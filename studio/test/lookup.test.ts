import { describe, expect, it } from "vitest";
import { toFunctionSelector } from "viem";
import { badgeSvg } from "@/lib/badge";
import { lookupContract } from "@/lib/lookup";
import { describe as describeLevel, LEVELS } from "@/lib/status";
import { EIP1967_BEACON_SLOT, EIP1967_IMPLEMENTATION_SLOT } from "@/lib/proxy";
import { addressWord, arcChain, encodeV1, encodeV2, fakeWorld, NONE_V1, NONE_V2, REG_V1, REG_V2, REPO, rpcCalls, SIGNER, storageBySlot, tallyJson, TARGET } from "./helpers";

const SEL = toFunctionSelector("getRegistration(address)");
const OWNER = toFunctionSelector("owner()");
const FILE = "https://raw.githubusercontent.com/acme/vault/HEAD/tally.json";
const LISTS = tallyJson({ chainId: 5042, address: TARGET, signer: SIGNER });
const UNBOUND = tallyJson({ chainId: 5042, address: TARGET });
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

  it("an unrecorded address that holds no code is a 'wallet', not 'unverified'", async () => {
    const world = fakeWorld({ rpc: { [REG_V2]: { [SEL]: NONE_V2() }, [REG_V1]: { [SEL]: NONE_V1() }, [TARGET]: { eth_getCode: "0x" } } });
    expect(await run(both, world)).toMatchObject({ ok: true, level: "wallet", registration: null });
  });

  it("an unrecorded address that holds code stays 'unverified'", async () => {
    const world = fakeWorld({ rpc: { [REG_V2]: { [SEL]: NONE_V2() }, [REG_V1]: { [SEL]: NONE_V1() }, [TARGET]: { eth_getCode: "0x6080604052" } } });
    expect(await run(both, world)).toMatchObject({ ok: true, level: "unverified" });
  });

  it("if the chain cannot say whether it is a contract, the answer is 'unknown', never 'unverified'", async () => {
    for (const reply of [new Error("socket hang up"), "not hex", { error: { code: -32000, message: "boom" } }]) {
      const world = fakeWorld({ rpc: { [REG_V2]: { [SEL]: NONE_V2() }, [REG_V1]: { [SEL]: NONE_V1() }, [TARGET]: { eth_getCode: reply as never } } });
      expect(await run(both, world)).toMatchObject({ ok: false, level: "unknown" });
    }
  });

  it("a recorded address never costs an eth_getCode call", async () => {
    const world = fakeWorld({ rpc: { [REG_V2]: { [SEL]: encodeV2() }, [REG_V1]: { [SEL]: NONE_V1() }, [TARGET]: { eth_getCode: "0x" } } });
    const result = await run(both, world);
    expect(result.level).not.toBe("wallet");
    expect(rpcCalls(world).filter((b) => b.method === "eth_getCode")).toHaveLength(0);
  });

  it("describes a wallet in plain words and gives it a neutral badge", () => {
    expect(describeLevel("wallet")).toMatch(/wallet/);
    expect(LEVELS.wallet.label).toBe("Not a contract");
    expect(badgeSvg("wallet")).toContain("not a contract");
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

const IMPL_WORD = addressWord("0x5555555555555555555555555555555555555555");
const OTHER_OWNER = addressWord("0x9999999999999999999999999999999999999999");
const rpcBodies = (world: ReturnType<typeof fakeWorld>) => rpcCalls(world);
const storageCalls = (world: ReturnType<typeof fakeWorld>) => rpcBodies(world).filter((b) => b.method === "eth_getStorageAt");
const ownerCalls = (world: ReturnType<typeof fakeWorld>) =>
  rpcBodies(world).filter((b) => b.method === "eth_call" && String(b.params[0].to).toLowerCase() === TARGET.toLowerCase() && String(b.params[0].data).startsWith(OWNER));
const v2live = { [REG_V2]: { [SEL]: encodeV2() }, [REG_V1]: { [SEL]: NONE_V1() } };

describe("what 'verified' requires", () => {
  it("a tally.json entry that names no wallet vouches for the address only, so the record stays 'control-proven'", async () => {
    const result = await run(both, fakeWorld({ rpc: v2live, files: { [FILE]: UNBOUND } }));
    expect(result.level).toBe("control-proven");
    expect(result.ok && result.repo).toMatchObject({ status: "confirmed", bound: false });
    expect(describeLevel(result.level, result.ok ? result.registration : null, result.ok ? result.repo : null)).toMatch(/does not name the wallet/);
  });

  it("an entry that names the signer's wallet, on a contract that is not a proxy, is 'verified'", async () => {
    const result = await run(both, fakeWorld({ rpc: v2live, files: { [FILE]: LISTS } }));
    expect(result).toMatchObject({ ok: true, level: "verified" });
    expect(result.ok && result.registration?.upgradeable).toBe(false);
    expect(result.ok && result.repo).toMatchObject({ status: "confirmed", bound: true });
  });

  it("an EIP-1967 implementation proxy never reaches 'verified', even when the repository names the signer", async () => {
    const world = fakeWorld({ rpc: { ...v2live, [TARGET]: { eth_getStorageAt: storageBySlot({ [EIP1967_IMPLEMENTATION_SLOT]: IMPL_WORD }) } }, files: { [FILE]: LISTS } });
    const result = await run(both, world);
    expect(result.level).toBe("control-proven");
    expect(result.ok && result.registration?.upgradeable).toBe(true);
    expect(describeLevel(result.level, result.ok ? result.registration : null, result.ok ? result.repo : null)).toMatch(/upgradeable proxy/);
  });

  it("a beacon proxy likewise", async () => {
    const world = fakeWorld({ rpc: { ...v2live, [TARGET]: { eth_getStorageAt: storageBySlot({ [EIP1967_BEACON_SLOT]: IMPL_WORD }) } }, files: { [FILE]: LISTS } });
    expect((await run(both, world)).level).toBe("control-proven");
  });

  it("an unreadable proxy slot makes the answer 'unknown', never 'verified'", async () => {
    for (const reply of [new Error("socket hang up"), { error: { code: -32000, message: "boom" } }, "not hex"]) {
      const world = fakeWorld({ rpc: { ...v2live, [TARGET]: { eth_getStorageAt: reply as never } }, files: { [FILE]: LISTS } });
      expect(await run(both, world)).toMatchObject({ ok: false, level: "unknown" });
    }
  });

  it("only a live v2 record is probed: stale, self-attested and v1 records cost no storage reads", async () => {
    for (const rpc of [
      { [REG_V2]: { [SEL]: encodeV2({ flags: 0 }) }, [REG_V1]: { [SEL]: NONE_V1() } },
      { [REG_V2]: { [SEL]: encodeV2({ prov: 1, method: 0, flags: 2 }) }, [REG_V1]: { [SEL]: NONE_V1() } },
      { [REG_V2]: { [SEL]: NONE_V2() }, [REG_V1]: { [SEL]: encodeV1() }, [TARGET]: { [OWNER]: addressWord(SIGNER) } },
    ]) {
      const world = fakeWorld({ rpc, files: { [FILE]: LISTS } });
      await run(both, world);
      expect(storageCalls(world)).toHaveLength(0);
    }
  });

  it("a live record is probed once per slot: two reads", async () => {
    const world = fakeWorld({ rpc: v2live, files: { [FILE]: LISTS } });
    await run(both, world);
    expect(storageCalls(world).map((b) => b.params[1]).sort()).toEqual([EIP1967_BEACON_SLOT, EIP1967_IMPLEMENTATION_SLOT].sort());
  });
});

describe("a node that is behind the chain", () => {
  const registered = { [REG_V2]: { [SEL]: encodeV2() }, [REG_V1]: { [SEL]: NONE_V1() } };
  const unregistered = { [REG_V2]: { [SEL]: NONE_V2() }, [REG_V1]: { [SEL]: NONE_V1() } };

  it("makes the answer 'unknown', never 'unverified', however sure it is that there is no record", async () => {
    const result = await run(both, fakeWorld({ rpc: unregistered, head: { ageSeconds: 4700 } }));
    expect(result).toMatchObject({ ok: false, level: "unknown" });
    expect(!result.ok && result.error).toMatch(/behind/);
  });

  it("is retried, so a healthy node behind the same address gets to answer", async () => {
    let probes = 0;
    const world = fakeWorld({ rpc: registered, files: { [FILE]: LISTS }, head: () => ({ ageSeconds: probes++ === 0 ? 4700 : 0 }) });
    expect(await run(both, world)).toMatchObject({ ok: true, level: "verified" });
  });

  it("is refused after five tries when every node is behind, one request per try", async () => {
    const world = fakeWorld({ rpc: registered, head: { ageSeconds: 4700 } });
    expect(await run(both, world)).toMatchObject({ ok: false, level: "unknown" });
    expect(world.calls).toHaveLength(5);
  });

  it("is judged against the chain's own limit, and 0 turns the check off", async () => {
    const answer = (chain: object, ageSeconds: number) => run(chain as typeof both, fakeWorld({ rpc: registered, files: { [FILE]: LISTS }, head: { ageSeconds } }));
    expect(await answer({ ...both, maxHeadAgeSeconds: 10_000 }, 4700)).toMatchObject({ ok: true, level: "verified" });
    expect(await answer({ ...both, maxHeadAgeSeconds: 0 }, 4700)).toMatchObject({ ok: true, level: "verified" });
    expect(await answer({ ...both, maxHeadAgeSeconds: 30 }, 45)).toMatchObject({ ok: false, level: "unknown" });
    expect(await answer(both, 45)).toMatchObject({ ok: true, level: "verified" }); // the default allows five minutes
  });

  it("a head that cannot be read is 'unknown' too", async () => {
    for (const head of [{ error: { code: -32000, message: "boom" } }, new Error("socket hang up"), { number: "0x1" }, { timestamp: "nope" }]) {
      expect(await run(both, fakeWorld({ rpc: registered, head: head as never }))).toMatchObject({ ok: false, level: "unknown" });
    }
  });
});

describe("deployer records", () => {
  const deployerWorld = (owner?: unknown) =>
    fakeWorld({
      rpc: { [REG_V2]: { [SEL]: encodeV2({ method: 3 }) }, [REG_V1]: { [SEL]: NONE_V1() }, ...(owner === undefined ? {} : { [TARGET]: { [OWNER]: owner as never } }) },
      files: { [FILE]: LISTS },
    });

  it("a contract that now names another owner is stale: the deployer no longer speaks for it", async () => {
    const result = await run(both, deployerWorld(OTHER_OWNER));
    expect(result.level).toBe("stale");
    expect(result.ok && result.registration?.controlCurrent).toBe(false);
    expect(result.ok && result.repo).toBeNull();
  });

  it("a deployer who is also the owner is 'verified'", async () => {
    expect((await run(both, deployerWorld(addressWord(SIGNER)))).level).toBe("verified");
  });

  it("a contract with no owner() leaves the deployer proof standing", async () => {
    expect((await run(both, deployerWorld())).level).toBe("verified");
  });

  it("a renounced owner (zero address) leaves the deployer proof standing", async () => {
    expect((await run(both, deployerWorld(addressWord("0x0000000000000000000000000000000000000000")))).level).toBe("verified");
  });

  it("an owner() answer that is not one clean address word reads as 'no owner', like the registry does", async () => {
    for (const reply of [`0x${"ab".repeat(32)}`, "0x1234", `0x${"00".repeat(40)}`]) {
      expect((await run(both, deployerWorld(reply))).level, reply).toBe("verified");
    }
  });

  it("an owner() that cannot be read makes the answer 'unknown', never a stronger claim", async () => {
    expect(await run(both, deployerWorld(new TypeError("network down")))).toMatchObject({ ok: false, level: "unknown" });
  });

  it("owner and admin records are not re-probed: the registry already re-checks them", async () => {
    for (const method of [1, 2]) {
      const world = fakeWorld({ rpc: { [REG_V2]: { [SEL]: encodeV2({ method }) }, [REG_V1]: { [SEL]: NONE_V1() } }, files: { [FILE]: LISTS } });
      await run(both, world);
      expect(ownerCalls(world), `method ${method}`).toHaveLength(0);
    }
  });
});
