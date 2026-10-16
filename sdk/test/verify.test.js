const test = require("node:test");
const assert = require("node:assert/strict");
const { lib, arc, encodeV1, encodeV2, encodeNone, encodeAddressWord, registryRpc, fakeWorld, SIGNER, TARGET } = require("../../extension/test/helpers");
const { verifyTallyFile, exitCodeFor } = require("../verify.js");

const registry = lib("registry.js");
const sel = registry.GET_REGISTRATION;

// A chain that is not in any table: nothing here depends on a particular network.
const REG_V2 = "0x4444444444444444444444444444444444444444";
const REG_V1 = "0x5555555555555555555555555555555555555555";
const chain = { ...arc, key: "test-chain", id: 31337, name: "Test Chain", registries: [{ version: 2, address: REG_V2 }, { version: 1, address: REG_V1 }] };
const chains = [chain];
const REPO = "acme/vault";
const OTHER = "0x2222222222222222222222222222222222222222";
const IMPL = encodeAddressWord("0x6666666666666666666666666666666666666666");

const entry = (extra = {}) => ({ chainId: 31337, address: TARGET, signer: SIGNER, ...extra });
const tallyOf = (...contracts) => ({ version: 1, contracts });
const rpcFor = (v2, v1) => registryRpc(chain, sel, { [REG_V2]: v2 ?? encodeNone(2), [REG_V1]: v1 ?? encodeNone(1) });
const run = (tally, world, extra = {}) => verifyTallyFile({ tally, chains, repository: REPO, fetchImpl: world, studioUrl: "https://studio.test", ...extra });
const codes = (summary, index = 0) => summary.results[index].problems.map((p) => p.code);

test("a contract that is registered, current and named by the file passes", async () => {
  const world = fakeWorld({ rpc: rpcFor(encodeV2()) });
  const summary = await run(tallyOf(entry()), world);
  assert.equal(summary.ok, true);
  assert.deepEqual([summary.errors, summary.warnings, summary.unknown], [0, 0, 0]);
  assert.equal(summary.results[0].level, "verified");
  assert.equal(summary.results[0].status, "ok");
  assert.equal(exitCodeFor(summary), 0);
});

test("the repository half is judged against the file in hand: nothing is fetched from GitHub", async () => {
  const world = fakeWorld({ rpc: rpcFor(encodeV2()) });
  await run(tallyOf(entry()), world);
  assert.equal(world.calls.filter((c) => c.url.includes("raw.githubusercontent")).length, 0);
});

test("a listed contract with no record on any registry fails and says where to register it", async () => {
  const summary = await run(tallyOf(entry()), fakeWorld({ rpc: rpcFor() }));
  assert.deepEqual(codes(summary), ["not-registered"]);
  assert.match(summary.results[0].problems[0].message, /https:\/\/studio\.test\/register\?address=0x0f39.*chain=test-chain/);
  assert.equal(exitCodeFor(summary), 1);
});

test("an address that holds no code is a wallet, not something to register", async () => {
  const summary = await run(tallyOf(entry()), fakeWorld({ rpc: rpcFor(), code: { [TARGET]: "0x" } }));
  assert.deepEqual(codes(summary), ["not-a-contract"]);
});

test("an entry without a signer fails, and the message gives the line to add", async () => {
  const summary = await run(tallyOf(entry({ signer: undefined })), fakeWorld({ rpc: rpcFor(encodeV2()) }));
  assert.deepEqual(codes(summary), ["signer-missing"]);
  assert.match(summary.results[0].problems[0].message, new RegExp(`"signer": "${SIGNER}"`));
});

test("an entry naming a different wallet than the one that registered fails", async () => {
  const summary = await run(tallyOf(entry({ signer: OTHER })), fakeWorld({ rpc: rpcFor(encodeV2()) }));
  assert.deepEqual(codes(summary), ["signer-mismatch"]);
});

test("a record that names another repository fails; the comparison ignores case and a path", async () => {
  const world = (repo) => fakeWorld({ rpc: rpcFor(encodeV2({ repo })) });
  assert.deepEqual(codes(await run(tallyOf(entry()), world("https://github.com/someone/else"))), ["other-repository"]);
  assert.deepEqual(codes(await run(tallyOf(entry()), world("https://github.com/ACME/Vault/tree/main/contracts"))), []);
  assert.deepEqual(codes(await run(tallyOf(entry()), world("https://github.com/someone/else"), { repository: undefined })), [], "no repository given: not checked");
});

test("control that moved, and code that changed, are stale and say which", async () => {
  const moved = await run(tallyOf(entry()), fakeWorld({ rpc: rpcFor(encodeV2({ flags: 2 })) }));
  assert.deepEqual(codes(moved), ["stale"]);
  assert.match(moved.results[0].problems[0].message, /control moved/);
  const changed = await run(tallyOf(entry()), fakeWorld({ rpc: rpcFor(encodeV2({ flags: 1 })) }));
  assert.deepEqual(codes(changed), ["stale"]);
  assert.match(changed.results[0].problems[0].message, /code at this address changed/);
});

