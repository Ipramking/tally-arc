// Tally extension config. Verified Arc endpoints (docs.arc.io, Sep 2026).
// After deploying TallyRegistry, paste its address into REGISTRY_ADDRESS.
//
// Dry-run tip: to test on Arc Testnet first, comment out the MAINNET block
// and uncomment TESTNET below (free USDC gas via faucet.circle.com). The
// content script already runs on explorer.testnet.arc.io (see manifest.json).
globalThis.TALLY_CONFIG = {
  // --- MAINNET (default) ---
  CHAIN_ID: 5042,
  RPC_URL: "https://rpc.mainnet.arc.io",
  EXPLORER: "https://explorer.arc.io",

  // --- TESTNET (uncomment for a dry-run, and comment the three lines above) ---
  // CHAIN_ID: 5042002,
  // RPC_URL: "https://rpc.testnet.arc.io",
  // EXPLORER: "https://explorer.testnet.arc.io",

  STUDIO_URL: "https://tally-studio.vercel.app", // register hand-off host (live)
  // TODO: set after `npm run deploy:arc` (or deploy:arcTestnet)
  REGISTRY_ADDRESS: "0x0000000000000000000000000000000000000000",

  // 1-Click evaluator presets (fill after registering demo contracts).
  PRESETS: {
    // A verified (owner-proven) contract you registered.
    VERIFIED: "0x0000000000000000000000000000000000000000",
    // Any unregistered contract → shows the amber "Register" path.
    UNVERIFIED: "0x0000000000000000000000000000000000000000",
  },
};
