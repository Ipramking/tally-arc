const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { root, chains, TARGET } = require("./helpers");

const SOURCES = ["chains.generated.js", "lib/safe-url.js", "lib/status.js", "content/content.js"].map((f) => fs.readFileSync(path.join(root, f), "utf8"));
const STUDIO = chains.studioUrl;
const A = (n) => "0x" + String(n).padStart(40, "0");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(condition, ms = 1500) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await sleep(5);
  }
  return condition();
}

/** Boot the content script in a jsdom page that pretends to be an explorer. */
function boot({ url = `https://explorer.arc.io/address/${TARGET}`, body = "<h1>Address</h1>", respond }) {
  const dom = new JSDOM(`<!doctype html><body>${body}</body>`, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  const sent = [];
  let inFlight = 0;
  let maxInFlight = 0;
  window.chrome = {
    runtime: {
      lastError: undefined,
      sendMessage(message, callback) {
        sent.push(message);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        Promise.resolve(respond(message)).then((response) => {
          inFlight--;
          callback(response);
        });
      },
    },
  };
  for (const source of SOURCES) window.eval(source);
  return { window, document: window.document, sent, stats: () => ({ maxInFlight }) };
}

const reply = (level, extra = {}) => ({ ok: true, level, summary: `summary for ${level}`, href: `${STUDIO}/c/${TARGET}?chain=arc`, ...extra });
const badges = (document) => [...document.querySelectorAll(".tally-badge")];

test("badges the page's own address and links to the studio", async () => {
  const { document, sent } = boot({ respond: () => reply("verified") });
  assert.ok(await waitFor(() => badges(document).length === 1));
  const badge = badges(document)[0];
  assert.equal(badge.tagName, "A");
  assert.ok(badge.classList.contains("tally-verified"));
  assert.equal(badge.textContent, "Tally Verified");
  assert.equal(badge.getAttribute("href"), `${STUDIO}/c/${TARGET}?chain=arc`);
  assert.equal(badge.rel, "noopener noreferrer");
  assert.equal(badge.target, "_blank");
  assert.equal(badge.title, "summary for verified");
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ type: "tally:lookup", address: TARGET }]);
});

test("every level renders its own class and label", async () => {
  const levels = { verified: "Tally Verified", "control-proven": "Control proven", stale: "Stale record", "self-attested": "Self-attested", unverified: "Unverified", unknown: "Tally unavailable" };
  for (const [level, label] of Object.entries(levels)) {
    const { document } = boot({ respond: () => reply(level) });
    assert.ok(await waitFor(() => badges(document).length === 1), level);
    assert.ok(badges(document)[0].classList.contains(`tally-${level}`), level);
    assert.equal(badges(document)[0].textContent, label);
  }
});

test("a wallet gets no badge at all, while a contract beside it still does", async () => {
  const wallet = A(7);
  const contract = A(8);
  const body = `
    <h1>Contract details</h1>
    <a id="creator" href="/address/${wallet}">creator</a>
    <a id="sibling" href="/address/${contract}">contract</a>`;
  const { document, sent } = boot({
    url: `https://explorer.arc.io/address/${contract}`,
    body,
    respond: (m) => (m.address.toLowerCase() === wallet.toLowerCase() ? reply("wallet") : reply("unverified")),
  });
  assert.ok(await waitFor(() => badges(document).length === 1));
  await sleep(60); // give the wallet's answer time to land: it must still not draw anything
  assert.equal(badges(document).length, 1);
  assert.equal(document.querySelector("#creator").nextElementSibling?.classList.contains("tally-badge") ?? false, false);
  assert.ok(document.querySelector("#sibling").nextElementSibling.classList.contains("tally-unverified"));
  assert.ok(sent.some((m) => m.address === wallet), "the wallet was still looked up once");
});

test("a wallet is looked up once, not again on every re-scan", async () => {
  const wallet = A(9);
  const { document, sent } = boot({ body: `<h1>Address</h1><a href="/address/${wallet}">w</a>`, respond: () => reply("wallet") });
  await sleep(80);
  const before = sent.filter((m) => m.address === wallet).length;
  assert.equal(before, 1);
  document.body.append(document.createElement("div")); // DOM churn triggers another scan
  await sleep(600);
  assert.equal(sent.filter((m) => m.address === wallet).length, 1);
  assert.equal(badges(document).length, 0);
});

test("inline links get one badge per address; off-site and non-address links are ignored", async () => {
  const body = `
    <a id="a" href="/address/${A(1)}">one</a>
    <a id="dup" href="/address/${A(1)}">one again</a>
    <a id="t" href="/token/${A(2)}">token</a>
    <a id="evil" href="https://evil.example/address/${A(3)}">off-site</a>
    <a id="tx" href="/tx/${A(4)}">tx</a>
    <a id="partial" href="/address/${A(5).slice(0, 30)}">too short</a>`;
  const { document, sent } = boot({ url: "https://explorer.arc.io/", body, respond: () => reply("unverified") });
  assert.ok(await waitFor(() => badges(document).length === 2));
  await sleep(30);
  assert.equal(badges(document).length, 2);
  assert.deepEqual(sent.map((m) => m.address).sort(), [A(1), A(2)].sort());
  assert.equal(document.getElementById("a").nextElementSibling.className.includes("tally-badge"), true);
  assert.equal(document.getElementById("evil").nextElementSibling.id, "tx", "no badge after an off-site link");
});

