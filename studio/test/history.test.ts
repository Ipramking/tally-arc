import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, parseAbiParameters, toFunctionSelector, type Address, type Hex } from "viem";
import { registryV2Abi } from "@/lib/abi";
import { chains, type ChainDef } from "@/lib/chain";
import { DEFAULT_PAGE, mergeHistories, readHistory, type History } from "@/lib/history";
import { fakeWorld, OTHER, REG_V1, REPO, SIGNER, TARGET } from "./helpers";

const bot = chains.find((c) => c.key === "bot-testnet") as ChainDef;
const REG = bot.registries[0];
const SEL_LENGTH = toFunctionSelector("historyLength(address)");
const SEL_PAGE = toFunctionSelector("getHistory(address,uint256,uint256)");

type Row = { signer: Address; blockNumber: bigint; kind: number; provenance: number; method: number };
const row = (o: Partial<Row> & { blockNumber: bigint }): Row => ({ signer: SIGNER, kind: 0, provenance: 2, method: 1, ...o });

const lengthReply = (n: number): Hex => encodeFunctionResult({ abi: registryV2Abi, functionName: "historyLength", result: BigInt(n) });
const pageReply = (rows: Row[]): Hex => encodeFunctionResult({ abi: registryV2Abi, functionName: "getHistory", result: rows });

/** A real-shaped Registered log for one block. */
function registeredLog(o: { signer?: Address; repo?: string; hash?: string; tx?: Hex; logIndex?: number }) {
  const topics = encodeEventTopics({ abi: registryV2Abi, eventName: "Registered", args: { target: TARGET, signer: o.signer ?? SIGNER } });
  const data = encodeAbiParameters(parseAbiParameters("uint8 provenance, uint8 method, string githubRepo, string buildHash, bytes32 codehash"), [
    2,
    1,
    o.repo ?? REPO,
    o.hash ?? "",
    `0x${"ab".repeat(32)}`,
  ]);
  const transactionHash = o.tx ?? (`0x${"cd".repeat(32)}` as Hex);
  return { topics, data, transactionHash, logIndex: `0x${(o.logIndex ?? 0).toString(16)}` };
}

const header = (stamps: Record<number, number>) => (params: unknown[]) => {
  const stamp = stamps[parseInt(String(params[0]), 16)];
  return stamp === undefined ? null : { timestamp: `0x${stamp.toString(16)}` };
};
const logsByBlock = (byBlock: Record<number, ReturnType<typeof registeredLog>[]>) => (params: unknown[]) => {
  const f = params[0] as { fromBlock: string; toBlock: string };
  expect(f.fromBlock).toBe(f.toBlock); // always a single block
  return byBlock[parseInt(f.fromBlock, 16)] ?? [];
};

function world(rows: Row[], extra: Record<string, unknown> = {}) {
  return fakeWorld({
    rpc: {
      [REG.address]: { [SEL_LENGTH]: lengthReply(rows.length), [SEL_PAGE]: pageReply(rows) },
      "*": extra as never,
    },
  });
}

