import { describe, expect, it } from "vitest";
import { chainHref, chains, resolveChain } from "@/lib/chain";

describe("chainHref", () => {
  it("sets the network and keeps the rest of the URL", () => {
    expect(chainHref("/register", "?address=0xabc&chain=arc", "bot-testnet")).toBe("/register?address=0xabc&chain=bot-testnet");
    expect(chainHref("/c/0xabc", "", "arc")).toBe("/c/0xabc?chain=arc");
  });

  it("replaces an existing chain instead of adding a second one", () => {
    const href = chainHref("/", "?chain=arc&chain=arc-testnet", "bot-testnet");
    expect(new URL(href, "https://x.test").searchParams.getAll("chain")).toEqual(["bot-testnet"]);
  });

  it("produces a link that resolves to the chosen network, for every network", () => {
    for (const chain of chains) {
      const param = new URL(chainHref("/register", "", chain.key), "https://x.test").searchParams.get("chain");
      expect(resolveChain(param)?.key).toBe(chain.key);
    }
  });

  it("offers more than one network, including BOT Chain's Bohr testnet", () => {
    expect(chains.length).toBeGreaterThan(1);
    expect(chains.map((c) => c.key)).toContain("bot-testnet");
  });
});
