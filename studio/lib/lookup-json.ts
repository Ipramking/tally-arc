// The public JSON shape of one lookup: GET /api/lookup/<address>?chain=<key>.
//
// It carries everything an integrator needs to show a trust level without reimplementing the
// rules (the level, a label, one plain sentence, and the evidence behind them). Nothing in it is
// free text from the chain or from GitHub: the repository is reduced to a parsed owner/name and
// a canonical link, and the build hash is stripped of invisible characters and capped.
import { getAddress } from "viem";
import { explorerAddressUrl, STUDIO_URL } from "./chain";
import type { ChainDef } from "./chains.generated";
import type { Lookup } from "./lookup";
import type { Registration } from "./registry";
import type { RepoStatus } from "./repo-proof";
import { displayText, parseGithubRepo } from "./safe-url";
import { describe, LEVELS, type Level } from "./status";

/** Bump when a field is removed or changes meaning. Adding a field does not bump it. */
export const SCHEMA_VERSION = 1;

export interface LookupJson {
  schema: typeof SCHEMA_VERSION;
  /** false only when the chain or a registry could not be read; the HTTP status is then 503. */
  ok: boolean;
  level: Level;
  /** Fixed wording for the level, for example "Tally Verified". */
  label: string;
  /** One plain sentence explaining the level. */
  summary: string;
  chain: { key: string; id: number; name: string };
  /** EIP-55 checksummed. */
  address: string;
  registration: null | {
    registry: string;
    registryVersion: 1 | 2;
    signer: string;
    provenance: Exclude<Registration["provenance"], "NONE">;
    method: Registration["method"];
    /** Unix seconds. */
    registeredAt: number;
    /** Does the signer still control the contract? null when it could not be established. */
    controlCurrent: boolean | null;
    /** Is the code unchanged since registration? null for the legacy v1 registry, which does not record it. */
    codeCurrent: boolean | null;
    /** Is the contract an upgradeable proxy? null when it was not probed. */
    upgradeable: boolean | null;
    buildHash: string;
  };
  /** The repository the record names, only when it is a plain GitHub repository. */
  repository: null | { url: string; owner: string; repo: string };
  /** What the repository's tally.json said, when it was checked. */
  repoCheck: null | { status: RepoStatus; bound: boolean | null; tallyJson: string | null };
  links: { record: string; badge: string; explorer: string };
  /** Only when ok is false. */
  error?: string;
}

export function lookupJson(chain: ChainDef, address: string, result: Lookup): LookupJson {
  const checksummed = getAddress(address);
  const chainInfo = { key: chain.key, id: chain.id, name: chain.name };
  const links = {
    record: `${STUDIO_URL}/c/${checksummed}?chain=${chain.key}`,
    badge: `${STUDIO_URL}/api/badge/${checksummed}?chain=${chain.key}`,
    explorer: explorerAddressUrl(chain, checksummed),
  };

  if (!result.ok) {
    return {
      schema: SCHEMA_VERSION,
      ok: false,
      level: "unknown",
      label: LEVELS.unknown.label,
      summary: describe("unknown"),
      chain: chainInfo,
      address: checksummed,
      registration: null,
      repository: null,
      repoCheck: null,
      links,
      error: displayText(result.error, 200),
    };
  }

  const record = result.registration;
  const parsed = record ? parseGithubRepo(record.githubRepo) : null;
  return {
    schema: SCHEMA_VERSION,
    ok: true,
    level: result.level,
    label: LEVELS[result.level].label,
    summary: describe(result.level, record, result.repo),
    chain: chainInfo,
    address: checksummed,
    registration:
      record && record.provenance !== "NONE"
        ? {
            registry: record.registry,
            registryVersion: record.registryVersion,
            signer: record.signer,
            provenance: record.provenance,
            method: record.method,
            registeredAt: record.registeredAt,
            controlCurrent: record.controlCurrent,
            codeCurrent: record.codeCurrent,
            upgradeable: record.upgradeable,
            buildHash: displayText(record.buildHash, 66),
          }
        : null,
    repository: parsed ? { url: parsed.url, owner: parsed.owner, repo: parsed.repo } : null,
    repoCheck: result.repo ? { status: result.repo.status, bound: result.repo.status === "confirmed" ? result.repo.bound === true : null, tallyJson: result.repo.url ?? null } : null,
    links,
  };
}
