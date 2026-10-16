const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { root, lib, chains, arc, registryRpc, v1Registry, encodeV1, encodeV2, fakeWorld, tallyJson, SIGNER, TARGET } = require("./helpers");

for (const name of ["net.js", "safe-url.js", "registry.js", "repo-proof.js", "status.js", "lookup.js"]) lib(name);
const registry = lib("registry.js");
const background = require(path.join(root, "background.js"));

const REG_V1 = v1Registry(arc);
const sel = registry.GET_REGISTRATION;
const FILE = "https://raw.githubusercontent.com/acme/vault/HEAD/tally.json";
const fromArc = { id: "tally-extension", url: `https://explorer.arc.io/address/${TARGET}` };
const lookupMsg = (address = TARGET, extra = {}) => ({ type: "tally:lookup", address, ...extra });
// Every registry the chain table lists answers "no record" unless a test says otherwise, so these
// tests keep working when chains.json lists a newer registry.
const rpcWith = (answers = {}) => registryRpc(arc, sel, answers);
const registered = () => fakeWorld({ rpc: rpcWith() });

test.beforeEach(() => background.cache.clear());

test("rejects bad input without touching the network", async () => {
  const world = registered();
  assert.equal(await background.handleLookup({ type: "other" }, fromArc, world), null);
  assert.equal(await background.handleLookup(null, fromArc, world), null);
  assert.deepEqual(await background.handleLookup(lookupMsg("0x123"), fromArc, world), { ok: false, level: "unknown", error: "invalid address" });
  assert.deepEqual(await background.handleLookup(lookupMsg(), { url: "https://evil.example/" }, world), { ok: false, level: "unknown", error: "unsupported page" });
  assert.deepEqual(await background.handleLookup(lookupMsg(), {}, world), { ok: false, level: "unknown", error: "unsupported page" });
  assert.deepEqual(await background.handleLookup(lookupMsg(), { url: "not a url" }, world), { ok: false, level: "unknown", error: "unsupported page" });
  assert.equal(world.calls.length, 0);
});

test("an unregistered contract points the badge at its record page, never the register form", async () => {
  const result = await background.handleLookup(lookupMsg(), fromArc, registered());
  assert.equal(result.ok, true);
  assert.equal(result.level, "unverified");
  assert.equal(result.href, `${chains.studioUrl}/c/${TARGET}?chain=arc`);
  assert.doesNotMatch(result.href, /\/register/);
  assert.match(result.summary, /No Tally record/);
});

test("a registered contract points the badge at its record page", async () => {
  const world = fakeWorld({
    rpc: rpcWith({ [REG_V1]: encodeV1({ repo: "https://github.com/acme/vault", prov: 1 }) }),
  });
  const result = await background.handleLookup(lookupMsg(), fromArc, world);
  assert.equal(result.level, "self-attested");
  assert.equal(result.href, `${chains.studioUrl}/c/${TARGET}?chain=arc`);
});

test("the chain comes from the sender's page, never from the message", async () => {
  const world = registered();
  const onTestnet = { id: "tally-extension", url: "https://explorer.testnet.arc.io/" };
  const result = await background.handleLookup(lookupMsg(TARGET, { chain: "arc", chainId: 5042, rpcUrl: "https://evil.example" }), onTestnet, world);
  assert.equal(result.ok, false);
  assert.equal(result.level, "unknown");
  assert.equal(world.calls.length, 0, "arc-testnet has no registry, so nothing is queried and the message's chain is ignored");
});

test("RPC failure becomes an 'unknown' answer with a plain sentence", async () => {
  const world = fakeWorld({ rpc: rpcWith({ [REG_V1]: new TypeError("network down") }) });
  const result = await background.handleLookup(lookupMsg(), fromArc, world);
  assert.equal(result.ok, false);
  assert.equal(result.level, "unknown");
  assert.match(result.summary, /Could not read the registry/);
});

test("answers are cached and concurrent asks share one lookup", async () => {
  const world = registered();
  const [a, b] = await Promise.all([background.handleLookup(lookupMsg(), fromArc, world), background.handleLookup(lookupMsg(TARGET.toLowerCase()), fromArc, world)]);
  assert.deepEqual(a, b);
  const callsAfterFirst = world.calls.length;
  await background.handleLookup(lookupMsg(), fromArc, world);
  assert.equal(world.calls.length, callsAfterFirst, "second ask served from cache");
});

test("successful answers expire after about a minute, failures after seconds", async () => {
  const world = registered();
  await background.handleLookup(lookupMsg(), fromArc, world);
  const entry = [...background.cache.values()][0];
  const ttl = entry.expires - Date.now();
  assert.ok(ttl > 55_000 && ttl <= 60_000, `ok ttl ${ttl}`);

  background.cache.clear();
  const failing = fakeWorld({ rpc: rpcWith({ [REG_V1]: new TypeError("down") }) });
  await background.handleLookup(lookupMsg(), fromArc, failing);
  await new Promise((r) => setTimeout(r, 5));
  const failed = [...background.cache.values()][0];
  const failTtl = failed.expires - Date.now();
  assert.ok(failTtl > 0 && failTtl <= 10_000, `failure ttl ${failTtl}`);

  failed.expires = Date.now() - 1; // expired: asks again
  const before = failing.calls.length;
  await background.handleLookup(lookupMsg(), fromArc, failing);
  assert.ok(failing.calls.length > before);
});

test("the cache is bounded", async () => {
  const world = registered();
  for (let i = 1; i <= 520; i++) {
    await background.handleLookup(lookupMsg("0x" + i.toString(16).padStart(40, "0")), fromArc, world);
  }
  assert.ok(background.cache.size <= 500, `size ${background.cache.size}`);
});

test("a verified record flows all the way through", async () => {
  // v1 only has a legacy registry on arc, so build a v2 chain view for the lookup.
  const v2 = "0x4444444444444444444444444444444444444444";
  const original = chains.chains[0].registries;
  const arc = chains.chains[0];
  const saved = [...original];
  try {
    arc.registries.splice(0, arc.registries.length, { version: 2, address: v2 });
    const world = fakeWorld({
      rpc: { [v2]: { [sel]: encodeV2({ repo: "https://github.com/acme/vault" }) } },
      files: { [FILE]: tallyJson({ chainId: 5042, address: TARGET, signer: SIGNER }) },
    });
    const result = await background.handleLookup(lookupMsg(), fromArc, world);
    assert.equal(result.level, "verified");
    assert.match(result.summary, /repository lists this contract/);
  } finally {
    arc.registries.splice(0, arc.registries.length, ...saved);
  }
});

test("the message listener only answers the extension's own contexts", async () => {
  const listeners = [];
  const savedFetch = globalThis.fetch;
  globalThis.chrome = { runtime: { id: "tally-extension", onMessage: { addListener: (fn) => listeners.push(fn) } } };
  try {
    delete require.cache[require.resolve(path.join(root, "background.js"))];
    require(path.join(root, "background.js"));
    assert.equal(listeners.length, 1);
    const [listener] = listeners;

    assert.equal(listener(lookupMsg(), { id: "someone-else", url: fromArc.url }, () => assert.fail("must not answer")), false);
    assert.equal(listener({ type: "nope" }, fromArc, () => assert.fail("must not answer")), false);

    globalThis.fetch = registered();
    const answer = await new Promise((resolve) => {
      assert.equal(listener(lookupMsg(), fromArc, resolve), true, "keeps the channel open");
    });
    assert.equal(answer.level, "unverified");
  } finally {
    globalThis.fetch = savedFetch;
    delete globalThis.chrome;
  }
});
