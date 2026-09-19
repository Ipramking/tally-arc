const { expect } = require("chai");
const { ethers } = require("hardhat");

async function signRegister(
  signer,
  registryAddress,
  target,
  githubRepo,
  buildHash,
  nonce
) {
  const domain = {
    name: "Tally",
    version: "1",
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: registryAddress,
  };
  const types = {
    Register: [
      { name: "target", type: "address" },
      { name: "githubRepo", type: "string" },
      { name: "buildHash", type: "string" },
      { name: "nonce", type: "uint256" },
    ],
  };
  const value = { target, githubRepo, buildHash, nonce };
  return signer.signTypedData(domain, types, value);
}

describe("TallyRegistry", () => {
  async function deployRegistry() {
    const Registry = await ethers.getContractFactory("TallyRegistry");
    const registry = await Registry.deploy();
    await registry.waitForDeployment();
    return registry;
  }

  it("records SELF_ATTESTED for an EOA target and does not mark it verified", async () => {
    const [dev, relayer] = await ethers.getSigners();
    const registry = await deployRegistry();
    const target = ethers.Wallet.createRandom().address; // EOA, no code

    const sig = await signRegister(
      dev,
      await registry.getAddress(),
      target,
      "https://github.com/acme/token",
      "0xabc",
      0n
    );

    await registry
      .connect(relayer)
      .registerWithSignature(target, "https://github.com/acme/token", "0xabc", sig);

    const reg = await registry.getRegistration(target);
    expect(reg.provenance).to.equal(1n); // SELF_ATTESTED
    expect(reg.isVerified).to.equal(false);
    expect(reg.owner).to.equal(dev.address);
  });

  it("marks OWNER_PROVEN when the signer is the target contract's owner", async () => {
    const [dev, relayer] = await ethers.getSigners();
    const registry = await deployRegistry();

    const Ownable = await ethers.getContractFactory("OwnableTarget");
    const target = await Ownable.deploy(dev.address);
    await target.waitForDeployment();
    const targetAddr = await target.getAddress();

    const sig = await signRegister(
      dev,
      await registry.getAddress(),
      targetAddr,
      "https://github.com/acme/vault",
      "0xdeadbeef",
      0n
    );

    await registry
      .connect(relayer)
      .registerWithSignature(targetAddr, "https://github.com/acme/vault", "0xdeadbeef", sig);

    const reg = await registry.getRegistration(targetAddr);
    expect(reg.provenance).to.equal(2n); // OWNER_PROVEN
    expect(reg.isVerified).to.equal(true);
  });

  it("REJECTS an attacker trying to claim provenance for a contract they don't own", async () => {
    const [dev, attacker, relayer] = await ethers.getSigners();
    const registry = await deployRegistry();

    const Ownable = await ethers.getContractFactory("OwnableTarget");
    const target = await Ownable.deploy(dev.address); // owned by dev
    await target.waitForDeployment();
    const targetAddr = await target.getAddress();

    // attacker signs, but is NOT the owner
    const sig = await signRegister(
      attacker,
      await registry.getAddress(),
      targetAddr,
      "https://github.com/evil/phish",
      "0x00",
      0n
    );

    await expect(
      registry
        .connect(relayer)
        .registerWithSignature(targetAddr, "https://github.com/evil/phish", "0x00", sig)
    ).to.be.revertedWith("Signer is not contract owner");
  });

  it("rejects a replayed signature (nonce consumed)", async () => {
    const [dev, relayer] = await ethers.getSigners();
    const registry = await deployRegistry();
    const target = ethers.Wallet.createRandom().address;

    const sig = await signRegister(
      dev,
      await registry.getAddress(),
      target,
      "https://github.com/acme/token",
      "0xabc",
      0n
    );
    await registry
      .connect(relayer)
      .registerWithSignature(target, "https://github.com/acme/token", "0xabc", sig);

    await expect(
      registry
        .connect(relayer)
        .registerWithSignature(target, "https://github.com/acme/token", "0xabc", sig)
    ).to.be.reverted;
  });
});
