// Orchestrates one address lookup: read every registry on the chain, pick the
// strongest record, confirm the repository when it matters, decide the level.
// Mirrors extension/lib/lookup.js.
import type { Address } from "viem";
import type { ChainDef } from "./chains.generated";
import type { NetOptions } from "./net";
import { checkRepoProof, type RepoCheck } from "./repo-proof";
import { isUpgradeableProxy } from "./proxy";
import { currentOwnerIs, readOwner, readRegistry, type Registration } from "./registry";
import { getCode } from "./rpc";
import { isAddress, parseGithubRepo } from "./safe-url";
import { decideLevel, isLive, pickBest, type Level } from "./status";

export type Lookup =
  | { ok: true; level: Level; registration: Registration | null; repo: RepoCheck | null; repoLink: string | null }
  | { ok: false; level: "unknown"; error: string };

/** Never throws for network or decoding failures; those become level "unknown". */
export async function lookupContract(input: { chain: ChainDef; address: string } & NetOptions): Promise<Lookup> {
  const { chain, address, ...options } = input;
  // The chain's own limit applies unless the caller passes one.
  const net: NetOptions = { ...options, maxHeadAgeSeconds: options.maxHeadAgeSeconds ?? chain.maxHeadAgeSeconds };
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
      // A deployer proof is a permanent fact, so the registry keeps reporting it as "still held" after the
      // contract changed hands. Tally does not: once the contract names another owner, the deployer no
      // longer speaks for it, and its record reads stale. A contract with no owner() leaves the proof as is.
      if (record.registryVersion === 2 && record.provenance === "CONTROL_PROVEN" && record.method === "DEPLOYER" && record.controlCurrent === true) {
        const owner = await readOwner(chain, address as Address, net);
        if (owner !== null && owner !== record.signer.toLowerCase()) record.controlCurrent = false;
      }
      records.push(record);
    }

    const best = pickBest(records);
    // A proxy's code hash survives an upgrade, so the "code unchanged" leg says nothing about it. Probe the
    // standard proxy slots for the record that could reach "verified"; a failed probe makes the answer unknown.
    if (best && best.registryVersion === 2 && isLive(best)) best.upgradeable = await isUpgradeableProxy(chain, address as Address, net);
    const repo = best && isLive(best) ? await checkRepoProof({ repoUrl: best.githubRepo, chainId: chain.id, address, signer: best.signer, ...net }) : null;
    let level = decideLevel(best, repo);
    // No record: a wallet has no code, so there is nothing to verify and nothing to register.
    // If the chain cannot say, getCode throws and the answer is "unknown", never "unverified".
    if (level === "unverified" && (await getCode(chain.rpcUrl, address as Address, net)) === "0x") level = "wallet";
    return {
      ok: true,
      level,
      registration: best,
      repo,
      repoLink: best ? (parseGithubRepo(best.githubRepo)?.url ?? null) : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "lookup failed";
    return { ok: false, level: "unknown", error: message.slice(0, 200) };
  }
}
