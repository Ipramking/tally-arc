const { ethers, network } = require("hardhat");

// Deploys a tiny Ownable target the deployer owns, so the full provenance
// flow can be exercised end-to-end: register it in the studio and it becomes
// OWNER_PROVEN (the green "Tally Verified" badge). Handy for the demo / dry-run.
//
//   npm run deploy:demo:arcTestnet   (free — fund via faucet.circle.com)
//   npm run deploy:demo:arc          (mainnet — spends real USDC gas)
async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();

  console.log(`Network:  ${network.name} (chainId ${net.chainId})`);
  console.log(`Deployer/owner: ${deployer.address}`);

  const Ownable = await ethers.getContractFactory("OwnableTarget");
  const target = await Ownable.deploy(deployer.address);
  await target.waitForDeployment();

  const address = await target.getAddress();
  const explorer =
    net.chainId === 5042002n
      ? "https://explorer.testnet.arc.io"
      : "https://explorer.arc.io";

  console.log(`\nDemo OwnableTarget deployed at: ${address}`);
  console.log(`owner() = ${await target.owner()}`);
  console.log(`Explorer: ${explorer}/address/${address}`);
  console.log(
    `\nRegister this address in the studio while connected as the owner` +
      `\nwallet — it will resolve to OWNER_PROVEN (green "Tally Verified").`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
