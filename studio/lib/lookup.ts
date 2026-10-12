// Orchestrates one address lookup: read every registry on the chain, pick the
// strongest record, confirm the repository when it matters, decide the level.
// Mirrors extension/lib/lookup.js.
import type { Address } from "viem";
import type { ChainDef } from "./chains.generated";
import type { NetOptions } from "./net";
import { checkRepoProof, type RepoCheck } from "./repo-proof";
import { currentOwnerIs, readRegistry, type Registration } from "./registry";
import { isAddress, parseGithubRepo } from "./safe-url";
import { decideLevel, isLive, pickBest, type Level } from "./status";

export type Lookup =
  | { ok: true; level: Level; registration: Registration | null; repo: RepoCheck | null; repoLink: string | null }
  | { ok: false; level: "unknown"; error: string };

/** Never throws for network or decoding failures; those become level "unknown". */
export async function lookupContract(input: { chain: ChainDef; address: string } & NetOptions): Promise<Lookup> {
  const { chain, address, ...net } = input;
  if (!isAddress(address)) return { ok: false, level: "unknown", error: "invalid address" };
  if (chain.registries.length === 0) return { ok: false, level: "unknown", error: `no registry deployed on ${chain.name}` };

  try {
    // Newest first. Any failed read makes the answer unknown: a missing record
    // on one registry cannot be trusted while another registry is unreachable.
    const records: Registration[] = [];
    for (const entry of chain.registries) {
      const record = await readRegistry(chain, entry, address as Address, net);
      if (record.provenance === "NONE") continue;
      if (record.registryVersion === 1 && record.provenance === "CONTROL_PROVEN") {
        record.controlCurrent = await currentOwnerIs(chain, address as Address, record.signer, net);
      }
      records.push(record);
    }

    const best = pickBest(records);
    const repo = best && isLive(best) ? await checkRepoProof({ repoUrl: best.githubRepo, chainId: chain.id, address, ...net }) : null;
    return {
      ok: true,
      level: decideLevel(best, repo),
      registration: best,
      repo,
      repoLink: best ? (parseGithubRepo(best.githubRepo)?.url ?? null) : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "lookup failed";
    return { ok: false, level: "unknown", error: message.slice(0, 200) };
  }
}
