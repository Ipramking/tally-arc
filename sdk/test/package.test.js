const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const api = require("../index.js");
const root = path.join(__dirname, "..");

test("the public API is what the types and the README promise", () => {
  const names = ["lookup", "describe", "LEVELS", "chains", "defaultChain", "studioUrl", "getChain", "verifyTallyFile", "exitCodeFor"];
  assert.deepEqual(Object.keys(api).sort(), [...names].sort());
  for (const name of ["lookup", "describe", "getChain", "verifyTallyFile", "exitCodeFor"]) assert.equal(typeof api[name], "function", name);

  const types = fs.readFileSync(path.join(root, "index.d.ts"), "utf8");
  for (const name of names) assert.match(types, new RegExp(`export (function|const) ${name}\\b`), `${name} is typed`);
});

test("lookup uses the global fetch and a default timeout when none is given, as the types promise", async () => {
  const { arc, lib, encodeV2, encodeNone, registryRpc, fakeWorld, TARGET } = require("../../extension/test/helpers");
  const sel = lib("registry.js").GET_REGISTRATION;
  const REG = "0x4444444444444444444444444444444444444444";
  const chain = { ...arc, key: "test-chain", id: 31337, name: "Test Chain", registries: [{ version: 2, address: REG }] };
  const world = fakeWorld({ rpc: registryRpc(chain, sel, { [REG]: encodeV2() }) });
  const original = globalThis.fetch;
  globalThis.fetch = world;
  try {
    const result = await api.lookup({ chain, address: TARGET });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.level, "control-proven", "a registered contract whose repository is not checked here");
    assert.ok(world.calls.length > 0, "it went through the global fetch");

    const quiet = fakeWorld({ rpc: registryRpc(chain, sel, { [REG]: encodeNone(2) }) });
    assert.equal((await api.lookup({ chain, address: TARGET, fetchImpl: quiet })).level, "unverified", "an explicit fetchImpl still wins");
  } finally {
    globalThis.fetch = original;
  }
});

test("getChain finds a chain by key or by id, and says null otherwise", () => {
  const first = api.chains[0];
  assert.equal(api.getChain(first.key), first);
  assert.equal(api.getChain(first.id), first);
  assert.equal(api.getChain(String(first.id)), first);
  assert.equal(api.getChain("no-such-chain"), null);
  assert.equal(api.getChain("x", [{ key: "x", id: 7 }]).id, 7);
});

test("the bundled table has the default chain and wording for every level", () => {
  assert.ok(api.getChain(api.defaultChain));
  assert.match(api.studioUrl, /^https:\/\//);
  assert.equal(api.LEVELS.verified.label, "Tally Verified");
  for (const level of ["verified", "control-proven", "stale", "self-attested", "unverified", "wallet", "unknown"]) assert.ok(api.LEVELS[level], level);
  assert.match(api.describe("unverified"), /No Tally record/);
});

test("the ES module entry exposes the same API", async () => {
  const esm = await import("../index.mjs");
  for (const name of Object.keys(api)) assert.equal(esm[name], api[name], name);
  assert.equal(esm.default, api);
});

test("package.json points at files that exist and publishes only what it needs", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  for (const file of [pkg.main, pkg.module, pkg.types, pkg.bin["tally-verify"], pkg.exports["."].import, pkg.exports["."].require, pkg.exports["."].types]) {
    assert.ok(fs.existsSync(path.join(root, file)), file);
  }
  assert.equal(pkg.license, "MIT");
  assert.deepEqual(pkg.dependencies ?? {}, {}, "no runtime dependencies");
  assert.ok(!pkg.files.includes("test"), "tests are not published");
});
