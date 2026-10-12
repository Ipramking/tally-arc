import { describe, expect, it } from "vitest";
import { explainPlan, tallyJsonSnippet, validateRegisterInput } from "@/lib/register";
import { OTHER, TARGET } from "./helpers";

const ok = { target: TARGET, repo: "https://github.com/acme/vault", buildHash: "" };

describe("validateRegisterInput", () => {
  it("accepts a good claim and canonicalises the repository link", () => {
    expect(validateRegisterInput({ ...ok, repo: " https://github.com/acme/vault.git ", buildHash: " abc123 " })).toEqual({
      ok: true,
      target: TARGET,
      repo: "https://github.com/acme/vault",
      buildHash: "abc123",
    });
    expect(validateRegisterInput({ ...ok, repo: "https://github.com/acme/vault/tree/main/contracts" })).toMatchObject({ ok: true, repo: "https://github.com/acme/vault" });
  });

  it("rejects bad addresses, including a mixed-case address with a wrong checksum", () => {
    for (const target of ["", "0x123", "not an address", TARGET.slice(0, 41), `${TARGET}0`]) {
      expect(validateRegisterInput({ ...ok, target }), target).toMatchObject({ ok: false });
    }
    const typo = TARGET.replace("0f399C", "0F399c");
    expect(typo).not.toBe(TARGET);
    expect(validateRegisterInput({ ...ok, target: typo })).toMatchObject({ ok: false });
    expect(validateRegisterInput({ ...ok, target: TARGET.toLowerCase() })).toMatchObject({ ok: true, target: TARGET });
  });

  it("rejects anything that is not a plain GitHub repository", () => {
    const bad = [
      "",
      "github.com/acme/vault",
      "http://github.com/acme/vault",
      "https://gitlab.com/acme/vault",
      "https://github.com/acme",
      "javascript:alert(1)",
      "https://github.com/acme/vault?x=1",
      "https://github.com/acme/vault#frag",
      "https://github.com/acme/va ult",
      "https://github.com/../vault",
    ];
    for (const repo of bad) expect(validateRegisterInput({ ...ok, repo }), repo).toMatchObject({ ok: false });
  });

  it("applies the registry's build-hash rule", () => {
    expect(validateRegisterInput({ ...ok, buildHash: "a".repeat(66) })).toMatchObject({ ok: true });
    expect(validateRegisterInput({ ...ok, buildHash: "a".repeat(67) })).toMatchObject({ ok: false });
    for (const buildHash of ["a b", "a<b", "a/b", "caf\u00e9", "a\nb"]) {
      expect(validateRegisterInput({ ...ok, buildHash }), buildHash).toMatchObject({ ok: false });
    }
  });
});

describe("explainPlan", () => {
  const v2 = { registryVersion: 2 as const, chainName: "Arc" };
  const v1 = { registryVersion: 1 as const, chainName: "Arc" };

  it("v2 turns each proof into a control-proven record", () => {
    expect(explainPlan({ method: "OWNER" }, v2)).toMatchObject({ tone: "ok", method: "OWNER" });
    expect(explainPlan({ method: "ADMIN_ROLE" }, v2)).toMatchObject({ tone: "ok", method: "ADMIN_ROLE" });
    expect(explainPlan({ method: "DEPLOYER", deployerNonce: 12 }, v2)).toMatchObject({ tone: "ok", method: "DEPLOYER", deployerNonce: 12 });
  });

  it("warns that a contract with no controller can only be self-attested", () => {
    const view = explainPlan({ method: "NONE" }, v2);
    expect(view).toMatchObject({ tone: "warn", method: "NONE" });
    expect(view.detail).toMatch(/never as verified/);
  });

  it("refuses to proceed when someone else owns the contract or there is no code", () => {
    const blocked = explainPlan({ method: "BLOCKED", owner: OTHER }, v2);
    expect(blocked).toMatchObject({ tone: "bad", method: null });
    expect(blocked.detail).toContain("0x2222");
    expect(explainPlan({ method: "NO_CODE" }, v2)).toMatchObject({ tone: "bad", method: null });
  });

  it("on legacy v1 only owner() can be proven; other proofs degrade to self-attested with a warning", () => {
    expect(explainPlan({ method: "OWNER" }, v1)).toMatchObject({ tone: "ok", method: "OWNER" });
    expect(explainPlan({ method: "ADMIN_ROLE" }, v1)).toMatchObject({ tone: "warn", method: "NONE" });
    expect(explainPlan({ method: "DEPLOYER", deployerNonce: 3 }, v1)).toMatchObject({ tone: "warn", method: "NONE" });
  });
});

describe("tallyJsonSnippet", () => {
  it("produces the file the repository check expects", () => {
    const text = tallyJsonSnippet(5042, TARGET);
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toEqual({ version: 1, contracts: [{ chainId: 5042, address: TARGET }] });
  });
});
