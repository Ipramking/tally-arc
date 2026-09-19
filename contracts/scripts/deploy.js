const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();

  console.log(`Network:  ${network.name} (chainId ${net.chainId})`);
  console.log(`Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  // On Arc the native balance IS USDC (18 decimals at protocol level).
  console.log(`Balance:  ${ethers.formatEther(balance)} USDC (native gas)`);

  const Registry = await ethers.getContractFactory("TallyRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  const explorer =
    net.chainId === 5042002n
      ? "https://explorer.testnet.arc.io"
      : "https://explorer.arc.io";

  console.log(`\nTallyRegistry deployed at: ${address}`);
  console.log(`Domain separator:          ${await registry.domainSeparator()}`);
  console.log(`\nExplorer: ${explorer}/address/${address}`);
  console.log(
    `\nSet this everywhere:\n  REGISTRY_ADDRESS=${address}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
