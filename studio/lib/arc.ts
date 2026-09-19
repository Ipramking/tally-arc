import { defineChain } from "viem";

// Arc — verified against docs.arc.io (Sep 2026). USDC is the native gas token
// (18 decimals at protocol level; 6 as the ERC-20 view — same balance).
//
// Mainnet is the default. Set NEXT_PUBLIC_ARC_CHAIN_ID=5042002 to point the
// whole studio at Arc Testnet for a free dry-run (faucet: faucet.circle.com).
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID || 5042);
const IS_TESTNET = CHAIN_ID === 5042002;

const DEFAULT_RPC = IS_TESTNET
  ? "https://rpc.testnet.arc.io"
  : "https://rpc.mainnet.arc.io";

export const arc = defineChain({
  id: CHAIN_ID,
  name: IS_TESTNET ? "Arc Testnet" : "Arc",
  testnet: IS_TESTNET,
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_ARC_RPC_URL || DEFAULT_RPC],
    },
  },
  blockExplorers: {
    default: {
      name: IS_TESTNET ? "Arc Testnet Explorer" : "Arc Explorer",
      url: IS_TESTNET
        ? "https://explorer.testnet.arc.io"
        : "https://explorer.arc.io",
    },
  },
});
