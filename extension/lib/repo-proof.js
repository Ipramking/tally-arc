// Confirms the off-chain half of "verified": the repository must list the
// contract in a tally.json at its root.
//
//   { "version": 1, "contracts": [ { "chainId": 5042, "address": "0x..." } ] }
//
// The on-chain record says "this signer controls the contract and claims this
// repository". Only the repository can say "yes, this contract is ours".
// Mirrors studio/lib/repo-proof.ts.
(function (root, factory) {
  const net = root.TallyNet || (typeof require === "function" ? require("./net.js") : null);
  const safe = root.TallySafeUrl || (typeof require === "function" ? require("./safe-url.js") : null);
  const api = factory(net, safe);
  root.TallyRepoProof = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (net, safe) {
  const MAX_FILE_BYTES = 64 * 1024;
  const MAX_ENTRIES = 1000;

  /**
   * @returns {Promise<{status: "confirmed"|"not-listed"|"no-file"|"invalid-file"|"invalid-repo"|"unavailable", url?: string, detail?: string}>}
   *   confirmed     tally.json lists this chain id + address
   *   not-listed    valid tally.json, but this contract is not in it
   *   no-file       the repository has no tally.json (HTTP 404)
   *   invalid-file  tally.json is not valid / too large / wrong version
   *   invalid-repo  the on-chain repository URL is not a plain github.com repo
   *   unavailable   could not check (network error, timeout, redirect, 5xx)
   */
  async function checkRepoProof({ repoUrl, chainId, address, fetchImpl, timeoutMs }) {
    const parsed = safe.parseGithubRepo(repoUrl);
    if (!parsed) return { status: "invalid-repo" };
    const url = safe.tallyJsonUrl(parsed);

    let response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json, text/plain;q=0.9" },
        credentials: "omit",
        redirect: "error", // a renamed or moved repository is "unavailable", never followed
        cache: "no-store",
        signal: net.timeoutSignal(timeoutMs),
      });
    } catch (error) {
      return { status: "unavailable", url, detail: error && error.name === "TimeoutError" ? "timeout" : "network" };
    }
    if (response.status === 404) return { status: "no-file", url };
    if (!response.ok) return { status: "unavailable", url, detail: "HTTP " + response.status };

    let text;
    try {
      text = await net.readLimited(response, MAX_FILE_BYTES);
    } catch (error) {
      if (error && error.name === "TooLargeError") return { status: "invalid-file", url, detail: "too large" };
      return { status: "unavailable", url, detail: "network" };
    }

    let doc;
    try {
      doc = JSON.parse(text);
    } catch {
      return { status: "invalid-file", url, detail: "not JSON" };
    }
    if (!doc || typeof doc !== "object" || doc.version !== 1 || !Array.isArray(doc.contracts)) {
      return { status: "invalid-file", url, detail: "unexpected shape" };
    }

    const wanted = String(address).toLowerCase();
    const entries = doc.contracts.slice(0, MAX_ENTRIES);
    for (const entry of entries) {
      if (
        entry &&
        typeof entry === "object" &&
        entry.chainId === chainId &&
        typeof entry.address === "string" &&
        safe.isAddress(entry.address) &&
        entry.address.toLowerCase() === wanted
      ) {
        return { status: "confirmed", url };
      }
    }
    return { status: "not-listed", url };
  }

  return { MAX_FILE_BYTES, checkRepoProof };
});
