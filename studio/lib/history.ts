// Provenance history: every registration and revocation a v2 registry has
// recorded for one contract, newest first.
//
// The registry appends an entry on each write and never removes one, so a
// record that was replaced or revoked stays readable. The list itself (who,
// which block, what level) comes from one eth_call. The repository and build
// hash of each entry come from the `Registered` event in that entry's block,
// read with single-block log queries, which every RPC allows. Anything that
// cannot be fetched is left blank; it never fails the page.
import { decodeEventLog, decodeFunctionResult, encodeFunctionData, pad, toEventSelector, type Address, type Hex } from "viem";
import { registryV2Abi } from "./abi";
import type { ChainDef, RegistryDef } from "./chains.generated";
import type { NetOptions } from "./net";
import { PROOF_METHODS, PROVENANCE, type ProofMethod, type Provenance } from "./registry";
import { ethCall, getBlockTimestamp, getLogsInBlock, RpcError } from "./rpc";

export type HistoryKind = "REGISTERED" | "REVOKED";
const KINDS: readonly HistoryKind[] = ["REGISTERED", "REVOKED"];

export const DEFAULT_PAGE = 10;
export const MAX_PAGE = 50;
const CONCURRENCY = 4;

const REGISTERED_TOPIC = toEventSelector("Registered(address,address,uint8,uint8,string,string,bytes32)");

export interface HistoryItem {
  /** Position in the registry's list for this contract (0 is the oldest). */
  index: number;
  kind: HistoryKind;
  /** REGISTERED: who signed the claim. REVOKED: who removed the record. */
  signer: Address;
  /** The level written, or for REVOKED the level that was removed. */
  provenance: Provenance;
  method: ProofMethod;
  block: number;
  /** Unix seconds, or null when the block header could not be read. */
  time: number | null;
  /** From the Registered event; null when it could not be read (and always for REVOKED). */
  repo: string | null;
  buildHash: string | null;
  txHash: Hex | null;
  registry: Address;
}

export type History =
  | { status: "ok"; registry: Address; total: number; items: HistoryItem[] }
  /** v1 registries keep no history; a v2 registry deployed before history existed answers the same way. */
  | { status: "unsupported"; registry: Address }
  | { status: "unavailable"; registry: Address; detail: string };

export interface HistoryOptions extends NetOptions {
  limit?: number;
}

function pick<T>(list: readonly T[], value: number, what: string): T {
  const item = list[value];
  if (!Number.isInteger(value) || item === undefined) throw new Error(`${what} out of range`);
  return item;
}

/** Run `work` over `items` with at most `CONCURRENCY` in flight. Errors are the worker's to handle. */
async function forEachLimited<T>(items: readonly T[], work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  });
  await Promise.all(lanes);
}

const unavailable = (registry: Address, error: unknown): History => ({
  status: "unavailable",
  registry,
  detail: (error instanceof Error ? error.message : "history lookup failed").slice(0, 120),
});

