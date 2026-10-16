const { ethers } = require("hardhat");
const { detectMethod } = require("./lib");

// CLI relayer: sign a registration and submit it. Mirrors the studio, headless.
//
//   REGISTRY=0x… TARGET=0x… REPO=https://github.com/you/proj \
//     npx hardhat run scripts/register.js --network arcTestnet
//
// Optional:
//   VERSION=1|2          registry version (default 2)
//   METHOD=auto|owner|admin|deployer|none   v2 proof method (default auto-detect)
//   DEPLOYER_NONCE=n     nonce the signer deployed the target with (METHOD=deployer)
//   BUILD_HASH=…         commit or build identifier
//
// After registering, add the contract to the repository's tally.json so clients
// can show "Verified" (see docs/security.md).

const METHODS = { none: 0, owner: 1, admin: 2, deployer: 3 };
const LEVELS = ["NONE", "SELF_ATTESTED", "CONTROL_PROVEN"];

async function main() {
  const registryAddr = process.env.REGISTRY;
  const target = process.env.TARGET;
  const repo = process.env.REPO || "https://github.com/Ipramking/tally-arc";
  const buildHash = process.env.BUILD_HASH || "";
  const version = Number(process.env.VERSION || 2);
  if (!registryAddr || !target) throw new Error("Set REGISTRY and TARGET env vars.");

  const [signer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  console.log(`Signer:   ${signer.address}`);
  console.log(`Target:   ${target}`);

  if (version === 1) {
    const registry = await ethers.getContractAt("TallyRegistry", registryAddr);
    const nonce = await registry.nonces(target);
    const domain = { name: "Tally", version: "1", chainId, verifyingContract: registryAddr };
    const types = {
      Register: [
        { name: "target", type: "address" },
        { name: "githubRepo", type: "string" },
        { name: "buildHash", type: "string" },
        { name: "nonce", type: "uint256" },
      ],
    };
    const signature = await signer.signTypedData(domain, types, { target, githubRepo: repo, buildHash, nonce });
    const tx = await registry.registerWithSignature(target, repo, buildHash, signature);
    console.log(`Tx:       ${tx.hash}`);
    await tx.wait();
    const reg = await registry.getRegistration(target);
    console.log(`Provenance: ${LEVELS[Number(reg.provenance)]}  Repo: ${reg.githubRepo}`);
    return;
  }

  const registry = await ethers.getContractAt("TallyRegistryV2", registryAddr);
  let method = (process.env.METHOD || "auto").toLowerCase();
  let deployerNonce = BigInt(process.env.DEPLOYER_NONCE || 0);
  if (method === "auto") {
    const found = await detectMethod(ethers.provider, target, signer.address);
    if (found.error) throw new Error(found.error);
    method = found.method.toLowerCase().replace("_role", "");
    if (found.deployerNonce !== undefined) deployerNonce = BigInt(found.deployerNonce);
    console.log(`Proof:    ${found.method}${found.deployerNonce !== undefined ? ` (nonce ${found.deployerNonce})` : ""}`);
  }
  if (!(method in METHODS)) throw new Error(`Unknown METHOD "${method}"`);

  const claim = {
    target,
    signer: signer.address,
    githubRepo: repo,
    buildHash,
    method: METHODS[method],
    deployerNonce,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  };
  const nonce = await registry.nonces(signer.address);
  const domain = { name: "Tally", version: "2", chainId, verifyingContract: registryAddr };
  const types = {
    Register: [
      { name: "target", type: "address" },
      { name: "signer", type: "address" },
      { name: "githubRepo", type: "string" },
      { name: "buildHash", type: "string" },
      { name: "method", type: "uint8" },
      { name: "deployerNonce", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const signature = await signer.signTypedData(domain, types, { ...claim, nonce });
  const tx = await registry.register(claim, signature);
  console.log(`Tx:       ${tx.hash}`);
  await tx.wait();

  const reg = await registry.getRegistration(target);
  console.log(`Provenance: ${LEVELS[Number(reg.provenance)]}  control-proven & current: ${reg.isControlProven}`);
  console.log(`Repo:       ${reg.githubRepo}`);
  console.log(`\nNext: add { "chainId": ${chainId}, "address": "${target}", "signer": "${signer.address}" } to tally.json in ${repo}`);
  console.log(`      ("signer" is required for "verified": it makes the repository itself name the wallet it authorises.)`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
