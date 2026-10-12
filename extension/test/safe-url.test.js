const test = require("node:test");
const assert = require("node:assert/strict");
const { lib, chains, vectors } = require("./helpers");

const safe = lib("safe-url.js");

test("parseGithubRepo matches the shared vectors", () => {
  for (const v of vectors("safe-url.json").parseGithubRepo) {
    assert.deepEqual(safe.parseGithubRepo(v.input), v.expected, `${JSON.stringify(v.input)} (${v.why || "ok"})`);
  }
});

test("isAddress matches the shared vectors", () => {
  for (const v of vectors("safe-url.json").isAddress) {
    assert.equal(safe.isAddress(v.input), v.expected, JSON.stringify(v.input));
  }
});

test("the canonical URL is the only thing that can be linked", () => {
  const parsed = safe.parseGithubRepo("https://github.com/owner/repo/tree/main/x.git");
  assert.equal(parsed.url, "https://github.com/owner/repo");
  assert.equal(safe.tallyJsonUrl(parsed), "https://raw.githubusercontent.com/owner/repo/HEAD/tally.json");
});

test("displayText strips invisible and bidi characters and truncates", () => {
  assert.equal(safe.displayText("ab\u202ecd\u200bef\u0000g"), "abcdefg");
  assert.equal(safe.displayText("x".repeat(100), 10), "xxxxxxxxx\u2026");
  assert.equal(safe.displayText(42), "");
});

test("shorten", () => {
  assert.equal(safe.shorten("0x0f399C0143CAd70b43D18a5696026B0cEdcA0cCb"), "0x0f39\u2026" + "0cCb");
  assert.equal(safe.shorten("nope"), "");
});

test("chainForHostname maps explorer hosts to chains and nothing else", () => {
  assert.equal(safe.chainForHostname(chains, "explorer.arc.io").key, "arc");
  assert.equal(safe.chainForHostname(chains, "EXPLORER.ARC.IO").key, "arc");
  assert.equal(safe.chainForHostname(chains, "explorer.testnet.arc.io").key, "arc-testnet");
  assert.equal(safe.chainForHostname(chains, "explorer.arc.io.evil.example"), null);
  assert.equal(safe.chainForHostname(chains, "evil.example"), null);
  assert.equal(safe.chainForHostname(chains, undefined), null);
});

test("studio URLs are built from configuration only", () => {
  const arc = safe.chainByKey(chains, "arc");
  const address = "0x0f399C0143CAd70b43D18a5696026B0cEdcA0cCb";
  assert.equal(safe.studioDetailUrl(chains, arc, address), `${chains.studioUrl}/c/${address}?chain=arc`);
  assert.equal(safe.studioRegisterUrl(chains, arc, address), `${chains.studioUrl}/register?address=${address}&chain=arc`);
});
