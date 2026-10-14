require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// Networks come from the repo-wide chains.json (single source of truth).
// "arc" -> network `arc`, "arc-testnet" -> `arcTestnet`. Override a chain's RPC
// with <KEY>_RPC_URL, e.g. ARC_RPC_URL or ARC_TESTNET_RPC_URL.
const { chains } = require("../chains.json");

const accounts = process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [];
const camel = (key) => key.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const envName = (key) => key.toUpperCase().replace(/-/g, "_");

const networks = {};
for (const chain of chains) {
  if (!chain.rpcUrl) continue;
  networks[camel(chain.key)] = {
    url: process.env[`${envName(chain.key)}_RPC_URL`] || chain.rpcUrl,
    chainId: chain.id,
    accounts,
  };
}

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // Pinned so the bytecode runs on chains that have not adopted newer opcodes.
      evmVersion: "paris",
    },
  },
  networks,
};
