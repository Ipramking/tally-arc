const test = require("node:test");
const assert = require("node:assert/strict");
const { lib, arc, encodeV1, encodeV2, encodeAddressWord, fakeWorld, tallyJson, SIGNER, TARGET, REPO } = require("./helpers");

const registry = lib("registry.js");
const status = lib("status.js");
const { lookup } = lib("lookup.js");

const REG_V1 = "0x459Cab32306c439a408cA6b8672CcF6c6A0536d9";
const REG_V2 = "0x4444444444444444444444444444444444444444";
const FILE = "https://raw.githubusercontent.com/acme/vault/HEAD/tally.json";
const LISTS_TARGET = tallyJson({ chainId: 5042, address: TARGET, signer: SIGNER });
const UNBOUND_TARGET = tallyJson({ chainId: 5042, address: TARGET });
const sel = registry.GET_REGISTRATION;
const none = (version) => (version === 1 ? encodeV1({ repo: "", owner: "0x0000000000000000000000000000000000000000", at: 0n, prov: 0 }) : encodeV2({ repo: "", signer: "0x0000000000000000000000000000000000000000", at: 0n, prov: 0, method: 0, flags: 0 }));

const both = { ...arc, registries: [{ version: 2, address: REG_V2 }, { version: 1, address: REG_V1 }] };
const v1only = { ...arc, registries: [{ version: 1, address: REG_V1 }] };
const rpcFor = (map) => Object.fromEntries(Object.entries(map).map(([to, reply]) => [to.toLowerCase(), reply]));
const run = (chain, world) => lookup({ chain, address: TARGET, fetchImpl: world });

test("unregistered everywhere is 'unverified'", async () => {
  const world = fakeWorld({ rpc: rpcFor({ [REG_V2]: { [sel]: none(2) }, [REG_V1]: { [sel]: none(1) } }) });
  const result = await run(both, world);
  assert.equal(result.ok, true);
  assert.equal(result.level, "unverified");
  assert.equal(result.registration, null);
  assert.equal(world.calls.filter((c) => c.url.includes("raw.githubusercontent")).length, 0, "no repo request when there is no record");
});

test("an unrecorded address that holds no code is a 'wallet', not 'unverified'", async () => {
  const world = fakeWorld({ rpc: rpcFor({ [REG_V2]: { [sel]: none(2) }, [REG_V1]: { [sel]: none(1) } }), code: { [TARGET]: "0x" } });
  const result = await run(both, world);
  assert.equal(result.ok, true);
  assert.equal(result.level, "wallet");
  assert.equal(result.registration, null);
});

test("an unrecorded address that holds code stays 'unverified'", async () => {
  const world = fakeWorld({ rpc: rpcFor({ [REG_V2]: { [sel]: none(2) }, [REG_V1]: { [sel]: none(1) } }), code: { [TARGET]: "0x6080604052" } });
  assert.equal((await run(both, world)).level, "unverified");
});

test("if the chain cannot say whether it is a contract, the answer is 'unknown', never 'unverified'", async () => {
  const world = fakeWorld({ rpc: rpcFor({ [REG_V2]: { [sel]: none(2) }, [REG_V1]: { [sel]: none(1) } }), code: { [TARGET]: new Error("socket hang up") } });
  const result = await run(both, world);
  assert.equal(result.ok, false);
  assert.equal(result.level, "unknown");
});

test("rejects a malformed eth_getCode answer instead of guessing", async () => {
  const world = fakeWorld({ rpc: rpcFor({ [REG_V2]: { [sel]: none(2) }, [REG_V1]: { [sel]: none(1) } }), code: { [TARGET]: "not hex" } });
  const result = await run(both, world);
  assert.equal(result.ok, false);
  assert.equal(result.level, "unknown");
});

test("a recorded address never costs an eth_getCode call", async () => {
  const world = fakeWorld({ rpc: rpcFor({ [REG_V2]: { [sel]: encodeV2() }, [REG_V1]: { [sel]: none(1) } }), files: {}, code: { [TARGET]: "0x" } });
  const result = await run(both, world);
  assert.notEqual(result.level, "wallet");
  assert.equal(world.calls.filter((c) => JSON.parse(c.init.body || "{}").method === "eth_getCode").length, 0);
});

