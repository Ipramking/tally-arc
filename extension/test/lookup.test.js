const test = require("node:test");
const assert = require("node:assert/strict");
const { lib, arc, encodeV1, encodeV2, encodeAddressWord, fakeWorld, tallyJson, SIGNER, TARGET, REPO } = require("./helpers");

const registry = lib("registry.js");
const { lookup } = lib("lookup.js");

const REG_V1 = "0x459Cab32306c439a408cA6b8672CcF6c6A0536d9";
const REG_V2 = "0x4444444444444444444444444444444444444444";
const FILE = "https://raw.githubusercontent.com/acme/vault/HEAD/tally.json";
const LISTS_TARGET = tallyJson({ chainId: 5042, address: TARGET });
const sel = registry.GET_REGISTRATION;
const none = (version) => (version === 1 ? encodeV1({ repo: "", owner: "0x0000000000000000000000000000000000000000", at: 0n, prov: 0 }) : encodeV2({ repo: "", signer: "0x0000000000000000000000000000000000000000", at: 0n, prov: 0, method: 0, flags: 0 }));

const both = { ...arc, registries: [{ version: 2, address: REG_V2 }, { version: 1, address: REG_V1 }] };
const v1only = { ...arc, registries: [{ version: 1, address: REG_V1 }] };
const rpcFor = (map) => Object.fromEntries(Object.entries(map).map(([to, reply]) => [to.toLowerCase(), reply]));
const run = (chain, world) => lookup({ chain, address: TARGET, fetchImpl: world });

test("unregistered everywhere is 'unverified'", async () => {
  const world = fakeWorld({ rpc: rpcFor({ [REG_V2]: { [sel]: none(2) }, [REG_V1]: { [sel]: none(1) } }) });
  const result = await run(both, world);
  assert.equal(result.ok, true);
  assert.equal(result.level, "unverified");
  assert.equal(result.registration, null);
  assert.equal(world.calls.filter((c) => c.url.includes("raw.githubusercontent")).length, 0, "no repo request when there is no record");
});

test("v2 control proof + live control + unchanged code + listed repo is 'verified'", async () => {
  const world = fakeWorld({ rpc: rpcFor({ [REG_V2]: { [sel]: encodeV2() }, [REG_V1]: { [sel]: none(1) } }), files: { [FILE]: LISTS_TARGET } });
  const result = await run(both, world);
  assert.equal(result.level, "verified");
  assert.equal(result.repoLink, REPO);
  assert.equal(result.repo.status, "confirmed");
});

test("v2 proof without a tally.json entry stays 'control-proven'", async () => {
  const world = fakeWorld({ rpc: rpcFor({ [REG_V2]: { [sel]: encodeV2() }, [REG_V1]: { [sel]: none(1) } }), files: {} });
  const result = await run(both, world);
  assert.equal(result.level, "control-proven");
  assert.equal(result.repo.status, "no-file");
});

test("v2 record whose control was lost or code changed is 'stale' and skips the repo check", async () => {
  for (const flags of [0, 1, 2]) {
    const world = fakeWorld({ rpc: rpcFor({ [REG_V2]: { [sel]: encodeV2({ flags }) }, [REG_V1]: { [sel]: none(1) } }), files: { [FILE]: LISTS_TARGET } });
    const result = await run(both, world);
    assert.equal(result.level, "stale", "flags " + flags);
    assert.equal(result.repo, null);
  }
});

test("v2 self-attested record is 'self-attested' and never verified, even if the repo lists it", async () => {
  const world = fakeWorld({ rpc: rpcFor({ [REG_V2]: { [sel]: encodeV2({ prov: 1, method: 0, flags: 2 }) }, [REG_V1]: { [sel]: none(1) } }), files: { [FILE]: LISTS_TARGET } });
  assert.equal((await run(both, world)).level, "self-attested");
});

