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
   * @param repoCheck optional async (record) => {status, bound?, ...}; replaces the fetch of the repository's tally.json
   * @returns {Promise<{ok: true, level: string, registration: object|null, repo: object|null, repoLink: string|null}
   *                 | {ok: false, level: "unknown", error: string}>}
   * Never throws for network or decoding failures; those become level "unknown".
   */
  async function lookup({ chain, address, fetchImpl, timeoutMs, repoCheck }) {
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
        // A deployer proof is a permanent fact, so the registry keeps reporting it as "still held" after the
        // contract changed hands. Tally does not: once the contract names another owner, the deployer no
        // longer speaks for it, and its record reads stale. A contract with no owner() leaves the proof as is.
        if (record.registryVersion === 2 && record.provenance === "CONTROL_PROVEN" && record.method === "DEPLOYER" && record.controlCurrent === true) {
          const owner = await registry.readOwner(chain, address, fetchImpl, timeoutMs);
          if (owner !== null && owner !== record.signer.toLowerCase()) record.controlCurrent = false;
        }
        records.push(record);
      }

      const best = status.pickBest(records);
      // A proxy's code hash survives an upgrade, so the "code unchanged" leg says nothing about it. Probe the
      // standard proxy slots for the record that could reach "verified"; a failed probe makes the answer unknown.
      if (best && best.registryVersion === 2 && status.isLive(best)) {
        best.upgradeable = await registry.isUpgradeableProxy(chain, address, fetchImpl, timeoutMs);
      }
      let repo = null;
      if (best && status.isLive(best)) {
        // `repoCheck(record)` lets a caller that already holds the repository's tally.json (a CI job
        // checking its own checkout) judge it locally instead of fetching it from GitHub.
        repo = repoCheck
          ? await repoCheck(best)
          : await repoProof.checkRepoProof({ repoUrl: best.githubRepo, chainId: chain.id, address, signer: best.signer, fetchImpl, timeoutMs });
      }
      let level = status.decideLevel(best, repo);
      // No record: a wallet has no code, so there is nothing to verify and nothing to register.
      // If the chain cannot say, that throws and the answer is "unknown", never "unverified".
      if (level === "unverified" && !(await registry.hasCode(chain.rpcUrl, address, fetchImpl, timeoutMs))) level = "wallet";
      const parsed = best ? safe.parseGithubRepo(best.githubRepo) : null;
      return {
        ok: true,
        level,
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
