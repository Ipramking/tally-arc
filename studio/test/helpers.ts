// Test plumbing: a fake chain (JSON-RPC over fetch) plus real ABI encoding from viem.
import { encodeFunctionResult, getAddress, parseAbi, type Address, type Hex } from "viem";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chains, type ChainDef } from "@/lib/chain";
import { registryV1Abi, registryV2Abi } from "@/lib/abi";

export const ZERO = "0x0000000000000000000000000000000000000000" as Address;
export const SIGNER = "0x1111111111111111111111111111111111111111" as Address;
export const OTHER = "0x2222222222222222222222222222222222222222" as Address;
export const TARGET = "0x0f399C0143CAd70b43D18a5696026B0cEdcA0cCb" as Address;
export const REPO = "https://github.com/acme/vault";
export const REG_V2 = "0x4444444444444444444444444444444444444444" as Address;

export const arcChain = chains.find((c) => c.key === "arc") as ChainDef;
export const REG_V1 = arcChain.registries[0].address;

export function vectors<T = any>(name: string): T {
  const path = fileURLToPath(new URL(`../../test-vectors/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8"));
}

export function encodeV1(o: { repo?: string; hash?: string; owner?: Address; at?: bigint; prov?: number; verified?: boolean } = {}): Hex {
  const prov = o.prov ?? 2;
  return encodeFunctionResult({
    abi: registryV1Abi,
    functionName: "getRegistration",
    result: [o.repo ?? REPO, o.hash ?? "", o.owner ?? SIGNER, o.at ?? 1700000000n, prov, o.verified ?? prov === 2],
  });
}

export function encodeV2(o: { repo?: string; hash?: string; signer?: Address; at?: bigint; prov?: number; method?: number; flags?: number } = {}): Hex {
  const prov = o.prov ?? 2;
  const flags = o.flags ?? 3;
  return encodeFunctionResult({
    abi: registryV2Abi,
    functionName: "getRegistration",
    result: [o.repo ?? REPO, o.hash ?? "", o.signer ?? SIGNER, o.at ?? 1700000000n, prov, prov === 2 && flags === 3, o.method ?? 1, flags],
  });
}

export const NONE_V1 = () => encodeV1({ repo: "", owner: ZERO, at: 0n, prov: 0 });
export const NONE_V2 = () => encodeV2({ repo: "", signer: ZERO, at: 0n, prov: 0, method: 0, flags: 0 });
export const addressWord = (a: Address): Hex => `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;
export const ZERO_WORD: Hex = `0x${"0".repeat(64)}`;
/** An eth_getStorageAt reply that answers by slot: slots not listed read as empty, like a contract that is not a proxy. */
export const storageBySlot = (slots: Record<string, string | Error>) => (params: unknown[]) => {
  const value = slots[String(params[1]).toLowerCase()];
  if (value instanceof Error) throw value;
  return value ?? ZERO_WORD;
};
export const boolWord = (b: boolean): Hex => `0x${(b ? "1" : "0").padStart(64, "0")}`;

/** A reply is a value, an Error to throw, an RPC error object, or a function of the request params. */
type RpcReply = string | Error | { error: { code: number; message: string } } | ((params: unknown[]) => unknown) | unknown[] | Record<string, unknown>;
export type FakeFetch = ((url: string, init?: RequestInit) => Promise<Response>) & { calls: { url: string; init?: RequestInit }[] };

/**
 * Fake chain. rpc: { [to]: { [selector | "method"]: reply } } routes eth_call by (to, selector);
 * other methods (eth_getCode, eth_getTransactionCount) are keyed by name under "*".
 * files: GitHub raw URL -> text | status number | Error.
 */
export function fakeWorld(spec: { rpc?: Record<string, Record<string, RpcReply>>; files?: Record<string, string | number | Error> } = {}): FakeFetch {
  const rpc = Object.fromEntries(Object.entries(spec.rpc ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const files = spec.files ?? {};
  const calls: FakeFetch["calls"] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.startsWith("https://raw.githubusercontent.com/")) {
      const file = files[url];
      if (file instanceof Error) throw file;
      if (typeof file === "number") return new Response("", { status: file });
      if (file === undefined) return new Response("Not Found", { status: 404 });
      return new Response(file);
    }
    const body = JSON.parse(String(init?.body));
    let reply: RpcReply | undefined;
    if (body.method === "eth_call") {
      const { to, data } = body.params[0];
      reply = rpc[String(to).toLowerCase()]?.[String(data).slice(0, 10)];
      if (reply === undefined) return Response.json({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted" } });
    } else {
      reply = rpc["*"]?.[body.method] ?? rpc[String(body.params[0]).toLowerCase()]?.[body.method];
      // Every address holds code unless a test says otherwise ("0x" = a wallet).
      if (reply === undefined && body.method === "eth_getCode") reply = "0x6001";
      // Every contract has empty proxy slots unless a test says otherwise.
      if (reply === undefined && body.method === "eth_getStorageAt") reply = ZERO_WORD;
      if (reply === undefined) return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: `no fake for ${body.method}` } });
    }
    if (typeof reply === "function") reply = reply(body.params) as RpcReply;
    if (reply instanceof Error) throw reply;
    if (reply && typeof reply === "object" && !Array.isArray(reply) && "error" in reply) return Response.json({ jsonrpc: "2.0", id: 1, error: (reply as { error: unknown }).error });
    return Response.json({ jsonrpc: "2.0", id: 1, result: reply });
  }) as FakeFetch;
  fn.calls = calls;
  return fn;
}

export const tallyJson = (...contracts: unknown[]) => JSON.stringify({ version: 1, contracts });
export { getAddress, parseAbi };
