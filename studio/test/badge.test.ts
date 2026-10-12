import { describe, expect, it } from "vitest";
import { BADGE_STATES, badgeSvg } from "@/lib/badge";
import { TtlCache } from "@/lib/cache";

describe("badgeSvg", () => {
  it("renders a well-formed, script-free SVG for every state", () => {
    for (const state of BADGE_STATES) {
      const svg = badgeSvg(state);
      expect(svg.startsWith("<svg "), state).toBe(true);
      expect(svg).toMatch(/<\/svg>$/);
      expect(svg).not.toMatch(/<script|onload|onerror|javascript:|<foreignObject/i);
      expect(svg).toContain(`aria-label="tally: `);
    }
  });

  it("green is used for 'verified' and for nothing else", () => {
    const green = "#34d399";
    for (const state of BADGE_STATES) expect(badgeSvg(state).includes(green), state).toBe(state === "verified");
  });

  it("escapes markup in the label", () => {
    const svg = badgeSvg("verified", `<img src=x onerror="alert(1)">&`);
    expect(svg).not.toContain("<img");
    expect(svg).toContain("&lt;img");
    expect(svg).toContain("&amp;");
  });

  it("the value text is a fixed phrase per state", () => {
    expect(badgeSvg("control-proven")).toContain(">control proven<");
    expect(badgeSvg("unknown-network")).toContain(">unknown network<");
  });
});

describe("TtlCache", () => {
  it("shares one load between concurrent callers and honours the TTL", async () => {
    let now = 1000;
    let loads = 0;
    const cache = new TtlCache<string>(10, () => now);
    const load = async () => `v${++loads}`;
    const [a, b] = await Promise.all([cache.get("k", load, () => 100), cache.get("k", load, () => 100)]);
    expect([a, b, loads]).toEqual(["v1", "v1", 1]);
    now += 99;
    expect(await cache.get("k", load, () => 100)).toBe("v1");
    now += 2;
    expect(await cache.get("k", load, () => 100)).toBe("v2");
  });

  it("picks the TTL from the result and drops failed loads", async () => {
    let now = 0;
    const cache = new TtlCache<{ ok: boolean }>(10, () => now);
    let n = 0;
    const load = async () => ({ ok: ++n > 1 });
    await cache.get("k", load, (v) => (v.ok ? 1000 : 5));
    now = 6;
    expect((await cache.get("k", load, (v) => (v.ok ? 1000 : 5))).ok).toBe(true);

    const failing = new TtlCache<string>(10, () => now);
    await expect(failing.get("x", async () => Promise.reject(new Error("no")), () => 1)).rejects.toThrow("no");
    await new Promise((r) => setTimeout(r, 0));
    expect(failing.size).toBe(0);
  });

  it("is bounded", async () => {
    const cache = new TtlCache<number>(3);
    for (let i = 0; i < 10; i++) await cache.get(String(i), async () => i, () => 1000);
    expect(cache.size).toBeLessThanOrEqual(3);
  });
});
