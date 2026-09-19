// Tally extension config. These are the verified Arc Mainnet endpoints.
// After deploying TallyRegistry, paste its address into REGISTRY_ADDRESS.
globalThis.TALLY_CONFIG = {
  CHAIN_ID: 5042,
  RPC_URL: "https://rpc.mainnet.arc.io",
  EXPLORER: "https://explorer.arc.io",
  STUDIO_URL: "https://tally.build", // register hand-off host
  // TODO: set after `npm run deploy:arc`
  REGISTRY_ADDRESS: "0x0000000000000000000000000000000000000000",

  // 1-Click evaluator presets (fill after registering demo contracts).
  PRESETS: {
    // A verified (owner-proven) contract you registered.
    VERIFIED: "0x0000000000000000000000000000000000000000",
    // Any unregistered contract → shows the amber "Register" path.
    UNVERIFIED: "0x0000000000000000000000000000000000000000",
  },
};
