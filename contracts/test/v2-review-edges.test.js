// Edge cases raised in review. The first two groups pin how the DEPLOYED, IMMUTABLE v2 registry
// behaves in places the clients compensate for (see docs/security.md, section 7), so the limits
// are documented and cannot change silently. The last group covers signatures made for another
// chain, registry or domain.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { METHOD, TYPES, deployRegistry, deployTarget, domainOf, makeClaim, register, read } = require("./helpers");

describe("TallyRegistryV2: edges found in review", () => {
  let registry, a, b, relayer;
  beforeEach(async () => {
    [a, b, relayer] = await ethers.getSigners();
    registry = await deployRegistry();
  });

  describe("a deployer's record outlives the deployer's ownership", () => {
    const setup = async () => {
      const deployerNonce = BigInt(await ethers.provider.getTransactionCount(a.address));
      const t = await deployTarget("TransferableOwner", [a.address], a);
      const target = await t.getAddress();
      await register(registry, relayer, a, { target, method: METHOD.DEPLOYER, deployerNonce });
      return { t, target, deployerNonce };
    };

    it("the registry keeps calling the record 'control current' after the contract is handed to someone else", async () => {
      const { t, target } = await setup();
      await t.connect(a).transferOwnership(b.address);
      expect(await t.owner()).to.equal(b.address);

      const r = await read(registry, target);
      expect(r.signer).to.equal(a.address);
      expect(r.method).to.equal(METHOD.DEPLOYER);
      expect(r.flags & 1, "FLAG_CONTROL_CURRENT").to.equal(1);
      expect(r.isControlProven).to.equal(true);
      // Tally's clients therefore read owner() themselves and show such a record as stale.
    });

    it("the new owner can always replace the record, and the former deployer cannot take it back", async () => {
      const { t, target, deployerNonce } = await setup();
      await t.connect(a).transferOwnership(b.address);

      await register(registry, relayer, b, { target, method: METHOD.OWNER });
      expect((await read(registry, target)).signer).to.equal(b.address);
      await expect(register(registry, relayer, a, { target, method: METHOD.DEPLOYER, deployerNonce })).to.be.revertedWithCustomError(registry, "Outranked");
    });

    it("the new owner can also revoke the former deployer's record", async () => {
      const { t, target } = await setup();
      await t.connect(a).transferOwnership(b.address);
      await registry.connect(b).revoke(target);
      expect((await read(registry, target)).provenance).to.equal(0);
    });
  });

  describe("a proxy's code hash survives an upgrade", () => {
    it("swapping the implementation changes what the contract does, not the hash the registry compares", async () => {
      const v1 = await deployTarget("UpgradableLogicV1", [], a);
      const v2 = await deployTarget("UpgradableLogicV2", [], a);
      const init = v1.interface.encodeFunctionData("initialize", [a.address]);
      const proxy = await deployTarget("TestProxy", [await v1.getAddress(), init], a);
      const target = await proxy.getAddress();

      await register(registry, relayer, a, { target, method: METHOD.OWNER });
      const recorded = await registry.recordedCodehash(target);
      const logic = await ethers.getContractAt("UpgradableLogicV1", target);
      expect(await logic.version()).to.equal(1n);

      await logic.connect(a).upgradeTo(await v2.getAddress());

      expect(await logic.version(), "behaviour changed").to.equal(2n);
      expect(ethers.keccak256(await ethers.provider.getCode(target)), "code hash did not").to.equal(recorded);
      const r = await read(registry, target);
      expect(r.isControlProven).to.equal(true);
      expect(r.flags & 2, "FLAG_CODE_CURRENT").to.equal(2);
      // Tally's clients therefore read the EIP-1967 slots and never show a proxy as verified.
    });
  });

  describe("signatures are bound to this chain, this registry and this domain", () => {
    it("rejects a signature made for another chain, another registry or another domain, and accepts the right one", async () => {
      const t = await deployTarget("OwnableTarget", [a.address]);
      const target = await t.getAddress();
      const claim = await makeClaim(registry, { signer: a, target, method: METHOD.OWNER });
      const value = { ...claim, nonce: await registry.nonces(a.address) };
      const domain = await domainOf(registry);
      const other = await deployRegistry();
      const variants = {
        "another chain": { ...domain, chainId: domain.chainId + 1n },
        "another registry": { ...domain, verifyingContract: await other.getAddress() },
        "another domain version": { ...domain, version: "1" },
        "another domain name": { ...domain, name: "Tally2" },
      };
      for (const [label, wrongDomain] of Object.entries(variants)) {
        const signature = await a.signTypedData(wrongDomain, TYPES, value);
        await expect(registry.connect(relayer).register(claim, signature), label).to.be.revertedWithCustomError(registry, "BadSignature");
      }

      // The right domain works, so the loop above failed for the reason it claims.
      await registry.connect(relayer).register(claim, await a.signTypedData(domain, TYPES, value));
      expect((await read(registry, target)).signer).to.equal(a.address);
    });
  });
});
