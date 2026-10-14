import { describe, expect, it } from "vitest";
import { encodeFunctionData, parseAbi, toFunctionSelector, type Hex } from "viem";
import { currentOwnerIs, decodeRegistration, DecodeError, encodeGetRegistration, readRegistry } from "@/lib/registry";
import { addressWord, arcChain, encodeV1, encodeV2, fakeWorld, NONE_V1, OTHER, REG_V1, REG_V2, REPO, SIGNER, TARGET } from "./helpers";

const SEL = toFunctionSelector("getRegistration(address)");
const OWNER = toFunctionSelector("owner()");

describe("registry decoding", () => {
  it("encodes the call like viem and with the shared selector", () => {
    const viemData = encodeFunctionData({ abi: parseAbi(["function getRegistration(address)"]), functionName: "getRegistration", args: [TARGET] });
    expect(encodeGetRegistration(1, TARGET)).toBe(viemData);
    expect(encodeGetRegistration(2, TARGET)).toBe(viemData);
    expect(encodeGetRegistration(2, TARGET).slice(0, 10)).toBe(SEL);
  });

  it("decodes a v1 owner-proven record (control and code are not tracked)", () => {
    const record = decodeRegistration(1, REG_V1, encodeV1({ hash: "abc123", prov: 2 }));
    expect(record).toEqual({
      registryVersion: 1,
      registry: REG_V1,
      githubRepo: REPO,
      buildHash: "abc123",
      signer: SIGNER,
      registeredAt: 1700000000,
      provenance: "CONTROL_PROVEN",
      method: "OWNER",
      controlCurrent: null,
      codeCurrent: null,
    });
  });

  it("decodes v1 self-attested and empty records", () => {
    expect(decodeRegistration(1, REG_V1, encodeV1({ prov: 1 })).provenance).toBe("SELF_ATTESTED");
    expect(decodeRegistration(1, REG_V1, NONE_V1()).provenance).toBe("NONE");
  });

  it("decodes every v2 method and flag combination", () => {
    const methods = ["NONE", "OWNER", "ADMIN_ROLE", "DEPLOYER"];
    for (let method = 0; method < 4; method++) {
      for (let flags = 0; flags < 4; flags++) {
        const record = decodeRegistration(2, REG_V2, encodeV2({ method, flags, prov: method === 0 ? 1 : 2 }));
        expect(record.method).toBe(methods[method]);
        expect(record.controlCurrent).toBe((flags & 1) !== 0);
        expect(record.codeCurrent).toBe((flags & 2) !== 0);
      }
    }
  });

  it("round-trips non-ASCII text", () => {
    const text = "h\u00e9llo \u2713";
    expect(decodeRegistration(2, REG_V2, encodeV2({ hash: text })).buildHash).toBe(text);
  });

  it("malformed data throws DecodeError and never half-parses", () => {
    const good = encodeV1();
    const setWord = (hex: string, index: number, value: string) =>
      `0x${hex.slice(2, 2 + index * 64)}${value.padStart(64, "0")}${hex.slice(2 + index * 64 + 64)}`;
    const cases: [string, string][] = [
      ["empty", "0x"],
      ["junk", "0xdeadbeef"],
      ["truncated", good.slice(0, 2 + 64 * 3)],
      ["truncated tail", good.slice(0, good.length - 64)],
      ["offset past end", setWord(good, 0, "ffff00")],
      ["provenance 3", setWord(good, 4, "03")],
    ];
    for (const [name, data] of cases) {
      expect(() => decodeRegistration(1, REG_V1, data as `0x${string}`), name).toThrow(DecodeError);
    }
    expect(() => decodeRegistration(2, REG_V2, setWord(encodeV2(), 6, "04") as `0x${string}`)).toThrow(DecodeError);
  });

  it("readRegistry reads through the RPC and tags the registry", async () => {
    const world = fakeWorld({ rpc: { [REG_V2]: { [SEL]: encodeV2() } } });
    const record = await readRegistry(arcChain, { version: 2, address: REG_V2 }, TARGET, { fetchImpl: world });
    expect(record.registry).toBe(REG_V2);
    expect(world.calls).toHaveLength(1);
  });

  it("an empty eth_call (no registry code) is an error, not 'unverified'", async () => {
    const world = fakeWorld({ rpc: { [REG_V1]: { [SEL]: "0x" } } });
    await expect(readRegistry(arcChain, { version: 1, address: REG_V1 }, TARGET, { fetchImpl: world })).rejects.toThrow(/empty result/);
  });
});

describe("v1 live-ownership probe", () => {
  const ask = (reply: Hex | { error: { code: number; message: string } }) =>
    currentOwnerIs(arcChain, TARGET, SIGNER, { fetchImpl: fakeWorld({ rpc: { [TARGET]: { [OWNER]: reply } } }) });

  it("compares owner() with the recorded signer", async () => {
    expect(await ask(addressWord(SIGNER))).toBe(true);
    expect(await ask(addressWord(OTHER))).toBe(false);
    expect(await ask({ error: { code: 3, message: "execution reverted" } })).toBe(false);
    expect(await ask("0x")).toBe(false);
    expect(await ask("0x1234")).toBe(false);
  });

  it("a network failure is an error, not 'not the owner'", async () => {
    const failing = fakeWorld({ rpc: { [TARGET]: { [OWNER]: new TypeError("network down") } } });
    await expect(currentOwnerIs(arcChain, TARGET, SIGNER, { fetchImpl: failing })).rejects.toThrow(/network down/);
  });
});