describe("readHistory", () => {
  it("lists entries newest first with time, repository, build hash and transaction filled in", async () => {
    const tx1 = `0x${"11".repeat(32)}` as Hex;
    const tx2 = `0x${"22".repeat(32)}` as Hex;
    const fetchImpl = world([row({ blockNumber: 100n, signer: OTHER, provenance: 1, method: 0 }), row({ blockNumber: 200n })], {
      eth_getBlockByNumber: header({ 100: 1_700_000_000, 200: 1_700_000_500 }),
      eth_getLogs: logsByBlock({
        100: [registeredLog({ signer: OTHER, repo: "https://github.com/squatter/fake", tx: tx1 })],
        200: [registeredLog({ signer: SIGNER, repo: REPO, hash: "abc123", tx: tx2 })],
      }),
    });
    const h = await readHistory(bot, REG, TARGET, { fetchImpl });
    expect(h.status).toBe("ok");
    if (h.status !== "ok") return;
    expect(h.total).toBe(2);
    expect(h.items.map((i) => i.index)).toEqual([1, 0]); // newest first
    expect(h.items[0]).toMatchObject({ kind: "REGISTERED", provenance: "CONTROL_PROVEN", method: "OWNER", block: 200, time: 1_700_000_500, repo: REPO, buildHash: "abc123", txHash: tx2 });
    expect(h.items[1]).toMatchObject({ kind: "REGISTERED", provenance: "SELF_ATTESTED", method: "NONE", signer: OTHER, repo: "https://github.com/squatter/fake", txHash: tx1 });
  });

  it("keeps a revocation as an entry, with no repository", async () => {
    const fetchImpl = world([row({ blockNumber: 100n }), row({ blockNumber: 150n, kind: 1, signer: OTHER })], {
      eth_getBlockByNumber: header({ 100: 1, 150: 2 }),
      eth_getLogs: logsByBlock({ 100: [registeredLog({})] }),
    });
    const h = await readHistory(bot, REG, TARGET, { fetchImpl });
    if (h.status !== "ok") throw new Error("expected ok");
    expect(h.items[0]).toMatchObject({ kind: "REVOKED", signer: OTHER, provenance: "CONTROL_PROVEN", method: "OWNER", repo: null, buildHash: null, txHash: null });
    expect(h.items[1]).toMatchObject({ kind: "REGISTERED", repo: REPO });
  });

  it("pairs several registrations in one block with their events in order", async () => {
    const fetchImpl = world([row({ blockNumber: 100n }), row({ blockNumber: 100n })], {
      eth_getBlockByNumber: header({ 100: 5 }),
      eth_getLogs: logsByBlock({ 100: [registeredLog({ repo: "https://github.com/acme/one", logIndex: 3 }), registeredLog({ repo: "https://github.com/acme/two", logIndex: 7 })] }),
    });
    const h = await readHistory(bot, REG, TARGET, { fetchImpl });
    if (h.status !== "ok") throw new Error("expected ok");
    expect(h.items.map((i) => i.repo)).toEqual(["https://github.com/acme/two", "https://github.com/acme/one"]);
  });

  it("does not attach an event whose signer differs from the entry", async () => {
    const fetchImpl = world([row({ blockNumber: 100n, signer: SIGNER })], {
      eth_getBlockByNumber: header({ 100: 5 }),
      eth_getLogs: logsByBlock({ 100: [registeredLog({ signer: OTHER, repo: "https://github.com/evil/phish" })] }),
    });
    const h = await readHistory(bot, REG, TARGET, { fetchImpl });
    if (h.status !== "ok") throw new Error("expected ok");
    expect(h.items[0].repo).toBeNull();
    expect(h.items[0].txHash).toBeNull();
  });

  it("still lists the entries when logs and block headers cannot be read", async () => {
    const fetchImpl = world([row({ blockNumber: 100n })], {
      eth_getBlockByNumber: { error: { code: -32000, message: "header not found" } },
      eth_getLogs: { error: { code: -32005, message: "query exceeds max block range" } },
    });
    const h = await readHistory(bot, REG, TARGET, { fetchImpl });
    expect(h.status).toBe("ok");
    if (h.status !== "ok") return;
    expect(h.items).toHaveLength(1);
    expect(h.items[0]).toMatchObject({ block: 100, time: null, repo: null, buildHash: null, txHash: null, signer: SIGNER });
  });

  it("asks for the last `limit` entries only and reports the full total", async () => {
    let asked: { start: bigint; count: bigint } | null = null;
    const fetchImpl = fakeWorld({
      rpc: {
        [REG.address]: {
          [SEL_LENGTH]: lengthReply(25),
          [SEL_PAGE]: (params: unknown[]) => {
            const { args } = decodeFunctionData({ abi: registryV2Abi, data: (params[0] as { data: Hex }).data });
            asked = { start: args![1] as bigint, count: args![2] as bigint };
            return pageReply(Array.from({ length: 10 }, (_, i) => row({ blockNumber: BigInt(100 + i) })));
          },
        },
        "*": { eth_getBlockByNumber: header({}), eth_getLogs: [] } as never,
      },
    });
    const h = await readHistory(bot, REG, TARGET, { fetchImpl, limit: 10 });
    if (h.status !== "ok") throw new Error("expected ok");
    expect(asked).toEqual({ start: 15n, count: 10n });
    expect(h.total).toBe(25);
    expect(h.items).toHaveLength(10);
    expect(h.items[0].index).toBe(24);
    expect(h.items[9].index).toBe(15);
  });

  it("returns an empty list for a contract with no history", async () => {
    const h = await readHistory(bot, REG, TARGET, { fetchImpl: world([]) });
    expect(h).toEqual({ status: "ok", registry: REG.address, total: 0, items: [] });
  });

  it("says unsupported for a v1 registry without asking the network", async () => {
    const fetchImpl = fakeWorld();
    const arc = chains.find((c) => c.key === "arc") as ChainDef;
    const h = await readHistory(arc, { version: 1, address: REG_V1 }, TARGET, { fetchImpl });
    expect(h.status).toBe("unsupported");
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it("says unsupported for a v2 registry that has no history functions", async () => {
    const fetchImpl = fakeWorld({ rpc: {} }); // every eth_call reverts
    expect((await readHistory(bot, REG, TARGET, { fetchImpl })).status).toBe("unsupported");
  });

  it("says unavailable, not unsupported, when the network fails", async () => {
    const fetchImpl = fakeWorld({ rpc: { [REG.address]: { [SEL_LENGTH]: new Error("socket hang up") } } });
    const h = await readHistory(bot, REG, TARGET, { fetchImpl });
    expect(h.status).toBe("unavailable");
  });

  it("says unavailable when the registry returns an unknown level", async () => {
    const fetchImpl = world([row({ blockNumber: 1n, provenance: 9 })]);
    expect((await readHistory(bot, REG, TARGET, { fetchImpl })).status).toBe("unavailable");
  });
});

describe("mergeHistories", () => {
  const item = (block: number, index: number, registry: Address) => ({ index, block, registry }) as never;
  const ok = (registry: Address, total: number, items: unknown[]): History => ({ status: "ok", registry, total, items: items as never });

  it("sorts newest first across registries, sums totals and cuts to the limit", () => {
    const A = REG.address;
    const B = OTHER;
    const merged = mergeHistories([ok(A, 3, [item(300, 2, A), item(100, 0, A)]), ok(B, 2, [item(200, 1, B), item(50, 0, B)])], 3);
    expect(merged.items.map((i) => i.block)).toEqual([300, 200, 100]);
    expect(merged.total).toBe(5);
    expect(merged.hasUnsupported).toBe(false);
  });

  it("flags registries that keep no history or could not be read", () => {
    const m = mergeHistories([
      { status: "unsupported", registry: REG_V1 },
      { status: "unavailable", registry: REG.address, detail: "timeout" },
    ]);
    expect(m).toMatchObject({ items: [], total: 0, hasUnsupported: true, hasUnavailable: true });
  });

  it("defaults to one page", () => {
    const many = Array.from({ length: DEFAULT_PAGE + 5 }, (_, i) => item(i, i, REG.address));
    expect(mergeHistories([ok(REG.address, many.length, many)]).items).toHaveLength(DEFAULT_PAGE);
  });
});
