// EIP-712 typed data for registration. The type strings are checked against the
// contracts' own source by test/eip712.test.ts, so a typo here fails CI instead
// of surfacing as a BadSignature revert in someone's wallet.
import type { Address } from "viem";
import { METHOD_CODE, type ProofMethod } from "./registry";

export const V1_TYPES = {
  Register: [
    { name: "target", type: "address" },
    { name: "githubRepo", type: "string" },
    { name: "buildHash", type: "string" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const V2_TYPES = {
  Register: [
    { name: "target", type: "address" },
    { name: "signer", type: "address" },
    { name: "githubRepo", type: "string" },
    { name: "buildHash", type: "string" },
    { name: "method", type: "uint8" },
    { name: "deployerNonce", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const V1_DOMAIN_VERSION = "1";
export const V2_DOMAIN_VERSION = "2";

export function registryDomain(version: 1 | 2, chainId: number, verifyingContract: Address) {
  return {
    name: "Tally",
    version: version === 2 ? V2_DOMAIN_VERSION : V1_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  } as const;
}

/** `Register(address target,...)`, the string the contract hashes into its typehash. */
export function typeString(types: typeof V1_TYPES | typeof V2_TYPES): string {
  return `Register(${types.Register.map((field) => `${field.type} ${field.name}`).join(",")})`;
}

export interface ClaimInput {
  target: Address;
  signer: Address;
  githubRepo: string;
  buildHash: string;
  method: ProofMethod;
  /** Only read by the registry when method is DEPLOYER. */
  deployerNonce: bigint;
  deadline: bigint;
}

/** The struct passed to register(). */
export function claimStruct(claim: ClaimInput) {
  return {
    target: claim.target,
    signer: claim.signer,
    githubRepo: claim.githubRepo,
    buildHash: claim.buildHash,
    method: METHOD_CODE[claim.method],
    deployerNonce: claim.method === "DEPLOYER" ? claim.deployerNonce : 0n,
    deadline: claim.deadline,
  };
}

/** The typed-data message the signer signs (the struct plus their current nonce). */
export function v2Message(claim: ClaimInput, nonce: bigint) {
  return { ...claimStruct(claim), nonce };
}
