const test = require("node:test");
const assert = require("node:assert/strict");
const { lib, arc, vectors, encodeV2, fakeWorld, tallyJson, SIGNER, TARGET, REPO } = require("./helpers");

const registry = lib("registry.js");
const { checkRepoProof, judgeEntries, matchEntries } = lib("repo-proof.js");
const { lookup } = lib("lookup.js");
const status = lib("status.js");

const v = vectors("repo-signer.json");
const FILE = "https://raw.githubusercontent.com/acme/vault/HEAD/tally.json";
const OTHER = "0x2222222222222222222222222222222222222222";
const REG_V2 = "0x4444444444444444444444444444444444444444";
const REG_V1 = "0x459Cab32306c439a408cA6b8672CcF6c6A0536d9";
const sel = registry.GET_REGISTRATION;

for (const c of v.cases) {
  test("tally.json wallet rule (shared vectors): " + c.name, () => {
    const signer = c.recordSigner === undefined ? v.signer : c.recordSigner === null ? undefined : c.recordSigner;
    const got = judgeEntries(matchEntries(c.contracts, v.chainId, v.address), signer);
    assert.equal(got.status, c.expect.status);
    assert.equal(got.bound, c.expect.bound);
    assert.equal(got.named, c.expect.named);
  });
}

const run = (entries, signer) => checkRepoProof({ repoUrl: REPO, chainId: 5042, address: TARGET, signer, fetchImpl: fakeWorld({ files: { [FILE]: tallyJson(...entries) } }) });

test("checkRepoProof confirms and binds when the file names the signer", async () => {
  const r = await run([{ chainId: 5042, address: TARGET, signer: SIGNER }], SIGNER);
  assert.equal(r.status, "confirmed");
  assert.equal(r.bound, true);
});

test("checkRepoProof reports a mismatch, with the wallet named, when the file names someone else", async () => {
  const r = await run([{ chainId: 5042, address: TARGET, signer: OTHER }], SIGNER);
  assert.equal(r.status, "signer-mismatch");
  assert.equal(r.named, OTHER);
});

test("checkRepoProof still confirms an entry that names no wallet", async () => {
  const r = await run([{ chainId: 5042, address: TARGET }], SIGNER);
  assert.equal(r.status, "confirmed");
  assert.equal(r.bound, false);
});

const none = encodeV2({ repo: "", signer: "0x0000000000000000000000000000000000000000", at: 0n, prov: 0, method: 0, flags: 0 });
const chain = { ...arc, registries: [{ version: 2, address: REG_V2 }, { version: 1, address: REG_V1 }] };
const rpc = { [REG_V2.toLowerCase()]: { [sel]: encodeV2({ signer: SIGNER }) }, [REG_V1.toLowerCase()]: { [sel]: none } };
const level = async (entries) => lookup({ chain, address: TARGET, fetchImpl: fakeWorld({ rpc, files: { [FILE]: tallyJson(...entries) } }) });

test("the level is verified when the repository names the wallet that registered it", async () => {
  assert.equal((await level([{ chainId: 5042, address: TARGET, signer: SIGNER }])).level, "verified");
});

test("the level is verified when the repository lists the contract and names no wallet", async () => {
  assert.equal((await level([{ chainId: 5042, address: TARGET }])).level, "verified");
});

test("the level is NOT verified when the repository names a different wallet, and it says why", async () => {
  const r = await level([{ chainId: 5042, address: TARGET, signer: OTHER }]);
  assert.equal(r.level, "control-proven");
  assert.match(status.describe(r.level, r.registration, r.repo), /names a different wallet/);
});