export async function readHistory(chain: ChainDef, registry: RegistryDef, target: Address, options: HistoryOptions = {}): Promise<History> {
  if (registry.version !== 2) return { status: "unsupported", registry: registry.address };
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? DEFAULT_PAGE), 1), MAX_PAGE);
  const net: NetOptions = { fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs };

  let total: number;
  try {
    const data = await ethCall(chain.rpcUrl, registry.address, encodeFunctionData({ abi: registryV2Abi, functionName: "historyLength", args: [target] }), net);
    const length = decodeFunctionResult({ abi: registryV2Abi, functionName: "historyLength", data });
    if (length > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("history length out of range");
    total = Number(length);
  } catch (error) {
    if (error instanceof RpcError && error.revert) return { status: "unsupported", registry: registry.address };
    return unavailable(registry.address, error);
  }
  if (total === 0) return { status: "ok", registry: registry.address, total: 0, items: [] };

  const start = Math.max(0, total - limit);
  let items: HistoryItem[];
  try {
    const data = await ethCall(chain.rpcUrl, registry.address, encodeFunctionData({ abi: registryV2Abi, functionName: "getHistory", args: [target, BigInt(start), BigInt(limit)] }), net);
    const page = decodeFunctionResult({ abi: registryV2Abi, functionName: "getHistory", data });
    items = page.map((e, i) => ({
      index: start + i,
      kind: pick(KINDS, e.kind, "kind"),
      signer: e.signer,
      provenance: pick(PROVENANCE, e.provenance, "provenance"),
      method: pick(PROOF_METHODS, e.method, "method"),
      block: Number(e.blockNumber),
      time: null,
      repo: null,
      buildHash: null,
      txHash: null,
      registry: registry.address,
    }));
  } catch (error) {
    return unavailable(registry.address, error);
  }

  // Block timestamps, one request per distinct block.
  const times = new Map<number, number>();
  await forEachLimited([...new Set(items.map((i) => i.block))], async (block) => {
    try {
      times.set(block, await getBlockTimestamp(chain.rpcUrl, block, net));
    } catch {
      // leave the time blank
    }
  });

  // Repository, build hash and transaction of each registration, from that block's event.
  const events = new Map<number, { signer: string; repo: string; buildHash: string; txHash: Hex }[]>();
  await forEachLimited([...new Set(items.filter((i) => i.kind === "REGISTERED").map((i) => i.block))], async (block) => {
    try {
      const logs = await getLogsInBlock(chain.rpcUrl, { address: registry.address, topics: [REGISTERED_TOPIC, pad(target, { size: 32 })], block }, net);
      const decoded: { signer: string; repo: string; buildHash: string; txHash: Hex }[] = [];
      for (const log of logs.sort((a, b) => a.logIndex - b.logIndex)) {
        try {
          const event = decodeEventLog({ abi: registryV2Abi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
          if (event.eventName === "Registered") {
            decoded.push({ signer: event.args.signer.toLowerCase(), repo: event.args.githubRepo, buildHash: event.args.buildHash, txHash: log.transactionHash });
          }
        } catch {
          // skip a log that does not decode
        }
      }
      events.set(block, decoded);
    } catch {
      // leave repo and build hash blank
    }
  });

  // Entries are oldest first, so the k-th registration in a block pairs with the k-th event in it.
  const seen = new Map<number, number>();
  for (const item of items) {
    item.time = times.get(item.block) ?? null;
    if (item.kind !== "REGISTERED") continue;
    const k = seen.get(item.block) ?? 0;
    seen.set(item.block, k + 1);
    const event = events.get(item.block)?.[k];
    if (event && event.signer === item.signer.toLowerCase()) {
      item.repo = event.repo;
      item.buildHash = event.buildHash;
      item.txHash = event.txHash;
    }
  }

  return { status: "ok", registry: registry.address, total, items: items.reverse() };
}

export interface MergedHistory {
  /** Newest first, at most `limit` entries across every registry. */
  items: HistoryItem[];
  /** Entries the registries hold in total (shown or not). */
  total: number;
  /** Some registry on this network keeps no history (v1), so older records may exist that cannot be listed. */
  hasUnsupported: boolean;
  /** A registry that does keep history could not be read right now. */
  hasUnavailable: boolean;
}

/** Combine the answers of every registry on a chain into one newest-first list. */
export function mergeHistories(histories: readonly History[], limit = DEFAULT_PAGE): MergedHistory {
  const items: HistoryItem[] = [];
  let total = 0;
  let hasUnsupported = false;
  let hasUnavailable = false;
  for (const h of histories) {
    if (h.status === "ok") {
      items.push(...h.items);
      total += h.total;
    } else if (h.status === "unsupported") hasUnsupported = true;
    else hasUnavailable = true;
  }
  items.sort((a, b) => b.block - a.block || b.index - a.index);
  return { items: items.slice(0, limit), total, hasUnsupported, hasUnavailable };
}
