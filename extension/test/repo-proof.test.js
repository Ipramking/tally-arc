const test = require("node:test");
const assert = require("node:assert/strict");
const { lib, fakeFetch, textResponse, tallyJson, TARGET } = require("./helpers");

const proof = lib("repo-proof.js");
const REPO = "https://github.com/acme/vault";
const URL_OF = "https://raw.githubusercontent.com/acme/vault/HEAD/tally.json";
const check = (fetchImpl, overrides = {}) =>
  proof.checkRepoProof({ repoUrl: REPO, chainId: 5042, address: TARGET, fetchImpl, ...overrides });
const serving = (body, init) => fakeFetch(() => textResponse(body, init));

test("confirmed when tally.json lists this chain and address", async () => {
  const fetchImpl = serving(tallyJson({ chainId: 1, address: TARGET }, { chainId: 5042, address: TARGET }));
  assert.deepEqual(await check(fetchImpl), { status: "confirmed", url: URL_OF });
  assert.equal(fetchImpl.calls[0].url, URL_OF);
});

test("address comparison ignores case, extra fields are tolerated", async () => {
  const body = JSON.stringify({ version: 1, name: "Vault", contracts: [{ chainId: 5042, address: TARGET.toLowerCase(), label: "main" }] });
  assert.equal((await check(serving(body))).status, "confirmed");
});

test("requests are locked down", async () => {
  const fetchImpl = serving(tallyJson());
  await check(fetchImpl);
  const { init } = fetchImpl.calls[0];
  assert.equal(init.credentials, "omit");
  assert.equal(init.redirect, "error");
  assert.equal(init.method, "GET");
});

test("not-listed: right file, wrong chain or address", async () => {
  assert.equal((await check(serving(tallyJson({ chainId: 1, address: TARGET })))).status, "not-listed");
  assert.equal((await check(serving(tallyJson({ chainId: 5042, address: "0x" + "9".repeat(40) })))).status, "not-listed");
  assert.equal((await check(serving(tallyJson()))).status, "not-listed");
});

test("chainId must be a number, address a valid address string", async () => {
  assert.equal((await check(serving(tallyJson({ chainId: "5042", address: TARGET })))).status, "not-listed");
  assert.equal((await check(serving(tallyJson({ chainId: 5042, address: [TARGET] })))).status, "not-listed");
  assert.equal((await check(serving(tallyJson(null, 7, "x")))).status, "not-listed");
});

test("no-file on 404, unavailable on other HTTP errors", async () => {
  assert.equal((await check(serving("", { status: 404 }))).status, "no-file");
  for (const status of [403, 429, 500, 502]) {
    const result = await check(serving("", { status }));
    assert.equal(result.status, "unavailable", String(status));
    assert.equal(result.detail, "HTTP " + status);
  }
});

test("redirects, network errors and timeouts are 'unavailable', never followed", async () => {
  const redirect = fakeFetch(() => { throw new TypeError("redirect mode is set to error"); });
  assert.equal((await check(redirect)).status, "unavailable");
  const timeout = fakeFetch(() => { throw new DOMException("The operation timed out", "TimeoutError"); });
  const result = await check(timeout);
  assert.equal(result.status, "unavailable");
  assert.equal(result.detail, "timeout");
});

test("invalid-file for malformed or unexpected content", async () => {
  const bad = ["not json", "[]", "null", '"x"', "{}", '{"version":2,"contracts":[]}', '{"version":1}', '{"version":1,"contracts":{}}', '{"version":"1","contracts":[]}'];
  for (const body of bad) assert.equal((await check(serving(body))).status, "invalid-file", body);
});

test("invalid-file when the file is too large, even without a content-length", async () => {
  const huge = "x".repeat(proof.MAX_FILE_BYTES + 1);
  assert.deepEqual((await check(serving(huge))).detail, "too large");
  const declared = serving("{}", { headers: { "content-length": String(proof.MAX_FILE_BYTES + 1) } });
  assert.equal((await check(declared)).status, "invalid-file");
});

test("only the first 1000 entries of contracts are read", async () => {
  const filler = Array.from({ length: 1000 }, () => 1);
  const late = JSON.stringify({ version: 1, contracts: [...filler, { chainId: 5042, address: TARGET }] });
  assert.equal((await check(serving(late))).status, "not-listed");
  const early = JSON.stringify({ version: 1, contracts: [...filler.slice(1), { chainId: 5042, address: TARGET }] });
  assert.equal((await check(serving(early))).status, "confirmed");
});

test("invalid-repo for anything that is not a plain github.com repository, without any request", async () => {
  for (const repoUrl of ["javascript:alert(1)", "https://evil.example/acme/vault", "https://github.com/acme", "", null]) {
    const fetchImpl = serving(tallyJson());
    const result = await check(fetchImpl, { repoUrl });
    assert.equal(result.status, "invalid-repo", String(repoUrl));
    assert.equal(fetchImpl.calls.length, 0, "no request for " + String(repoUrl));
  }
});

test("path segments after owner/repo never change which file is fetched", async () => {
  const fetchImpl = serving(tallyJson({ chainId: 5042, address: TARGET }));
  await check(fetchImpl, { repoUrl: "https://github.com/acme/vault/tree/main/contracts" });
  assert.equal(fetchImpl.calls[0].url, URL_OF);
});
