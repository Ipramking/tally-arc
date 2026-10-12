// Works out HOW a wallet can prove control of a contract to the v2 registry,
// using only reads. Mirrors the contract's own checks, in the same order:
// owner(), then the default admin role, then the CREATE deployer address.
import { decodeFunctionResult, encodeFunctionData, getCreateAddress, zeroAddress, type Address, type Hex } from "viem";
import { accessControlAbi, ownableAbi } from "./abi";
import type { NetOptions } from "./net";
import { ethCall, getCode, getTransactionCount, RpcError } from "./rpc";

/** The registry reads at most uint32.max, and scanning more nonces than this is pointless. */
export const MAX_NONCE_SCAN = 100_000;

export type ProofPlan =
  | { method: "OWNER" }
  | { method: "ADMIN_ROLE" }
  | { method: "DEPLOYER"; deployerNonce: number }
  /** Nobody on-chain controls the target, so only a self-attested claim is possible. */
  | { method: "NONE" }
  /** Someone else controls the target; the registry refuses an unproven claim. */
  | { method: "BLOCKED"; owner: Address }
  | { method: "NO_CODE" };

async function optionalCall(rpcUrl: string, to: Address, data: Hex, options: NetOptions): Promise<Hex | null> {
  try {
    return await ethCall(rpcUrl, to, data, options);
  } catch (error) {
    if (error instanceof RpcError && error.revert) return null; // the function does not exist
    throw error;
  }
}

export async function currentOwner(rpcUrl: string, target: Address, options: NetOptions = {}): Promise<Address | null> {
  const data = await optionalCall(rpcUrl, target, encodeFunctionData({ abi: ownableAbi, functionName: "owner" }), options);
  if (!data || data.length !== 66) return null;
  const owner = decodeFunctionResult({ abi: ownableAbi, functionName: "owner", data });
  return owner === zeroAddress ? null : owner;
}

export async function hasAdminRole(rpcUrl: string, target: Address, account: Address, options: NetOptions = {}): Promise<boolean> {
  const call = encodeFunctionData({ abi: accessControlAbi, functionName: "hasRole", args: [`0x${"00".repeat(32)}`, account] });
  const data = await optionalCall(rpcUrl, target, call, options);
  if (!data || data.length !== 66) return false;
  return decodeFunctionResult({ abi: accessControlAbi, functionName: "hasRole", data });
}

/** Find n such that CREATE(account, n) == target, scanning nonces below the account's current count. */
export async function findDeployerNonce(rpcUrl: string, target: Address, account: Address, options: NetOptions = {}): Promise<number | null> {
  const count = Math.min(await getTransactionCount(rpcUrl, account, options), MAX_NONCE_SCAN);
  const wanted = target.toLowerCase();
  for (let nonce = 0; nonce < count; nonce++) {
    if (getCreateAddress({ from: account, nonce: BigInt(nonce) }).toLowerCase() === wanted) return nonce;
    if (nonce % 4000 === 3999) await new Promise((resolve) => setTimeout(resolve, 0)); // keep the page responsive
  }
  return null;
}

export async function planProof(input: { rpcUrl: string; target: Address; account: Address } & NetOptions): Promise<ProofPlan> {
  const { rpcUrl, target, account, ...net } = input;
  const code = await getCode(rpcUrl, target, net);
  if (code === "0x") return { method: "NO_CODE" };

  const owner = await currentOwner(rpcUrl, target, net);
  if (owner && owner.toLowerCase() === account.toLowerCase()) return { method: "OWNER" };
  if (await hasAdminRole(rpcUrl, target, account, net)) return { method: "ADMIN_ROLE" };

  const deployerNonce = await findDeployerNonce(rpcUrl, target, account, net);
  if (deployerNonce !== null) return { method: "DEPLOYER", deployerNonce };

  return owner ? { method: "BLOCKED", owner } : { method: "NONE" };
}
