import { describe, expect, it } from "vitest";
import { toFunctionSelector } from "viem";
import { lookupContract } from "@/lib/lookup";
import { checkRepoProof, judgeEntries, matchEntries } from "@/lib/repo-proof";
import { describe as describeLevel } from "@/lib/status";
import { arcChain, encodeV2, fakeWorld, NONE_V1, OTHER, REG_V1, REG_V2, REPO, SIGNER, TARGET, tallyJson, vectors } from "./helpers";

interface Case {
  name: string;
  contracts: unknown[];
  recordSigner?: string | null;
  expect: { status: string; bound?: boolean; named?: string };
}
const v = vectors<{ chainId: number; address: string; signer: string; cases: Case[] }>("repo-signer.json");
const FILE = "https://raw.githubusercontent.com/acme/vault/HEAD/tally.json";

describe("tally.json wallet rule (shared vectors)", () => {
  for (const c of v.cases) {
    it(c.name, () => {
      const signer = c.recordSigner === undefined ? v.signer : (c.recordSigner ?? undefined);
      const got = judgeEntries(matchEntries(c.contracts, v.chainId, v.address), signer);
      expect(got).toMatchObject(c.expect);
      if (c.expect.bound === undefined) expect(got.bound).toBeUndefined();
      if (c.expect.named === undefined) expect(got.named).toBeUndefined();
    });
  }
});

describe("checkRepoProof with a signer", () => {
  const run = (entries: unknown[], signer?: string) =>
    checkRepoProof({ repoUrl: REPO, chainId: 5042, address: TARGET, signer, fetchImpl: fakeWorld({ files: { [FILE]: tallyJson(...entries) } }) });

  it("confirms and binds when the file names the signer", async () => {
    expect(await run([{ chainId: 5042, address: TARGET, signer: SIGNER }], SIGNER)).toMatchObject({ status: "confirmed", bound: true });
  });

  it("reports a mismatch, with the wallet the file names, when it names someone else", async () => {
    expect(await run([{ chainId: 5042, address: TARGET, signer: OTHER }], SIGNER)).toMatchObject({ status: "signer-mismatch", named: OTHER.toLowerCase() });
  });

  it("still confirms an entry that names no wallet, but marks it unbound (the level then stays control-proven)", async () => {
    expect(await run([{ chainId: 5042, address: TARGET }], SIGNER)).toMatchObject({ status: "confirmed", bound: false });
  });
});

describe("the level a reader sees", () => {
  const SEL = toFunctionSelector("getRegistration(address)");
  const world = (entries: unknown[]) =>
    fakeWorld({ rpc: { [REG_V2]: { [SEL]: encodeV2({ signer: SIGNER }) }, [REG_V1]: { [SEL]: NONE_V1() } }, files: { [FILE]: tallyJson(...entries) } });
  const chain = { ...arcChain, registries: [{ version: 2 as const, address: REG_V2 }, { version: 1 as const, address: REG_V1 }] };
  const run = (entries: unknown[]) => lookupContract({ chain: chain as never, address: TARGET, fetchImpl: world(entries) });

  it("is verified when the repository names the wallet that registered it", async () => {
    expect(await run([{ chainId: 5042, address: TARGET, signer: SIGNER }])).toMatchObject({ ok: true, level: "verified" });
  });

  it("is NOT verified when the repository lists the contract but names no wallet, and says why", async () => {
    const result = await run([{ chainId: 5042, address: TARGET }]);
    expect(result).toMatchObject({ ok: true, level: "control-proven" });
    expect(describeLevel("control-proven", result.ok ? result.registration : null, result.ok ? result.repo : null)).toMatch(/does not name the wallet/);
  });

  it("is NOT verified when the repository names a different wallet, and says why", async () => {
    const result = await run([{ chainId: 5042, address: TARGET, signer: OTHER }]);
    expect(result).toMatchObject({ ok: true, level: "control-proven" });
    expect(describeLevel("control-proven", result.ok ? result.registration : null, result.ok ? result.repo : null)).toMatch(/names a different wallet/);
  });
});
