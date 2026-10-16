import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";
import { chains, defaultChain } from "@/lib/chain";
import type { Lookup } from "@/lib/lookup";
import { lookupJson, SCHEMA_VERSION } from "@/lib/lookup-json";
import type { Registration } from "@/lib/registry";
import { LEVELS } from "@/lib/status";
import { arcChain, REG_V2, REPO, SIGNER, TARGET } from "./helpers";

const { cached } = vi.hoisted(() => ({ cached: vi.fn() }));
vi.mock("@/lib/lookup-cache", () => ({ cachedLookup: cached }));

import { GET, OPTIONS } from "@/app/api/lookup/[address]/route";

const TALLY_FILE = "https://raw.githubusercontent.com/acme/vault/HEAD/tally.json";
const record = (extra: Partial<Registration> = {}): Registration => ({
  registryVersion: 2,
  registry: REG_V2,
  githubRepo: REPO,
  buildHash: "abc123",
  signer: SIGNER,
  registeredAt: 1700000000,
  provenance: "CONTROL_PROVEN",
  method: "OWNER",
  controlCurrent: true,
  codeCurrent: true,
  upgradeable: false,
  ...extra,
});
const verified: Lookup = { ok: true, level: "verified", registration: record(), repo: { status: "confirmed", bound: true, url: TALLY_FILE }, repoLink: REPO };
const none: Lookup = { ok: true, level: "unverified", registration: null, repo: null, repoLink: null };

