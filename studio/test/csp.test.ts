import { describe, expect, it } from "vitest";
import { chains } from "@/lib/chain";
import { buildCsp, rpcOrigins } from "@/lib/csp";

describe("buildCsp", () => {
  const csp = buildCsp("abc123");
  const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

  it("only runs scripts that carry the request's nonce", () => {
    const script = directive("script-src");
    expect(script).toContain("'nonce-abc123'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toMatch(/unsafe-inline|unsafe-eval|\*|https?:/);
  });

  it("locks down everything else", () => {
    expect(directive("default-src")).toBe("default-src 'self'");
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("base-uri")).toBe("base-uri 'none'");
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive("form-action")).toBe("form-action 'self'");
    expect(directive("style-src")).not.toMatch(/unsafe-inline/);
  });

  it("allows connections to this origin and the chains' RPC endpoints, nothing else", () => {
    const connect = directive("connect-src").split(" ").slice(1);
    expect(connect[0]).toBe("'self'");
    expect(connect.slice(1).sort()).toEqual([...rpcOrigins].sort());
    for (const chain of chains) expect(connect).toContain(new URL(chain.rpcUrl).origin);
  });

  it("only widens for development", () => {
    const dev = buildCsp("n", true);
    expect(dev).toContain("'unsafe-eval'");
    expect(csp).not.toContain("'unsafe-eval'");
  });
});
