// The registry contracts are the source of truth; the studio (TypeScript) and the
// extension (plain JS) are written by hand against them. These tests keep the
// clients in step with the contracts by checking the studio's ABIs, its EIP-712 types and
// the extension's byte-level decoder against the REAL compiled contracts.
//
//   - every signature the studio declares must exist on the contract, with the
//     same selector, output types and indexed fields
//   - every custom error the contract declares must be known to the studio
//     (and have a plain-English message)
//   - typed data built from the studio's types must be accepted by the contract
//   - the extension's decoder must agree with the contract's own ABI decoding
const { expect } = require("chai");
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("hardhat");
const { deployRegistry, deployTarget, METHOD, PROV } = require("./helpers");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const ROOT = path.join(__dirname, "..", "..");
const source = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const studioAbi = source("studio/lib/abi.ts");
const studioEip712 = source("studio/lib/eip712.ts");
const extensionRegistry = require(path.join(ROOT, "extension/lib/registry.js"));

// ---- reading the studio's TypeScript without compiling it -----------------

function signaturesOf(constName) {
  const start = studioAbi.indexOf(`export const ${constName} = parseAbi([`);
  expect(start, `${constName} not found in studio/lib/abi.ts`).to.be.greaterThan(-1);
  const end = studioAbi.indexOf("]);", start);
  return [...studioAbi.slice(start, end).matchAll(/"((?:function|event|error) [^"]+)"/g)].map((m) => m[1]);
}

function typesOf(constName) {
  const start = studioEip712.indexOf(`export const ${constName} = {`);
  expect(start, `${constName} not found in studio/lib/eip712.ts`).to.be.greaterThan(-1);
  const end = studioEip712.indexOf("} as const;", start);
  const fields = [...studioEip712.slice(start, end).matchAll(/\{ name: "(\w+)", type: "(\w+)" \}/g)].map((m) => ({ name: m[1], type: m[2] }));
  return { Register: fields };
}

function domainVersion(constName) {
  const match = studioEip712.match(new RegExp(`export const ${constName} = "(\\d+)"`));
  expect(match, `${constName} not found`).to.not.equal(null);
  return match[1];
}

