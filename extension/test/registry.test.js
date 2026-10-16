const test = require("node:test");
const assert = require("node:assert/strict");
const { toFunctionSelector, encodeFunctionData, parseAbi } = require("viem");
const { lib, arc, encodeV1, encodeV2, encodeAddressWord, fakeFetch, fakeWorld, SIGNER, TARGET, REPO } = require("./helpers");

const registry = lib("registry.js");
const OTHER = "0x2222222222222222222222222222222222222222";
const REG_V2 = "0x3333333333333333333333333333333333333333";

/** Replace 32-byte word `index` of an ABI blob. */
function setWord(hex, index, valueHex) {
  const body = hex.slice(2);
  return "0x" + body.slice(0, index * 64) + valueHex.replace(/^0x/, "").padStart(64, "0") + body.slice(index * 64 + 64);
}

test("selectors and call encoding match viem", () => {
  assert.equal(registry.GET_REGISTRATION, toFunctionSelector("getRegistration(address)"));
  assert.equal(registry.OWNER, toFunctionSelector("owner()"));
  const viemData = encodeFunctionData({ abi: parseAbi(["function getRegistration(address)"]), functionName: "getRegistration", args: [TARGET] });
  assert.equal(registry.encodeGetRegistration(TARGET), viemData.toLowerCase());
  assert.throws(() => registry.encodeGetRegistration("0x1234"), TypeError);
});

test("decodes a v1 owner-proven record", () => {
  const record = registry.decodeRegistration(1, encodeV1({ hash: "abc123", prov: 2 }));
  assert.deepEqual(record, {
    registryVersion: 1,
    githubRepo: REPO,
    buildHash: "abc123",
    signer: SIGNER,
    registeredAt: 1700000000,
    provenance: "CONTROL_PROVEN",
    method: "OWNER",
    controlCurrent: null,
    codeCurrent: null,
    upgradeable: null,
    v1Verified: true,
  });
});

test("decodes v1 self-attested and empty records", () => {
  const self = registry.decodeRegistration(1, encodeV1({ prov: 1 }));
  assert.equal(self.provenance, "SELF_ATTESTED");
  assert.equal(self.method, "NONE");
  const none = registry.decodeRegistration(1, encodeV1({ repo: "", owner: "0x0000000000000000000000000000000000000000", at: 0n, prov: 0 }));
  assert.equal(none.provenance, "NONE");
  assert.equal(none.githubRepo, "");
});

test("decodes every v2 method and flag combination", () => {
  const methods = ["NONE", "OWNER", "ADMIN_ROLE", "DEPLOYER"];
  for (let method = 0; method < 4; method++) {
    for (let flags = 0; flags < 4; flags++) {
      const record = registry.decodeRegistration(2, encodeV2({ method, flags, prov: method === 0 ? 1 : 2 }));
      assert.equal(record.method, methods[method]);
      assert.equal(record.controlCurrent, (flags & 1) !== 0);
      assert.equal(record.codeCurrent, (flags & 2) !== 0);
      assert.equal(record.registryVersion, 2);
    }
  }
});

test("round-trips non-ASCII text", () => {
  const record = registry.decodeRegistration(2, encodeV2({ repo: "https://github.com/h\u00e9llo/w\u00f6rld", hash: "\u2713" }));
  assert.equal(record.githubRepo, "https://github.com/h\u00e9llo/w\u00f6rld");
  assert.equal(record.buildHash, "\u2713");
});

test("a v1 reader still decodes the first six outputs of a v2 response", () => {
  // v2 is layout-compatible with v1 for old clients, but offsets differ, so a
  // v1 decode of a v2 blob must either work or fail loudly, never mis-parse.
  const blob = encodeV2();
  try {
    const record = registry.decodeRegistration(1, blob);
    assert.equal(record.githubRepo, REPO);
    assert.equal(record.signer, SIGNER);
  } catch (error) {
    assert.equal(error.name, "DecodeError");
  }
});

