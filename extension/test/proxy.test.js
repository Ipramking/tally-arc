const test = require("node:test");
const assert = require("node:assert/strict");
const { keccak256, toHex } = require("viem");
const { lib, arc, vectors, fakeWorld, encodeAddressWord, TARGET } = require("./helpers");

const registry = lib("registry.js");
const slotOf = (label) => toHex(BigInt(keccak256(toHex(label))) - 1n, { size: 32 });
const IMPL = encodeAddressWord("0x5555555555555555555555555555555555555555");
const probe = (storage) => registry.isUpgradeableProxy(arc, TARGET, fakeWorld({ storage: { [TARGET]: storage } }));

test("the slot constants are bytes32(uint256(keccak256(label)) - 1) and match the shared vector", () => {
  const { slots } = vectors("proxy-slots.json");
  assert.equal(registry.EIP1967_IMPLEMENTATION_SLOT, slots.implementation.slot);
  assert.equal(registry.EIP1967_BEACON_SLOT, slots.beacon.slot);
  assert.equal(slotOf(slots.implementation.label), slots.implementation.slot);
  assert.equal(slotOf(slots.beacon.label), slots.beacon.slot);
});

test("an EIP-1967 implementation proxy and a beacon proxy are upgradeable", async () => {
  assert.equal(await probe({ [registry.EIP1967_IMPLEMENTATION_SLOT]: IMPL }), true);
  assert.equal(await probe({ [registry.EIP1967_BEACON_SLOT]: IMPL }), true);
});

test("empty slots read as not a proxy, including nodes that drop leading zeros", async () => {
  assert.equal(await probe({}), false);
  assert.equal(await probe({ [registry.EIP1967_IMPLEMENTATION_SLOT]: "0x0", [registry.EIP1967_BEACON_SLOT]: "0x0" }), false);
});

test("a short, non-zero answer still counts as set", async () => {
  assert.equal(await probe({ [registry.EIP1967_IMPLEMENTATION_SLOT]: "0x5555555555555555555555555555555555555555" }), true);
});

test("a failed or malformed read throws; it never defaults to 'not a proxy'", async () => {
  for (const reply of [new Error("socket hang up"), { error: { code: -32000, message: "boom" } }, "not hex", "0x", "0x" + "0".repeat(70)]) {
    await assert.rejects(probe({ [registry.EIP1967_IMPLEMENTATION_SLOT]: reply }));
  }
});

test("readOwner returns the owner in lowercase, or null when the contract names none", async () => {
  const ask = (reply) => registry.readOwner(arc, TARGET, fakeWorld({ rpc: reply === undefined ? {} : { [TARGET.toLowerCase()]: { [registry.OWNER]: reply } } }));
  assert.equal(await ask(encodeAddressWord("0x9999999999999999999999999999999999999999")), "0x9999999999999999999999999999999999999999");
  assert.equal(await ask(undefined), null, "a revert means no owner()");
  assert.equal(await ask(encodeAddressWord("0x0000000000000000000000000000000000000000")), null, "renounced");
  assert.equal(await ask("0x" + "ab".repeat(32)), null, "not an address word");
  assert.equal(await ask("0x1234"), null, "wrong length");
  await assert.rejects(ask(new TypeError("network down")), "a network failure is not 'no owner'");
});
