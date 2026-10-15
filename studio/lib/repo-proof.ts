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
  | "confirmed" //     tally.json lists this chain id + address
  | "not-listed" //    valid tally.json, but this contract is not in it
  | "no-file" //       the repository has no tally.json (HTTP 404)
  | "invalid-file" //  tally.json is not valid, too large, or the wrong version
  | "invalid-repo" //  the on-chain repository URL is not a plain github.com repo
  | "unavailable"; //  could not check (network error, timeout, redirect, 5xx)

export interface RepoCheck {
  status: RepoStatus;
  url?: string;
  detail?: string;
}

export interface RepoProofInput extends NetOptions {
  repoUrl: string;
  chainId: number;
  address: string;
}

/** The outcome of fetching a repository's tally.json: its entries, or why they are not available. */
export type TallyFileRead =
  | { status: "ok"; url: string; contracts: unknown[] }
  | { status: Exclude<RepoStatus, "confirmed" | "not-listed">; url?: string; detail?: string };

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

export async function checkRepoProof({ repoUrl, chainId, address, fetchImpl, timeoutMs }: RepoProofInput): Promise<RepoCheck> {
  const read = await readTallyFile({ repoUrl, fetchImpl, timeoutMs });
  if (read.status !== "ok") return read;
  const listed = read.contracts.slice(0, MAX_ENTRIES).some((entry) => entryMatches(entry, chainId, address));
  return { status: listed ? "confirmed" : "not-listed", url: read.url };
}
