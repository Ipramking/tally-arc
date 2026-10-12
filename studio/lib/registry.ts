// Reading and normalising registry records, v1 and v2.
//
// v1 (deployed, immutable) never re-checks ownership: its `isVerified` stays
// true after the owner changes. So for v1 the client probes owner() itself, and
// v1 records carry no code hash (`codeCurrent: null`). See docs/security.md.
import { decodeFunctionResult, encodeFunctionData, type Address, type Hex } from "viem";
import { ownableAbi, registryV1Abi, registryV2Abi } from "./abi";
import type { ChainDef, RegistryDef } from "./chains.generated";
import type { NetOptions } from "./net";
import { ethCall, RpcError } from "./rpc";

export type Provenance = "NONE" | "SELF_ATTESTED" | "CONTROL_PROVEN";
export type ProofMethod = "NONE" | "OWNER" | "ADMIN_ROLE" | "DEPLOYER";

export interface Registration {
  registryVersion: 1 | 2;
  registry: Address;
  githubRepo: string;
  buildHash: string;
  signer: Address;
  registeredAt: number;
  provenance: Provenance;
  method: ProofMethod;
  /** Does the signer still control the target? null until probed (v1 only). */
  controlCurrent: boolean | null;
  /** Is the code at the target unchanged since registration? null for v1. */
  codeCurrent: boolean | null;
}

export const PROVENANCE: readonly Provenance[] = ["NONE", "SELF_ATTESTED", "CONTROL_PROVEN"];
export const PROOF_METHODS: readonly ProofMethod[] = ["NONE", "OWNER", "ADMIN_ROLE", "DEPLOYER"];
export const METHOD_CODE: Readonly<Record<ProofMethod, number>> = { NONE: 0, OWNER: 1, ADMIN_ROLE: 2, DEPLOYER: 3 };

export const FLAG_CONTROL_CURRENT = 1;
export const FLAG_CODE_CURRENT = 2;

export const METHOD_LABEL: Readonly<Record<ProofMethod, string>> = {
  NONE: "No proof",
  OWNER: "owner()",
  ADMIN_ROLE: "Default admin role",
  DEPLOYER: "Deployer (CREATE address)",
};

export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecodeError";
  }
}

export function encodeGetRegistration(version: 1 | 2, target: Address): Hex {
  return version === 2
    ? encodeFunctionData({ abi: registryV2Abi, functionName: "getRegistration", args: [target] })
    : encodeFunctionData({ abi: registryV1Abi, functionName: "getRegistration", args: [target] });
}

function indexOf<T>(list: readonly T[], value: number | bigint, what: string): T {
  const index = Number(value);
  const item = list[index];
  if (!Number.isInteger(index) || item === undefined) throw new DecodeError(`${what} out of range`);
  return item;
}

function toTimestamp(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new DecodeError("timestamp out of range");
  return n;
}

/** Decode a getRegistration result into a normalised record. Throws DecodeError. */
export function decodeRegistration(version: 1 | 2, registry: Address, data: Hex): Registration {
  try {
    if (version === 1) {
      const [githubRepo, buildHash, owner, registeredAt, provenance] = decodeFunctionResult({
        abi: registryV1Abi,
        functionName: "getRegistration",
        data,
      });
      const level = indexOf(PROVENANCE, provenance, "provenance");
      return {
        registryVersion: 1,
        registry,
        githubRepo,
        buildHash,
        signer: owner,
        registeredAt: toTimestamp(registeredAt),
        provenance: level,
        method: level === "CONTROL_PROVEN" ? "OWNER" : "NONE",
        controlCurrent: null,
        codeCurrent: null,
      };
    }
    const [githubRepo, buildHash, signer, registeredAt, provenance, , method, flags] = decodeFunctionResult({
      abi: registryV2Abi,
      functionName: "getRegistration",
      data,
    });
    return {
      registryVersion: 2,
      registry,
      githubRepo,
      buildHash,
      signer,
      registeredAt: toTimestamp(registeredAt),
      provenance: indexOf(PROVENANCE, provenance, "provenance"),
      method: indexOf(PROOF_METHODS, method, "method"),
      controlCurrent: (flags & FLAG_CONTROL_CURRENT) !== 0,
      codeCurrent: (flags & FLAG_CODE_CURRENT) !== 0,
    };
  } catch (error) {
    if (error instanceof DecodeError) throw error;
    throw new DecodeError(data === "0x" ? "empty result (no registry deployed at this address?)" : "malformed registry response");
  }
}

/** Read one registry. Resolves to a record (possibly provenance NONE). */
export async function readRegistry(chain: ChainDef, registry: RegistryDef, target: Address, options: NetOptions = {}): Promise<Registration> {
  const data = await ethCall(chain.rpcUrl, registry.address, encodeGetRegistration(registry.version, target), options);
  return decodeRegistration(registry.version, registry.address, data);
}

/** Does `target.owner()` currently equal `signer`? A target without owner() answers false. */
export async function currentOwnerIs(chain: ChainDef, target: Address, signer: Address, options: NetOptions = {}): Promise<boolean> {
  try {
    const data = await ethCall(chain.rpcUrl, target, encodeFunctionData({ abi: ownableAbi, functionName: "owner" }), options);
    if (data.length !== 66) return false;
    const owner = decodeFunctionResult({ abi: ownableAbi, functionName: "owner", data });
    return owner.toLowerCase() === signer.toLowerCase();
  } catch (error) {
    if (error instanceof RpcError && error.revert) return false;
    throw error;
  }
}
