import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { registryV2Abi } from "@/lib/abi";
import { claimStruct, registryDomain, typeString, V1_TYPES, V2_TYPES, v2Message, type ClaimInput } from "@/lib/eip712";
import { REG_V2, REPO, SIGNER, TARGET } from "./helpers";

const source = (name: string) => readFileSync(fileURLToPath(new URL(`../../contracts/contracts/${name}`, import.meta.url)), "utf8");
const typehashOf = (sol: string) => /"(Register\([^"]*\))"/.exec(sol)?.[1];
const domainOf = (sol: string) => /EIP712\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/.exec(sol)?.slice(1, 3);

const claim: ClaimInput = { target: TARGET, signer: SIGNER, githubRepo: REPO, buildHash: "abc", method: "OWNER", deployerNonce: 7n, deadline: 1900000000n };

describe("EIP-712 definitions match the contracts' own source", () => {
  it("v2 type string equals the REGISTER_TYPEHASH preimage in TallyRegistryV2.sol", () => {
    expect(typeString(V2_TYPES)).toBe(typehashOf(source("TallyRegistryV2.sol")));
  });

  it("v1 type string equals the preimage in TallyRegistry.sol", () => {
    expect(typeString(V1_TYPES)).toBe(typehashOf(source("TallyRegistry.sol")));
  });

  it("domain name and version equal the EIP712(...) constructor arguments", () => {
    for (const [file, version] of [["TallyRegistry.sol", 1], ["TallyRegistryV2.sol", 2]] as const) {
      const [name, v] = domainOf(source(file)) ?? [];
      const domain = registryDomain(version, 5042, REG_V2);
      expect([domain.name, domain.version], file).toEqual([name, v]);
    }
  });
});

describe("claims", () => {
  it("the struct encodes against the register() ABI and zeroes deployerNonce unless DEPLOYER", () => {
    expect(claimStruct(claim)).toMatchObject({ method: 1, deployerNonce: 0n });
    expect(claimStruct({ ...claim, method: "DEPLOYER" })).toMatchObject({ method: 3, deployerNonce: 7n });
    expect(claimStruct({ ...claim, method: "NONE" })).toMatchObject({ method: 0, deployerNonce: 0n });
    expect(claimStruct({ ...claim, method: "ADMIN_ROLE" }).method).toBe(2);
    const data = encodeFunctionData({ abi: registryV2Abi, functionName: "register", args: [claimStruct(claim), "0x1234"] });
    expect(data.startsWith("0x")).toBe(true);
  });

  it("a signature over our typed data recovers the signer (shape sanity)", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const input = { ...claim, signer: account.address };
    const typed = { domain: registryDomain(2, 5042, REG_V2), types: V2_TYPES, primaryType: "Register" as const, message: v2Message(input, 3n) };
    const signature = await account.signTypedData(typed);
    expect(await recoverTypedDataAddress({ ...typed, signature })).toBe(account.address);
  });

  it("the signed message carries the nonce and every field of the struct", () => {
    const message = v2Message(claim, 9n);
    expect(Object.keys(message).sort()).toEqual(V2_TYPES.Register.map((f) => f.name).sort());
    expect(message.nonce).toBe(9n);
  });
});
