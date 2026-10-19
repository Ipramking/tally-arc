// Minimal JSON-RPC client for reads. Used instead of a full client library so
// every request is locked down the same way as the extension's: a deadline, a
// size cap, no redirects, no credentials, and errors classified into "the call
// reverted" (an answer) versus "the network failed" (no answer).
//
// Freshness: a public RPC is often several nodes behind one address, and one of them can fall behind or
// freeze. Its answers are valid but old ("no record" for a contract that was registered an hour ago), so
// every read is sent together with a "latest block" probe in ONE batch request. One request is served by
// one node, so the probe tells us how old the data we are about to trust really is. A node whose newest
// block is older than the limit is retried (the load balancer may pick another node) and then refused.
import type { Address, Hex } from "viem";
import { readLimited, timeoutSignal, TooLargeError, type NetOptions } from "./net";

const MAX_RPC_BYTES = 64 * 1024;
// The probe returns a whole block (transaction hashes only); allow for a busy one.
const MAX_BATCH_BYTES = 256 * 1024;
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;

export const DEFAULT_MAX_HEAD_AGE_SECONDS = 300;
const DEFAULT_FRESHNESS_ATTEMPTS = 5;

export class RpcError extends Error {
  readonly revert: boolean;
  readonly status: number | undefined;
  constructor(message: string, revert = false, status?: number) {
    super(message);
    this.name = "RpcError";
    this.revert = revert;
    this.status = status;
  }
}

function describeAge(seconds: number): string {
  if (seconds < 120) return `${seconds} seconds`;
  if (seconds < 7200) return `${Math.round(seconds / 60)} minutes`;
  return `${Math.round(seconds / 3600)} hours`;
}

/** The answering node is behind the chain. Not an answer about the contract: the lookup is "unavailable". */
export class StaleNodeError extends RpcError {
  readonly ageSeconds: number;
  constructor(ageSeconds: number) {
    super(`The network node is behind: its newest block is ${describeAge(ageSeconds)} old, so its answer cannot be trusted. Try again shortly. If your device clock is wrong, this can be a false alarm.`);
    this.name = "StaleNodeError";
    this.ageSeconds = ageSeconds;
  }
}

type Entry = { id?: unknown; result?: unknown; error?: { code?: number; message?: unknown } } | null;

async function postJson(rpcUrl: string, payload: unknown, limit: number, options: NetOptions): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    signal: timeoutSignal(options.timeoutMs),
  });
  if (!response.ok) throw new RpcError(`RPC HTTP ${response.status}`, false, response.status);
  try {
    return JSON.parse(await readLimited(response, limit));
  } catch (error) {
    if (error instanceof TooLargeError) throw new RpcError("RPC response too large");
    throw new RpcError("RPC returned invalid JSON");
  }
}

/** One JSON-RPC reply to its result, or the RpcError it stands for. */
function unwrap(body: Entry): unknown {
  if (body && body.error) {
    const message = String(body.error.message ?? "RPC error").slice(0, 200);
    throw new RpcError(message, body.error.code === 3 || /revert/i.test(message));
  }
  if (!body || body.result === undefined || body.result === null) throw new RpcError("RPC returned no result");
  return body.result;
}

async function rawRequest(rpcUrl: string, method: string, params: unknown[], options: NetOptions, limit = MAX_RPC_BYTES): Promise<unknown> {
  return unwrap((await postJson(rpcUrl, { jsonrpc: "2.0", id: 1, method, params }, limit, options)) as Entry);
}

function blockTimestamp(block: unknown): number {
  const stamp = block && typeof block === "object" ? (block as { timestamp?: unknown }).timestamp : undefined;
  if (typeof stamp !== "string" || !/^0x[0-9a-fA-F]{1,16}$/.test(stamp)) throw new RpcError("RPC returned a malformed block");
  const seconds = Number(BigInt(stamp));
  if (!Number.isSafeInteger(seconds)) throw new RpcError("RPC returned a malformed block");
  return seconds;
}

// Endpoints that refuse batch requests: the check then runs as two requests (weaker, since they can reach
// different nodes, but still better than none).
const batchRefused = new Set<string>();

async function readWithHead(rpcUrl: string, method: string, params: unknown[], options: NetOptions): Promise<{ head: number; entry: Entry }> {
  if (!batchRefused.has(rpcUrl)) {
    const body = await postJson(
      rpcUrl,
      [
        { jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["latest", false] },
        { jsonrpc: "2.0", id: 2, method, params },
      ],
      MAX_BATCH_BYTES,
      options,
    ).catch((error: unknown) => {
      if (error instanceof RpcError && (error.status === 400 || error.status === 405 || error.status === 413)) return null;
      throw error;
    });
    if (Array.isArray(body)) {
      const head = body.find((e: Entry) => e && e.id === 1) as Entry | undefined;
      const entry = body.find((e: Entry) => e && e.id === 2) as Entry | undefined;
      if (!head || !entry) throw new RpcError("RPC returned a malformed batch");
      return { head: blockTimestamp(unwrap(head)), entry };
    }
    batchRefused.add(rpcUrl); // a non-array answer (or HTTP 400/405/413) means batching is not supported here
  }
  const head = blockTimestamp(await rawRequest(rpcUrl, "eth_getBlockByNumber", ["latest", false], options, MAX_BATCH_BYTES));
  let entry: Entry;
  try {
    entry = { result: await rawRequest(rpcUrl, method, params, options) };
  } catch (error) {
    if (!(error instanceof RpcError)) throw error;
    entry = { error: { code: error.revert ? 3 : -32000, message: error.message } };
  }
  return { head, entry };
}

