// Tally extension config. Verified Arc endpoints (docs.arc.io, Sep 2026).
// After deploying TallyRegistry, paste its address into REGISTRY_ADDRESS.
//
// Dry-run tip: to test on Arc Testnet first, comment out the MAINNET block
// and uncomment TESTNET below (free USDC gas via faucet.circle.com). The
// content script already runs on explorer.testnet.arc.io (see manifest.json).
globalThis.TALLY_CONFIG = {
  // --- MAINNET (live) ---
  CHAIN_ID: 5042,
  RPC_URL: "https://rpc.mainnet.arc.io",
  EXPLORER: "https://explorer.arc.io",

  // --- TESTNET (for a free dry-run: swap the three lines above for these) ---
  // CHAIN_ID: 5042002,
  // RPC_URL: "https://rpc.testnet.arc.io",
  // EXPLORER: "https://explorer.testnet.arc.io",

  STUDIO_URL: "https://tally-studio.vercel.app", // register hand-off host
  // TallyRegistry on Arc mainnet (deployed 2026-09-20).
  REGISTRY_ADDRESS: "0x459Cab32306c439a408cA6b8672CcF6c6A0536d9",

  // 1-Click evaluator presets.
  PRESETS: {
    // Verified (owner-proven) demo contract.
    VERIFIED: "0x0f399C0143CAd70b43D18a5696026B0cEdcA0cCb",
    // Any unregistered contract → shows the red "Register" path.
    UNVERIFIED: "0x000000000000000000000000000000000000dEaD",
  },
};
