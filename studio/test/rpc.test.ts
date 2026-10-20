import { describe, expect, it } from "vitest";
import { ethCall, getCode, getTransactionCount, RpcError, StaleNodeError } from "@/lib/rpc";
import { readLimited, TooLargeError } from "@/lib/net";
import { TARGET, type FakeFetch } from "./helpers";

const serving = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as FakeFetch;
  fn.calls = calls;
  return fn;
};
const json = (body: unknown, init?: ResponseInit) => Response.json(body, init);
// These tests are about the request itself, so the freshness probe is off (see "freshness" below).
const RAW = { maxHeadAgeSeconds: 0 };

describe("rpc", () => {
  it("sends a locked-down JSON-RPC request", async () => {
    const fetchImpl = serving(() => json({ jsonrpc: "2.0", id: 1, result: "0x1234" }));
    expect(await ethCall("https://rpc.example", TARGET, "0xabcdef", { fetchImpl, ...RAW })).toBe("0x1234");
    const { url, init } = fetchImpl.calls[0];
    expect(url).toBe("https://rpc.example");
    expect(init).toMatchObject({ method: "POST", credentials: "omit", redirect: "error", cache: "no-store" });
    expect(JSON.parse(String(init?.body)).params).toEqual([{ to: TARGET, data: "0xabcdef" }, "latest"]);
  });

  it("classifies failures", async () => {
    const run = (handler: () => Response) => ethCall("https://rpc.example", TARGET, "0x", { fetchImpl: serving(handler), ...RAW });
    await expect(run(() => new Response("", { status: 503 }))).rejects.toThrow(/HTTP 503/);
    await expect(run(() => new Response("<html>"))).rejects.toThrow(/invalid JSON/);
    await expect(run(() => json({}))).rejects.toThrow(/no result/);
    await expect(run(() => json({ result: null }))).rejects.toThrow(/no result/);
    await expect(run(() => json({ result: 5 }))).rejects.toThrow(/malformed data/);
    await expect(run(() => json({ result: "0xabc" }))).rejects.toThrow(/malformed data/);
    await expect(run(() => new Response("x".repeat(70 * 1024)))).rejects.toThrow(/too large/);

    const revert = await run(() => json({ error: { code: 3, message: "execution reverted" } })).catch((e) => e);
    expect(revert).toBeInstanceOf(RpcError);
    expect(revert.revert).toBe(true);
    expect((await run(() => json({ error: { code: -32000, message: "execution reverted: nope" } })).catch((e) => e)).revert).toBe(true);
    const limited = await run(() => json({ error: { code: -32005, message: "rate limited" } })).catch((e) => e);
    expect(limited.revert).toBe(false);
    expect(limited.message).toMatch(/rate limited/);
  });

  it("network errors propagate as-is", async () => {
    const failing = serving(() => {
      throw new TypeError("fetch failed");
    });
    await expect(ethCall("https://rpc.example", TARGET, "0x", { fetchImpl: failing, ...RAW })).rejects.toThrow(/fetch failed/);
    await expect(ethCall("https://rpc.example", TARGET, "0x", { fetchImpl: failing })).rejects.toThrow(/fetch failed/);
  });

  it("getCode and getTransactionCount validate what comes back", async () => {
    const reply = (result: unknown) => ({ fetchImpl: serving(() => json({ jsonrpc: "2.0", id: 1, result })), ...RAW });
    expect(await getCode("https://rpc.example", TARGET, reply("0x6001"))).toBe("0x6001");
    expect(await getTransactionCount("https://rpc.example", TARGET, reply("0x2a"))).toBe(42);
    await expect(getTransactionCount("https://rpc.example", TARGET, reply("0xzz"))).rejects.toThrow(/malformed count/);
    await expect(getTransactionCount("https://rpc.example", TARGET, reply("0x" + "f".repeat(16)))).rejects.toThrow(/malformed count/);
  });
});

