// Confirms the off-chain half of "verified": the repository must list the
// contract in a tally.json at its root.
//
//   { "version": 1, "contracts": [ { "chainId": 5042, "address": "0x..." } ] }
//
// The on-chain record says "this signer controls the contract and claims this
// repository". Only the repository can say "yes, this contract is ours".
// Mirrors extension/lib/repo-proof.js.
import { readLimited, timeoutSignal, TooLargeError, type NetOptions } from "./net";
import { isAddress, parseGithubRepo, tallyJsonUrl } from "./safe-url";

export const MAX_FILE_BYTES = 64 * 1024;
/** Clients read only this many entries of a tally.json; later ones are ignored. */
export const MAX_ENTRIES = 1000;

export type RepoStatus =
  | "confirmed" //        tally.json lists this chain id + address (and, if it names a wallet, the signer's)
  | "not-listed" //       valid tally.json, but this contract is not in it
  | "signer-mismatch" //  tally.json lists this contract but names a different wallet
  | "no-file" //          the repository has no tally.json (HTTP 404)
  | "invalid-file" //     tally.json is not valid, too large, or the wrong version
  | "invalid-repo" //     the on-chain repository URL is not a plain github.com repo
  | "unavailable"; //     could not check (network error, timeout, redirect, 5xx)

export interface RepoCheck {
  status: RepoStatus;
  url?: string;
  detail?: string;
  /** confirmed only: true when the confirming entry also named the signer's wallet. */
  bound?: boolean;
  /** signer-mismatch only: the (lowercase) wallet the file names instead. */
  named?: string;
}

export interface RepoProofInput extends NetOptions {
  repoUrl: string;
  chainId: number;
  address: string;
  /**
   * The record's signer. An entry that names a wallet must name this one. Without it the
   * wallet is not compared (an entry that names none is accepted either way).
   */
  signer?: string;
}

/** The outcome of fetching a repository's tally.json: its entries, or why they are not available. */
export type TallyFileRead =
  | { status: "ok"; url: string; contracts: unknown[] }
  | { status: Exclude<RepoStatus, "confirmed" | "not-listed" | "signer-mismatch">; url?: string; detail?: string };

/** Fetch and validate a repository's tally.json (never follows redirects, capped in size, strict shape). */
export async function readTallyFile({ repoUrl, fetchImpl = fetch, timeoutMs }: { repoUrl: string } & NetOptions): Promise<TallyFileRead> {
  const parsed = parseGithubRepo(repoUrl);
  if (!parsed) return { status: "invalid-repo" };
  const url = tallyJsonUrl(parsed);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json, text/plain;q=0.9" },
      credentials: "omit",
      redirect: "error", // a renamed or moved repository is "unavailable", never followed
      cache: "no-store",
      signal: timeoutSignal(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return { status: "unavailable", url, detail: timedOut ? "timeout" : "network" };
  }
  if (response.status === 404) return { status: "no-file", url };
  if (!response.ok) return { status: "unavailable", url, detail: `HTTP ${response.status}` };

  let text: string;
  try {
    text = await readLimited(response, MAX_FILE_BYTES);
  } catch (error) {
    if (error instanceof TooLargeError) return { status: "invalid-file", url, detail: "too large" };
    return { status: "unavailable", url, detail: "network" };
  }

  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { status: "invalid-file", url, detail: "not JSON" };
  }
  const file = doc as { version?: unknown; contracts?: unknown } | null;
  if (!file || typeof file !== "object" || file.version !== 1 || !Array.isArray(file.contracts)) {
    return { status: "invalid-file", url, detail: "unexpected shape" };
  }
  return { status: "ok", url, contracts: file.contracts };
}

/** Does this tally.json entry list `address` on `chainId`? */
export function entryMatches(entry: unknown, chainId: number, address: string): boolean {
  const item = entry as { chainId?: unknown; address?: unknown } | null;
  return (
    !!item &&
    typeof item === "object" &&
    item.chainId === chainId &&
    typeof item.address === "string" &&
    isAddress(item.address) &&
    item.address.toLowerCase() === address.toLowerCase()
  );
}

/** What a matching entry says about the wallet: null for none, "invalid" for a field that is not an address, else the address (lowercase). */
export type NamedSigner = string | null;
export const INVALID_SIGNER = "invalid";

export function namedSigner(entry: unknown): NamedSigner {
  const value = (entry as { signer?: unknown } | null)?.signer;
  if (value === undefined || value === null) return null;
  return typeof value === "string" && isAddress(value) ? value.toLowerCase() : INVALID_SIGNER;
}

/** The wallets named by the entries that list `address` on `chainId` (first MAX_ENTRIES only). */
export function matchEntries(contracts: readonly unknown[], chainId: number, address: string): NamedSigner[] {
  return contracts
    .slice(0, MAX_ENTRIES)
    .filter((entry) => entryMatches(entry, chainId, address))
    .map(namedSigner);
}

/**
 * The shared rule (mirrored in extension/lib/repo-proof.js, checked by test-vectors/repo-signer.json):
 * an entry naming this signer confirms and binds; an entry naming nobody confirms without binding;
 * if every matching entry names someone else the file disagrees with the record.
 */
export function judgeEntries(matches: readonly NamedSigner[], signer?: string): Pick<RepoCheck, "status" | "bound" | "named"> {
  if (matches.length === 0) return { status: "not-listed" };
  if (signer === undefined) return { status: "confirmed" };
  const me = signer.toLowerCase();
  if (matches.includes(me)) return { status: "confirmed", bound: true };
  if (matches.includes(null)) return { status: "confirmed", bound: false };
  const named = matches.find((m): m is string => m !== null && m !== INVALID_SIGNER);
  return named ? { status: "signer-mismatch", named } : { status: "signer-mismatch" };
}

export async function checkRepoProof({ repoUrl, chainId, address, signer, fetchImpl, timeoutMs }: RepoProofInput): Promise<RepoCheck> {
  const read = await readTallyFile({ repoUrl, fetchImpl, timeoutMs });
  if (read.status !== "ok") return read;
  return { ...judgeEntries(matchEntries(read.contracts, chainId, address), signer), url: read.url };
}
