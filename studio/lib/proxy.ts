// Is this contract an upgradeable proxy?
//
// A proxy's own bytecode never changes when its implementation is swapped, so the
// registry's code-hash check cannot see an upgrade. Tally therefore never shows a
// proxy as "verified": the record keeps its control proof, but the code leg of the
// claim does not hold. Mirrors extension/lib/registry.js.
//
// Detected: EIP-1967 implementation proxies (transparent and UUPS) and beacon
// proxies. Not detected: diamonds and hand-rolled proxies. Minimal proxies
// (EIP-1167) embed a fixed implementation in their bytecode, so the code hash
// already covers them.
import type { Address, Hex } from "viem";
import type { ChainDef } from "./chains.generated";
import type { NetOptions } from "./net";
import { getStorageAt } from "./rpc";

/** bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1). Pinned by test/proxy.test.ts. */
export const EIP1967_IMPLEMENTATION_SLOT: Hex = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
/** bytes32(uint256(keccak256("eip1967.proxy.beacon")) - 1). Pinned by test/proxy.test.ts. */
export const EIP1967_BEACON_SLOT: Hex = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";

const EMPTY_WORD = `0x${"0".repeat(64)}`;

/** True when either EIP-1967 slot is set. A failed read throws: the answer must never default to "not a proxy". */
export async function isUpgradeableProxy(chain: ChainDef, target: Address, options: NetOptions = {}): Promise<boolean> {
  const [implementation, beacon] = await Promise.all([
    getStorageAt(chain.rpcUrl, target, EIP1967_IMPLEMENTATION_SLOT, options),
    getStorageAt(chain.rpcUrl, target, EIP1967_BEACON_SLOT, options),
  ]);
  return implementation !== EMPTY_WORD || beacon !== EMPTY_WORD;
}
