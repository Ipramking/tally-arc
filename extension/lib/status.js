// The one place that turns evidence into a trust level. Everything user-visible
// ("Tally Verified", a green badge) must come from decideLevel.
//
// Mirrors studio/lib/status.ts; both are tested against test-vectors/status.json.
(function (root, factory) {
  const api = factory();
  root.TallyStatus = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  /**
   * verified        control proven + still held + code unchanged + repo lists this contract
   * control-proven  control proven and still held, but the source link is not confirmed
   *                 (or the registry cannot track code changes, i.e. v1)
   * stale           the proof no longer holds: control moved or the code changed
   * self-attested   a claim with no on-chain proof
   * unverified      a contract with no record
   * wallet          no record and no contract code: a wallet, so nothing to verify
   *                 (decided by the lookup from the chain, not by decideLevel)
   * unknown         could not read the registry
   */
  const LEVELS = {
    verified: { label: "Tally Verified", short: "Verified" },
    "control-proven": { label: "Control proven", short: "Control proven" },
    stale: { label: "Stale record", short: "Stale" },
    "self-attested": { label: "Self-attested", short: "Self-attested" },
    unverified: { label: "Unverified", short: "Unverified" },
    wallet: { label: "Not a contract", short: "Wallet" },
    unknown: { label: "Tally unavailable", short: "Unknown" },
  };

  /** A control-proven record whose proof still holds today. */
  function isLive(registration) {
    return (
      registration.provenance === "CONTROL_PROVEN" &&
      registration.controlCurrent === true &&
      registration.codeCurrent !== false
    );
  }

  /**
   * @param registration normalised record, or null when no registry has one
   * @param repo         result of checkRepoProof, or null when not checked
   */
  function decideLevel(registration, repo) {
    if (!registration || registration.provenance === "NONE") return "unverified";
    if (registration.provenance === "SELF_ATTESTED") return "self-attested";
    if (!isLive(registration)) return "stale";
    // v1 does not record the code hash, so it can never reach "verified".
    if (registration.registryVersion === 2 && registration.codeCurrent === true && repo && repo.status === "confirmed") {
      return "verified";
    }
    return "control-proven";
  }

  function strength(registration) {
    if (registration.provenance === "CONTROL_PROVEN") return isLive(registration) ? 3 : 2;
    if (registration.provenance === "SELF_ATTESTED") return 1;
    return 0;
  }

  /**
   * Choose which registry's record to show. Strongest evidence wins, so a
   * throwaway self-attested record on a newer registry can never hide a live
   * control proof; ties go to the newest registry (list is newest first).
   */
  function pickBest(registrations) {
    let best = null;
    let bestStrength = 0;
    for (const registration of registrations) {
      const s = strength(registration);
      if (s > bestStrength) {
        best = registration;
        bestStrength = s;
      }
    }
    return best;
  }

  const REPO_TEXT = {
    "not-listed": "the repository does not list this contract in tally.json",
    "no-file": "the repository has no tally.json",
    "invalid-file": "the repository's tally.json is invalid",
    "invalid-repo": "the repository link on-chain is not a plain GitHub repository",
    unavailable: "the repository could not be checked right now",
  };

  /** One plain sentence explaining a level; safe text, no markup. */
  function describe(level, registration, repo) {
    switch (level) {
      case "verified":
        return "The signer proved control on-chain, the code is unchanged, and the repository lists this contract.";
      case "control-proven": {
        if (registration && registration.registryVersion === 1) {
          return "The owner proved control on the legacy v1 registry, which cannot detect code changes. Re-register on v2 to be verified.";
        }
        const why = repo && REPO_TEXT[repo.status];
        return why
          ? "The signer proved control on-chain, but " + why + ", so the source link is unconfirmed."
          : "The signer proved control on-chain, but the source link is unconfirmed.";
      }
      case "stale":
        return registration && registration.codeCurrent === false
          ? "The code at this address changed after it was registered. Treat the record as void."
          : "The signer no longer controls this contract. The record may be out of date.";
      case "self-attested":
        return "A source repository was claimed without any on-chain proof of control.";
      case "unverified":
        return "No Tally record exists for this address.";
      case "wallet":
        return "This address holds no contract code, so it is a wallet. Tally records provenance for contracts, not wallets.";
      default:
        return "Could not read the registry right now.";
    }
  }

  return { LEVELS, isLive, decideLevel, pickBest, describe };
});
