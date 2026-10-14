// Minimal JSON-RPC client for reads. Used instead of a full client library so
// every request is locked down the same way as the extension's: a deadline, a
// size cap, no redirects, no credentials, and errors classified into "the call
// reverted" (an answer) versus "the network failed" (no answer).
import type { Address, Hex } from "viem";
import { readLimited, timeoutSignal, TooLargeError, type NetOptions } from "./net";

const MAX_RPC_BYTES = 64 * 1024;
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;

export class RpcError extends Error {
  readonly revert: boolean;
  constructor(message: string, revert = false) {
    super(message);
    this.name = "RpcError";
    this.revert = revert;
  }
}

export async function rpcRequest(rpcUrl: string, method: string, params: unknown[], options: NetOptions = {}): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    signal: timeoutSignal(options.timeoutMs),
  });
  if (!response.ok) throw new RpcError(`RPC HTTP ${response.status}`);

  let body: { result?: unknown; error?: { code?: number; message?: unknown } } | null;
  try {
    body = JSON.parse(await readLimited(response, MAX_RPC_BYTES));
  } catch (error) {
    if (error instanceof TooLargeError) throw new RpcError("RPC response too large");
    throw new RpcError("RPC returned invalid JSON");
  }
  if (body && body.error) {
    const message = String(body.error.message ?? "RPC error").slice(0, 200);
    throw new RpcError(message, body.error.code === 3 || /revert/i.test(message));
  }
  if (!body || body.result === undefined || body.result === null) throw new RpcError("RPC returned no result");
  return body.result;
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

export async function getTransactionCount(rpcUrl: string, address: Address, options: NetOptions = {}): Promise<number> {
  const value = await rpcRequest(rpcUrl, "eth_getTransactionCount", [address, "latest"], options);
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,16}$/.test(value)) throw new RpcError("RPC returned a malformed count");
  const count = Number(BigInt(value));
  if (!Number.isSafeInteger(count)) throw new RpcError("RPC returned a malformed count");
  return count;
}
