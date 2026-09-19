export const REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ||
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

// EIP-712 domain for TallyRegistry (matches constructor EIP712("Tally","1")).
export const registryDomain = {
  name: "Tally",
  version: "1",
  chainId: 5042,
  verifyingContract: REGISTRY_ADDRESS,
} as const;

export const registerTypes = {
  Register: [
    { name: "target", type: "address" },
    { name: "githubRepo", type: "string" },
    { name: "buildHash", type: "string" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const PROVENANCE = ["NONE", "SELF_ATTESTED", "OWNER_PROVEN"] as const;

export const tallyRegistryAbi = [
  {
    type: "function",
    name: "registerWithSignature",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_target", type: "address" },
      { name: "_githubRepo", type: "string" },
      { name: "_buildHash", type: "string" },
      { name: "_signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getRegistration",
    stateMutability: "view",
    inputs: [{ name: "_target", type: "address" }],
    outputs: [
      { name: "githubRepo", type: "string" },
      { name: "buildHash", type: "string" },
      { name: "owner", type: "address" },
      { name: "registeredAt", type: "uint256" },
      { name: "provenance", type: "uint8" },
      { name: "isVerified", type: "bool" },
    ],
  },
] as const;