export async function rpcRequest(rpcUrl: string, method: string, params: unknown[], options: NetOptions = {}): Promise<unknown> {
  const maxAge = options.maxHeadAgeSeconds ?? DEFAULT_MAX_HEAD_AGE_SECONDS;
  if (maxAge <= 0) return rawRequest(rpcUrl, method, params, options);
  const attempts = Math.max(1, options.freshnessAttempts ?? DEFAULT_FRESHNESS_ATTEMPTS);
  let stale: StaleNodeError | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const { head, entry } = await readWithHead(rpcUrl, method, params, options);
    const age = Math.round((options.nowMs ? options.nowMs() : Date.now()) / 1000 - head);
    // The answer is judged only after the node proves it is current: a stale node's "reverted" or "no record"
    // is not an answer about the chain.
    if (age > maxAge) {
      stale = new StaleNodeError(age);
      continue;
    }
    return unwrap(entry);
  }
  throw stale as StaleNodeError;
}

function hexResult(value: unknown): Hex {
  if (typeof value !== "string" || !HEX.test(value)) throw new RpcError("RPC returned malformed data");
  return value as Hex;
}

export async function ethCall(rpcUrl: string, to: Address, data: Hex, options: NetOptions = {}): Promise<Hex> {
  return hexResult(await rpcRequest(rpcUrl, "eth_call", [{ to, data }, "latest"], options));
}

export async function getCode(rpcUrl: string, address: Address, options: NetOptions = {}): Promise<Hex> {
  return hexResult(await rpcRequest(rpcUrl, "eth_getCode", [address, "latest"], options));
}

export interface RpcLog {
  topics: Hex[];
  data: Hex;
  transactionHash: Hex;
  logIndex: number;
}

const HASH = /^0x[0-9a-fA-F]{64}$/;

/**
 * Logs one contract emitted in ONE block. A single-block query is the one log
 * query every RPC allows (public nodes cap wider ranges), and it is all the
 * registry history needs: the history list on-chain names the block of each write.
 */
export async function getLogsInBlock(
  rpcUrl: string,
  filter: { address: Address; topics: (Hex | Hex[] | null)[]; block: number },
  options: NetOptions = {},
): Promise<RpcLog[]> {
  const block = `0x${filter.block.toString(16)}`;
  const result = await rpcRequest(rpcUrl, "eth_getLogs", [{ address: filter.address, topics: filter.topics, fromBlock: block, toBlock: block }], options);
  if (!Array.isArray(result)) throw new RpcError("RPC returned malformed logs");
  return result.slice(0, 200).map((raw): RpcLog => {
    const log = raw as { topics?: unknown; data?: unknown; transactionHash?: unknown; logIndex?: unknown };
    const topics = Array.isArray(log.topics) ? log.topics : null;
    if (!topics || !topics.every((t) => typeof t === "string" && HASH.test(t))) throw new RpcError("RPC returned malformed logs");
    if (typeof log.data !== "string" || !HEX.test(log.data)) throw new RpcError("RPC returned malformed logs");
    if (typeof log.transactionHash !== "string" || !HASH.test(log.transactionHash)) throw new RpcError("RPC returned malformed logs");
    const index = typeof log.logIndex === "string" && /^0x[0-9a-fA-F]{1,8}$/.test(log.logIndex) ? Number(BigInt(log.logIndex)) : 0;
    return { topics: topics as Hex[], data: log.data as Hex, transactionHash: log.transactionHash as Hex, logIndex: index };
  });
}

/** Timestamp (unix seconds) of a block. */
export async function getBlockTimestamp(rpcUrl: string, block: number, options: NetOptions = {}): Promise<number> {
  const result = (await rpcRequest(rpcUrl, "eth_getBlockByNumber", [`0x${block.toString(16)}`, false], options)) as { timestamp?: unknown } | null;
  const stamp = result && typeof result === "object" ? result.timestamp : undefined;
  if (typeof stamp !== "string" || !/^0x[0-9a-fA-F]{1,16}$/.test(stamp)) throw new RpcError("RPC returned a malformed block");
  const seconds = Number(BigInt(stamp));
  if (!Number.isSafeInteger(seconds)) throw new RpcError("RPC returned a malformed block");
  return seconds;
}

/** One 32-byte storage slot, normalised to a lowercase 0x-prefixed 64-digit word (some nodes drop leading zeros). */
export async function getStorageAt(rpcUrl: string, address: Address, slot: Hex, options: NetOptions = {}): Promise<Hex> {
  const value = await rpcRequest(rpcUrl, "eth_getStorageAt", [address, slot, "latest"], options);
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) throw new RpcError("RPC returned malformed storage");
  return `0x${value.slice(2).toLowerCase().padStart(64, "0")}` as Hex;
}

export async function getTransactionCount(rpcUrl: string, address: Address, options: NetOptions = {}): Promise<number> {
  const value = await rpcRequest(rpcUrl, "eth_getTransactionCount", [address, "latest"], options);
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,16}$/.test(value)) throw new RpcError("RPC returned a malformed count");
  const count = Number(BigInt(value));
  if (!Number.isSafeInteger(count)) throw new RpcError("RPC returned a malformed count");
  return count;
}