test("a deployer whose contract now has another owner is stale", async () => {
  const world = fakeWorld({ rpc: { ...rpcFor(encodeV2({ method: 3 })), [TARGET.toLowerCase()]: { [registry.OWNER]: encodeAddressWord(OTHER) } } });
  assert.deepEqual(codes(await run(tallyOf(entry()), world)), ["stale"]);
});

test("an upgradeable proxy is a warning, not a failure, until --strict", async () => {
  const world = fakeWorld({ rpc: rpcFor(encodeV2()), storage: { [TARGET]: { [registry.EIP1967_IMPLEMENTATION_SLOT]: IMPL } } });
  const summary = await run(tallyOf(entry()), world);
  assert.deepEqual(codes(summary), ["proxy"]);
  assert.equal(summary.results[0].status, "warning");
  assert.equal(summary.ok, true);
  assert.equal(exitCodeFor(summary), 0);
  assert.equal(exitCodeFor(summary, { strict: true }), 1);
});

test("a record on the legacy registry is a warning", async () => {
  const world = fakeWorld({ rpc: { ...rpcFor(undefined, encodeV1()), [TARGET.toLowerCase()]: { [registry.OWNER]: encodeAddressWord(SIGNER) } } });
  assert.deepEqual(codes(await run(tallyOf(entry()), world)), ["legacy-registry"]);
});

test("a self-attested record is a warning", async () => {
  const world = fakeWorld({ rpc: rpcFor(encodeV2({ prov: 1, method: 0, flags: 2 })) });
  assert.deepEqual(codes(await run(tallyOf(entry()), world)), ["self-attested"]);
});

test("a chain that is unreadable is 'could not check' (exit 2), never a pass or a failure", async () => {
  const world = fakeWorld({ rpc: rpcFor(new TypeError("network down")) });
  const summary = await run(tallyOf(entry()), world);
  assert.deepEqual(codes(summary), ["unreadable"]);
  assert.equal(summary.results[0].status, "unknown");
  assert.equal(summary.ok, false);
  assert.equal(exitCodeFor(summary), 2);
});

test("a failure outranks 'could not check' in the exit code", async () => {
  const bad = entry({ chainId: 1 });
  const summary = await run(tallyOf(bad, entry()), fakeWorld({ rpc: rpcFor(new TypeError("down")) }));
  assert.equal(summary.errors, 1);
  assert.equal(summary.unknown, 1);
  assert.equal(exitCodeFor(summary), 1);
});

test("a chain id the table does not know, and a chain with no registry, fail with a reason", async () => {
  const unknown = await run(tallyOf(entry({ chainId: 12345 })), fakeWorld());
  assert.deepEqual(codes(unknown), ["unknown-chain"]);
  assert.match(unknown.results[0].problems[0].message, /--chains/);
  const noRegistry = await verifyTallyFile({ tally: tallyOf(entry()), chains: [{ ...chain, registries: [] }], fetchImpl: fakeWorld() });
  assert.deepEqual(codes(noRegistry), ["no-registry"]);
});

test("malformed files and entries fail instead of being skipped", async () => {
  for (const bad of [null, [], { version: 2, contracts: [] }, { version: 1 }, { version: 1, contracts: "x" }]) {
    assert.deepEqual(codes(await run(bad, fakeWorld())), ["invalid-file"], JSON.stringify(bad));
  }
  const entries = [null, {}, { chainId: "31337", address: TARGET }, { chainId: 31337, address: "0x123" }, entry({ signer: "nope" })];
  const summary = await run(tallyOf(...entries), fakeWorld());
  assert.deepEqual(summary.results.map((r) => r.problems[0].code), ["invalid-entry", "invalid-entry", "invalid-entry", "invalid-entry", "invalid-signer"]);
});

test("every entry is checked and reported, in order", async () => {
  const second = "0x0000000000000000000000000000000000000abc";
  const world = fakeWorld({ rpc: rpcFor(encodeV2()) });
  const summary = await run(tallyOf(entry(), entry({ address: second })), world);
  assert.equal(summary.results.length, 2);
  assert.deepEqual(summary.results.map((r) => r.index), [0, 1]);
});

test("a hostile on-chain repository string cannot make a record pass or crash the check", async () => {
  const world = fakeWorld({ rpc: rpcFor(encodeV2({ repo: "javascript:alert(1)" })) });
  const summary = await run(tallyOf(entry()), world);
  assert.deepEqual(codes(summary), ["other-repository"]);
  assert.match(summary.results[0].problems[0].message, /not a plain GitHub link/);
});