test("malformed data throws DecodeError and never half-parses", () => {
  const good1 = encodeV1();
  const good2 = encodeV2();
  const cases = [
    ["empty result", "0x"],
    ["not hex", "0xzz"],
    ["odd length", good1 + "0"],
    ["no 0x", good1.slice(2)],
    ["not a string", 42],
    ["truncated head", good1.slice(0, 2 + 64 * 3)],
    ["truncated tail", good1.slice(0, good1.length - 64)],
    ["string offset past end", setWord(good1, 0, "ffff00")],
    ["string offset inside head", setWord(good1, 0, "40")],
    ["misaligned offset", setWord(good1, 0, "c1")],
    ["huge string length", setWord(good1, 6, "ffffffff")],
    ["length over the cap", setWord(good1, 6, "2000")],
    ["dirty address", setWord(good1, 2, "ff" + "00".repeat(11) + "11".repeat(20))],
    ["provenance 3", setWord(good1, 4, "03")],
    ["bool 2", setWord(good1, 5, "02")],
    ["timestamp overflow", setWord(good1, 3, "ff".repeat(32))],
  ];
  for (const [name, data] of cases) {
    assert.throws(() => registry.decodeRegistration(1, data), (e) => e.name === "DecodeError", name);
  }
  assert.throws(() => registry.decodeRegistration(2, setWord(good2, 6, "04")), (e) => e.name === "DecodeError", "method 4");
  assert.throws(() => registry.decodeRegistration(2, setWord(good2, 7, "0100")), (e) => e.name === "DecodeError", "flags > 255");
  assert.throws(() => registry.decodeRegistration(3, good2), TypeError);
});

test("ethCall sends a locked-down JSON-RPC request", async () => {
  const fetchImpl = fakeFetch(() => Response.json({ jsonrpc: "2.0", id: 1, result: "0x1234" }));
  const result = await registry.ethCall("https://rpc.example", TARGET, "0xabcdef", fetchImpl);
  assert.equal(result, "0x1234");
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, "https://rpc.example");
  assert.equal(init.method, "POST");
  assert.equal(init.credentials, "omit");
  assert.equal(init.redirect, "error");
  assert.deepEqual(JSON.parse(init.body).params, [{ to: TARGET, data: "0xabcdef" }, "latest"]);
});

test("ethCall classifies failures", async () => {
  const run = (handler) => registry.ethCall("https://rpc.example", TARGET, "0x", fakeFetch(handler));
  await assert.rejects(run(() => new Response("", { status: 503 })), /HTTP 503/);
  await assert.rejects(run(() => new Response("<html>", { status: 200 })), /invalid JSON/);
  await assert.rejects(run(() => Response.json({ result: 5 })), /no result/);
  await assert.rejects(run(() => Response.json({})), /no result/);
  await assert.rejects(run(() => new Response("x".repeat(70 * 1024))), /too large/);
  await assert.rejects(run(() => { throw new TypeError("fetch failed"); }), /fetch failed/);

  const revert = await run(() => Response.json({ error: { code: 3, message: "execution reverted" } })).catch((e) => e);
  assert.equal(revert.name, "RpcError");
  assert.equal(revert.revert, true);
  const revert2 = await run(() => Response.json({ error: { code: -32000, message: "execution reverted: nope" } })).catch((e) => e);
  assert.equal(revert2.revert, true);
  const other = await run(() => Response.json({ error: { code: -32005, message: "rate limited" } })).catch((e) => e);
  assert.equal(other.revert, false);
  assert.match(other.message, /rate limited/);
});

test("readRegistry reads and tags the registry address", async () => {
  const world = fakeWorld({ rpc: { [REG_V2]: { [registry.GET_REGISTRATION]: encodeV2() } } });
  const record = await registry.readRegistry(arc, { version: 2, address: REG_V2 }, TARGET, world);
  assert.equal(record.registry, REG_V2);
  assert.equal(record.githubRepo, REPO);
  assert.equal(world.calls.length, 1);
});

test("v1ControlCurrent compares owner() with the recorded signer", async () => {
  const ask = (reply) => registry.v1ControlCurrent(arc, TARGET, SIGNER, fakeWorld({ rpc: { [TARGET.toLowerCase()]: { [registry.OWNER]: reply } } }));
  assert.equal(await ask(encodeAddressWord(SIGNER)), true);
  assert.equal(await ask(encodeAddressWord(SIGNER.toUpperCase().replace("0X", "0x"))), true);
  assert.equal(await ask(encodeAddressWord(OTHER)), false);
  assert.equal(await ask({ error: { code: 3, message: "execution reverted" } }), false, "no owner() at all");
  assert.equal(await ask("0x"), false, "empty return");
  assert.equal(await ask("0x1234"), false, "short return");
  const failing = fakeFetch(() => { throw new TypeError("network down"); });
  await assert.rejects(registry.v1ControlCurrent(arc, TARGET, SIGNER, failing), /network down/);
});
