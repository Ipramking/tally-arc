const { ethers, network } = require("hardhat");
const { explorerAddress } = require("./lib");

// Deploys a tiny Ownable target (OwnableTarget) owned by the deployer, so you
// can register it and see a control-proven record end to end.
//
//   npx hardhat run scripts/deploy-demo.js --network <name>
async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer account. Set DEPLOYER_PRIVATE_KEY in contracts/.env");
  const net = await ethers.provider.getNetwork();

  const Target = await ethers.getContractFactory("OwnableTarget");
  const target = await Target.deploy(deployer.address);
  await target.waitForDeployment();
  const address = await target.getAddress();

  console.log(`Network: ${network.name} (chainId ${net.chainId})`);
  console.log(`OwnableTarget deployed at: ${address}`);
  console.log(`Owner: ${deployer.address}`);
  const link = explorerAddress(net.chainId, address);
  if (link) console.log(`Explorer: ${link}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
