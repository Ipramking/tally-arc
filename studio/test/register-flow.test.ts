import { decodeFunctionData, encodeFunctionData, verifyTypedData, type Address, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { registryV1Abi, registryV2Abi } from "@/lib/abi";
import { registryDomain, V1_TYPES, V2_TYPES } from "@/lib/eip712";
import { SIGNATURE_TTL_SECONDS, submitRegistration, type Step } from "@/lib/register-flow";
import type { Eip1193Provider } from "@/lib/wallet";
import { arcChain, REG_V1, REG_V2, REPO, TARGET } from "./helpers";

// A throwaway key generated for this test run. It never holds anything.
const account = privateKeyToAccount(generatePrivateKey());
const NOW = 1_800_000_000_000;
const TX_HASH = `0x${"ab".repeat(32)}` as Hex;

/** Revive the JSON a wallet receives so a local account can sign it. */
function revive(typed: { types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, unknown> }) {
  const message = { ...typed.message };
  for (const field of typed.types[typed.primaryType]) {
    if (field.type.startsWith("uint")) message[field.name] = BigInt(message[field.name] as string | number);
  }
  return message;
}

function fakeWallet(options: { rejectSigning?: boolean } = {}) {
  const calls: { method: string; params: any }[] = [];
  const signed: { typed: any; signature: Hex }[] = [];
  const provider: Eip1193Provider = {
    async request({ method, params }) {
      calls.push({ method, params });
      switch (method) {
        case "wallet_switchEthereumChain":
          return null;
        case "eth_chainId":
          return `0x${arcChain.id.toString(16)}`;
        case "eth_signTypedData_v4": {
          if (options.rejectSigning) throw Object.assign(new Error("User rejected"), { code: 4001 });
          const typed = JSON.parse((params as string[])[1]);
          const signature = await account.signTypedData({ domain: typed.domain, types: typed.types, primaryType: typed.primaryType, message: revive(typed) });
          signed.push({ typed, signature });
          return signature;
        }
        case "eth_sendTransaction":
          return TX_HASH;
        default:
          throw new Error(`unexpected wallet call ${method}`);
      }
    },
  };
  return { provider, calls, signed };
}

function fakeReader(options: { nonce?: bigint; receiptStatus?: "success" | "reverted"; receiptThrows?: boolean } = {}) {
  const simulated: any[] = [];
  const reads: any[] = [];
  const reader = {
    async readContract(args: any) {
      reads.push(args);
      return options.nonce ?? 7n;
    },
    async simulateContract(args: any) {
      simulated.push(args);
      return { request: args };
    },
    async waitForTransactionReceipt() {
      if (options.receiptThrows) throw new Error("timed out");
      return { status: options.receiptStatus ?? "success" };
    },
  } as unknown as PublicClient;
  return { reader, simulated, reads };
}

const base = { chain: arcChain, account: account.address as Address, target: TARGET, repo: REPO, buildHash: "abc123", deployerNonce: 0, now: () => NOW };

describe("submitRegistration (v2)", () => {
  const registry = { version: 2 as const, address: REG_V2 };

  it("signs the typed message the contract expects and relays exactly what was signed", async () => {
    const wallet = fakeWallet();
    const { reader, simulated, reads } = fakeReader({ nonce: 7n });
    const steps: Step[] = [];
    const result = await submitRegistration({ ...base, registry, method: "DEPLOYER", deployerNonce: 12, provider: wallet.provider, reader, onStep: (s) => steps.push(s) });

    expect(result).toEqual({ hash: TX_HASH, confirmed: true });
    expect(steps).toEqual(["network", "sign", "simulate", "send", "confirm"]);
    expect(wallet.calls[0]).toMatchObject({ method: "wallet_switchEthereumChain" });

    // The signer's own nonce is read from this registry.
    expect(reads[0]).toMatchObject({ address: REG_V2, functionName: "nonces", args: [account.address] });

    const { typed, signature } = wallet.signed[0];
    expect(typed.domain).toMatchObject({ name: "Tally", version: "2", chainId: arcChain.id, verifyingContract: REG_V2.toLowerCase() });
    expect(typed.primaryType).toBe("Register");
    expect(typed.message).toMatchObject({
      target: TARGET.toLowerCase(),
      signer: account.address.toLowerCase(),
      githubRepo: REPO,
      buildHash: "abc123",
      method: 3,
      nonce: "7",
      deployerNonce: "12",
      deadline: String(Math.floor(NOW / 1000) + SIGNATURE_TTL_SECONDS),
    });
    expect(
      await verifyTypedData({ address: account.address, domain: registryDomain(2, arcChain.id, REG_V2), types: V2_TYPES, primaryType: "Register", message: revive(typed) as never, signature }),
    ).toBe(true);

    // What was simulated is what the wallet sent.
    expect(simulated[0]).toMatchObject({ address: REG_V2, functionName: "register", account: account.address });
    const sent = wallet.calls.find((c) => c.method === "eth_sendTransaction");
    expect(sent?.params[0]).toMatchObject({ from: account.address, to: REG_V2 });
    const decoded = decodeFunctionData({ abi: registryV2Abi, data: sent?.params[0].data });
    expect(decoded.functionName).toBe("register");
    expect(decoded.args?.[1]).toBe(signature);
    expect(decoded.args?.[0]).toMatchObject({ target: TARGET, signer: account.address, method: 3, deployerNonce: 12n });
  });

  it("zeroes the deployer nonce unless the proof is DEPLOYER", async () => {
    const wallet = fakeWallet();
    await submitRegistration({ ...base, registry, method: "OWNER", deployerNonce: 99, provider: wallet.provider, reader: fakeReader().reader });
    expect(wallet.signed[0].typed.message).toMatchObject({ method: 1, deployerNonce: "0" });
  });

  it("sends nothing when the signature request is rejected", async () => {
    const wallet = fakeWallet({ rejectSigning: true });
    await expect(submitRegistration({ ...base, registry, method: "OWNER", provider: wallet.provider, reader: fakeReader().reader })).rejects.toMatchObject({ code: 4001 });
    expect(wallet.calls.some((c) => c.method === "eth_sendTransaction")).toBe(false);
  });

  it("does not ask the wallet to send when the simulation reverts", async () => {
    const wallet = fakeWallet();
    const { reader } = fakeReader();
    (reader as any).simulateContract = async () => {
      throw Object.assign(new Error("reverted"), { data: { errorName: "NotOwner" } });
    };
    await expect(submitRegistration({ ...base, registry, method: "OWNER", provider: wallet.provider, reader })).rejects.toThrow("reverted");
    expect(wallet.calls.some((c) => c.method === "eth_sendTransaction")).toBe(false);
  });

  it("reports a mined-but-reverted transaction, and a slow confirmation without failing", async () => {
    await expect(
      submitRegistration({ ...base, registry, method: "OWNER", provider: fakeWallet().provider, reader: fakeReader({ receiptStatus: "reverted" }).reader }),
    ).rejects.toThrow(/reverted/);
    await expect(
      submitRegistration({ ...base, registry, method: "OWNER", provider: fakeWallet().provider, reader: fakeReader({ receiptThrows: true }).reader }),
    ).resolves.toEqual({ hash: TX_HASH, confirmed: false });
  });
});

describe("submitRegistration (legacy v1)", () => {
  const registry = { version: 1 as const, address: REG_V1 };

  it("signs the v1 message, keyed by the target's nonce, and calls registerWithSignature", async () => {
    const wallet = fakeWallet();
    const { reader, reads } = fakeReader({ nonce: 3n });
    await submitRegistration({ ...base, registry, method: "OWNER", provider: wallet.provider, reader });

    expect(reads[0]).toMatchObject({ address: REG_V1, functionName: "nonces", args: [TARGET] });
    const { typed, signature } = wallet.signed[0];
    expect(typed.domain).toMatchObject({ name: "Tally", version: "1", chainId: arcChain.id, verifyingContract: REG_V1.toLowerCase() });
    expect(typed.message).toEqual({ target: TARGET.toLowerCase(), githubRepo: REPO, buildHash: "abc123", nonce: "3" });
    expect(
      await verifyTypedData({ address: account.address, domain: registryDomain(1, arcChain.id, REG_V1), types: V1_TYPES, primaryType: "Register", message: revive(typed) as never, signature }),
    ).toBe(true);

    const sent = wallet.calls.find((c) => c.method === "eth_sendTransaction");
    expect(sent?.params[0].data).toBe(encodeFunctionData({ abi: registryV1Abi, functionName: "registerWithSignature", args: [TARGET, REPO, "abc123", signature] }));
  });
});
