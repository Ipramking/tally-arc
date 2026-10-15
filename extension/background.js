// Tally service worker. All network access (JSON-RPC and the repository's
// tally.json) happens here, under the extension's host permissions: the explorer
// page never sees these requests and its CORS policy cannot break lookups.
//
// Content scripts send { type: "tally:lookup", address }. The chain is taken
// from the sender's own URL, never from the message, and the answer is a small
// plain object: a level, one sentence of text and the studio URL to open.
/* global importScripts, chrome, TALLY_CHAINS, TallySafeUrl, TallyLookup, TallyStatus */
if (typeof importScripts === "function") {
  importScripts(
    "chains.generated.js",
    "lib/net.js",
    "lib/safe-url.js",
    "lib/registry.js",
    "lib/repo-proof.js",
    "lib/status.js",
    "lib/lookup.js",
  );
}

(function (root) {
  const OK_TTL_MS = 60 * 1000;
  const FAIL_TTL_MS = 10 * 1000;
  const MAX_CACHE_ENTRIES = 500;
  const MAX_IN_FLIGHT = 6;

  const cache = new Map(); // "chainKey:address" -> { expires, promise }
  let inFlight = 0;
  const waiting = [];

  async function slot() {
    if (inFlight >= MAX_IN_FLIGHT) await new Promise((resolve) => waiting.push(resolve));
    inFlight++;
    return () => {
      inFlight--;
      const next = waiting.shift();
      if (next) next();
    };
  }

  function chainForSender(sender) {
    try {
      return root.TallySafeUrl.chainForHostname(root.TALLY_CHAINS, new URL(sender.url).hostname);
    } catch {
      return null;
    }
  }

  async function resolve(chain, address, fetchImpl) {
    const release = await slot();
    try {
      const result = await root.TallyLookup.lookup({ chain, address, fetchImpl });
      const level = result.level;
      const summary = result.ok
        ? root.TallyStatus.describe(level, result.registration, result.repo)
        : root.TallyStatus.describe("unknown");
      // Every badge opens the contract's record, never the register form: a visitor who is only
      // checking a contract must not be nudged into registering it. The record explains what
      // the status means and offers registration, clearly, to the contract's owner.
      const href = root.TallySafeUrl.studioDetailUrl(root.TALLY_CHAINS, chain, address);
      return { ok: result.ok, level, summary, href };
    } finally {
      release();
    }
  }

  async function handleLookup(message, sender, fetchImpl) {
    if (!message || message.type !== "tally:lookup") return null;
    if (!root.TallySafeUrl.isAddress(message.address)) return { ok: false, level: "unknown", error: "invalid address" };
    const chain = chainForSender(sender);
    if (!chain) return { ok: false, level: "unknown", error: "unsupported page" };

    const key = chain.key + ":" + message.address.toLowerCase();
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.expires > now) return hit.promise;

    const promise = resolve(chain, message.address, fetchImpl);
    const entry = { expires: now + OK_TTL_MS, promise };
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    promise.then((result) => {
      if (!result.ok) entry.expires = Date.now() + FAIL_TTL_MS;
    });
    return promise;
  }

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Only our own content scripts and pages may ask.
      if (sender.id !== chrome.runtime.id) return false;
      if (!message || message.type !== "tally:lookup") return false;
      handleLookup(message, sender, fetch.bind(root))
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, level: "unknown", error: "lookup failed" }));
      return true; // keep the channel open for the async answer
    });
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { handleLookup, cache };
})(typeof globalThis !== "undefined" ? globalThis : this);
