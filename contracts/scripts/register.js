const { ethers } = require("hardhat");

// CLI relayer: sign the EIP-712 Register payload and submit it. Mirrors what
// Tally Studio does in the browser, but headless — handy for demos, tests, and
// registering a contract you own without opening a wallet UI.
//
//   REGISTRY=0x… TARGET=0x… REPO=https://github.com/you/proj \
//     npx hardhat run scripts/register.js --network arcTestnet
async function main() {
  const registryAddr = process.env.REGISTRY;
  const target = process.env.TARGET;
  const repo = process.env.REPO || "https://github.com/Ipramking/tally-arc";
  const buildHash = process.env.BUILD_HASH || "";
  if (!registryAddr || !target) {
    throw new Error("Set REGISTRY and TARGET env vars.");
  }

  const [signer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const registry = await ethers.getContractAt("TallyRegistry", registryAddr);

  const nonce = await registry.nonces(target);
  const domain = {
    name: "Tally",
    version: "1",
    chainId: Number(net.chainId),
    verifyingContract: registryAddr,
  };
  const types = {
    Register: [
      { name: "target", type: "address" },
      { name: "githubRepo", type: "string" },
      { name: "buildHash", type: "string" },
      { name: "nonce", type: "uint256" },
    ],
  };
  const signature = await signer.signTypedData(domain, types, {
    target,
    githubRepo: repo,
    buildHash,
    nonce,
  });

  console.log(`Signer:   ${signer.address}`);
  console.log(`Target:   ${target}`);
  const tx = await registry.registerWithSignature(target, repo, buildHash, signature);
  console.log(`Tx:       ${tx.hash}`);
  await tx.wait();

  const reg = await registry.getRegistration(target);
  const levels = ["NONE", "SELF_ATTESTED", "OWNER_PROVEN"];
  console.log(`\nProvenance: ${levels[Number(reg.provenance)]} (isVerified=${reg.isVerified})`);
  console.log(`Repo:       ${reg.githubRepo}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