test("nothing from the response is parsed as HTML or followed as a link", async () => {
  const { document } = boot({
    respond: () => ({ ok: true, level: "verified", summary: "<img src=x onerror=alert(1)>", href: "javascript:alert(document.cookie)" }),
  });
  assert.ok(await waitFor(() => badges(document).length === 1));
  const badge = badges(document)[0];
  assert.equal(document.querySelector("img"), null);
  assert.equal(badge.hasAttribute("href"), false, "non-studio href is dropped");
  assert.equal(badge.title, "<img src=x onerror=alert(1)>");
  assert.equal(badge.querySelectorAll("*").length, 2, "only the dot and the label");
});

test("only URLs under the configured studio origin become links", async () => {
  const cases = [
    [`${STUDIO}/c/${TARGET}`, true],
    [`${STUDIO}.evil.example/c/${TARGET}`, false],
    [`https://evil.example/?${STUDIO}/`, false],
    ["//tally-studio.vercel.app/c/x", false],
    [`${STUDIO}`, false],
    [42, false],
    [undefined, false],
  ];
  for (const [href, linked] of cases) {
    const { document } = boot({ respond: () => reply("verified", { href }) });
    assert.ok(await waitFor(() => badges(document).length === 1));
    assert.equal(badges(document)[0].hasAttribute("href"), linked, String(href));
  }
});

test("an unexpected level string cannot inject a class", async () => {
  const { document } = boot({ respond: () => reply('verified" onclick="alert(1)') });
  assert.ok(await waitFor(() => badges(document).length === 1));
  const badge = badges(document)[0];
  assert.equal(badge.className, "tally-badge tally-unknown");
  assert.equal(badge.hasAttribute("onclick"), false);
});

test("no answer from the extension shows nothing rather than a guess", async () => {
  for (const answer of [null, undefined, "nope", 42]) {
    const { document, sent } = boot({ respond: () => answer });
    assert.ok(await waitFor(() => sent.length === 1));
    await sleep(30);
    assert.equal(badges(document).length, 0, String(answer));
  }
});

test("an extension that was reloaded mid-page does not break the page", async () => {
  const dom = new JSDOM(`<!doctype html><body><h1>x</h1></body>`, { url: `https://explorer.arc.io/address/${TARGET}`, runScripts: "outside-only" });
  dom.window.chrome = { runtime: { sendMessage() { throw new Error("Extension context invalidated."); } } };
  for (const source of SOURCES) dom.window.eval(source);
  await sleep(30);
  assert.equal(dom.window.document.querySelectorAll(".tally-badge").length, 0);
});

test("pages that are not a configured explorer are left alone", async () => {
  const { document, sent } = boot({ url: `https://example.com/address/${TARGET}`, respond: () => reply("verified") });
  await sleep(30);
  assert.equal(sent.length, 0);
  assert.equal(badges(document).length, 0);
});

test("at most 40 addresses are badged per page and lookups run with bounded concurrency", async () => {
  const body = Array.from({ length: 60 }, (_, i) => `<a href="/address/${A(i + 1)}">a${i}</a>`).join("");
  const { document, sent, stats } = boot({
    url: "https://explorer.arc.io/",
    body,
    respond: async () => {
      await sleep(5);
      return reply("unverified");
    },
  });
  assert.ok(await waitFor(() => badges(document).length === 40));
  await sleep(50);
  assert.equal(badges(document).length, 40);
  assert.equal(sent.length, 40);
  assert.ok(stats().maxInFlight <= 4, `max in flight was ${stats().maxInFlight}`);
});

test("badges links the explorer adds later and drops them on navigation", async () => {
  const { window, document, sent } = boot({ url: `https://explorer.arc.io/address/${A(1)}`, body: "<h1>One</h1>", respond: () => reply("unverified") });
  assert.ok(await waitFor(() => badges(document).length === 1));

  document.body.insertAdjacentHTML("beforeend", `<a id="late" href="/address/${A(2)}">late</a>`);
  assert.ok(await waitFor(() => badges(document).length === 2, 2500));
  assert.ok(sent.some((m) => m.address === A(2)));

  // SPA navigation: new path, old content replaced.
  window.history.pushState({}, "", `/address/${A(3)}`);
  document.body.innerHTML = "<h1>Three</h1>";
  assert.ok(await waitFor(() => sent.some((m) => m.address === A(3)), 2500));
  assert.ok(await waitFor(() => badges(document).length === 1));
  assert.equal(document.querySelector("[data-tally-anchor]").getAttribute("data-tally-anchor"), A(3));
});
