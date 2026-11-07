import { describe, expect, it } from "vitest";
import { isAddress } from "viem";
import { chains, defaultChain, explorerAddressUrl, explorerTxUrl, resolveChain, serverChain, writeRegistry } from "@/lib/chain";
import { arcChain } from "./helpers";

describe("chain table", () => {
  it("every configured address is a valid, correctly checksummed address", () => {
    for (const chain of chains) {
      const addresses = [...chain.registries.map((r) => r.address), ...Object.values(chain.presets)];
      for (const address of addresses) expect(isAddress(address, { strict: true }), `${chain.key} ${address}`).toBe(true);
    }
  });

  it("keys, ids and explorer origins are unique", () => {
    expect(new Set(chains.map((c) => c.key)).size).toBe(chains.length);
    expect(new Set(chains.map((c) => c.id)).size).toBe(chains.length);
    expect(new Set(chains.map((c) => new URL(c.explorer.url).origin)).size).toBe(chains.length);
  });

  it("RPC and explorer URLs are plain https origins without credentials", () => {
    for (const chain of chains) {
      for (const raw of [chain.rpcUrl, chain.explorer.url]) {
        const url = new URL(raw);
        expect(url.protocol).toBe("https:");
        expect(url.username + url.password).toBe("");
      }
    }
  });
});

describe("resolveChain", () => {
  it("defaults when the parameter is missing, and accepts keys and numeric ids", () => {
    expect(resolveChain(undefined)).toBe(defaultChain);
    expect(resolveChain(null)).toBe(defaultChain);
    expect(resolveChain("")).toBe(defaultChain);
    expect(resolveChain("arc")?.id).toBe(5042);
    expect(resolveChain("5042")?.key).toBe("arc");
    expect(resolveChain("arc-testnet")?.id).toBe(5042002);
    expect(resolveChain(["arc-testnet", "arc"])?.key).toBe("arc-testnet");
  });

  it("an unknown chain is null, never silently the default", () => {
    for (const bad of ["nope", "1", "ARC", "arc ", "__proto__"]) expect(resolveChain(bad), bad).toBeNull();
  });
});

describe("helpers", () => {
  it("writeRegistry is the first (newest) entry, or null", () => {
    expect(writeRegistry({ ...arcChain, registries: [{ version: 2, address: "0x4444444444444444444444444444444444444444" }, ...arcChain.registries] })?.version).toBe(2);
    expect(writeRegistry({ ...arcChain, registries: [] })).toBeNull();
  });

  it("explorer links come from the configured explorer", () => {
    expect(explorerAddressUrl(arcChain, "0xabc")).toBe(`${arcChain.explorer.url}/address/0xabc`);
    expect(explorerTxUrl(arcChain, "0xdef")).toBe(`${arcChain.explorer.url}/tx/0xdef`);
  });

  it("serverChain applies a valid https override and ignores unsafe ones", () => {
    const key = "TALLY_RPC_URL_ARC";
    expect(serverChain(arcChain, { [key]: "https://rpc.private.example/key" }).rpcUrl).toBe("https://rpc.private.example/key");
    for (const bad of ["http://rpc.example", "https://user:pw@rpc.example", "not a url", "javascript:alert(1)", ""]) {
      expect(serverChain(arcChain, { [key]: bad }).rpcUrl, bad).toBe(arcChain.rpcUrl);
    }
    expect(serverChain(arcChain, {})).toBe(arcChain);
    const testnet = chains.find((c) => c.key === "arc-testnet")!;
    expect(serverChain(testnet, { TALLY_RPC_URL_ARC_TESTNET: "https://t.example" }).rpcUrl).toBe("https://t.example");
  });
});
