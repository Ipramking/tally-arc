require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// Arc Mainnet parameters — verified against arc.io / docs.arc.io (Sep 2026).
// Chain ID 5042 (0x13b2), USDC as native gas token.
const ARC_MAINNET_RPC = process.env.ARC_RPC_URL || "https://rpc.mainnet.arc.io";
const ARC_TESTNET_RPC =
  process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.io";

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const accounts = DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [];

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    arc: { url: ARC_MAINNET_RPC, chainId: 5042, accounts },
    arcTestnet: { url: ARC_TESTNET_RPC, chainId: 5042002, accounts },
  },
};
