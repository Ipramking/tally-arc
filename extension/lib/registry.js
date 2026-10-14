// Dependency-free reader for the Tally registries over plain JSON-RPC.
//
// Encodes getRegistration(address) and decodes the result by hand so the
// extension ships with zero runtime dependencies. The decoder is strict: every
// offset and length is bounds-checked, and malformed data throws instead of
// being half-parsed. Verified against real contract output and viem in tests.
(function (root, factory) {
  const net = root.TallyNet || (typeof require === "function" ? require("./net.js") : null);
  const safe = root.TallySafeUrl || (typeof require === "function" ? require("./safe-url.js") : null);
  const api = factory(net, safe);
  root.TallyRegistry = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (net, safe) {
  // keccak256("getRegistration(address)")[0:4]; identical on v1 and v2.
  const GET_REGISTRATION = "0x72731062";
  // keccak256("owner()")[0:4]
  const OWNER = "0x8da5cb5b";

  const PROVENANCE = ["NONE", "SELF_ATTESTED", "CONTROL_PROVEN"];
  const METHOD = ["NONE", "OWNER", "ADMIN_ROLE", "DEPLOYER"];
  const FLAG_CONTROL_CURRENT = 1;
  const FLAG_CODE_CURRENT = 2;

  const MAX_STRING_BYTES = 4096; // v2 stores <= 200 bytes; v1 is unbounded, so cap what we read
  const MAX_RPC_BYTES = 64 * 1024;

  class DecodeError extends Error {
    constructor(message) {
      super(message);
      this.name = "DecodeError";
    }
  }

  class RpcError extends Error {
    constructor(message, revert) {
      super(message);
      this.name = "RpcError";
      this.revert = Boolean(revert);
    }
  }

  function encodeGetRegistration(address) {
    if (!safe.isAddress(address)) throw new TypeError("invalid address");
    return GET_REGISTRATION + address.slice(2).toLowerCase().padStart(64, "0");
  }

  function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  function wordAt(data, byteOffset) {
    const start = byteOffset * 2;
    if (!Number.isSafeInteger(byteOffset) || byteOffset < 0 || start + 64 > data.length) {
      throw new DecodeError("read past end of data");
    }
    return data.slice(start, start + 64);
  }

  function smallInt(word, max, what) {
    const value = BigInt("0x" + word);
    if (value > BigInt(max)) throw new DecodeError(what + " out of range");
    return Number(value);
  }

  function addressFromWord(word) {
    if (!/^0{24}/.test(word)) throw new DecodeError("address has dirty upper bytes");
    return "0x" + word.slice(24);
  }

  function boolFromWord(word) {
    const value = smallInt(word, 1, "bool");
    return value === 1;
  }

  function stringAt(data, headBytes, offset) {
    if (offset < headBytes || offset % 32 !== 0) throw new DecodeError("bad string offset");
    const length = smallInt(wordAt(data, offset), MAX_STRING_BYTES, "string length");
    const start = (offset + 32) * 2;
    const end = start + length * 2;
    if (end > data.length) throw new DecodeError("string runs past end of data");
    return new TextDecoder("utf-8").decode(hexToBytes(data.slice(start, end)));
  }

  /**
   * Decode the result of getRegistration(address) from a v1 or v2 registry.
   * Returns a normalised record. `controlCurrent` is null for v1 (the contract
   * cannot tell; the caller must probe owner()) and `codeCurrent` is null for v1
   * (v1 does not record the code hash).
   */
  function decodeRegistration(version, resultHex) {
    if (version !== 1 && version !== 2) throw new TypeError("registry version must be 1 or 2");
    if (typeof resultHex !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(resultHex)) {
      throw new DecodeError("not hex data");
    }
    const data = resultHex.slice(2).toLowerCase();
    if (data.length === 0) throw new DecodeError("empty result (no registry deployed at this address?)");

    const headWords = version === 2 ? 8 : 6;
    const headBytes = headWords * 32;
    const word = (i) => wordAt(data, i * 32);

    const githubRepo = stringAt(data, headBytes, smallInt(word(0), 0xffffff, "offset"));
    const buildHash = stringAt(data, headBytes, smallInt(word(1), 0xffffff, "offset"));
    const signer = addressFromWord(word(2));
    const registeredAt = smallInt(word(3), Number.MAX_SAFE_INTEGER, "timestamp");
    const provenance = PROVENANCE[smallInt(word(4), PROVENANCE.length - 1, "provenance")];
    const flag5 = boolFromWord(word(5)); // v1: isVerified; v2: isControlProven

    if (version === 1) {
      return {
        registryVersion: 1,
        githubRepo,
        buildHash,
        signer,
        registeredAt,
        provenance,
        method: provenance === "CONTROL_PROVEN" ? "OWNER" : "NONE",
        controlCurrent: null,
        codeCurrent: null,
        v1Verified: flag5,
      };
    }

    const method = METHOD[smallInt(word(6), METHOD.length - 1, "method")];
    const flags = smallInt(word(7), 255, "flags");
    return {
      registryVersion: 2,
      githubRepo,
      buildHash,
      signer,
      registeredAt,
      provenance,
      method,
      controlCurrent: (flags & FLAG_CONTROL_CURRENT) !== 0,
      codeCurrent: (flags & FLAG_CODE_CURRENT) !== 0,
    };
  }

  async function ethCall(rpcUrl, to, data, fetchImpl, timeoutMs) {
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: net.timeoutSignal(timeoutMs),
    });
    if (!response.ok) throw new RpcError("RPC HTTP " + response.status, false);
    let body;
    try {
      body = JSON.parse(await net.readLimited(response, MAX_RPC_BYTES));
    } catch (error) {
      if (error && error.name === "TooLargeError") throw new RpcError("RPC response too large", false);
      throw new RpcError("RPC returned invalid JSON", false);
    }
    if (body && body.error) {
      const message = String(body.error.message || "RPC error").slice(0, 200);
      throw new RpcError(message, body.error.code === 3 || /revert/i.test(message));
    }
    if (!body || typeof body.result !== "string") throw new RpcError("RPC returned no result", false);
    return body.result;
  }

  /** Read one registry. Resolves to a record (possibly provenance NONE). */
  async function readRegistry(chain, registry, address, fetchImpl, timeoutMs) {
    const result = await ethCall(chain.rpcUrl, registry.address, encodeGetRegistration(address), fetchImpl, timeoutMs);
    const record = decodeRegistration(registry.version, result);
    return Object.assign(record, { registry: registry.address });
  }

  /**
   * v1 never re-checks ownership: its `isVerified` stays true after the owner
   * changes. Probe the target's owner() ourselves and compare with the signer.
   */
  async function v1ControlCurrent(chain, target, signer, fetchImpl, timeoutMs) {
    try {
      const result = await ethCall(chain.rpcUrl, target, OWNER, fetchImpl, timeoutMs);
      const data = result.slice(2).toLowerCase();
      if (data.length !== 64) return false;
      return addressFromWord(data) === signer.toLowerCase();
    } catch (error) {
      if (error && error.name === "RpcError" && error.revert) return false;
      throw error;
    }
  }

  return {
    GET_REGISTRATION,
    OWNER,
    DecodeError,
    RpcError,
    encodeGetRegistration,
    decodeRegistration,
    ethCall,
    readRegistry,
    v1ControlCurrent,
  };
});