// A public RPC is often several nodes behind one address. One of them can freeze: its answers are well-formed and
// old. Each read therefore carries a "latest block" probe in the same batch (one request, one node).
describe("freshness", () => {
  const NOW = 1_800_000_000_000; // ms
  const at = { nowMs: () => NOW };
  const header = (ageSeconds: number) => ({ number: "0x10", timestamp: `0x${(NOW / 1000 - ageSeconds).toString(16)}`, transactions: [] });
  type Node = { age?: number | (() => number); result?: unknown; error?: { code: number; message: string } };
  const one = (node: Node, b: { id: number; method: string }) => {
    if (b.method === "eth_getBlockByNumber") return { jsonrpc: "2.0", id: b.id, result: header(typeof node.age === "function" ? node.age() : (node.age ?? 0)) };
    return node.error ? { jsonrpc: "2.0", id: b.id, error: node.error } : { jsonrpc: "2.0", id: b.id, result: node.result ?? "0x1234" };
  };
  // Answers a batch (in reverse order, as a node is free to) or a single request.
  const node = (spec: Node = {}) =>
    serving((_url, init) => {
      const body = JSON.parse(String(init?.body));
      return json(Array.isArray(body) ? body.map((b) => one(spec, b)).reverse() : one(spec, body));
    });
  const bodies = (fetchImpl: FakeFetch) => fetchImpl.calls.map((c) => JSON.parse(String(c.init?.body)));

  it("sends the read and a latest-block probe as one batch, and matches the answers by id", async () => {
    const fetchImpl = node({ result: "0x1234" });
    expect(await ethCall("https://rpc.shape", TARGET, "0xabcdef", { fetchImpl, ...at })).toBe("0x1234");
    expect(fetchImpl.calls).toHaveLength(1);
    expect(fetchImpl.calls[0].init).toMatchObject({ method: "POST", credentials: "omit", redirect: "error", cache: "no-store" });
    const [sent] = bodies(fetchImpl);
    expect(sent.map((b: { id: number; method: string }) => [b.id, b.method])).toEqual([[1, "eth_getBlockByNumber"], [2, "eth_call"]]);
    expect(sent[0].params).toEqual(["latest", false]);
    expect(sent[1].params).toEqual([{ to: TARGET, data: "0xabcdef" }, "latest"]);
  });

  it("refuses a node whose newest block is old, after retrying", async () => {
    const fetchImpl = node({ age: 4700 });
    const error = await ethCall("https://rpc.stale", TARGET, "0x", { fetchImpl, ...at }).catch((e) => e);
    expect(error).toBeInstanceOf(StaleNodeError);
    expect(error).toBeInstanceOf(RpcError);
    expect(error.ageSeconds).toBe(4700);
    expect(error.message).toMatch(/behind: its newest block is 78 minutes old/);
    expect(fetchImpl.calls).toHaveLength(5);
    const once = node({ age: 4700 });
    await expect(ethCall("https://rpc.stale", TARGET, "0x", { fetchImpl: once, freshnessAttempts: 1, ...at })).rejects.toBeInstanceOf(StaleNodeError);
    expect(once.calls).toHaveLength(1);
  });

  it("a retry that lands on a healthy node answers", async () => {
    let probes = 0;
    const fetchImpl = node({ age: () => (probes++ < 2 ? 4700 : 1), result: "0xbeef" });
    expect(await ethCall("https://rpc.retry", TARGET, "0x", { fetchImpl, ...at })).toBe("0xbeef");
    expect(fetchImpl.calls).toHaveLength(3);
  });

  it("judges the read only after the node proves it is current: a stale node's revert is not an answer", async () => {
    const revert = { code: 3, message: "execution reverted" };
    const stale = await ethCall("https://rpc.revert", TARGET, "0x", { fetchImpl: node({ age: 4700, error: revert }), ...at }).catch((e) => e);
    expect(stale).toBeInstanceOf(StaleNodeError);
    const fresh = await ethCall("https://rpc.revert", TARGET, "0x", { fetchImpl: node({ age: 2, error: revert }), ...at }).catch((e) => e);
    expect(fresh).toBeInstanceOf(RpcError);
    expect(fresh).not.toBeInstanceOf(StaleNodeError);
    expect(fresh.revert).toBe(true);
  });

  it("the limit is the caller's: a looser one accepts, a stricter one refuses, 0 sends a plain request", async () => {
    expect(await ethCall("https://rpc.limit", TARGET, "0x", { fetchImpl: node({ age: 4700 }), maxHeadAgeSeconds: 10_000, ...at })).toBe("0x1234");
    await expect(ethCall("https://rpc.limit", TARGET, "0x", { fetchImpl: node({ age: 45 }), maxHeadAgeSeconds: 30, ...at })).rejects.toBeInstanceOf(StaleNodeError);
    expect(await ethCall("https://rpc.limit", TARGET, "0x", { fetchImpl: node({ age: 45 }), ...at })).toBe("0x1234"); // default: five minutes
    const plain = node({ age: 99_999 });
    expect(await ethCall("https://rpc.limit", TARGET, "0x", { fetchImpl: plain, maxHeadAgeSeconds: 0, ...at })).toBe("0x1234");
    expect(Array.isArray(bodies(plain)[0])).toBe(false);
  });

  it("a head dated in the future (a device clock that runs slow) is not stale", async () => {
    expect(await ethCall("https://rpc.future", TARGET, "0x", { fetchImpl: node({ age: -3600 }), ...at })).toBe("0x1234");
  });

  it("an answer without the probe, or with a malformed one, is refused", async () => {
    const missing = serving(() => json([{ jsonrpc: "2.0", id: 2, result: "0x1234" }]));
    await expect(ethCall("https://rpc.missing", TARGET, "0x", { fetchImpl: missing, ...at })).rejects.toThrow(/malformed batch/);
    for (const probe of [{ result: { number: "0x1" } }, { result: { timestamp: "soon" } }, { result: null }, { error: { code: -32000, message: "boom" } }]) {
      const fetchImpl = serving(() => json([{ jsonrpc: "2.0", id: 1, ...probe }, { jsonrpc: "2.0", id: 2, result: "0x1234" }]));
      await expect(ethCall("https://rpc.probe", TARGET, "0x", { fetchImpl, ...at })).rejects.toBeInstanceOf(RpcError);
    }
  });

  it("falls back to two requests when the endpoint refuses batches, and remembers it", async () => {
    for (const refuse of [() => new Response("no", { status: 400 }), () => json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "batch not supported" } })]) {
      const url = `https://rpc.nobatch/${refuse.toString().length}`;
      const spec: Node = { age: 4700 };
      const fetchImpl = serving((u, init) => {
        const body = JSON.parse(String(init?.body));
        return Array.isArray(body) ? refuse() : json(one(spec, body));
      });
      await expect(ethCall(url, TARGET, "0x", { fetchImpl, freshnessAttempts: 1, ...at })).rejects.toBeInstanceOf(StaleNodeError);
      expect(fetchImpl.calls.length).toBe(3); // the refused batch, then the probe, then the read
      spec.age = 0;
      expect(await ethCall(url, TARGET, "0x", { fetchImpl, ...at })).toBe("0x1234");
      expect(fetchImpl.calls.length).toBe(5); // no second batch attempt: two plain requests
      expect(bodies(fetchImpl).filter((b) => Array.isArray(b))).toHaveLength(1);
    }
  });

  it("a server error on the batch is a failure, not 'batches are refused'", async () => {
    const url = "https://rpc.flaky";
    const down = serving(() => new Response("", { status: 503 }));
    await expect(ethCall(url, TARGET, "0x", { fetchImpl: down, ...at })).rejects.toThrow(/HTTP 503/);
    const healthy = node();
    expect(await ethCall(url, TARGET, "0x", { fetchImpl: healthy, ...at })).toBe("0x1234");
    expect(Array.isArray(bodies(healthy)[0])).toBe(true);
  });
});

describe("readLimited", () => {
  it("stops reading once the cap is exceeded, even without a content-length", async () => {
    await expect(readLimited(new Response("x".repeat(101)), 100)).rejects.toBeInstanceOf(TooLargeError);
    expect(await readLimited(new Response("x".repeat(100)), 100)).toHaveLength(100);
  });

  it("rejects a declared length over the cap without reading", async () => {
    const response = new Response("tiny", { headers: { "content-length": "999999" } });
    await expect(readLimited(response, 100)).rejects.toBeInstanceOf(TooLargeError);
  });
});
