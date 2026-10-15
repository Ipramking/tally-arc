// The tally.json a repository needs for a contract to reach "verified", built so
// that registering a NEW contract never wipes the ones already listed.
//
// The old snippet was a whole file containing only the new contract; pasting it
// over an existing tally.json silently un-verified every other contract. This
// reads the repository's current file and returns a merged one instead.
import type { NetOptions } from "./net";
import { entryMatches, MAX_ENTRIES, readTallyFile } from "./repo-proof";

export type SnippetState =
  /** The repository's file was read; the text keeps its entries and adds this contract. */
  | "merged"
  /** The repository's file already lists this contract; nothing to change. */
  | "listed"
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
const entry = (chainId: number, address: string) => ({ chainId, address });

/**
 * Merge `{chainId, address}` into a tally.json's contracts list. Existing entries
 * are kept exactly as they are (even ones this studio does not understand), and
 * the new entry is appended unless it is already listed.
 */
export function mergeTallyContracts(existing: readonly unknown[], chainId: number, address: string): { text: string; kept: number; alreadyListed: boolean; beyondLimit: boolean } {
  const alreadyListed = existing.slice(0, MAX_ENTRIES).some((e) => entryMatches(e, chainId, address));
  const contracts = alreadyListed ? [...existing] : [...existing, entry(chainId, address)];
  return { text: file(contracts), kept: existing.length, alreadyListed, beyondLimit: !alreadyListed && existing.length >= MAX_ENTRIES };
}

const WHY: Record<string, string> = {
  "invalid-file": "it is not valid tally.json",
  unavailable: "GitHub could not be reached",
  "invalid-repo": "the repository link is not a plain GitHub link",
};

export async function buildTallySnippet(input: { repoUrl: string; chainId: number; address: string } & NetOptions): Promise<Snippet> {
  const { repoUrl, chainId, address, ...net } = input;
  const read = await readTallyFile({ repoUrl, ...net });

  if (read.status === "ok") {
    const merged = mergeTallyContracts(read.contracts, chainId, address);
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
          ? `Your tally.json has no contracts yet. Replace its contents with this.${tail}`
          : `Your tally.json lists ${count}. This version keeps them and adds this one, so replace the file with it.${tail}`,
    };
  }

  if (read.status === "no-file") {
    return { state: "fresh", text: file([entry(chainId, address)]), kept: 0, note: "The repository has no tally.json yet. Create it at the root, on the default branch, with this content." };
  }

  return {
    state: "manual",
    text: `${JSON.stringify(entry(chainId, address), null, 2)}\n`,
    kept: 0,
    note: `We could not read your current tally.json (${WHY[read.status] ?? "unknown reason"}). Do not replace the file. Add this entry to its "contracts" list.`,
  };
}