test("v2 control proof + live control + unchanged code + listed repo is 'verified'", async () => {
  const world = fakeWorld({ rpc: rpcFor({ [REG_V2]: { [sel]: encodeV2() }, [REG_V1]: { [sel]: none(1) } }), files: { [FILE]: LISTS_TARGET } });
  const result = await run(both, world);
  assert.equal(result.level, "verified");
  assert.equal(result.repoLink, REPO);
  assert.equal(result.repo.status, "confirmed");
});

test("v2 proof without a tally.json entry stays 'control-proven'", async () => {
  const world = fakeWorld({ rpc: rpcFor({ [REG_V2]: { [sel]: encodeV2() }, [REG_V1]: { [sel]: none(1) } }), files: {} });
  const result = await run(both, world);
  assert.equal(result.level, "control-proven");
  assert.equal(result.repo.status, "no-file");
});

test("v2 record whose control was lost or code changed is 'stale' and skips the repo check", async () => {
  for (const flags of [0, 1, 2]) {
    const world = fakeWorld({ rpc: rpcFor({ [REG_V2]: { [sel]: encodeV2({ flags }) }, [REG_V1]: { [sel]: none(1) } }), files: { [FILE]: LISTS_TARGET } });
    const result = await run(both, world);
    assert.equal(result.level, "stale", "flags " + flags);
    assert.equal(result.repo, null);
  }
});

test("v2 self-attested record is 'self-attested' and never verified, even if the repo lists it", async () => {
  const world = fakeWorld({ rpc: rpcFor({ [REG_V2]: { [sel]: encodeV2({ prov: 1, method: 0, flags: 2 }) }, [REG_V1]: { [sel]: none(1) } }), files: { [FILE]: LISTS_TARGET } });
  assert.equal((await run(both, world)).level, "self-attested");
});

test("v1: live owner is 'control-proven' at best (v1 cannot track code)", async () => {
  const world = fakeWorld({
    rpc: rpcFor({ [REG_V1]: { [sel]: encodeV1() }, [TARGET]: { [registry.OWNER]: encodeAddressWord(SIGNER) } }),
    files: { [FILE]: LISTS_TARGET },
  });
  const result = await run(v1only, world);
  assert.equal(result.level, "control-proven");
  assert.equal(result.repo.status, "confirmed");
  assert.equal(result.registration.controlCurrent, true);
});

test("v1: after an ownership transfer the record is 'stale', not owner-proven forever", async () => {
  const world = fakeWorld({
    rpc: rpcFor({ [REG_V1]: { [sel]: encodeV1() }, [TARGET]: { [registry.OWNER]: encodeAddressWord("0x9999999999999999999999999999999999999999") } }),
    files: { [FILE]: LISTS_TARGET },
  });
  const result = await run(v1only, world);
  assert.equal(result.level, "stale");
  assert.equal(result.registration.controlCurrent, false);
});

test("v1: a target with no owner() at all is stale for a recorded owner", async () => {
  const world = fakeWorld({ rpc: rpcFor({ [REG_V1]: { [sel]: encodeV1() } }) });
  assert.equal((await run(v1only, world)).level, "stale");
});

test("a newer self-attested record cannot hide an older live control proof", async () => {
  const world = fakeWorld({
    rpc: rpcFor({
      [REG_V2]: { [sel]: encodeV2({ repo: "https://github.com/evil/fake", prov: 1, method: 0, flags: 2 }) },
      [REG_V1]: { [sel]: encodeV1() },
      [TARGET]: { [registry.OWNER]: encodeAddressWord(SIGNER) },
    }),
    files: { [FILE]: LISTS_TARGET },
  });
  const result = await run(both, world);
  assert.equal(result.level, "control-proven");
  assert.equal(result.repoLink, REPO);
});

test("any unreadable registry makes the answer 'unknown', never 'unverified'", async () => {
  const down = new TypeError("network down");
  const newestDown = fakeWorld({ rpc: rpcFor({ [REG_V2]: { [sel]: down }, [REG_V1]: { [sel]: none(1) } }) });
  const a = await run(both, newestDown);
  assert.equal(a.ok, false);
  assert.equal(a.level, "unknown");
  const oldestDown = fakeWorld({ rpc: rpcFor({ [REG_V2]: { [sel]: none(2) }, [REG_V1]: { [sel]: down } }) });
  assert.equal((await run(both, oldestDown)).level, "unknown");
});

test("a registry with no code (empty eth_call) is an error, not 'unverified'", async () => {
  const world = fakeWorld({ rpc: rpcFor({ [REG_V1]: { [sel]: "0x" } }) });
  const result = await run(v1only, world);
  assert.equal(result.level, "unknown");
  assert.match(result.error, /empty result/);
});

