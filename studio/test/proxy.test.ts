import { describe, expect, it } from "vitest";
import { keccak256, toHex } from "viem";
import { EIP1967_BEACON_SLOT, EIP1967_IMPLEMENTATION_SLOT, isUpgradeableProxy } from "@/lib/proxy";
import { addressWord, arcChain, fakeWorld, storageBySlot, TARGET, vectors } from "./helpers";

const slotOf = (label: string) => toHex(BigInt(keccak256(toHex(label))) - 1n, { size: 32 });
const IMPL = addressWord("0x5555555555555555555555555555555555555555");
const check = (reply: unknown) => isUpgradeableProxy(arcChain, TARGET, { fetchImpl: fakeWorld({ rpc: { [TARGET]: { eth_getStorageAt: reply as never } } }) });

describe("proxy detection", () => {
  it("the slot constants are bytes32(uint256(keccak256(label)) - 1) and match the shared vector", () => {
    expect(EIP1967_IMPLEMENTATION_SLOT).toBe(slotOf("eip1967.proxy.implementation"));
    expect(EIP1967_BEACON_SLOT).toBe(slotOf("eip1967.proxy.beacon"));
    const { slots } = vectors("proxy-slots.json");
    expect(slots.implementation.slot).toBe(EIP1967_IMPLEMENTATION_SLOT);
    expect(slots.beacon.slot).toBe(EIP1967_BEACON_SLOT);
    expect(slotOf(slots.implementation.label)).toBe(slots.implementation.slot);
    expect(slotOf(slots.beacon.label)).toBe(slots.beacon.slot);
  });

  it("an EIP-1967 implementation proxy is upgradeable", async () => {
    expect(await check(storageBySlot({ [EIP1967_IMPLEMENTATION_SLOT]: IMPL }))).toBe(true);
  });

  it("a beacon proxy is upgradeable", async () => {
    expect(await check(storageBySlot({ [EIP1967_BEACON_SLOT]: IMPL }))).toBe(true);
  });

  it("empty slots read as not a proxy, including nodes that drop leading zeros", async () => {
    expect(await check(storageBySlot({}))).toBe(false);
    expect(await check("0x0")).toBe(false);
  });

  it("a short, non-zero answer still counts as set", async () => {
    expect(await check("0x5555555555555555555555555555555555555555")).toBe(true);
  });

  it("a failed or malformed read throws; it never defaults to 'not a proxy'", async () => {
    for (const reply of [new Error("socket hang up"), { error: { code: -32000, message: "boom" } }, "not hex", "0x", `0x${"0".repeat(70)}`]) {
      await expect(check(reply)).rejects.toThrow();
    }
  });
});