describe("lookupJson", () => {
  it("describes a verified contract with its evidence and links", () => {
    const body = lookupJson(arcChain, TARGET.toLowerCase(), verified);
    expect(body).toMatchObject({
      schema: SCHEMA_VERSION,
      ok: true,
      level: "verified",
      label: "Tally Verified",
      chain: { key: arcChain.key, id: arcChain.id, name: arcChain.name },
      address: getAddress(TARGET),
      registration: { registryVersion: 2, signer: SIGNER, provenance: "CONTROL_PROVEN", method: "OWNER", controlCurrent: true, codeCurrent: true, upgradeable: false, buildHash: "abc123" },
      repository: { url: REPO, owner: "acme", repo: "vault" },
      repoCheck: { status: "confirmed", bound: true, tallyJson: TALLY_FILE },
    });
    expect(body.summary).toMatch(/names the signer's wallet/);
    expect(body.links.record).toContain(`/c/${getAddress(TARGET)}?chain=${arcChain.key}`);
    expect(body.links.badge).toContain(`/api/badge/${getAddress(TARGET)}?chain=${arcChain.key}`);
    expect(body.links.explorer).toBe(`${arcChain.explorer.url}/address/${getAddress(TARGET)}`);
    expect(body.error).toBeUndefined();
  });

  it("an address with no record has no registration, repository or check", () => {
    const body = lookupJson(arcChain, TARGET, none);
    expect(body).toMatchObject({ ok: true, level: "unverified", label: "Unverified", registration: null, repository: null, repoCheck: null });
  });

  it("a proxy reports upgradeable, and an unbound repository reports bound false", () => {
    const proxy = lookupJson(arcChain, TARGET, { ok: true, level: "control-proven", registration: record({ upgradeable: true }), repo: { status: "confirmed", bound: true, url: TALLY_FILE }, repoLink: REPO });
    expect(proxy).toMatchObject({ level: "control-proven", registration: { upgradeable: true } });
    expect(proxy.summary).toMatch(/upgradeable proxy/);
    const unbound = lookupJson(arcChain, TARGET, { ok: true, level: "control-proven", registration: record(), repo: { status: "confirmed", bound: false, url: TALLY_FILE }, repoLink: REPO });
    expect(unbound.repoCheck).toMatchObject({ status: "confirmed", bound: false });
    expect(unbound.summary).toMatch(/does not name the wallet/);
  });

  it("bound is only reported for a confirmed check", () => {
    const body = lookupJson(arcChain, TARGET, { ok: true, level: "control-proven", registration: record(), repo: { status: "not-listed", url: TALLY_FILE }, repoLink: REPO });
    expect(body.repoCheck).toEqual({ status: "not-listed", bound: null, tallyJson: TALLY_FILE });
  });

  it("a read failure is ok:false and level unknown, never unverified", () => {
    const body = lookupJson(arcChain, TARGET, { ok: false, level: "unknown", error: `socket‮ hang up ${"x".repeat(400)}` });
    expect(body).toMatchObject({ ok: false, level: "unknown", label: LEVELS.unknown.label, registration: null });
    expect(body.error).not.toMatch(/‮/);
    expect(body.error!.length).toBeLessThanOrEqual(200);
  });

  it("never passes free text from the chain through: hostile repository and build hash are neutralised", () => {
    const hostile = record({ githubRepo: "javascript:alert(document.cookie)", buildHash: `ab​‮cd${"z".repeat(300)}` });
    const body = lookupJson(arcChain, TARGET, { ok: true, level: "control-proven", registration: hostile, repo: { status: "invalid-repo" }, repoLink: null });
    expect(body.repository).toBeNull();
    expect(body.registration!.buildHash).not.toMatch(/[​‮]/);
    expect(body.registration!.buildHash.length).toBeLessThanOrEqual(66);
    expect(JSON.stringify(body)).not.toContain("javascript:");
  });

  it("every level has a label and a sentence, and the result is plain JSON", () => {
    for (const level of Object.keys(LEVELS) as (keyof typeof LEVELS)[]) {
      const body = lookupJson(arcChain, TARGET, level === "unknown" ? { ok: false, level, error: "down" } : { ok: true, level, registration: level === "unverified" || level === "wallet" ? null : record(), repo: null, repoLink: null });
      expect(body.label, level).toBe(LEVELS[level].label);
      expect(body.summary.length, level).toBeGreaterThan(20);
      expect(JSON.parse(JSON.stringify(body)), level).toEqual(body);
    }
  });
});

describe("GET /api/lookup/<address>", () => {
  const call = (address: string, query = "") => GET(new Request(`https://studio.test/api/lookup/${address}${query}`), { params: Promise.resolve({ address }) });
  beforeEach(() => cached.mockReset());

  it("rejects an invalid address with 400 and never looks anything up", async () => {
    const res = await call("0x123");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ schema: SCHEMA_VERSION, ok: false, error: expect.stringMatching(/invalid address/) });
    expect(cached).not.toHaveBeenCalled();
  });

  it("rejects an unknown chain with 400 and lists the ones it knows", async () => {
    const res = await call(TARGET, "?chain=no-such-chain");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("unknown chain");
    expect(body.chains.map((c: { key: string }) => c.key)).toEqual(chains.map((c) => c.key));
    expect(body.chains.every((c: { hasRegistry: unknown }) => typeof c.hasRegistry === "boolean")).toBe(true);
    expect(cached).not.toHaveBeenCalled();
  });

  it("answers 200 with JSON, open CORS and a short cache, for the default chain when none is given", async () => {
    cached.mockResolvedValue(verified);
    const res = await call(TARGET);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toMatch(/max-age=30/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, level: "verified", chain: { key: defaultChain.key } });
    expect(cached).toHaveBeenCalledWith(expect.objectContaining({ key: defaultChain.key }), TARGET);
  });

  it("looks up the chain named by key or by chain id", async () => {
    cached.mockResolvedValue(none);
    for (const chain of chains) {
      for (const param of [chain.key, String(chain.id)]) {
        cached.mockClear();
        const res = await call(TARGET, `?chain=${param}`);
        expect(res.status, param).toBe(200);
        expect((await res.json()).chain.key, param).toBe(chain.key);
        expect(cached).toHaveBeenCalledWith(expect.objectContaining({ key: chain.key }), TARGET);
      }
    }
  });

  it("answers 503, uncached, with level unknown when the chain cannot be read", async () => {
    cached.mockResolvedValue({ ok: false, level: "unknown", error: "RPC HTTP 502" });
    const res = await call(TARGET);
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ ok: false, level: "unknown", error: "RPC HTTP 502" });
  });

  it("answers the CORS preflight", () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
  });
});