function declaredErrors(solFile) {
  return [...source(solFile).matchAll(/^\s*error (\w+)\(/gm)].map((m) => m[1]).sort();
}

function revertHelpKeys() {
  const block = studioAbi.slice(studioAbi.indexOf("export const REVERT_HELP"));
  return [...block.matchAll(/^ {2}([A-Za-z]+):/gm)].map((m) => m[1]).sort();
}

const sighash = (params) => params.map((p) => p.format("sighash"));

async function artifactInterface(name) {
  const artifact = await hre.artifacts.readArtifact(name);
  return new ethers.Interface(artifact.abi);
}

function expectParity(label, studioSignatures, real) {
  const studio = new ethers.Interface(studioSignatures);
  for (const fragment of studio.fragments) {
    const where = `${label}: ${fragment.format("sighash")}`;
    if (fragment.type === "function") {
      const actual = real.getFunction(fragment.name);
      expect(actual, `${where} is not on the contract`).to.not.equal(null);
      expect(fragment.selector, `${where} selector`).to.equal(actual.selector);
      expect(sighash(fragment.outputs), `${where} outputs`).to.deep.equal(sighash(actual.outputs));
      expect(fragment.stateMutability, `${where} mutability`).to.equal(actual.stateMutability);
    } else if (fragment.type === "event") {
      const actual = real.getEvent(fragment.name);
      expect(actual, `${where} is not on the contract`).to.not.equal(null);
      expect(fragment.topicHash, `${where} topic`).to.equal(actual.topicHash);
      expect(
        fragment.inputs.map((i) => Boolean(i.indexed)),
        `${where} indexed fields`
      ).to.deep.equal(actual.inputs.map((i) => Boolean(i.indexed)));
    } else if (fragment.type === "error") {
      const actual = real.getError(fragment.name);
      expect(actual, `${where} is not on the contract`).to.not.equal(null);
      expect(fragment.selector, `${where} selector`).to.equal(actual.selector);
    }
  }
}

describe("clients agree with the contracts", () => {
  describe("studio ABIs", () => {
    it("registryV2Abi matches TallyRegistryV2 (functions, events, errors)", async () => {
      expectParity("v2", signaturesOf("registryV2Abi"), await artifactInterface("TallyRegistryV2"));
    });

    it("registryV1Abi matches the deployed TallyRegistry (v1)", async () => {
      expectParity("v1", signaturesOf("registryV1Abi"), await artifactInterface("TallyRegistry"));
    });

    it("the studio knows every custom error the v2 contract declares, and explains each one", () => {
      const declared = declaredErrors("contracts/contracts/TallyRegistryV2.sol");
      const known = signaturesOf("registryV2Abi")
        .filter((s) => s.startsWith("error "))
        .map((s) => s.slice(6, s.indexOf("(")))
        .sort();
      expect(known).to.deep.equal(declared);
      expect(revertHelpKeys()).to.deep.equal(declared);
    });

    it("owner() and hasRole() match what the registry itself probes", async () => {
      const probes = new ethers.Interface(signaturesOf("ownableAbi").concat(signaturesOf("accessControlAbi")));
      expect(probes.getFunction("owner").selector).to.equal(ethers.id("owner()").slice(0, 10));
      expect(probes.getFunction("hasRole").selector).to.equal(ethers.id("hasRole(bytes32,address)").slice(0, 10));
      expect(extensionRegistry.OWNER).to.equal(ethers.id("owner()").slice(0, 10));
      expect(extensionRegistry.GET_REGISTRATION).to.equal(ethers.id("getRegistration(address)").slice(0, 10));
    });
  });

  describe("v2: typed data built from the studio's types is accepted by the contract", () => {
    const REPO = "https://github.com/acme/vault";
    const longHash = "a".repeat(66);

    it("registers with the studio's V2_TYPES and domain, and the extension decodes the result exactly", async () => {
      const [, owner, relayer] = await ethers.getSigners();
      const registry = await deployRegistry("TallyRegistryV2");
      const target = await deployTarget("OwnableTarget", [owner.address], owner);
      const claim = {
        target: await target.getAddress(),
        signer: owner.address,
        githubRepo: REPO,
        buildHash: longHash,
        method: METHOD.OWNER,
        deployerNonce: 0n,
        deadline: BigInt((await time.latest()) + 3600),
      };
      const domain = {
        name: "Tally",
        version: domainVersion("V2_DOMAIN_VERSION"),
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await registry.getAddress(),
      };
      const nonce = await registry.nonces(owner.address);
      const signature = await owner.signTypedData(domain, typesOf("V2_TYPES"), { ...claim, nonce });
      await registry.connect(relayer).register(claim, signature);

      const raw = await ethers.provider.call({ to: await registry.getAddress(), data: extensionRegistry.encodeGetRegistration(claim.target) });
      const decoded = extensionRegistry.decodeRegistration(2, raw);
      const real = await registry.getRegistration(claim.target);
      expect(decoded).to.deep.equal({
        registryVersion: 2,
        githubRepo: real.githubRepo,
        buildHash: real.buildHash,
        signer: real.signer.toLowerCase(),
        registeredAt: Number(real.registeredAt),
        provenance: "CONTROL_PROVEN",
        method: "OWNER",
        controlCurrent: true,
        codeCurrent: true,
        upgradeable: null, // not a registry fact: the lookup probes the proxy slots afterwards
      });
      expect(decoded.githubRepo).to.equal(REPO);
      expect(decoded.buildHash).to.equal(longHash);
    });

    it("decodes every provenance and method the contract can return", async () => {
      const [, owner, other, relayer] = await ethers.getSigners();
      const registry = await deployRegistry("TallyRegistryV2");
      const registryAddress = await registry.getAddress();
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const domain = { name: "Tally", version: domainVersion("V2_DOMAIN_VERSION"), chainId, verifyingContract: registryAddress };
      const types = typesOf("V2_TYPES");

      async function registerAs(wallet, target, method, deployerNonce = 0n) {
        const claim = {
          target,
          signer: wallet.address,
          githubRepo: REPO,
          buildHash: "",
          method,
          deployerNonce,
          deadline: BigInt((await time.latest()) + 3600),
        };
        const nonce = await registry.nonces(wallet.address);
        await registry.connect(relayer).register(claim, await wallet.signTypedData(domain, types, { ...claim, nonce }));
      }
      async function decode(target) {
        const raw = await ethers.provider.call({ to: registryAddress, data: extensionRegistry.encodeGetRegistration(target) });
        return extensionRegistry.decodeRegistration(2, raw);
      }

      // Nothing registered.
      const plain = await deployTarget("Plain", [], owner);
      expect(await decode(await plain.getAddress())).to.include({ provenance: "NONE", method: "NONE", githubRepo: "" });

      // Self-attested (a contract with no controller).
      await registerAs(other, await plain.getAddress(), METHOD.NONE);
      expect(await decode(await plain.getAddress())).to.include({ provenance: "SELF_ATTESTED", method: "NONE", controlCurrent: false });

      // Admin role.
      const admin = await deployTarget("AdminTarget", [owner.address], owner);
      await registerAs(owner, await admin.getAddress(), METHOD.ADMIN_ROLE);
      expect(await decode(await admin.getAddress())).to.include({ provenance: "CONTROL_PROVEN", method: "ADMIN_ROLE", controlCurrent: true, codeCurrent: true });

      // Deployer (CREATE address).
      const nonceBefore = await ethers.provider.getTransactionCount(owner.address);
      const deployed = await deployTarget("Plain", [], owner);
      await registerAs(owner, await deployed.getAddress(), METHOD.DEPLOYER, BigInt(nonceBefore));
      expect(await decode(await deployed.getAddress())).to.include({ provenance: "CONTROL_PROVEN", method: "DEPLOYER", controlCurrent: true, codeCurrent: true });
    });
  });

  describe("v1: the deployed registry accepts the studio's V1_TYPES, keyed by the target's nonce", () => {
    const REPO = "https://github.com/acme/legacy";

    it("registers and updates, and the extension decodes v1 output exactly", async () => {
      const [, owner, relayer] = await ethers.getSigners();
      const registry = await deployRegistry("TallyRegistry");
      const target = await deployTarget("OwnableTarget", [owner.address], owner);
      const targetAddress = await target.getAddress();
      const domain = {
        name: "Tally",
        version: domainVersion("V1_DOMAIN_VERSION"),
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await registry.getAddress(),
      };
      const types = typesOf("V1_TYPES");
      const longRepo = `${REPO}/${"x".repeat(120)}`; // v1 does not bound the string; the decoder must handle several words

      for (const [round, repo] of [[0n, REPO], [1n, longRepo]]) {
        // register-flow.ts reads nonces(target) on v1, so this is the nonce it signs with.
        const nonce = await registry.nonces(targetAddress);
        expect(nonce).to.equal(round);
        const message = { target: targetAddress, githubRepo: repo, buildHash: "444d1a3", nonce };
        await registry.connect(relayer).registerWithSignature(targetAddress, repo, "444d1a3", await owner.signTypedData(domain, types, message));
      }

      const raw = await ethers.provider.call({ to: await registry.getAddress(), data: extensionRegistry.encodeGetRegistration(targetAddress) });
      const decoded = extensionRegistry.decodeRegistration(1, raw);
      const real = await registry.getRegistration(targetAddress);
      expect(decoded).to.deep.equal({
        registryVersion: 1,
        githubRepo: longRepo,
        buildHash: "444d1a3",
        signer: real.owner.toLowerCase(),
        registeredAt: Number(real.registeredAt),
        provenance: "CONTROL_PROVEN",
        method: "OWNER",
        controlCurrent: null,
        codeCurrent: null,
        upgradeable: null,
        v1Verified: true,
      });
      expect(Number(real.provenance)).to.equal(PROV.CONTROL);
    });
  });
});
