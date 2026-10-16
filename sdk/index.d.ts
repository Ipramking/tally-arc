export type Level = "verified" | "control-proven" | "stale" | "self-attested" | "unverified" | "wallet" | "unknown";

export interface RegistryDef {
  version: 1 | 2;
  address: string;
}

/** One EVM network. Pass your own to lookup() for a chain the bundled table does not list. */
export interface Chain {
  key: string;
  id: number;
  name: string;
  testnet?: boolean;
  nativeCurrency?: { name: string; symbol: string; decimals: number };
  /** https only. */
  rpcUrl: string;
  explorer?: { name: string; url: string };
  /** Newest first. Every entry is read; the newest record wins. */
  registries: RegistryDef[];
  presets?: { verified?: string; unverified?: string };
}

export interface Registration {
  registryVersion: 1 | 2;
  registry: string;
  githubRepo: string;
  buildHash: string;
  signer: string;
  /** Unix seconds. */
  registeredAt: number;
  provenance: "NONE" | "SELF_ATTESTED" | "CONTROL_PROVEN";
  method: "NONE" | "OWNER" | "ADMIN_ROLE" | "DEPLOYER";
  /** Does the signer still control the contract? */
  controlCurrent: boolean | null;
  /** Is the code unchanged since registration? null on the legacy v1 registry. */
  codeCurrent: boolean | null;
  /** Is the contract an upgradeable proxy? null when it was not probed. */
  upgradeable: boolean | null;
}

export type RepoStatus = "confirmed" | "not-listed" | "signer-mismatch" | "no-file" | "invalid-file" | "invalid-repo" | "unavailable";

export interface RepoCheck {
  status: RepoStatus;
  url?: string;
  detail?: string;
  /** confirmed only: the entry also named the signer's wallet. Verified needs this. */
  bound?: boolean;
  /** signer-mismatch only: the wallet the file names instead (lowercase). */
  named?: string;
}

export type LookupResult =
  | { ok: true; level: Level; registration: Registration | null; repo: RepoCheck | null; repoLink: string | null }
  | { ok: false; level: "unknown"; error: string };

export interface LookupOptions {
  chain: Chain;
  address: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Judge the repository yourself (for example from a checkout) instead of fetching its tally.json from GitHub. */
  repoCheck?: (record: Registration) => RepoCheck | Promise<RepoCheck>;
}

/** Never throws for network or decoding failures: those come back as { ok: false, level: "unknown" }. */
export function lookup(options: LookupOptions): Promise<LookupResult>;

/** One plain sentence for a level. */
export function describe(level: Level, registration?: Registration | null, repo?: RepoCheck | null): string;

/** Fixed wording for every level. */
export const LEVELS: Record<Level, { label: string; short: string }>;

/** The chains bundled with this version. */
export const chains: Chain[];
export const defaultChain: string;
export const studioUrl: string;

/** Find a chain by key or by chain id. */
export function getChain(keyOrId: string | number, chains?: Chain[]): Chain | null;

export interface TallyEntry {
  chainId: number;
  address: string;
  signer?: string;
}

export interface Problem {
  severity: "error" | "warning" | "unknown";
  code: string;
  message: string;
}

export interface EntryResult {
  index: number;
  chainId?: number;
  address?: string;
  signer: string | null;
  chain: string | null;
  level: Level | null;
  status: "ok" | "warning" | "error" | "unknown";
  problems: Problem[];
  record?: { registry: string; registryVersion: 1 | 2; signer: string; method: Registration["method"] };
}

export interface VerifySummary {
  /** No errors and nothing that could not be checked. Warnings do not fail it. */
  ok: boolean;
  errors: number;
  unknown: number;
  warnings: number;
  results: EntryResult[];
}

/** Compare a parsed tally.json with the chain. The repository half of the rule is judged against the file in hand. */
export function verifyTallyFile(options: {
  tally: unknown;
  chains: Chain[];
  /** "owner/name" the on-chain records must name; omit to skip that check. */
  repository?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  studioUrl?: string;
}): Promise<VerifySummary>;

/** 0 all good, 1 a record and the file disagree, 2 something could not be checked. */
export function exitCodeFor(summary: VerifySummary, options?: { strict?: boolean }): 0 | 1 | 2;

declare const api: {
  lookup: typeof lookup;
  describe: typeof describe;
  LEVELS: typeof LEVELS;
  chains: typeof chains;
  defaultChain: typeof defaultChain;
  studioUrl: typeof studioUrl;
  getChain: typeof getChain;
  verifyTallyFile: typeof verifyTallyFile;
  exitCodeFor: typeof exitCodeFor;
};
export default api;