test("garbage from the RPC is 'unknown'", async () => {
  const world = fakeWorld({ rpc: rpcFor({ [REG_V1]: { [sel]: "0xdeadbeef" } }) });
  assert.equal((await run(v1only, world)).level, "unknown");
});

test("invalid address and chains without registries are 'unknown' with a reason", async () => {
  assert.equal((await lookup({ chain: arc, address: "nope", fetchImpl: fakeWorld() })).error, "invalid address");
  const empty = await lookup({ chain: { ...arc, registries: [] }, address: TARGET, fetchImpl: fakeWorld() });
  assert.match(empty.error, /no registry deployed/);
});

test("a hostile on-chain repo string never reaches a request or a link", async () => {
  const evil = "javascript:alert(document.cookie)";
  const world = fakeWorld({ rpc: rpcFor({ [REG_V2]: { [sel]: encodeV2({ repo: evil }) }, [REG_V1]: { [sel]: none(1) } }) });
  const result = await run(both, world);
  assert.equal(result.level, "control-proven");
  assert.equal(result.repo.status, "invalid-repo");
  assert.equal(result.repoLink, null);
  assert.equal(world.calls.filter((c) => c.url.includes("raw.githubusercontent")).length, 0);
});

test("a caller can judge the repository itself: nothing is fetched and the supplied check decides", async () => {
  const world = fakeWorld({ rpc: rpcFor({ [REG_V2]: { [sel]: encodeV2() }, [REG_V1]: { [sel]: none(1) } }), files: {} });
  const seen = [];
  const supplied = async (record) => {
    seen.push(record.signer);
    return { status: "confirmed", bound: true, url: "tally.json" };
  };
  const result = await lookup({ chain: both, address: TARGET, fetchImpl: world, repoCheck: supplied });
  assert.equal(result.level, "verified");
  assert.deepEqual(seen, [SIGNER], "it is handed the record it must judge");
  assert.equal(world.calls.filter((c) => c.url.includes("raw.githubusercontent")).length, 0);

  const unbound = await lookup({ chain: both, address: TARGET, fetchImpl: world, repoCheck: async () => ({ status: "confirmed", bound: false }) });
  assert.equal(unbound.level, "control-proven");
});

// ---- what "verified" requires: a named wallet, no proxy, and a deployer that still speaks for the contract

const IMPL_WORD = encodeAddressWord("0x5555555555555555555555555555555555555555");
const OTHER_OWNER = encodeAddressWord("0x9999999999999999999999999999999999999999");
const v2live = () => rpcFor({ [REG_V2]: { [sel]: encodeV2() }, [REG_V1]: { [sel]: none(1) } });
const bodies = (world) => world.calls.map((c) => JSON.parse((c.init && c.init.body) || "{}"));
const storageCalls = (world) => bodies(world).filter((b) => b.method === "eth_getStorageAt");
const ownerCalls = (world) =>
  bodies(world).filter((b) => b.method === "eth_call" && String(b.params[0].to).toLowerCase() === TARGET.toLowerCase() && String(b.params[0].data).startsWith(registry.OWNER));

test("a tally.json entry that names no wallet vouches for the address only: 'control-proven'", async () => {
  const result = await run(both, fakeWorld({ rpc: v2live(), files: { [FILE]: UNBOUND_TARGET } }));
  assert.equal(result.level, "control-proven");
  assert.equal(result.repo.status, "confirmed");
  assert.equal(result.repo.bound, false);
  assert.match(status.describe(result.level, result.registration, result.repo), /does not name the wallet/);
});

test("an entry that names the signer's wallet, on a contract that is not a proxy, is 'verified'", async () => {
  const result = await run(both, fakeWorld({ rpc: v2live(), files: { [FILE]: LISTS_TARGET } }));
  assert.equal(result.level, "verified");
  assert.equal(result.registration.upgradeable, false);
  assert.equal(result.repo.bound, true);
});

test("an EIP-1967 implementation proxy never reaches 'verified', even when the repository names the signer", async () => {
  const world = fakeWorld({ rpc: v2live(), files: { [FILE]: LISTS_TARGET }, storage: { [TARGET]: { [registry.EIP1967_IMPLEMENTATION_SLOT]: IMPL_WORD } } });
  const result = await run(both, world);
  assert.equal(result.level, "control-proven");
  assert.equal(result.registration.upgradeable, true);
  assert.match(status.describe(result.level, result.registration, result.repo), /upgradeable proxy/);
});

