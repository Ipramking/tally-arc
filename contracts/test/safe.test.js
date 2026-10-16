// A Safe (the real contracts, v1.4.1, not a mock) as the owner of a contract and as the signer of its
// registration. The registry accepts ERC-1271 signatures, so a multisig registers by collecting owner
// signatures and letting anyone relay them. The signature is the one the Safe's own fallback handler
// validates: each owner signs the SafeMessage hash of the registry's EIP-712 digest, and the signatures
// are concatenated in ascending owner-address order.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { METHOD, deployRegistry, deployTarget, makeClaim, read } = require("./helpers");

const artifacts = "@safe-global/safe-contracts/build/artifacts/contracts";
const SafeArtifact = require(`${artifacts}/Safe.sol/Safe.json`);
const FactoryArtifact = require(`${artifacts}/proxies/SafeProxyFactory.sol/SafeProxyFactory.json`);
const HandlerArtifact = require(`${artifacts}/handler/CompatibilityFallbackHandler.sol/CompatibilityFallbackHandler.json`);

const SAFE_MESSAGE = { SafeMessage: [{ name: "message", type: "bytes" }] };

async function deployArtifact(artifact, deployer) {
  const contract = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer).deploy();
  await contract.waitForDeployment();
  return contract;
}

/** A Safe with the given owners and threshold, behind the standard proxy factory. Resolves to its address. */
async function createSafe(deployer, ownerAddresses, threshold) {
  const singleton = await deployArtifact(SafeArtifact, deployer);
  const factory = await deployArtifact(FactoryArtifact, deployer);
  const handler = await deployArtifact(HandlerArtifact, deployer);
  const setup = singleton.interface.encodeFunctionData("setup", [
    ownerAddresses,
    threshold,
    ethers.ZeroAddress,
    "0x",
    await handler.getAddress(),
    ethers.ZeroAddress,
    0,
    ethers.ZeroAddress,
  ]);
  const receipt = await (await factory.createProxyWithNonce(await singleton.getAddress(), setup, 0n)).wait();
  const created = receipt.logs
    .map((log) => {
      try {
        return factory.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((event) => event && event.name === "ProxyCreation");
  return created.args.proxy;
}

/** What the Safe's fallback handler checks for a signature over `digest`: owners sign the SafeMessage hash, sorted by address. */
async function safeSignature(safeAddress, digest, wallets, { sorted = true } = {}) {
  const { chainId } = await ethers.provider.getNetwork();
  const messageHash = ethers.TypedDataEncoder.hash({ chainId, verifyingContract: safeAddress }, SAFE_MESSAGE, { message: digest });
  const ordered = sorted ? [...wallets].sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1)) : wallets;
  return ethers.concat(
    ordered.map((wallet) => {
      const signature = wallet.signingKey.sign(messageHash);
      return ethers.concat([signature.r, signature.s, ethers.toBeHex(signature.v, 1)]);
    }),
  );
}

describe("TallyRegistryV2 with a real Safe (v1.4.1) as owner and signer", () => {
  const owners = [1, 2, 3].map((n) => new ethers.Wallet(`0x${String(n).repeat(64)}`));
  const stranger = new ethers.Wallet(`0x${"4".repeat(64)}`);
  let registry, relayer, safe, target;

  beforeEach(async () => {
    const [deployer, anyone] = await ethers.getSigners();
    relayer = anyone;
    registry = await deployRegistry();
    safe = await createSafe(deployer, owners.map((o) => o.address), 2);
    target = await (await deployTarget("OwnableTarget", [safe], deployer)).getAddress();
  });

  const claimFor = (extra = {}) => makeClaim(registry, { signerAddress: safe, target, method: METHOD.OWNER, ...extra });
  const submit = async (claim, wallets, options) => registry.connect(relayer).register(claim, await safeSignature(safe, await registry.hashClaim(claim), wallets, options));

  it("registers the contract with two of three owners' signatures, relayed by an account that is not an owner", async () => {
    await submit(await claimFor(), [owners[0], owners[2]]);

    const record = await read(registry, target);
    expect(record.signer).to.equal(safe);
    expect(record.method).to.equal(METHOD.OWNER);
    expect(record.isControlProven).to.equal(true);
    expect(record.flags).to.equal(3);
    expect(await registry.nonces(safe)).to.equal(1n);
  });

  it("accepts any two owners, and all three", async () => {
    for (const signers of [[owners[0], owners[1]], [owners[1], owners[2]], owners]) {
      const fresh = await deployRegistry();
      const claim = await makeClaim(fresh, { signerAddress: safe, target, method: METHOD.OWNER });
      await fresh.connect(relayer).register(claim, await safeSignature(safe, await fresh.hashClaim(claim), signers));
      expect((await read(fresh, target)).isControlProven).to.equal(true);
    }
  });

  it("rejects one signature when the Safe needs two", async () => {
    await expect(submit(await claimFor(), [owners[0]])).to.be.revertedWithCustomError(registry, "BadSignature");
  });

  it("rejects signatures from people who are not owners of the Safe", async () => {
    await expect(submit(await claimFor(), [owners[0], stranger])).to.be.revertedWithCustomError(registry, "BadSignature");
  });

  it("rejects signatures that are not in ascending owner order, which is the Safe's own rule", async () => {
    const descending = [...owners.slice(0, 2)].sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? 1 : -1));
    await expect(submit(await claimFor(), descending, { sorted: false })).to.be.revertedWithCustomError(registry, "BadSignature");
  });

  it("rejects a signature collected for a different claim", async () => {
    const approved = await claimFor({ githubRepo: "https://github.com/acme/approved" });
    const signature = await safeSignature(safe, await registry.hashClaim(approved), [owners[0], owners[1]]);
    const swapped = await claimFor({ githubRepo: "https://github.com/evil/swapped" });
    await expect(registry.connect(relayer).register(swapped, signature)).to.be.revertedWithCustomError(registry, "BadSignature");
  });

  it("cannot be replayed: the Safe's nonce in the registry has moved on", async () => {
    const claim = await claimFor();
    const signature = await safeSignature(safe, await registry.hashClaim(claim), [owners[0], owners[1]]);
    await registry.connect(relayer).register(claim, signature);
    await expect(registry.connect(relayer).register(claim, signature)).to.be.revertedWithCustomError(registry, "BadSignature");
  });

  it("a plain wallet cannot register a contract the Safe owns, even with a perfect signature of its own", async () => {
    const claim = await makeClaim(registry, { signer: owners[0].connect(ethers.provider), target, method: METHOD.OWNER });
    const signature = await owners[0].signTypedData(
      { name: "Tally", version: "2", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await registry.getAddress() },
      {
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
      },
      { ...claim, nonce: await registry.nonces(owners[0].address) },
    );
    await expect(registry.connect(relayer).register(claim, signature)).to.be.revertedWithCustomError(registry, "NotOwner");
  });
});
