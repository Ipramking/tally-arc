import { describe, expect, it } from "vitest";
import { toFunctionSelector } from "viem";
import { lookupContract } from "@/lib/lookup";
import { addressWord, arcChain, encodeV1, encodeV2, fakeWorld, NONE_V1, NONE_V2, REG_V1, REG_V2, REPO, SIGNER, tallyJson, TARGET } from "./helpers";

const SEL = toFunctionSelector("getRegistration(address)");
const OWNER = toFunctionSelector("owner()");
const FILE = "https://raw.githubusercontent.com/acme/vault/HEAD/tally.json";
const LISTS = tallyJson({ chainId: 5042, address: TARGET });
const both = { ...arcChain, registries: [{ version: 2 as const, address: REG_V2 }, { version: 1 as const, address: REG_V1 }] };
const v1only = { ...arcChain, registries: [{ version: 1 as const, address: REG_V1 }] };
const run = (chain: typeof both | typeof v1only | typeof arcChain, world: ReturnType<typeof fakeWorld>) =>
  lookupContract({ chain: chain as any, address: TARGET, fetchImpl: world });

describe("lookupContract", () => {
  it("unregistered everywhere is 'unverified' and makes no repo request", async () => {
    const world = fakeWorld({ rpc: { [REG_V2]: { [SEL]: NONE_V2() }, [REG_V1]: { [SEL]: NONE_V1() } } });
    const result = await run(both, world);
    expect(result).toMatchObject({ ok: true, level: "unverified", registration: null });
    expect(world.calls.filter((c) => c.url.includes("raw.githubusercontent"))).toHaveLength(0);
  });

  it("v2 proof + live control + unchanged code + listed repo is 'verified'", async () => {
    const world = fakeWorld({ rpc: { [REG_V2]: { [SEL]: encodeV2() }, [REG_V1]: { [SEL]: NONE_V1() } }, files: { [FILE]: LISTS } });
    const result = await run(both, world);
    expect(result).toMatchObject({ ok: true, level: "verified", repoLink: REPO });
    expect(result.ok && result.repo?.status).toBe("confirmed");
  });

  it("v2 proof without a tally.json entry stays 'control-proven'", async () => {
    const world = fakeWorld({ rpc: { [REG_V2]: { [SEL]: encodeV2() }, [REG_V1]: { [SEL]: NONE_V1() } } });
    const result = await run(both, world);
    expect(result.level).toBe("control-proven");
    expect(result.ok && result.repo?.status).toBe("no-file");
  });

  it("a stale v2 record (control lost or code changed) skips the repo check", async () => {
    for (const flags of [0, 1, 2]) {
      const world = fakeWorld({ rpc: { [REG_V2]: { [SEL]: encodeV2({ flags }) }, [REG_V1]: { [SEL]: NONE_V1() } }, files: { [FILE]: LISTS } });
      const result = await run(both, world);
      expect(result.level, `flags ${flags}`).toBe("stale");
      expect(result.ok && result.repo).toBeNull();
    }
  });

  it("self-attested stays self-attested even if the repo lists the contract", async () => {
    const world = fakeWorld({ rpc: { [REG_V2]: { [SEL]: encodeV2({ prov: 1, method: 0, flags: 2 }) }, [REG_V1]: { [SEL]: NONE_V1() } }, files: { [FILE]: LISTS } });
    expect((await run(both, world)).level).toBe("self-attested");
  });

  it("v1: a live owner is 'control-proven' at best because v1 cannot track code", async () => {
    const world = fakeWorld({ rpc: { [REG_V1]: { [SEL]: encodeV1() }, [TARGET]: { [OWNER]: addressWord(SIGNER) } }, files: { [FILE]: LISTS } });
    const result = await run(v1only, world);
    expect(result.level).toBe("control-proven");
    expect(result.ok && result.repo?.status).toBe("confirmed");
    expect(result.ok && result.registration?.controlCurrent).toBe(true);
  });

  it("v1: after an ownership transfer the record is 'stale', not owner-proven forever", async () => {
    const world = fakeWorld({
      rpc: { [REG_V1]: { [SEL]: encodeV1() }, [TARGET]: { [OWNER]: addressWord("0x9999999999999999999999999999999999999999") } },
      files: { [FILE]: LISTS },
    });
    const result = await run(v1only, world);
    expect(result.level).toBe("stale");
    expect(result.ok && result.registration?.controlCurrent).toBe(false);
  });

  it("v1: a target with no owner() at all is stale for a recorded owner", async () => {
    expect((await run(v1only, fakeWorld({ rpc: { [REG_V1]: { [SEL]: encodeV1() } } }))).level).toBe("stale");
  });

  it("a newer self-attested record cannot hide an older live control proof", async () => {
    const world = fakeWorld({
      rpc: {
        [REG_V2]: { [SEL]: encodeV2({ repo: "https://github.com/evil/fake", prov: 1, method: 0, flags: 2 }) },
        [REG_V1]: { [SEL]: encodeV1() },
        [TARGET]: { [OWNER]: addressWord(SIGNER) },
      },
      files: { [FILE]: LISTS },
    });
    const result = await run(both, world);
    expect(result).toMatchObject({ level: "control-proven", repoLink: REPO });
  });

  it("any unreadable registry makes the answer 'unknown', never 'unverified'", async () => {
    const down = new TypeError("network down");
    const a = await run(both, fakeWorld({ rpc: { [REG_V2]: { [SEL]: down }, [REG_V1]: { [SEL]: NONE_V1() } } }));
    expect(a).toMatchObject({ ok: false, level: "unknown" });
    const b = await run(both, fakeWorld({ rpc: { [REG_V2]: { [SEL]: NONE_V2() }, [REG_V1]: { [SEL]: down } } }));
    expect(b.level).toBe("unknown");
  });

  it("garbage or empty answers from the RPC are 'unknown'", async () => {
    expect((await run(v1only, fakeWorld({ rpc: { [REG_V1]: { [SEL]: "0xdeadbeef" } } }))).level).toBe("unknown");
    const empty = await run(v1only, fakeWorld({ rpc: { [REG_V1]: { [SEL]: "0x" } } }));
    expect(empty).toMatchObject({ ok: false, level: "unknown" });
  });

  it("invalid addresses and chains without registries are 'unknown' with a reason", async () => {
    expect(await lookupContract({ chain: arcChain, address: "nope", fetchImpl: fakeWorld() })).toMatchObject({ ok: false, error: "invalid address" });
    const empty = await run({ ...arcChain, registries: [] } as any, fakeWorld());
    expect(empty).toMatchObject({ ok: false });
    expect(!empty.ok && empty.error).toMatch(/no registry deployed/);
  });

  it("a hostile on-chain repo string never reaches a request or a link", async () => {
    const world = fakeWorld({ rpc: { [REG_V2]: { [SEL]: encodeV2({ repo: "javascript:alert(document.cookie)" }) }, [REG_V1]: { [SEL]: NONE_V1() } } });
    const result = await run(both, world);
    expect(result).toMatchObject({ level: "control-proven", repoLink: null });
    expect(result.ok && result.repo?.status).toBe("invalid-repo");
    expect(world.calls.filter((c) => c.url.includes("raw.githubusercontent"))).toHaveLength(0);
  });
});
