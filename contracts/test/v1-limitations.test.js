// Characterisation tests for the DEPLOYED, IMMUTABLE v1 registry
// (contracts/TallyRegistry.sol, Arc mainnet). They pin down the limitations that
// motivated TallyRegistryV2 so the behaviour is documented and cannot change
// silently. See docs/security.md.
const { expect } = require("chai");
const { ethers } = require("hardhat");

async function signV1(signer, registry, target, githubRepo, buildHash, nonce) {
  const domain = {
    name: "Tally",
    version: "1",
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: await registry.getAddress(),
  };
  const types = {
    Register: [
      { name: "target", type: "address" },
      { name: "githubRepo", type: "string" },
      { name: "buildHash", type: "string" },
      { name: "nonce", type: "uint256" },
    ],
  };
  return signer.signTypedData(domain, types, { target, githubRepo, buildHash, nonce });
}

async function deploy(name, ...args) {
  const f = await ethers.getContractFactory(name);
  const c = await f.deploy(...args);
  await c.waitForDeployment();
  return c;
}

describe("TallyRegistry v1 (deployed): known limitations fixed in v2", () => {
  let registry, a, b, relayer;
  beforeEach(async () => {
    [a, b, relayer] = await ethers.getSigners();
    registry = await deploy("TallyRegistry");
  });

  const submit = async (signer, target, repo, nonce) =>
    registry.connect(relayer).registerWithSignature(target, repo, "", await signV1(signer, registry, target, repo, "", nonce));

  it("V1-1: any contract with owner() can be 'owner-proven' against any repository", async () => {
    const scam = await deploy("OwnableTarget", a.address);
    const target = await scam.getAddress();
    await submit(a, target, "https://github.com/Uniswap/v3-core", 0n);
    const r = await registry.getRegistration(target);
    expect(r.isVerified).to.equal(true);
    expect(r.githubRepo).to.equal("https://github.com/Uniswap/v3-core");
  });

  it("V1-2: a squatter permanently locks out the real owner of a non-Ownable contract", async () => {
    const target = await registry.getAddress(); // any contract without owner()
    await submit(b, target, "https://github.com/evil/fake", 0n);
    await expect(submit(a, target, "https://github.com/real/project", 1n)).to.be.revertedWith("Unauthorized: not record owner");
  });

  it("V1-3: contracts owned by a contract (multisig) can never be owner-proven", async () => {
    const owned = await deploy("OwnableTarget", await registry.getAddress());
    await expect(submit(a, await owned.getAddress(), "https://github.com/acme/vault", 0n)).to.be.revertedWith("Signer is not contract owner");
  });

  it("V1-4: after an ownership transfer neither the old nor the new owner can update the record", async () => {
    const t = await deploy("TransferableOwner", a.address);
    const target = await t.getAddress();
    await submit(a, target, "https://github.com/acme/v1", 0n);
    await t.transferOwnership(b.address);
    await expect(submit(b, target, "https://github.com/acme/v2", 1n)).to.be.revertedWith("Unauthorized: not record owner");
    await expect(submit(a, target, "https://github.com/acme/v2", 1n)).to.be.revertedWith("Signer is not contract owner");
  });

  it("V1-5: the contract stores any string as the repository, including javascript: URLs", async () => {
    const eoa = ethers.Wallet.createRandom().address;
    await submit(a, eoa, "javascript:alert(document.domain)", 0n);
    expect((await registry.getRegistration(eoa)).githubRepo).to.equal("javascript:alert(document.domain)");
  });
});
