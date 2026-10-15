// Injects Tally provenance badges next to contract addresses on a supported
// block explorer. This script never touches the network: it asks the extension's
// service worker, which answers with a level, one sentence and a studio URL.
//
// Everything is built with DOM APIs and textContent; no value from the chain or
// the page is ever parsed as HTML or opened directly.
/* global chrome, TALLY_CHAINS, TallySafeUrl, TallyStatus */
(function () {
  "use strict";

  const config = globalThis.TALLY_CHAINS;
  const safe = globalThis.TallySafeUrl;
  const status = globalThis.TallyStatus;
  const chain = safe.chainForHostname(config, location.hostname);
  if (!chain) return;

  const MAX_ADDRESSES = 40; // distinct addresses badged per page
  const MAX_ANCHORS_PER_SCAN = 500;
  const MAX_CONCURRENT = 4;
  const RESULT_CACHE_LIMIT = 200;
  const SCAN_DEBOUNCE_MS = 400;
  const ADDRESS_PATH = /^\/(?:address|token)\/(0x[0-9a-fA-F]{40})(?:[/?#]|$)/;

  const results = new Map(); // address -> Promise<response|null>
  const placed = new Map(); // address -> badge element currently in the page
  const pending = new Set(); // addresses with a lookup in flight
  const wallets = new Set(); // addresses that hold no code: nothing to verify, so no badge

  // ---- bounded concurrency ------------------------------------------------
  const queue = [];
  let active = 0;
  function pump() {
    while (active < MAX_CONCURRENT && queue.length) {
      const job = queue.shift();
      active++;
      job.task().then(job.resolve, () => job.resolve(null)).finally(() => {
        active--;
        pump();
      });
    }
  }
  function enqueue(task) {
    return new Promise((resolve) => {
      queue.push({ task, resolve });
      pump();
    });
  }

  // ---- lookup -------------------------------------------------------------
  function ask(address) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "tally:lookup", address }, (response) => {
          if (chrome.runtime.lastError || !response || typeof response !== "object") resolve(null);
          else resolve(response);
        });
      } catch {
        resolve(null); // extension reloaded or updated while the page stayed open
      }
    });
  }

  function lookup(address) {
    const key = address.toLowerCase();
    if (!results.has(key)) {
      if (results.size >= RESULT_CACHE_LIMIT) results.delete(results.keys().next().value);
      results.set(key, enqueue(() => ask(address)));
    }
    return results.get(key);
  }

  // ---- rendering ----------------------------------------------------------
  function renderBadge(response) {
    const level = response && status.LEVELS[response.level] ? response.level : "unknown";
    const meta = status.LEVELS[level];
    // Plain status only. No call to action: this badge is read by people checking a contract.
    const label = meta.label;
    const summary = typeof (response && response.summary) === "string" ? response.summary.slice(0, 300) : "";

    const badge = document.createElement("a");
    badge.className = "tally-badge tally-" + level;
    badge.target = "_blank";
    badge.rel = "noopener noreferrer";
    // Only ever link to our own studio.
    const href = response && typeof response.href === "string" ? response.href : "";
    if (href.startsWith(config.studioUrl + "/")) badge.href = href;
    badge.title = summary;
    badge.setAttribute("aria-label", "Tally: " + label + (summary ? ". " + summary : ""));

    const dot = document.createElement("span");
    dot.className = "tally-dot";
    const text = document.createElement("span");
    text.className = "tally-label";
    text.textContent = label;
    badge.append(dot, text);
    return badge;
  }

  async function decorate(anchor, address) {
    const key = address.toLowerCase();
    if (wallets.has(key)) return;
    const existing = placed.get(key);
    if (pending.has(key) || (existing && existing.isConnected)) return; // one badge per address
    if (!placed.has(key) && placed.size + pending.size >= MAX_ADDRESSES) return;

    pending.add(key);
    try {
      const response = await lookup(address);
      if (!response) return; // no answer: show nothing rather than a guess
      if (response.level === "wallet") {
        // A wallet (creator, sender, recipient...) is not a contract. A red "Register" badge
        // beside it would be wrong: nothing can be registered there.
        wallets.add(key);
        return;
      }
      if (!anchor.isConnected) {
        results.delete(key); // the page moved on; let a later scan retry
        return;
      }
      const badge = renderBadge(response);
      anchor.insertAdjacentElement("afterend", badge);
      placed.set(key, badge);
    } finally {
      pending.delete(key);
    }
  }

  // ---- finding addresses --------------------------------------------------
  function addressFromLink(anchor) {
    let url;
    try {
      url = new URL(anchor.getAttribute("href"), location.href);
    } catch {
      return null;
    }
    if (url.origin !== location.origin) return null; // only the explorer's own links
    const match = ADDRESS_PATH.exec(url.pathname);
    return match ? match[1] : null;
  }

  function decorateInline() {
    const links = document.querySelectorAll("a[href*='/address/0x'], a[href*='/token/0x']");
    const limit = Math.min(links.length, MAX_ANCHORS_PER_SCAN);
    for (let i = 0; i < limit; i++) {
      const address = addressFromLink(links[i]);
      if (address) decorate(links[i], address);
    }
  }

  // The page's own address is a fallback when the header does not render it as a link.
  function decoratePrimary() {
    const match = ADDRESS_PATH.exec(location.pathname);
    if (!match) return;
    const key = match[1].toLowerCase();
    const existing = placed.get(key);
    if (pending.has(key) || (existing && existing.isConnected)) return;
    const header = document.querySelector("h1, h2, [data-testid='address-hash']") || document.body;
    if (header.querySelector("[data-tally-anchor='" + key + "']")) return; // already tried here
    const anchor = document.createElement("span");
    anchor.setAttribute("data-tally-anchor", key);
    header.prepend(anchor);
    decorate(anchor, match[1]);
  }

  // Explorers navigate without reloading. When the path changes, drop every badge
  // so none can end up beside a different address than the one it was computed for.
  let lastPath = location.pathname;
  function resetIfNavigated() {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    document.querySelectorAll(".tally-badge, [data-tally-anchor]").forEach((node) => node.remove());
    placed.clear();
  }

  function pruneRemoved() {
    for (const [key, badge] of placed) if (!badge.isConnected) placed.delete(key);
  }

  function scan() {
    try {
      resetIfNavigated();
      pruneRemoved(); // rows the explorer re-rendered must not use up the cap
      // Inline links first so the badge lands beside the address in the header;
      // decoratePrimary only runs when that address is not a link.
      decorateInline();
      decoratePrimary();
    } catch (error) {
      console.debug("[Tally] scan error", error);
    }
  }

  scan();
  // Explorers are single-page apps: re-scan on DOM churn (debounced).
  let timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(scan, SCAN_DEBOUNCE_MS);
  }).observe(document.body, { childList: true, subtree: true });
})();
