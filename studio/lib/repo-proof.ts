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
const MAX_ENTRIES = 1000;

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

export async function checkRepoProof({ repoUrl, chainId, address, fetchImpl = fetch, timeoutMs }: RepoProofInput): Promise<RepoCheck> {
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

  const wanted = address.toLowerCase();
  for (const entry of file.contracts.slice(0, MAX_ENTRIES) as unknown[]) {
    const item = entry as { chainId?: unknown; address?: unknown } | null;
    if (
      item &&
      typeof item === "object" &&
      item.chainId === chainId &&
      typeof item.address === "string" &&
      isAddress(item.address) &&
      item.address.toLowerCase() === wanted
    ) {
      return { status: "confirmed", url };
    }
  }
  return { status: "not-listed", url };
}
