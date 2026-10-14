// Orchestrates one address lookup: read every registry on the chain, pick the
// strongest record, confirm the repository when it matters, decide the level.
// Mirrors studio/lib/lookup.ts.
(function (root, factory) {
  const need = (name, path) => root[name] || (typeof require === "function" ? require(path) : null);
  const api = factory(
    need("TallyRegistry", "./registry.js"),
    need("TallyRepoProof", "./repo-proof.js"),
    need("TallyStatus", "./status.js"),
    need("TallySafeUrl", "./safe-url.js"),
  );
  root.TallyLookup = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (registry, repoProof, status, safe) {
  /**
   * @returns {Promise<{ok: true, level: string, registration: object|null, repo: object|null, repoLink: string|null}
   *                 | {ok: false, level: "unknown", error: string}>}
   * Never throws for network or decoding failures; those become level "unknown".
   */
  async function lookup({ chain, address, fetchImpl, timeoutMs }) {
    if (!safe.isAddress(address)) return { ok: false, level: "unknown", error: "invalid address" };
    if (!chain.registries.length) return { ok: false, level: "unknown", error: "no registry deployed on " + chain.name };

    try {
      // Newest first. Any failed read makes the answer unknown: a missing record
      // on one registry cannot be trusted while another registry is unreachable.
      const records = [];
      for (const entry of chain.registries) {
        const record = await registry.readRegistry(chain, entry, address, fetchImpl, timeoutMs);
        if (record.provenance === "NONE") continue;
        if (record.registryVersion === 1 && record.provenance === "CONTROL_PROVEN") {
          record.controlCurrent = await registry.v1ControlCurrent(chain, address, record.signer, fetchImpl, timeoutMs);
        }
        records.push(record);
      }

      const best = status.pickBest(records);
      let repo = null;
      if (best && status.isLive(best)) {
        repo = await repoProof.checkRepoProof({ repoUrl: best.githubRepo, chainId: chain.id, address, fetchImpl, timeoutMs });
      }
      const parsed = best ? safe.parseGithubRepo(best.githubRepo) : null;
      return {
        ok: true,
        level: status.decideLevel(best, repo),
        registration: best,
        repo,
        repoLink: parsed ? parsed.url : null,
      };
    } catch (error) {
      return { ok: false, level: "unknown", error: error && error.message ? String(error.message).slice(0, 200) : "lookup failed" };
    }
  }

  return { lookup };
});
