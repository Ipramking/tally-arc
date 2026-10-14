import { describe, expect, it } from "vitest";
import { ethCall, getCode, getTransactionCount, RpcError } from "@/lib/rpc";
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

describe("rpc", () => {
  it("sends a locked-down JSON-RPC request", async () => {
    const fetchImpl = serving(() => json({ jsonrpc: "2.0", id: 1, result: "0x1234" }));
    expect(await ethCall("https://rpc.example", TARGET, "0xabcdef", { fetchImpl })).toBe("0x1234");
    const { url, init } = fetchImpl.calls[0];
    expect(url).toBe("https://rpc.example");
    expect(init).toMatchObject({ method: "POST", credentials: "omit", redirect: "error", cache: "no-store" });
    expect(JSON.parse(String(init?.body)).params).toEqual([{ to: TARGET, data: "0xabcdef" }, "latest"]);
  });

  it("classifies failures", async () => {
    const run = (handler: () => Response) => ethCall("https://rpc.example", TARGET, "0x", { fetchImpl: serving(handler) });
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
    await expect(ethCall("https://rpc.example", TARGET, "0x", { fetchImpl: failing })).rejects.toThrow(/fetch failed/);
  });

  it("getCode and getTransactionCount validate what comes back", async () => {
    const reply = (result: unknown) => serving(() => json({ jsonrpc: "2.0", id: 1, result }));
    expect(await getCode("https://rpc.example", TARGET, { fetchImpl: reply("0x6001") })).toBe("0x6001");
    expect(await getTransactionCount("https://rpc.example", TARGET, { fetchImpl: reply("0x2a") })).toBe(42);
    await expect(getTransactionCount("https://rpc.example", TARGET, { fetchImpl: reply("0xzz") })).rejects.toThrow(/malformed count/);
    await expect(getTransactionCount("https://rpc.example", TARGET, { fetchImpl: reply("0x" + "f".repeat(16)) })).rejects.toThrow(/malformed count/);
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