test("a beacon proxy likewise", async () => {
  const world = fakeWorld({ rpc: v2live(), files: { [FILE]: LISTS_TARGET }, storage: { [TARGET]: { [registry.EIP1967_BEACON_SLOT]: IMPL_WORD } } });
  assert.equal((await run(both, world)).level, "control-proven");
});

test("an unreadable proxy slot makes the answer 'unknown', never 'verified'", async () => {
  for (const reply of [new Error("socket hang up"), { error: { code: -32000, message: "boom" } }, "not hex"]) {
    const world = fakeWorld({ rpc: v2live(), files: { [FILE]: LISTS_TARGET }, storage: { [TARGET]: { [registry.EIP1967_IMPLEMENTATION_SLOT]: reply } } });
    const result = await run(both, world);
    assert.equal(result.ok, false);
    assert.equal(result.level, "unknown");
  }
});

test("only a live v2 record is probed: stale, self-attested and v1 records cost no storage reads", async () => {
  for (const rpc of [
    rpcFor({ [REG_V2]: { [sel]: encodeV2({ flags: 0 }) }, [REG_V1]: { [sel]: none(1) } }),
    rpcFor({ [REG_V2]: { [sel]: encodeV2({ prov: 1, method: 0, flags: 2 }) }, [REG_V1]: { [sel]: none(1) } }),
    rpcFor({ [REG_V2]: { [sel]: none(2) }, [REG_V1]: { [sel]: encodeV1() }, [TARGET]: { [registry.OWNER]: encodeAddressWord(SIGNER) } }),
  ]) {
    const world = fakeWorld({ rpc, files: { [FILE]: LISTS_TARGET } });
    await run(both, world);
    assert.equal(storageCalls(world).length, 0);
  }
});

test("a live record is probed once per proxy slot: two reads", async () => {
  const world = fakeWorld({ rpc: v2live(), files: { [FILE]: LISTS_TARGET } });
  await run(both, world);
  assert.deepEqual(storageCalls(world).map((b) => b.params[1]).sort(), [registry.EIP1967_BEACON_SLOT, registry.EIP1967_IMPLEMENTATION_SLOT].sort());
});

const deployerWorld = (owner) =>
  fakeWorld({
    rpc: rpcFor({
      [REG_V2]: { [sel]: encodeV2({ method: 3 }) },
      [REG_V1]: { [sel]: none(1) },
      ...(owner === undefined ? {} : { [TARGET]: { [registry.OWNER]: owner } }),
    }),
    files: { [FILE]: LISTS_TARGET },
  });

test("deployer record: a contract that now names another owner is stale, because the deployer no longer speaks for it", async () => {
  const result = await run(both, deployerWorld(OTHER_OWNER));
  assert.equal(result.level, "stale");
  assert.equal(result.registration.controlCurrent, false);
  assert.equal(result.repo, null);
});

test("deployer record: a deployer who is also the owner is 'verified'", async () => {
  assert.equal((await run(both, deployerWorld(encodeAddressWord(SIGNER)))).level, "verified");
});

test("deployer record: a contract with no owner() leaves the proof standing", async () => {
  assert.equal((await run(both, deployerWorld())).level, "verified");
});

test("deployer record: a renounced owner (zero address) leaves the proof standing", async () => {
  assert.equal((await run(both, deployerWorld(encodeAddressWord("0x0000000000000000000000000000000000000000")))).level, "verified");
});

test("deployer record: an owner() answer that is not one clean address word reads as 'no owner', like the registry does", async () => {
  for (const reply of ["0x" + "ab".repeat(32), "0x1234", "0x" + "00".repeat(40)]) {
    assert.equal((await run(both, deployerWorld(reply))).level, "verified", reply);
  }
});

test("deployer record: an owner() that cannot be read makes the answer 'unknown'", async () => {
  const result = await run(both, deployerWorld(new TypeError("network down")));
  assert.equal(result.ok, false);
  assert.equal(result.level, "unknown");
});

test("owner and admin records are not re-probed: the registry already re-checks them", async () => {
  for (const method of [1, 2]) {
    const world = fakeWorld({ rpc: rpcFor({ [REG_V2]: { [sel]: encodeV2({ method }) }, [REG_V1]: { [sel]: none(1) } }), files: { [FILE]: LISTS_TARGET } });
    await run(both, world);
    assert.equal(ownerCalls(world).length, 0, "method " + method);
  }
});
