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

// Source verification. Blockscout explorers answer the Etherscan-style /api that
// hardhat-verify speaks. Arc's explorer sits behind a bot challenge that a script
// cannot pass, so it is deliberately not listed. Add a chain here once its explorer
// is known to accept verification (then `npx hardhat verify --network <name> <address>`).
const VERIFY_API = {
  "bot-testnet": { api: "https://scan.bohr.life/api", browser: "https://scan.bohr.life" },
  bot: { api: "https://scan.botchain.ai/api", browser: "https://scan.botchain.ai" },
};
const verifiable = chains.filter((chain) => VERIFY_API[chain.key]);

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
  etherscan: {
    // Blockscout ignores the key, but hardhat-verify wants a non-empty value per network.
    apiKey: Object.fromEntries(verifiable.map((chain) => [camel(chain.key), "not-needed"])),
    customChains: verifiable.map((chain) => ({
      network: camel(chain.key),
      chainId: chain.id,
      urls: { apiURL: VERIFY_API[chain.key].api, browserURL: VERIFY_API[chain.key].browser },
    })),
  },
  sourcify: { enabled: false },
};
