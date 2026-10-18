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
  // The freshness probe returns a whole block (transaction hashes only); allow for a busy one.
  const MAX_BATCH_BYTES = 256 * 1024;
  const DEFAULT_MAX_HEAD_AGE_SECONDS = 300;
  const DEFAULT_FRESHNESS_ATTEMPTS = 5;

  class DecodeError extends Error {
    constructor(message) {
      super(message);
      this.name = "DecodeError";
    }
  }

  class RpcError extends Error {
    constructor(message, revert, status) {
      super(message);
      this.name = "RpcError";
      this.revert = Boolean(revert);
      this.status = status;
    }
  }

  function describeAge(seconds) {
    if (seconds < 120) return seconds + " seconds";
    if (seconds < 7200) return Math.round(seconds / 60) + " minutes";
    return Math.round(seconds / 3600) + " hours";
  }

  /** The answering node is behind the chain. Not an answer about the contract: the lookup is "unavailable". */
  class StaleNodeError extends RpcError {
    constructor(ageSeconds) {
      super(
        "The network node is behind: its newest block is " + describeAge(ageSeconds) +
          " old, so its answer cannot be trusted. Try again shortly. If your device clock is wrong, this can be a false alarm.",
        false,
      );
      this.name = "StaleNodeError";
      this.ageSeconds = ageSeconds;
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
        upgradeable: null,
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
      upgradeable: null,
    };
  }

  async function postJson(rpcUrl, payload, limit, fetchImpl, timeoutMs) {
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: net.timeoutSignal(timeoutMs),
    });
    if (!response.ok) throw new RpcError("RPC HTTP " + response.status, false, response.status);
    try {
      return JSON.parse(await net.readLimited(response, limit));
    } catch (error) {
      if (error && error.name === "TooLargeError") throw new RpcError("RPC response too large", false);
      throw new RpcError("RPC returned invalid JSON", false);
    }
  }

  /** One JSON-RPC reply to its result (a hex string, or a block object for the probe), or the RpcError it stands for. */
  function unwrap(entry, wantBlock) {
    if (entry && entry.error) {
      const message = String(entry.error.message || "RPC error").slice(0, 200);
      throw new RpcError(message, entry.error.code === 3 || /revert/i.test(message));
    }
    const result = entry ? entry.result : undefined;
    const ok = wantBlock ? result !== null && typeof result === "object" : typeof result === "string";
    if (!ok) throw new RpcError("RPC returned no result", false);
    return result;
  }

  function blockTimestamp(block) {
    const stamp = block && typeof block === "object" ? block.timestamp : undefined;
    if (typeof stamp !== "string" || !/^0x[0-9a-fA-F]{1,16}$/.test(stamp)) throw new RpcError("RPC returned a malformed block", false);
    const seconds = Number(BigInt(stamp));
    if (!Number.isSafeInteger(seconds)) throw new RpcError("RPC returned a malformed block", false);
    return seconds;
  }

  // Endpoints that refuse batch requests: the check then runs as two requests (weaker, since they can reach
  // different nodes, but still better than none).
  const batchRefused = new Set();

  async function plain(rpcUrl, method, params, fetchImpl, timeoutMs, limit, wantBlock) {
    return unwrap(await postJson(rpcUrl, { jsonrpc: "2.0", id: 1, method, params }, limit, fetchImpl, timeoutMs), wantBlock);
  }

  async function readWithHead(rpcUrl, method, params, fetchImpl, timeoutMs) {
    if (!batchRefused.has(rpcUrl)) {
      let body;
      try {
        body = await postJson(
          rpcUrl,
          [
            { jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["latest", false] },
            { jsonrpc: "2.0", id: 2, method, params },
          ],
          MAX_BATCH_BYTES,
          fetchImpl,
          timeoutMs,
        );
      } catch (error) {
        if (!(error instanceof RpcError && (error.status === 400 || error.status === 405 || error.status === 413))) throw error;
        body = null;
      }
      if (Array.isArray(body)) {
        const head = body.find((e) => e && e.id === 1);
        const entry = body.find((e) => e && e.id === 2);
        if (!head || !entry) throw new RpcError("RPC returned a malformed batch", false);
        return { head: blockTimestamp(unwrap(head, true)), entry };
      }
      batchRefused.add(rpcUrl); // a non-array answer (or HTTP 400/405/413) means batching is not supported here
    }
    const head = blockTimestamp(await plain(rpcUrl, "eth_getBlockByNumber", ["latest", false], fetchImpl, timeoutMs, MAX_BATCH_BYTES, true));
    let entry;
    try {
      entry = { result: await plain(rpcUrl, method, params, fetchImpl, timeoutMs, MAX_RPC_BYTES, false) };
    } catch (error) {
      if (!(error instanceof RpcError)) throw error;
      entry = { error: { code: error.revert ? 3 : -32000, message: error.message } };
    }
    return { head, entry };
  }

  /**
   * One read. `guard` = { maxHeadAgeSeconds, attempts, nowMs } (all optional; maxHeadAgeSeconds 0 turns the
   * freshness check off). The read travels with a "latest block" probe in one batch, so one node answers
   * both; a node whose newest block is too old is retried, then refused.
   */
  async function rpc(rpcUrl, method, params, fetchImpl, timeoutMs, guard) {
    const g = guard || {};
    const maxAge = g.maxHeadAgeSeconds === undefined || g.maxHeadAgeSeconds === null ? DEFAULT_MAX_HEAD_AGE_SECONDS : g.maxHeadAgeSeconds;
    if (maxAge <= 0) return plain(rpcUrl, method, params, fetchImpl, timeoutMs, MAX_RPC_BYTES, false);
    const attempts = Math.max(1, g.attempts || DEFAULT_FRESHNESS_ATTEMPTS);
    let stale = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const { head, entry } = await readWithHead(rpcUrl, method, params, fetchImpl, timeoutMs);
      const age = Math.round((typeof g.nowMs === "function" ? g.nowMs() : Date.now()) / 1000 - head);
      // The answer is judged only after the node proves it is current: a stale node's "reverted" or
      // "no record" is not an answer about the chain.
      if (age > maxAge) {
        stale = new StaleNodeError(age);
        continue;
      }
      return unwrap(entry, false);
    }
    throw stale;
  }

  /** The guard for one chain: the caller's settings, then the chain's own limit. */
  function guardFor(chain, guard) {
    const g = guard || {};
    return {
      maxHeadAgeSeconds: g.maxHeadAgeSeconds !== undefined && g.maxHeadAgeSeconds !== null ? g.maxHeadAgeSeconds : chain && chain.maxHeadAgeSeconds,
      attempts: g.attempts,
      nowMs: g.nowMs,
    };
  }

  function ethCall(rpcUrl, to, data, fetchImpl, timeoutMs, guard) {
    return rpc(rpcUrl, "eth_call", [{ to, data }, "latest"], fetchImpl, timeoutMs, guard);
  }

  /**
   * Does `address` hold contract code? An empty answer ("0x") is a wallet (an
   * externally owned account). Only the length matters, never the bytes.
   */
  async function hasCode(rpcUrl, address, fetchImpl, timeoutMs, guard) {
    const code = await rpc(rpcUrl, "eth_getCode", [address, "latest"], fetchImpl, timeoutMs, guard);
    if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(code)) throw new RpcError("RPC returned malformed code", false);
    return code.length > 2;
  }

  /** Read one registry. Resolves to a record (possibly provenance NONE). */
  async function readRegistry(chain, registry, address, fetchImpl, timeoutMs, guard) {
    const result = await ethCall(chain.rpcUrl, registry.address, encodeGetRegistration(address), fetchImpl, timeoutMs, guardFor(chain, guard));
    const record = decodeRegistration(registry.version, result);
    return Object.assign(record, { registry: registry.address });
  }

  /**
   * v1 never re-checks ownership: its `isVerified` stays true after the owner
   * changes. Probe the target's owner() ourselves and compare with the signer.
   */
  async function v1ControlCurrent(chain, target, signer, fetchImpl, timeoutMs, guard) {
    try {
      const result = await ethCall(chain.rpcUrl, target, OWNER, fetchImpl, timeoutMs, guardFor(chain, guard));
      const data = result.slice(2).toLowerCase();
      if (data.length !== 64) return false;
      return addressFromWord(data) === signer.toLowerCase();
    } catch (error) {
      if (error && error.name === "RpcError" && error.revert) return false;
      throw error;
    }
  }

  /**
   * The owner a contract names right now (lowercase), or null when it names none: no owner(), a
   * revert, an answer that is not one address word, or the zero address. This is the registry's own
   * reading of owner() (TallyRegistryV2._ownerOf). A network failure throws, never reads as "none".
   */
  async function readOwner(chain, target, fetchImpl, timeoutMs, guard) {
    try {
      const result = await ethCall(chain.rpcUrl, target, OWNER, fetchImpl, timeoutMs, guardFor(chain, guard));
      const data = result.slice(2).toLowerCase();
      if (data.length !== 64 || !/^0{24}/.test(data) || /^0+$/.test(data)) return null;
      return "0x" + data.slice(24);
    } catch (error) {
      if (error && error.name === "RpcError" && error.revert) return null;
      throw error;
    }
  }

  // bytes32(uint256(keccak256("eip1967.proxy.<name>")) - 1); pinned by test-vectors/proxy-slots.json.
  const EIP1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const EIP1967_BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
  const EMPTY_WORD = "0x" + "0".repeat(64);

  /** One storage slot as a lowercase 64-digit word (some nodes drop leading zeros). */
  async function getStorageAt(rpcUrl, address, slot, fetchImpl, timeoutMs, guard) {
    const value = await rpc(rpcUrl, "eth_getStorageAt", [address, slot, "latest"], fetchImpl, timeoutMs, guard);
    if (!/^0x[0-9a-fA-F]{1,64}$/.test(value)) throw new RpcError("RPC returned malformed storage", false);
    return "0x" + value.slice(2).toLowerCase().padStart(64, "0");
  }

  /**
   * Is the target an upgradeable proxy? A proxy's bytecode never changes when its implementation is
   * swapped, so the registry's code-hash check cannot see an upgrade and Tally never shows a proxy as
   * "verified". Detected: EIP-1967 implementation proxies (transparent, UUPS) and beacon proxies.
   * Not detected: diamonds and hand-rolled proxies. A failed read throws: it must never default to "no".
   */
  async function isUpgradeableProxy(chain, target, fetchImpl, timeoutMs, guard) {
    const g = guardFor(chain, guard);
    const [implementation, beacon] = await Promise.all([
      getStorageAt(chain.rpcUrl, target, EIP1967_IMPLEMENTATION_SLOT, fetchImpl, timeoutMs, g),
      getStorageAt(chain.rpcUrl, target, EIP1967_BEACON_SLOT, fetchImpl, timeoutMs, g),
    ]);
    return implementation !== EMPTY_WORD || beacon !== EMPTY_WORD;
  }

  return {
    GET_REGISTRATION,
    OWNER,
    EIP1967_IMPLEMENTATION_SLOT,
    EIP1967_BEACON_SLOT,
    DEFAULT_MAX_HEAD_AGE_SECONDS,
    DecodeError,
    RpcError,
    StaleNodeError,
    encodeGetRegistration,
    decodeRegistration,
    ethCall,
    hasCode,
    readRegistry,
    v1ControlCurrent,
    readOwner,
    getStorageAt,
    isUpgradeableProxy,
  };
});