test("v1: live owner is 'control-proven' at best (v1 cannot track code)", async () => {
  const world = fakeWorld({
    rpc: rpcFor({ [REG_V1]: { [sel]: encodeV1() }, [TARGET]: { [registry.OWNER]: encodeAddressWord(SIGNER) } }),
    files: { [FILE]: LISTS_TARGET },
  });
  const result = await run(v1only, world);
  assert.equal(result.level, "control-proven");
  assert.equal(result.repo.status, "confirmed");
  assert.equal(result.registration.controlCurrent, true);
});

test("v1: after an ownership transfer the record is 'stale', not owner-proven forever", async () => {
  const world = fakeWorld({
    rpc: rpcFor({ [REG_V1]: { [sel]: encodeV1() }, [TARGET]: { [registry.OWNER]: encodeAddressWord("0x9999999999999999999999999999999999999999") } }),
    files: { [FILE]: LISTS_TARGET },
  });
  const result = await run(v1only, world);
  assert.equal(result.level, "stale");
  assert.equal(result.registration.controlCurrent, false);
});

test("v1: a target with no owner() at all is stale for a recorded owner", async () => {
  const world = fakeWorld({ rpc: rpcFor({ [REG_V1]: { [sel]: encodeV1() } }) });
  assert.equal((await run(v1only, world)).level, "stale");
});

test("a newer self-attested record cannot hide an older live control proof", async () => {
  const world = fakeWorld({
    rpc: rpcFor({
      [REG_V2]: { [sel]: encodeV2({ repo: "https://github.com/evil/fake", prov: 1, method: 0, flags: 2 }) },
      [REG_V1]: { [sel]: encodeV1() },
      [TARGET]: { [registry.OWNER]: encodeAddressWord(SIGNER) },
    }),
    files: { [FILE]: LISTS_TARGET },
  });
  const result = await run(both, world);
  assert.equal(result.level, "control-proven");
  assert.equal(result.repoLink, REPO);
});

test("any unreadable registry makes the answer 'unknown', never 'unverified'", async () => {
  const down = new TypeError("network down");
  const newestDown = fakeWorld({ rpc: rpcFor({ [REG_V2]: { [sel]: down }, [REG_V1]: { [sel]: none(1) } }) });
  const a = await run(both, newestDown);
  assert.equal(a.ok, false);
  assert.equal(a.level, "unknown");
  const oldestDown = fakeWorld({ rpc: rpcFor({ [REG_V2]: { [sel]: none(2) }, [REG_V1]: { [sel]: down } }) });
  assert.equal((await run(both, oldestDown)).level, "unknown");
});

test("a registry with no code (empty eth_call) is an error, not 'unverified'", async () => {
  const world = fakeWorld({ rpc: rpcFor({ [REG_V1]: { [sel]: "0x" } }) });
  const result = await run(v1only, world);
  assert.equal(result.level, "unknown");
  assert.match(result.error, /empty result/);
});

test("garbage from the RPC is 'unknown'", async () => {
  const world = fakeWorld({ rpc: rpcFor({ [REG_V1]: { [sel]: "0xdeadbeef" } }) });
  assert.equal((await run(v1only, world)).level, "unknown");
});

test("invalid address and chains without registries are 'unknown' with a reason", async () => {
  assert.equal((await lookup({ chain: arc, address: "nope", fetchImpl: fakeWorld() })).error, "invalid address");
  const empty = await lookup({ chain: { ...arc, registries: [] }, address: TARGET, fetchImpl: fakeWorld() });
  assert.match(empty.error, /no registry deployed/);
});

test("a hostile on-chain repo string never reaches a request or a link", async () => {
  const evil = "javascript:alert(document.cookie)";
  const world = fakeWorld({ rpc: rpcFor({ [REG_V2]: { [sel]: encodeV2({ repo: evil }) }, [REG_V1]: { [sel]: none(1) } }) });
  const result = await run(both, world);
  assert.equal(result.level, "control-proven");
  assert.equal(result.repo.status, "invalid-repo");
  assert.equal(result.repoLink, null);
  assert.equal(world.calls.filter((c) => c.url.includes("raw.githubusercontent")).length, 0);
});
