import { encodeFunctionData, getCreateAddress, toFunctionSelector, type Address } from "viem";
import { describe, expect, it } from "vitest";
import { accessControlAbi } from "@/lib/abi";
import { findDeployerNonce, MAX_NONCE_SCAN, planProof } from "@/lib/prove";
import { addressWord, boolWord, fakeWorld, OTHER, SIGNER, TARGET } from "./helpers";

const OWNER = toFunctionSelector("owner()");
const HAS_ROLE = toFunctionSelector("hasRole(bytes32,address)");
const RPC = "https://rpc.example";
const ACCOUNT = SIGNER;
const revert = { error: { code: 3, message: "execution reverted" } };

function world(o: { code?: string; owner?: any; admin?: any; count?: string } = {}) {
  return fakeWorld({
    rpc: {
      "*": { eth_getCode: o.code ?? "0x6001", eth_getTransactionCount: o.count ?? "0x5" },
      [TARGET]: { [OWNER]: o.owner ?? revert, [HAS_ROLE]: o.admin ?? revert },
    },
  });
}
const plan = (fetchImpl: ReturnType<typeof fakeWorld>, target: Address = TARGET) => planProof({ rpcUrl: RPC, target, account: ACCOUNT, fetchImpl });

describe("planProof", () => {
  it("NO_CODE when nothing is deployed there", async () => {
    expect(await plan(world({ code: "0x" }))).toEqual({ method: "NO_CODE" });
  });

  it("OWNER when owner() is the connected wallet (compared case-insensitively)", async () => {
    expect(await plan(world({ owner: addressWord(ACCOUNT) }))).toEqual({ method: "OWNER" });
  });

  it("ADMIN_ROLE when the wallet holds DEFAULT_ADMIN_ROLE", async () => {
    expect(await plan(world({ admin: boolWord(true) }))).toEqual({ method: "ADMIN_ROLE" });
    expect(await plan(world({ owner: addressWord(OTHER), admin: boolWord(true) }))).toEqual({ method: "ADMIN_ROLE" });
  });

  it("hasRole is queried for role 0x00 and the wallet", async () => {
    const w = world({ admin: boolWord(true) });
    await plan(w);
    const roleCall = w.calls.map((c) => JSON.parse(String(c.init?.body))).find((b) => b.method === "eth_call" && b.params[0].data.startsWith(HAS_ROLE));
    expect(roleCall.params[0].data).toBe(encodeFunctionData({ abi: accessControlAbi, functionName: "hasRole", args: [`0x${"00".repeat(32)}`, ACCOUNT] }));
  });

  it("OWNER wins over ADMIN_ROLE", async () => {
    expect(await plan(world({ owner: addressWord(ACCOUNT), admin: boolWord(true) }))).toEqual({ method: "OWNER" });
  });

  it("DEPLOYER with the right nonce when the wallet created the contract", async () => {
    const created = getCreateAddress({ from: ACCOUNT, nonce: 3n });
    const w = fakeWorld({ rpc: { "*": { eth_getCode: "0x6001", eth_getTransactionCount: "0x9" }, [created]: { [OWNER]: revert, [HAS_ROLE]: revert } } });
    expect(await plan(w, created)).toEqual({ method: "DEPLOYER", deployerNonce: 3 });
  });

  it("NONE when nobody controls the contract and the wallet did not deploy it", async () => {
    expect(await plan(world())).toEqual({ method: "NONE" });
    expect(await plan(world({ owner: addressWord("0x0000000000000000000000000000000000000000") }))).toEqual({ method: "NONE" });
  });

  it("BLOCKED when someone else controls it (the registry refuses an unproven claim)", async () => {
    expect(await plan(world({ owner: addressWord(OTHER) }))).toEqual({ method: "BLOCKED", owner: OTHER });
  });

  it("a network failure surfaces as an error, not as a plan", async () => {
    const failing = fakeWorld({ rpc: { "*": { eth_getCode: new TypeError("network down") } } });
    await expect(plan(failing)).rejects.toThrow(/network down/);
  });

  it("the nonce scan is bounded and finds nothing past the cap", async () => {
    const past = getCreateAddress({ from: ACCOUNT, nonce: BigInt(MAX_NONCE_SCAN) });
    const w = fakeWorld({ rpc: { "*": { eth_getTransactionCount: "0xffffffff" } } });
    expect(await findDeployerNonce(RPC, past, ACCOUNT, { fetchImpl: w })).toBeNull();
  }, 60_000);
});
