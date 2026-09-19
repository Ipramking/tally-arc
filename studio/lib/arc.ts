import { defineChain } from "viem";

// Arc Mainnet — verified against arc.io / docs.arc.io (Sep 2026).
// USDC is the native gas token (18 decimals at protocol level).
export const arc = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_ARC_RPC_URL || "https://rpc.mainnet.arc.io",
      ],
    },
  },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.arc.io" },
  },
});
