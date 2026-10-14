const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { root, chains, lib, encodeV1, encodeAddressWord, fakeWorld, tallyJson, TARGET, SIGNER } = require("./helpers");

const registry = lib("registry.js");
const HTML = fs.readFileSync(path.join(root, "popup/popup.html"), "utf8");
const SCRIPTS = ["chains.generated.js", "lib/net.js", "lib/safe-url.js", "lib/registry.js", "lib/repo-proof.js", "lib/status.js", "lib/lookup.js", "popup/popup.js"].map((f) => fs.readFileSync(path.join(root, f), "utf8"));
const REG_V1 = chains.chains[0].registries[0].address.toLowerCase();
const FILE = "https://raw.githubusercontent.com/acme/vault/HEAD/tally.json";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function open(fetchImpl) {
  const dom = new JSDOM(HTML, { url: "chrome-extension://tally/popup/popup.html", runScripts: "outside-only" });
  dom.window.fetch = fetchImpl;
  dom.window.TextDecoder = TextDecoder; // jsdom does not provide it; browsers do
  for (const source of SCRIPTS) dom.window.eval(source);
  const $ = (id) => dom.window.document.getElementById(id);
  const check = async (address) => {
    $("addr").value = address;
    $("form").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    for (let i = 0; i < 200 && $("result").className.includes("loading"); i++) await sleep(5);
    await sleep(5);
  };
  return { window: dom.window, document: dom.window.document, $, check };
}

const world = (extra = {}) =>
  fakeWorld({ rpc: { [REG_V1]: { [registry.GET_REGISTRATION]: encodeV1({ repo: "", owner: "0x0000000000000000000000000000000000000000", at: 0n, prov: 0 }) } }, ...extra });

test("lists the configured chains and shows presets only where they exist", () => {
  const { $, document } = open(world());
  assert.deepEqual([...$("chain").options].map((o) => o.value), ["arc", "arc-testnet"]);
  assert.equal($("chain").value, "arc");
  assert.equal($("presets").classList.contains("hidden"), false);
  $("chain").value = "arc-testnet";
  $("chain").dispatchEvent(new document.defaultView.Event("change"));
  assert.equal($("presets").classList.contains("hidden"), true);
  assert.equal($("studioLink").href, chains.studioUrl + "/");
});

test("rejects a malformed address without a request", async () => {
  const fetchImpl = world();
  const { $, check } = open(fetchImpl);
  await check("0x123");
  assert.match($("result").textContent, /valid 0x/);
  assert.equal(fetchImpl.calls.length, 0);
});

test("an unregistered address offers registration", async () => {
  const { $, check } = open(world());
  await check(TARGET);
  const box = $("result");
  assert.ok(box.classList.contains("unverified"));
  assert.match(box.textContent, /Unverified/);
  const cta = box.querySelector("a.cta");
  assert.equal(cta.getAttribute("href"), `${chains.studioUrl}/register?address=${TARGET}&chain=arc`);
  assert.equal(cta.rel, "noopener noreferrer");
});

test("a live v1 owner shows 'Control proven' with the canonical repo link", async () => {
  const fetchImpl = fakeWorld({
    rpc: {
      [REG_V1]: { [registry.GET_REGISTRATION]: encodeV1({ repo: "https://github.com/acme/vault/tree/main", hash: "abc123" }) },
      [TARGET.toLowerCase()]: { [registry.OWNER]: encodeAddressWord(SIGNER) },
    },
    files: { [FILE]: tallyJson({ chainId: 5042, address: TARGET }) },
  });
  const { $, check } = open(fetchImpl);
  await check(TARGET);
  const box = $("result");
  assert.ok(box.classList.contains("control-proven"));
  assert.match(box.textContent, /legacy v1/);
  const links = [...box.querySelectorAll("a")].map((a) => a.getAttribute("href"));
  assert.ok(links.includes("https://github.com/acme/vault"), "canonical repo URL, extra path dropped");
  assert.ok(links.includes(`${chains.studioUrl}/c/${TARGET}?chain=arc`));
  assert.match(box.querySelector("dl").textContent, /abc123/);
});

test("hostile on-chain strings are shown as text and never linked or parsed", async () => {
  const fetchImpl = fakeWorld({
    rpc: {
      [REG_V1]: { [registry.GET_REGISTRATION]: encodeV1({ repo: "javascript:alert(1)", hash: "<img src=x onerror=alert(1)>" }) },
      [TARGET.toLowerCase()]: { [registry.OWNER]: encodeAddressWord(SIGNER) },
    },
  });
  const { $, check, document } = open(fetchImpl);
  await check(TARGET);
  const box = $("result");
  assert.equal(document.querySelector("img"), null);
  const hrefs = [...box.querySelectorAll("a")].map((a) => a.getAttribute("href"));
  assert.ok(hrefs.every((h) => h.startsWith(chains.studioUrl + "/")), hrefs.join(","));
  assert.match(box.textContent, /javascript:alert\(1\)/, "shown, inert, as text");
  assert.match(box.textContent, /<img src=x/);
});

test("an RPC failure says so instead of claiming the contract is unverified", async () => {
  const failing = fakeWorld({ rpc: { [REG_V1]: { [registry.GET_REGISTRATION]: new TypeError("network down") } } });
  const { $, check } = open(failing);
  await check(TARGET);
  const box = $("result");
  assert.ok(box.classList.contains("unknown"));
  assert.match(box.textContent, /Could not read Arc: network down/);
  assert.doesNotMatch(box.textContent, /Register this contract/);
});

test("the preset button fills the address and runs the check", async () => {
  const { $, document } = open(world());
  document.querySelector('.preset[data-preset="verified"]').click();
  assert.equal($("addr").value, chains.chains[0].presets.verified);
  await sleep(50);
  assert.ok($("result").className.includes("unverified"));
});
