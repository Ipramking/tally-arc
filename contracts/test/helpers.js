const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const METHOD = { NONE: 0, OWNER: 1, ADMIN_ROLE: 2, DEPLOYER: 3 };
const PROV = { NONE: 0, SELF: 1, CONTROL: 2 };
const REPO = "https://github.com/acme/project";

const TYPES = {
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

async function deployRegistry(name = "TallyRegistryV2") {
  const Factory = await ethers.getContractFactory(name);
  const registry = await Factory.deploy();
  await registry.waitForDeployment();
  return registry;
}

async function deployTarget(name, args = [], signer) {
  const Factory = await ethers.getContractFactory(name, signer);
  const c = await Factory.deploy(...args);
  await c.waitForDeployment();
  return c;
}

async function domainOf(registry) {
  return {
    name: "Tally",
    version: "2",
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: await registry.getAddress(),
  };
}

/** Build a claim with sane defaults; `signer` may be a Signer or an address. */
async function makeClaim(registry, o) {
  const latest = await time.latest();
  const signerAddress = o.signerAddress ?? (await o.signer.getAddress());
  return {
    target: o.target,
    signer: signerAddress,
    githubRepo: o.githubRepo ?? REPO,
    buildHash: o.buildHash ?? "",
    method: o.method ?? METHOD.NONE,
    deployerNonce: o.deployerNonce ?? 0n,
    deadline: o.deadline ?? BigInt(latest + 3600),
  };
}

async function typedValue(registry, claim, nonceOverride) {
  const nonce = nonceOverride ?? (await registry.nonces(claim.signer));
  return { ...claim, nonce };
}

/** EOA signature (EIP-712). */
async function signClaim(wallet, registry, claim, nonceOverride) {
  return wallet.signTypedData(await domainOf(registry), TYPES, await typedValue(registry, claim, nonceOverride));
}

/** Raw digest signature, as an ERC-1271 wallet controlled by `controller` expects. */
async function signDigest(controller, registry, claim, nonceOverride) {
  const digest = ethers.TypedDataEncoder.hash(await domainOf(registry), TYPES, await typedValue(registry, claim, nonceOverride));
  return controller.signingKey.sign(digest).serialized;
}

/** Sign as `signer` and relay through `relayer`. Resolves to the tx promise. */
async function register(registry, relayer, signer, opts) {
  const claim = await makeClaim(registry, { ...opts, signer });
  const sig = await signClaim(signer, registry, claim);
  return registry.connect(relayer).register(claim, sig);
}

async function read(registry, target) {
  const r = await registry.getRegistration(target);
  return {
    githubRepo: r.githubRepo,
    buildHash: r.buildHash,
    signer: r.signer,
    provenance: Number(r.provenance),
    isControlProven: r.isControlProven,
    method: Number(r.method),
    flags: Number(r.flags),
  };
}

module.exports = {
  METHOD,
  PROV,
  REPO,
  TYPES,
  deployRegistry,
  deployTarget,
  domainOf,
  makeClaim,
  signClaim,
  signDigest,
  register,
  read,
};
