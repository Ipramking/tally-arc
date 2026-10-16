require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ quiet: true });

// Networks come from the repo-wide chains.json (single source of truth), so a chain added
// there can be deployed to and verified on with no change here. A chain's key becomes its
// Hardhat network name in camelCase ("my-chain" -> `myChain`); override its RPC with
// <KEY>_RPC_URL ("my-chain" -> MY_CHAIN_RPC_URL).
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

// Source verification. A chain whose explorer.api is set in chains.json (an Etherscan-style
// /api, which Blockscout explorers answer and hardhat-verify speaks) can be verified with
// `npx hardhat verify --network <name> <address>`. Leave `api` out for an explorer a script
// cannot reach (for example one behind a bot challenge); verify through its web form.
const verifiable = chains.filter((chain) => chain.explorer && chain.explorer.api);

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
      urls: { apiURL: chain.explorer.api, browserURL: chain.explorer.url },
    })),
  },
  sourcify: { enabled: false },
};
