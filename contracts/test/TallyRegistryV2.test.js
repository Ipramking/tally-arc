const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
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
} = require("./helpers");

const addr = (c) => c.getAddress();

describe("TallyRegistryV2", () => {
  let registry, dev, other, relayer, stranger;

  beforeEach(async () => {
    [dev, other, relayer, stranger] = await ethers.getSigners();
    registry = await deployRegistry();
  });

  describe("typed data", () => {
    it("exposes version 2 and a domain separator matching EIP-712", async () => {
      expect(await registry.REGISTRY_VERSION()).to.equal(2n);
      expect(await registry.domainSeparator()).to.equal(ethers.TypedDataEncoder.hashDomain(await domainOf(registry)));
    });

    it("hashClaim equals the off-chain EIP-712 digest at the signer's current nonce", async () => {
      const target = await addr(await deployTarget("Plain"));
      const claim = await makeClaim(registry, { signer: dev, target });
      const expected = ethers.TypedDataEncoder.hash(await domainOf(registry), TYPES, { ...claim, nonce: 0n });
      expect(await registry.hashClaim(claim)).to.equal(expected);
    });
  });

  describe("self-attested claims", () => {
    it("records SELF_ATTESTED for a contract with no controller and does not mark it control-proven", async () => {
      const target = await addr(await deployTarget("Plain"));
      await register(registry, relayer, dev, { target, buildHash: "abc123" });
      const r = await read(registry, target);
      expect(r.provenance).to.equal(PROV.SELF);
      expect(r.method).to.equal(METHOD.NONE);
      expect(r.isControlProven).to.equal(false);
      expect(r.signer).to.equal(dev.address);
      expect(r.buildHash).to.equal("abc123");
    });

    it("rejects targets without code (EOAs, zero address)", async () => {
      for (const target of [ethers.Wallet.createRandom().address, ethers.ZeroAddress]) {
        await expect(register(registry, relayer, dev, { target })).to.be.revertedWithCustomError(registry, "NoCode");
      }
    });

    it("refuses an unproven claim when the target names an owner", async () => {
      const target = await addr(await deployTarget("OwnableTarget", [other.address]));
      await expect(register(registry, relayer, dev, { target })).to.be.revertedWithCustomError(registry, "ControllerExists");
      await expect(register(registry, relayer, other, { target })).to.be.revertedWithCustomError(registry, "ControllerExists");
    });

    it("allows a self-attested claim once ownership is renounced (owner() == 0)", async () => {
      const target = await addr(await deployTarget("OwnableTarget", [ethers.ZeroAddress]));
      await register(registry, relayer, dev, { target });
      expect((await read(registry, target)).provenance).to.equal(PROV.SELF);
    });

    it("lets the same signer update a self-attested record but not a different signer", async () => {
      const target = await addr(await deployTarget("Plain"));
      await register(registry, relayer, dev, { target, githubRepo: "https://github.com/acme/v1" });
      await register(registry, relayer, dev, { target, githubRepo: "https://github.com/acme/v2" });
      expect((await read(registry, target)).githubRepo).to.equal("https://github.com/acme/v2");
      await expect(register(registry, relayer, other, { target })).to.be.revertedWithCustomError(registry, "Outranked");
    });
  });

  describe("owner proof", () => {
    it("marks CONTROL_PROVEN when the signer is target.owner()", async () => {
      const target = await addr(await deployTarget("OwnableTarget", [dev.address]));
      await register(registry, relayer, dev, { target, method: METHOD.OWNER });
      const r = await read(registry, target);
      expect(r.provenance).to.equal(PROV.CONTROL);
      expect(r.method).to.equal(METHOD.OWNER);
      expect(r.isControlProven).to.equal(true);
      expect(r.flags).to.equal(3);
    });

    it("REJECTS an attacker claiming a contract they do not own (anti-squat)", async () => {
      const target = await addr(await deployTarget("OwnableTarget", [dev.address]));
      await expect(register(registry, relayer, other, { target, method: METHOD.OWNER })).to.be.revertedWithCustomError(
        registry,
        "NotOwner",
      );
    });

    it("documents the limit: control of a contract does not bind a repository (clients must confirm via tally.json)", async () => {
      const scam = await addr(await deployTarget("OwnableTarget", [other.address]));
      await register(registry, relayer, other, { target: scam, method: METHOD.OWNER, githubRepo: "https://github.com/Uniswap/v3-core" });
      const r = await read(registry, scam);
      expect(r.isControlProven).to.equal(true); // on-chain proof only
      expect(r.githubRepo).to.equal("https://github.com/Uniswap/v3-core"); // unconfirmed claim
    });

    it("accepts a smart-account owner through ERC-1271 (multisig / Safe style)", async () => {
      const controller = ethers.Wallet.createRandom(); // raw-digest signer behind the smart account
      const wallet = await deployTarget("Wallet1271", [controller.address]);
      const walletAddress = await addr(wallet);
      const target = await addr(await deployTarget("OwnableTarget", [walletAddress]));
      const claim = await makeClaim(registry, { signerAddress: walletAddress, target, method: METHOD.OWNER });
      await registry.connect(relayer).register(claim, await signDigest(controller, registry, claim));
      const r = await read(registry, target);
      expect(r.isControlProven).to.equal(true);
      expect(r.signer).to.equal(walletAddress);
    });

    it("rejects an ERC-1271 signature from the wrong controller", async () => {
      const wallet = await deployTarget("Wallet1271", [ethers.Wallet.createRandom().address]);
      const walletAddress = await addr(wallet);
      const target = await addr(await deployTarget("OwnableTarget", [walletAddress]));
      const claim = await makeClaim(registry, { signerAddress: walletAddress, target, method: METHOD.OWNER });
      const notTheController = ethers.Wallet.createRandom();
      await expect(registry.connect(relayer).register(claim, await signDigest(notTheController, registry, claim))).to.be.revertedWithCustomError(
        registry,
        "BadSignature",
      );
    });
  });

  describe("admin-role proof", () => {
    it("accepts DEFAULT_ADMIN_ROLE holders and rejects everyone else", async () => {
      const target = await addr(await deployTarget("AdminTarget", [dev.address]));
      await register(registry, relayer, dev, { target, method: METHOD.ADMIN_ROLE });
      const r = await read(registry, target);
      expect(r.method).to.equal(METHOD.ADMIN_ROLE);
      expect(r.isControlProven).to.equal(true);
      await expect(register(registry, relayer, other, { target, method: METHOD.ADMIN_ROLE })).to.be.revertedWithCustomError(
        registry,
        "NotAdmin",
      );
    });

    it("rejects the owner method on a target without owner() and the admin method on a plain contract", async () => {
      const adminTarget = await addr(await deployTarget("AdminTarget", [dev.address]));
      await expect(register(registry, relayer, dev, { target: adminTarget, method: METHOD.OWNER })).to.be.revertedWithCustomError(
        registry,
        "NotOwner",
      );
      const plain = await addr(await deployTarget("Plain"));
      await expect(register(registry, relayer, dev, { target: plain, method: METHOD.ADMIN_ROLE })).to.be.revertedWithCustomError(
        registry,
        "NotAdmin",
      );
    });
  });

  describe("deployer proof", () => {
    async function deployFrom(signer, name = "Plain", args = []) {
      const nonce = await ethers.provider.getTransactionCount(signer.address);
      const target = await addr(await deployTarget(name, args, signer));
      expect(target).to.equal(ethers.getCreateAddress({ from: signer.address, nonce }));
      return { target, nonce };
    }

    it("proves the deployer of a contract with no owner surface", async () => {
      const { target, nonce } = await deployFrom(dev);
      await register(registry, relayer, dev, { target, method: METHOD.DEPLOYER, deployerNonce: BigInt(nonce) });
      const r = await read(registry, target);
      expect(r.provenance).to.equal(PROV.CONTROL);
      expect(r.method).to.equal(METHOD.DEPLOYER);
      expect(r.isControlProven).to.equal(true);
    });

    it("rejects a wrong nonce and a signer who did not deploy", async () => {
      const { target, nonce } = await deployFrom(dev);
      await expect(register(registry, relayer, dev, { target, method: METHOD.DEPLOYER, deployerNonce: BigInt(nonce + 1) })).to.be.revertedWithCustomError(
        registry,
        "NotDeployer",
      );
      await expect(register(registry, relayer, other, { target, method: METHOD.DEPLOYER, deployerNonce: BigInt(nonce) })).to.be.revertedWithCustomError(
        registry,
        "NotDeployer",
      );
    });

    it("rejects nonces above 2^32 - 1", async () => {
      const { target } = await deployFrom(dev);
      await expect(register(registry, relayer, dev, { target, method: METHOD.DEPLOYER, deployerNonce: 2n ** 32n })).to.be.revertedWithCustomError(
        registry,
        "NonceTooLarge",
      );
    });

    it("computes CREATE addresses exactly like ethers for every RLP length class", async () => {
      const Harness = await ethers.getContractFactory("TallyRegistryV2Harness");
      const h = await Harness.deploy();
      await h.waitForDeployment();
      const nonces = [0, 1, 2, 126, 127, 128, 129, 254, 255, 256, 257, 65534, 65535, 65536, 65537, 16777215, 16777216, 16777217, 4294967295];
      for (const nonce of nonces) {
        expect(await h.createAddress(dev.address, nonce)).to.equal(ethers.getCreateAddress({ from: dev.address, nonce }), `nonce ${nonce}`);
      }
    });
  });

  describe("squatting and ranks", () => {
    it("a squatter cannot lock out the real deployer (v1 flaw fixed)", async () => {
      const { target, nonce } = await (async () => {
        const nonce = await ethers.provider.getTransactionCount(dev.address);
        return { target: await addr(await deployTarget("Plain")), nonce };
      })();
      await register(registry, relayer, other, { target, githubRepo: "https://github.com/evil/fake" });
      expect((await read(registry, target)).signer).to.equal(other.address);

      await register(registry, relayer, dev, { target, method: METHOD.DEPLOYER, deployerNonce: BigInt(nonce), githubRepo: "https://github.com/real/project" });
      const r = await read(registry, target);
      expect(r.signer).to.equal(dev.address);
      expect(r.githubRepo).to.equal("https://github.com/real/project");
    });

    it("a self-attested claim cannot replace a deployer record", async () => {
      const nonce = await ethers.provider.getTransactionCount(dev.address);
      const target = await addr(await deployTarget("Plain"));
      await register(registry, relayer, dev, { target, method: METHOD.DEPLOYER, deployerNonce: BigInt(nonce) });
      await expect(register(registry, relayer, other, { target })).to.be.revertedWithCustomError(registry, "Outranked");
    });

    it("the current owner outranks a deployer, and the deployer cannot take it back", async () => {
      const nonce = await ethers.provider.getTransactionCount(dev.address);
      const target = await addr(await deployTarget("OwnableTarget", [other.address])); // dev deploys, other owns
      await register(registry, relayer, dev, { target, method: METHOD.DEPLOYER, deployerNonce: BigInt(nonce) });
      await register(registry, relayer, other, { target, method: METHOD.OWNER });
      expect((await read(registry, target)).signer).to.equal(other.address);
      await expect(register(registry, relayer, dev, { target, method: METHOD.DEPLOYER, deployerNonce: BigInt(nonce) })).to.be.revertedWithCustomError(
        registry,
        "Outranked",
      );
    });

    it("cannot downgrade a live control record to a self-attested one", async () => {
      const target = await addr(await deployTarget("OwnableTarget", [ethers.ZeroAddress]));
      const adminTarget = await addr(await deployTarget("AdminTarget", [dev.address]));
      await register(registry, relayer, dev, { target: adminTarget, method: METHOD.ADMIN_ROLE });
      await expect(register(registry, relayer, dev, { target: adminTarget })).to.be.revertedWithCustomError(registry, "Outranked");
      await register(registry, relayer, dev, { target }); // unrelated self-attested target still fine
    });
  });

  describe("ownership and code changes", () => {
    it("never freezes after an ownership transfer (v1 flaw fixed)", async () => {
      const target = await addr(await deployTarget("TransferableOwner", [dev.address]));
      await register(registry, relayer, dev, { target, method: METHOD.OWNER, githubRepo: "https://github.com/acme/v1" });
      expect((await read(registry, target)).isControlProven).to.equal(true);

      await (await ethers.getContractAt("TransferableOwner", target)).transferOwnership(other.address);

      // The old record is no longer live, and the old owner cannot refresh it.
      let r = await read(registry, target);
      expect(r.isControlProven).to.equal(false);
      expect(r.flags & 1).to.equal(0);
      await expect(register(registry, relayer, dev, { target, method: METHOD.OWNER })).to.be.revertedWithCustomError(registry, "NotOwner");

      // The new owner takes over.
      await register(registry, relayer, other, { target, method: METHOD.OWNER, githubRepo: "https://github.com/acme/v2" });
      r = await read(registry, target);
      expect(r.signer).to.equal(other.address);
      expect(r.isControlProven).to.equal(true);
    });

    it("a control record whose signer lost control yields to the deployer", async () => {
      const nonce = await ethers.provider.getTransactionCount(other.address);
      const t = await deployTarget("TransferableOwner", [dev.address], other); // other deploys, dev owns
      const target = await addr(t);
      await register(registry, relayer, dev, { target, method: METHOD.OWNER, githubRepo: "https://github.com/dev/claim" });
      await t.connect(dev).transferOwnership(stranger.address); // dev loses control

      await register(registry, relayer, other, { target, method: METHOD.DEPLOYER, deployerNonce: BigInt(nonce), githubRepo: "https://github.com/real/deployer" });
      const r = await read(registry, target);
      expect(r.signer).to.equal(other.address);
      expect(r.githubRepo).to.equal("https://github.com/real/deployer");
    });

    it("flags a record when the code at the address changes, and frees the slot", async () => {
      const target = await addr(await deployTarget("Plain"));
      await register(registry, relayer, dev, { target });
      expect((await read(registry, target)).flags & 2).to.equal(2);

      await network.provider.send("hardhat_setCode", [target, "0x00"]);
      const r = await read(registry, target);
      expect(r.flags & 2).to.equal(0);
      expect(r.isControlProven).to.equal(false);

      await register(registry, relayer, other, { target, githubRepo: "https://github.com/other/code" });
      expect((await read(registry, target)).signer).to.equal(other.address);
    });

    it("a deployer record keeps the control flag but is not live once the code changed", async () => {
      const nonce = await ethers.provider.getTransactionCount(dev.address);
      const target = await addr(await deployTarget("Plain"));
      await register(registry, relayer, dev, { target, method: METHOD.DEPLOYER, deployerNonce: BigInt(nonce) });
      expect((await read(registry, target)).flags).to.equal(3);
      await network.provider.send("hardhat_setCode", [target, "0x00"]);
      const r = await read(registry, target);
      expect(r.flags).to.equal(1); // deployer fact is permanent, code flag cleared
      expect(r.isControlProven).to.equal(false);
    });

    it("a control record is not live once the code changed", async () => {
      const target = await addr(await deployTarget("OwnableTarget", [dev.address]));
      await register(registry, relayer, dev, { target, method: METHOD.OWNER });
      await network.provider.send("hardhat_setCode", [target, "0x00"]);
      expect((await read(registry, target)).isControlProven).to.equal(false);
    });
  });

  describe("signature handling", () => {
    it("rejects a replayed signature (nonce consumed)", async () => {
      const target = await addr(await deployTarget("Plain"));
      const claim = await makeClaim(registry, { signer: dev, target });
      const sig = await signClaim(dev, registry, claim);
      await registry.connect(relayer).register(claim, sig);
      await expect(registry.connect(relayer).register(claim, sig)).to.be.revertedWithCustomError(registry, "BadSignature");
      expect(await registry.nonces(dev.address)).to.equal(1n);
    });

    it("rejects a signature for a future nonce and a tampered claim", async () => {
      const target = await addr(await deployTarget("Plain"));
      const claim = await makeClaim(registry, { signer: dev, target });
      await expect(registry.connect(relayer).register(claim, await signClaim(dev, registry, claim, 5n))).to.be.revertedWithCustomError(registry, "BadSignature");

      const sig = await signClaim(dev, registry, claim);
      await expect(registry.connect(relayer).register({ ...claim, githubRepo: "https://github.com/evil/phish" }, sig)).to.be.revertedWithCustomError(
        registry,
        "BadSignature",
      );
    });

    it("rejects a signature made by someone other than the claimed signer, and a zero signer", async () => {
      const target = await addr(await deployTarget("Plain"));
      const claim = await makeClaim(registry, { signer: dev, target });
      await expect(registry.connect(relayer).register(claim, await signClaim(other, registry, claim))).to.be.revertedWithCustomError(registry, "BadSignature");
      await expect(
        registry.connect(relayer).register({ ...claim, signer: ethers.ZeroAddress }, "0x"),
      ).to.be.revertedWithCustomError(registry, "InvalidSigner");
    });

    it("enforces the deadline", async () => {
      const target = await addr(await deployTarget("Plain"));
      const expired = BigInt(await time.latest());
      await expect(register(registry, relayer, dev, { target, deadline: expired })).to.be.revertedWithCustomError(registry, "Expired");
    });

    it("keeps nonces per signer", async () => {
      const a = await addr(await deployTarget("Plain"));
      const b = await addr(await deployTarget("Plain"));
      await register(registry, relayer, dev, { target: a });
      await register(registry, relayer, other, { target: b });
      await register(registry, relayer, dev, { target: b }).catch(() => {}); // outranked, nonce rolls back
      expect(await registry.nonces(dev.address)).to.equal(1n);
      expect(await registry.nonces(other.address)).to.equal(1n);
    });
  });

  describe("input validation", () => {
    const goodRepos = [
      "https://github.com/a/b",
      "https://github.com/Ipramking/tally-arc",
      "https://github.com/a/b/tree/main/contracts",
      "https://github.com/a-b/c_d.e",
      "https://github.com/a/b.git",
    ];
    const badRepos = [
      "",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "http://github.com/a/b",
      "HTTPS://github.com/a/b",
      "https://github.com",
      "https://github.com/",
      "https://github.com/a",
      "https://github.com/a/",
      "https://github.com//a/b",
      "https://github.com/a//b",
      "https://github.com/./b",
      "https://github.com/../b",
      "https://github.com/a/..",
      "https://github.com/a/b?x=1",
      "https://github.com/a/b#frag",
      "https://github.com/a/b c",
      'https://github.com/a/b"onmouseover="x',
      "https://github.com/a/<b>",
      "https://github.com/a/b\n",
      "https://evil.com/github.com/a/b",
      "https://github.com.evil.com/a/b",
      "https://github.com@evil.com/a/b",
      "https://github.com/a/" + "b".repeat(200),
    ];

    it("accepts well-formed GitHub repository URLs", async () => {
      for (const githubRepo of goodRepos) {
        const target = await addr(await deployTarget("Plain"));
        await register(registry, relayer, dev, { target, githubRepo });
        expect((await read(registry, target)).githubRepo).to.equal(githubRepo);
      }
    });

    it("rejects scheme tricks, markup, lookalike hosts, odd paths and oversize strings", async () => {
      const target = await addr(await deployTarget("Plain"));
      for (const githubRepo of badRepos) {
        await expect(register(registry, relayer, dev, { target, githubRepo }), JSON.stringify(githubRepo)).to.be.revertedWithCustomError(
          registry,
          "BadRepo",
        );
      }
    });

    it("validates the build hash", async () => {
      const target = await addr(await deployTarget("Plain"));
      for (const buildHash of ["x".repeat(67), "has space", "<script>", "a/b", "0xé"]) {
        await expect(register(registry, relayer, dev, { target, buildHash })).to.be.revertedWithCustomError(registry, "BadBuildHash");
      }
      for (const buildHash of ["", "abc123", "0x" + "a".repeat(64), "v1.2.3-rc_1"]) {
        await register(registry, relayer, dev, { target, buildHash });
        expect((await read(registry, target)).buildHash).to.equal(buildHash);
      }
    });
  });

  describe("revoke", () => {
    it("lets the record's signer remove it, then the slot is free", async () => {
      const target = await addr(await deployTarget("Plain"));
      await register(registry, relayer, dev, { target });
      await expect(registry.connect(dev).revoke(target)).to.emit(registry, "Revoked").withArgs(target, dev.address);
      expect((await read(registry, target)).provenance).to.equal(PROV.NONE);
      await register(registry, relayer, other, { target });
      expect((await read(registry, target)).signer).to.equal(other.address);
    });

    it("lets the current owner or admin of the target remove anyone's record", async () => {
      const t = await deployTarget("TransferableOwner", [dev.address]);
      const target = await addr(t);
      await register(registry, relayer, dev, { target, method: METHOD.OWNER });
      await t.transferOwnership(other.address);
      await registry.connect(other).revoke(target);
      expect((await read(registry, target)).provenance).to.equal(PROV.NONE);

      const nonce = await ethers.provider.getTransactionCount(other.address);
      const adminTarget = await addr(await deployTarget("AdminTarget", [dev.address], other));
      await register(registry, relayer, other, { target: adminTarget, method: METHOD.DEPLOYER, deployerNonce: BigInt(nonce) });
      await registry.connect(dev).revoke(adminTarget); // dev is the target's admin
      expect((await read(registry, adminTarget)).provenance).to.equal(PROV.NONE);
    });

    it("rejects strangers and missing records", async () => {
      const target = await addr(await deployTarget("Plain"));
      await expect(registry.connect(dev).revoke(target)).to.be.revertedWithCustomError(registry, "NoRecord");
      await register(registry, relayer, dev, { target });
      await expect(registry.connect(stranger).revoke(target)).to.be.revertedWithCustomError(registry, "NotAuthorized");
    });
  });

  describe("hostile targets", () => {
    for (const name of ["GasBomb", "ReturnBomb", "Reverter", "DirtyAnswer"]) {
      it(`${name} cannot block, burn gas from, or fake a controller for registration`, async () => {
        const target = await addr(await deployTarget(name));
        const tx = await register(registry, relayer, dev, { target }); // self-attested still works
        const receipt = await tx.wait();
        expect(receipt.gasUsed).to.be.lessThan(600_000n);
        expect((await read(registry, target)).provenance).to.equal(PROV.SELF);
        await expect(register(registry, relayer, dev, { target, method: METHOD.OWNER })).to.be.revertedWithCustomError(registry, "NotOwner");
        await expect(register(registry, relayer, dev, { target, method: METHOD.ADMIN_ROLE })).to.be.revertedWithCustomError(registry, "NotAdmin");
      });
    }
  });

  describe("events and views", () => {
    it("emits Registered with the code hash and an empty read for unknown targets", async () => {
      const target = await addr(await deployTarget("OwnableTarget", [dev.address]));
      const codehash = ethers.keccak256(await ethers.provider.getCode(target));
      await expect(register(registry, relayer, dev, { target, method: METHOD.OWNER, buildHash: "abc", githubRepo: REPO }))
        .to.emit(registry, "Registered")
        .withArgs(target, dev.address, PROV.CONTROL, METHOD.OWNER, REPO, "abc", codehash);
      expect(await registry.recordedCodehash(target)).to.equal(codehash);

      const unknown = await read(registry, ethers.Wallet.createRandom().address);
      expect(unknown).to.deep.include({ provenance: 0, isControlProven: false, flags: 0, githubRepo: "" });
    });
  });

  describe("history", () => {
    const KIND = { REGISTERED: 0, REVOKED: 1 };
    const entry = (e) => ({
      signer: e.signer,
      blockNumber: Number(e.blockNumber),
      kind: Number(e.kind),
      provenance: Number(e.provenance),
      method: Number(e.method),
    });

    it("is empty for a target that was never registered", async () => {
      const target = ethers.Wallet.createRandom().address;
      expect(await registry.historyLength(target)).to.equal(0n);
      expect(await registry.getHistory(target, 0, 10)).to.have.length(0);
    });

    it("appends one entry per registration, oldest first, and keeps the claim that was replaced", async () => {
      const target = await addr(await deployTarget("Plain"));
      const first = await (await register(registry, relayer, dev, { target, buildHash: "v1" })).wait();
      const second = await (await register(registry, relayer, dev, { target, buildHash: "v2" })).wait();

      expect((await read(registry, target)).buildHash).to.equal("v2"); // the record shows only the latest...
      expect(await registry.historyLength(target)).to.equal(2n); // ...the history keeps both
      const list = (await registry.getHistory(target, 0, 10)).map(entry);
      expect(list).to.deep.equal([
        { signer: dev.address, blockNumber: first.blockNumber, kind: KIND.REGISTERED, provenance: PROV.SELF, method: METHOD.NONE },
        { signer: dev.address, blockNumber: second.blockNumber, kind: KIND.REGISTERED, provenance: PROV.SELF, method: METHOD.NONE },
      ]);
    });

    it("keeps a squatter's claim in the history after the real deployer takes over", async () => {
      const nonce = await ethers.provider.getTransactionCount(dev.address);
      const target = await addr(await deployTarget("Plain", [], dev));
      await register(registry, relayer, other, { target, githubRepo: "https://github.com/squatter/fake" });
      await register(registry, relayer, dev, { target, method: METHOD.DEPLOYER, deployerNonce: BigInt(nonce) });

      expect((await read(registry, target)).signer).to.equal(dev.address);
      const list = (await registry.getHistory(target, 0, 10)).map(entry);
      expect(list.map((e) => [e.signer, e.provenance, e.method])).to.deep.equal([
        [other.address, PROV.SELF, METHOD.NONE],
        [dev.address, PROV.CONTROL, METHOD.DEPLOYER],
      ]);
    });

    it("records a revocation with who removed the record, while the record itself is gone", async () => {
      const t = await deployTarget("TransferableOwner", [dev.address]);
      const target = await addr(t);
      await register(registry, relayer, dev, { target, method: METHOD.OWNER });
      await t.transferOwnership(other.address);
      const receipt = await (await registry.connect(other).revoke(target)).wait();

      expect((await read(registry, target)).provenance).to.equal(PROV.NONE);
      const list = (await registry.getHistory(target, 0, 10)).map(entry);
      expect(list).to.have.length(2);
      expect(list[1]).to.deep.equal({
        signer: other.address,
        blockNumber: receipt.blockNumber,
        kind: KIND.REVOKED,
        provenance: PROV.CONTROL,
        method: METHOD.OWNER,
      });
    });

    it("keeps appending after a revoke, so a re-registration shows all three lines", async () => {
      const target = await addr(await deployTarget("Plain"));
      await register(registry, relayer, dev, { target });
      await registry.connect(dev).revoke(target);
      await register(registry, relayer, dev, { target });
      const list = (await registry.getHistory(target, 0, 10)).map(entry);
      expect(list.map((e) => e.kind)).to.deep.equal([KIND.REGISTERED, KIND.REVOKED, KIND.REGISTERED]);
    });

    it("adds nothing when a registration reverts, and keeps each target's history separate", async () => {
      const owned = await addr(await deployTarget("OwnableTarget", [other.address]));
      const plain = await addr(await deployTarget("Plain"));
      await expect(register(registry, relayer, dev, { target: owned, method: METHOD.OWNER })).to.be.revertedWithCustomError(registry, "NotOwner");
      await register(registry, relayer, dev, { target: plain });
      expect(await registry.historyLength(owned)).to.equal(0n);
      expect(await registry.historyLength(plain)).to.equal(1n);
    });

    it("pages with start and count, and never overflows on a huge count", async () => {
      const target = await addr(await deployTarget("Plain"));
      for (let i = 0; i < 3; i++) await register(registry, relayer, dev, { target, buildHash: `b${i}` });

      const all = await registry.getHistory(target, 0, 3);
      expect(all).to.have.length(3);
      expect((await registry.getHistory(target, 1, 2)).map(entry)).to.deep.equal(all.slice(1).map(entry));
      expect(await registry.getHistory(target, 1, 1)).to.have.length(1);
      expect(await registry.getHistory(target, 2, ethers.MaxUint256)).to.have.length(1); // no overflow in start + count
      expect(await registry.getHistory(target, 3, 5)).to.have.length(0); // start at the end
      expect(await registry.getHistory(target, 99, 5)).to.have.length(0); // start past the end
      expect(await registry.getHistory(target, 0, 0)).to.have.length(0);
    });

    it("returns at most 100 entries per call", async function () {
      this.timeout(180_000);
      const target = await addr(await deployTarget("Plain"));
      for (let i = 0; i < 102; i++) await register(registry, relayer, dev, { target, buildHash: `b${i}` });
      expect(await registry.historyLength(target)).to.equal(102n);
      expect(await registry.getHistory(target, 0, 1000)).to.have.length(100);
      expect(await registry.getHistory(target, 100, 1000)).to.have.length(2);
    });
  });
});
