// The tally.json a repository needs for a contract to reach "verified", built so
// that registering a NEW contract never wipes the ones already listed.
//
// The old snippet was a whole file containing only the new contract; pasting it
// over an existing tally.json silently un-verified every other contract. This
// reads the repository's current file and returns a merged one instead.
import type { NetOptions } from "./net";
import { entryMatches, judgeEntries, MAX_ENTRIES, namedSigner, readTallyFile } from "./repo-proof";

export type SnippetState =
  /** The repository's file was read; the text keeps its entries and adds this contract. */
  | "merged"
  /** The repository's file already lists this contract; nothing to change. */
  | "listed"
  /** The file lists this contract but names a different wallet; the text names this one instead. */
  | "update"
  /** The repository has no tally.json yet; the text is a complete new file. */
  | "fresh"
  /** The current file could not be read; the text is ONE entry to add, never a file to paste over it. */
  | "manual";

export interface Snippet {
  state: SnippetState;
  /** What to copy: a whole file (merged, listed, fresh) or a single entry (manual). */
  text: string;
  /** Contracts already listed in the repository's file. */
  kept: number;
  /** One sentence for the person, in plain words. */
  note: string;
}

const file = (contracts: unknown[]) => `${JSON.stringify({ version: 1, contracts }, null, 2)}\n`;
/** The entry for a contract. With a signer it also names the wallet the repository authorises. */
const entry = (chainId: number, address: string, signer?: string) => (signer ? { chainId, address, signer } : { chainId, address });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export interface Merged {
  text: string;
  kept: number;
  /** An entry for this contract on this network was already there. */
  alreadyListed: boolean;
  /** It was there but named a different wallet, so `text` names this signer instead. */
  updated: boolean;
  /** The wallet the file named instead (lowercase), when `updated`. */
  named?: string;
  beyondLimit: boolean;
}

/**
 * Merge `{chainId, address}` into a tally.json's contracts list. Existing entries
 * are kept exactly as they are (even ones this studio does not understand), and
 * the new entry is appended unless it is already listed. With a `signer`, a new
 * entry names that wallet, and an existing entry that names a DIFFERENT wallet is
 * rewritten to name it (only offered to the person, never applied for them).
 */
export function mergeTallyContracts(existing: readonly unknown[], chainId: number, address: string, signer?: string): Merged {
  const seen = existing.slice(0, MAX_ENTRIES);
  const matching = seen.flatMap((e, i) => (entryMatches(e, chainId, address) ? [i] : []));

  if (matching.length === 0) {
    return { text: file([...existing, entry(chainId, address, signer)]), kept: existing.length, alreadyListed: false, updated: false, beyondLimit: existing.length >= MAX_ENTRIES };
  }

  const verdict = judgeEntries(matching.map((i) => namedSigner(seen[i])), signer);
  if (signer && verdict.status === "signer-mismatch") {
    const contracts = existing.map((e, i) => (matching.includes(i) ? { ...(e as object), signer } : e));
    return { text: file(contracts), kept: existing.length, alreadyListed: true, updated: true, named: verdict.named, beyondLimit: false };
  }
  return { text: file([...existing]), kept: existing.length, alreadyListed: true, updated: false, beyondLimit: false };
}

const WHY: Record<string, string> = {
  "invalid-file": "it is not valid tally.json",
  unavailable: "GitHub could not be reached",
  "invalid-repo": "the repository link is not a plain GitHub link",
};

/** `signer` is the wallet that registered the contract. When given, new entries name it, so the repository itself says which wallet it authorises. */
export async function buildTallySnippet(input: { repoUrl: string; chainId: number; address: string; signer?: string } & NetOptions): Promise<Snippet> {
  const { repoUrl, chainId, address, signer, ...net } = input;
  const read = await readTallyFile({ repoUrl, ...net });
  const naming = signer ? ` The entry names ${short(signer)}, the wallet that registered it, so the repository itself vouches for that wallet.` : "";

  if (read.status === "ok") {
    const merged = mergeTallyContracts(read.contracts, chainId, address, signer);
    if (merged.alreadyListed && merged.updated && signer) {
      const other = merged.named ? `a different wallet (${short(merged.named)})` : "a wallet that is not valid";
      return {
        state: "update",
        text: merged.text,
        kept: merged.kept,
        note: `Your tally.json lists this contract but names ${other}, so the record cannot be verified. If ${short(signer)} now controls the contract, replace the file with this version, which names it. Only the repository's owner can make that change.`,
      };
    }
    if (merged.alreadyListed) {
      return { state: "listed", text: merged.text, kept: merged.kept, note: "Your tally.json already lists this contract on this network. Nothing to change." };
    }
    const count = merged.kept === 1 ? "1 contract" : `${merged.kept} contracts`;
    const tail = merged.beyondLimit ? ` Note: Tally reads only the first ${MAX_ENTRIES} entries of a file, so this one would be ignored.` : "";
    return {
      state: "merged",
      text: merged.text,
      kept: merged.kept,
      note:
        merged.kept === 0
          ? `Your tally.json has no contracts yet. Replace its contents with this.${naming}${tail}`
          : `Your tally.json lists ${count}. This version keeps them and adds this one, so replace the file with it.${naming}${tail}`,
    };
  }

  if (read.status === "no-file") {
    return { state: "fresh", text: file([entry(chainId, address, signer)]), kept: 0, note: `The repository has no tally.json yet. Create it at the root, on the default branch, with this content.${naming}` };
  }

  return {
    state: "manual",
    text: `${JSON.stringify(entry(chainId, address, signer), null, 2)}\n`,
    kept: 0,
    note: `We could not read your current tally.json (${WHY[read.status] ?? "unknown reason"}). Do not replace the file. Add this entry to its "contracts" list.`,
  };
}
