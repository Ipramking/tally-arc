// The wallet side of registration: switch network, sign the EIP-712 message,
// simulate the transaction so a revert is explained before the wallet prompt,
// send it, and wait for it to land. Uses viem over the injected provider.
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type EIP1193Provider,
  type Hex,
  type PublicClient,
} from "viem";
import { registryV1Abi, registryV2Abi } from "./abi";
import type { ChainDef, RegistryDef } from "./chains.generated";
import { claimStruct, registryDomain, V1_TYPES, V2_TYPES, v2Message, type ClaimInput } from "./eip712";
import type { ProofMethod } from "./registry";
import { switchToChain, toViemChain, type Eip1193Provider } from "./wallet";

/** How long a signed registration stays valid. A stale signature cannot be replayed later. */
export const SIGNATURE_TTL_SECONDS = 3600;
export const CONFIRM_TIMEOUT_MS = 90_000;

export type Step = "network" | "sign" | "simulate" | "send" | "confirm";

export interface SubmitArgs {
  provider: Eip1193Provider;
  chain: ChainDef;
  registry: RegistryDef;
  account: Address;
  target: Address;
  repo: string;
  buildHash: string;
  method: ProofMethod;
  deployerNonce: number;
  onStep?: (step: Step) => void;
  /** Test seams. */
  reader?: PublicClient;
  now?: () => number;
}

export interface SubmitResult {
  hash: Hex;
  /** False when the transaction was sent but did not confirm within the timeout. */
  confirmed: boolean;
}

export async function submitRegistration(args: SubmitArgs): Promise<SubmitResult> {
  const { provider, chain, registry, account, target, repo, buildHash, onStep } = args;
  const viemChain = toViemChain(chain);
  const reader = args.reader ?? createPublicClient({ chain: viemChain, transport: http(chain.rpcUrl) });
  const wallet = createWalletClient({ account, chain: viemChain, transport: custom(provider as unknown as EIP1193Provider) });
  const now = args.now ?? Date.now;

  onStep?.("network");
  await switchToChain(provider, chain);

  let hash: Hex;
  if (registry.version === 2) {
    const claim: ClaimInput = {
      target,
      signer: account,
      githubRepo: repo,
      buildHash,
      method: args.method,
      deployerNonce: BigInt(args.deployerNonce),
      deadline: BigInt(Math.floor(now() / 1000) + SIGNATURE_TTL_SECONDS),
    };
    const nonce = await reader.readContract({ address: registry.address, abi: registryV2Abi, functionName: "nonces", args: [account] });

    onStep?.("sign");
    const signature = await wallet.signTypedData({
      account,
      domain: registryDomain(2, chain.id, registry.address),
      types: V2_TYPES,
      primaryType: "Register",
      message: v2Message(claim, nonce),
    });

    onStep?.("simulate");
    const { request } = await reader.simulateContract({
      account,
      address: registry.address,
      abi: registryV2Abi,
      functionName: "register",
      args: [claimStruct(claim), signature],
    });

    onStep?.("send");
    hash = await wallet.writeContract(request);
  } else {
    // Legacy v1: the registry derives the provenance itself from owner().
    const nonce = await reader.readContract({ address: registry.address, abi: registryV1Abi, functionName: "nonces", args: [target] });

    onStep?.("sign");
    const signature = await wallet.signTypedData({
      account,
      domain: registryDomain(1, chain.id, registry.address),
      types: V1_TYPES,
      primaryType: "Register",
      message: { target, githubRepo: repo, buildHash, nonce },
    });

    onStep?.("simulate");
    const { request } = await reader.simulateContract({
      account,
      address: registry.address,
      abi: registryV1Abi,
      functionName: "registerWithSignature",
      args: [target, repo, buildHash, signature],
    });

    onStep?.("send");
    hash = await wallet.writeContract(request);
  }

  onStep?.("confirm");
  try {
    const receipt = await reader.waitForTransactionReceipt({ hash, timeout: CONFIRM_TIMEOUT_MS });
    if (receipt.status === "reverted") throw new Error("The transaction was mined but reverted. Open it in the explorer for details.");
    return { hash, confirmed: true };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("The transaction was mined")) throw error;
    return { hash, confirmed: false };
  }
}
