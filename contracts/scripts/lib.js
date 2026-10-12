const { ethers } = require("hardhat");
const { chains } = require("../../chains.json");

const findChain = (id) => chains.find((c) => c.id === Number(id));

const explorerAddress = (chainId, address) => {
  const chain = findChain(chainId);
  return chain ? `${chain.explorer.url}/address/${address}` : null;
};

const iface = new ethers.Interface([
  "function owner() view returns (address)",
  "function hasRole(bytes32,address) view returns (bool)",
]);

/**
 * Work out how `account` can prove control of `target` to TallyRegistryV2.
 * Mirrors the studio's detection: owner() -> DEFAULT_ADMIN_ROLE -> CREATE deployer.
 * Resolves to { method: "OWNER" | "ADMIN_ROLE" | "DEPLOYER" | "NONE", deployerNonce?, error? }.
 */
async function detectMethod(provider, target, account) {
  if ((await provider.getCode(target)) === "0x") return { method: "NONE", error: "no contract code at target" };

  let owner = ethers.ZeroAddress;
  try {
    const data = await provider.call({ to: target, data: iface.encodeFunctionData("owner") });
    owner = iface.decodeFunctionResult("owner", data)[0];
  } catch {
    // no owner() surface
  }
  if (owner.toLowerCase() === account.toLowerCase()) return { method: "OWNER" };

  try {
    const data = await provider.call({ to: target, data: iface.encodeFunctionData("hasRole", [ethers.ZeroHash, account]) });
    if (iface.decodeFunctionResult("hasRole", data)[0]) return { method: "ADMIN_ROLE" };
  } catch {
    // no AccessControl surface
  }

  const count = Math.min(await provider.getTransactionCount(account), 100_000);
  for (let nonce = 0; nonce < count; nonce++) {
    if (ethers.getCreateAddress({ from: account, nonce }).toLowerCase() === target.toLowerCase()) {
      return { method: "DEPLOYER", deployerNonce: nonce };
    }
  }

  if (owner !== ethers.ZeroAddress) {
    return { method: "NONE", error: `target is controlled by ${owner}; only that controller (or its deployer) can register it` };
  }
  return { method: "NONE" };
}

module.exports = { findChain, explorerAddress, detectMethod };
