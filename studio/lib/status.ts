// The one place that turns evidence into a trust level. Everything user-visible
// ("Verified", a green badge) must come from decideLevel.
//
// Mirrors extension/lib/status.js; both are tested against test-vectors/status.json.
import type { RepoCheck } from "./repo-proof";
import type { Registration } from "./registry";

/**
 * verified        control proven + still held + code unchanged + repo lists this contract
 * control-proven  control proven and still held, but the source link is not confirmed
 *                 (or the registry cannot track code changes, i.e. v1)
 * stale           the proof no longer holds: control moved or the code changed
 * self-attested   a claim with no on-chain proof
 * unverified      no record
 * unknown         could not read the registry
 */
export type Level = "verified" | "control-proven" | "stale" | "self-attested" | "unverified" | "unknown";

export const LEVELS: Readonly<Record<Level, { label: string; short: string; css: string }>> = {
  verified: { label: "Tally Verified", short: "verified", css: "verified" },
  "control-proven": { label: "Control proven", short: "control proven", css: "control" },
  stale: { label: "Stale record", short: "stale", css: "stale" },
  "self-attested": { label: "Self-attested", short: "self-attested", css: "self" },
  unverified: { label: "Unverified", short: "unverified", css: "unverified" },
  unknown: { label: "Unavailable", short: "unknown", css: "unknown" },
};

type Evidence = Pick<Registration, "provenance" | "registryVersion" | "controlCurrent" | "codeCurrent">;

/** A control-proven record whose proof still holds today. */
export function isLive(registration: Evidence): boolean {
  return registration.provenance === "CONTROL_PROVEN" && registration.controlCurrent === true && registration.codeCurrent !== false;
}

export function decideLevel(registration: Evidence | null, repo: Pick<RepoCheck, "status"> | null): Level {
  if (!registration || registration.provenance === "NONE") return "unverified";
  if (registration.provenance === "SELF_ATTESTED") return "self-attested";
  if (!isLive(registration)) return "stale";
  // v1 does not record the code hash, so it can never reach "verified".
  if (registration.registryVersion === 2 && registration.codeCurrent === true && repo?.status === "confirmed") return "verified";
  return "control-proven";
}

function strength(registration: Evidence): number {
  if (registration.provenance === "CONTROL_PROVEN") return isLive(registration) ? 3 : 2;
  if (registration.provenance === "SELF_ATTESTED") return 1;
  return 0;
}

/**
 * Choose which registry's record to show. Strongest evidence wins, so a
 * throwaway self-attested record on a newer registry can never hide a live
 * control proof; ties go to the newest registry (the list is newest first).
 */
export function pickBest<T extends Evidence>(registrations: readonly T[]): T | null {
  let best: T | null = null;
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

const REPO_TEXT: Readonly<Record<string, string>> = {
  "not-listed": "the repository does not list this contract in tally.json",
  "no-file": "the repository has no tally.json",
  "invalid-file": "the repository's tally.json is invalid",
  "invalid-repo": "the repository link on-chain is not a plain GitHub repository",
  unavailable: "the repository could not be checked right now",
};

/** One plain sentence explaining a level; text only, no markup. */
export function describe(level: Level, registration?: Evidence | null, repo?: Pick<RepoCheck, "status"> | null): string {
  switch (level) {
    case "verified":
      return "The signer proved control on-chain, the code is unchanged, and the repository lists this contract.";
    case "control-proven": {
      if (registration?.registryVersion === 1) {
        return "The owner proved control on the legacy v1 registry, which cannot detect code changes. Re-register on v2 to be verified.";
      }
      const why = repo ? REPO_TEXT[repo.status] : undefined;
      return why
        ? `The signer proved control on-chain, but ${why}, so the source link is unconfirmed.`
        : "The signer proved control on-chain, but the source link is unconfirmed.";
    }
    case "stale":
      return registration?.codeCurrent === false
        ? "The code at this address changed after it was registered. Treat the record as void."
        : "The signer no longer controls this contract. The record may be out of date.";
    case "self-attested":
      return "A source repository was claimed without any on-chain proof of control.";
    case "unverified":
      return "No Tally record exists for this address.";
    default:
      return "Could not read the registry right now.";
  }
}
