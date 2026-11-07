const { ethers, network } = require("hardhat");
const { findChain, explorerAddress } = require("./lib");

// Deploys a Tally registry.
//
//   npx hardhat run scripts/deploy.js --network <name>
//   CONTRACT=TallyRegistry npx hardhat run scripts/deploy.js --network <name>   (legacy v1)
//
// <name> is a chain key from chains.json in camelCase ("my-chain" -> myChain).
//
// Defaults to TallyRegistryV2. Add the printed registry to chains.json
// (newest first) and run `npm run chains:sync` from the repo root.
async function main() {
  const name = process.env.CONTRACT || "TallyRegistryV2";
  const version = name.endsWith("V2") ? 2 : 1;

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer account. Set DEPLOYER_PRIVATE_KEY in contracts/.env");
  const net = await ethers.provider.getNetwork();
  const chain = findChain(net.chainId);
  const symbol = chain?.nativeCurrency.symbol ?? "native token";

  console.log(`Network:  ${network.name} (chainId ${net.chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ${symbol}`);

  const Registry = await ethers.getContractFactory(name);
  const registry = await Registry.deploy();
  // Printed before waiting, so a transaction the node accepts but never mines can still be reported.
  console.log(`Deploy tx: ${registry.deploymentTransaction().hash}`);
  await registry.waitForDeployment();
  const address = await registry.getAddress();

  console.log(`\n${name} deployed at: ${address}`);
  console.log(`Domain separator: ${await registry.domainSeparator()}`);
  const link = explorerAddress(net.chainId, address);
  if (link) console.log(`Explorer: ${link}`);
  console.log(
    `\nNext: add to chains.json -> chains[key=${chain?.key ?? "<your chain>"}].registries (newest first):\n` +
      `  { "version": ${version}, "address": "${address}" }\n` +
      `then run: npm run chains:sync`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
