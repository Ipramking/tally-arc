// Shared test plumbing: load the browser libraries under Node, encode registry
// responses with viem (an independent implementation of the ABI), and fake the
// network.
const fs = require("node:fs");
const path = require("node:path");
const { parseAbi, encodeFunctionResult } = require("viem");

const root = path.join(__dirname, "..");
const lib = (name) => require(path.join(root, "lib", name));

const chains = require(path.join(root, "chains.generated.js"));
const arc = chains.chains.find((c) => c.key === "arc");

const vectors = (name) => JSON.parse(fs.readFileSync(path.join(root, "..", "test-vectors", name), "utf8"));

const abiV1 = parseAbi([
  "function getRegistration(address _target) view returns (string githubRepo, string buildHash, address owner, uint256 registeredAt, uint8 provenance, bool isVerified)",
]);
const abiV2 = parseAbi([
  "function getRegistration(address target) view returns (string githubRepo, string buildHash, address signer, uint256 registeredAt, uint8 provenance, bool isControlProven, uint8 method, uint8 flags)",
]);

const ZERO = "0x0000000000000000000000000000000000000000";
const ZERO_WORD = "0x" + "0".repeat(64);
const SIGNER ="0x1111111111111111111111111111111111111111";
const TARGET = "0x0f399C0143CAd70b43D18a5696026B0cEdcA0cCb";
const REPO = "https://github.com/acme/vault";

/** ABI-encode a v1 getRegistration result. prov: 0|1|2. */
function encodeV1({ repo = REPO, hash = "", owner = SIGNER, at = 1700000000n, prov = 2, verified = prov === 2 } = {}) {
  return encodeFunctionResult({ abi: abiV1, functionName: "getRegistration", result: [repo, hash, owner, BigInt(at), prov, verified] });
}

/** ABI-encode a v2 getRegistration result. flags: bit0 control, bit1 code. */
function encodeV2({ repo = REPO, hash = "", signer = SIGNER, at = 1700000000n, prov = 2, method = 1, flags = 3 } = {}) {
  return encodeFunctionResult({ abi: abiV2, functionName: "getRegistration", result: [repo, hash, signer, BigInt(at), prov, prov === 2 && flags === 3, method, flags] });
}

const word = (hexNoPrefix) => hexNoPrefix.padStart(64, "0");
const encodeAddressWord = (address) => "0x" + word(address.slice(2).toLowerCase());

/** An empty "nothing registered" answer, laid out the way the given registry version returns it. */
const encodeNone = (version) =>
  version === 1
    ? encodeV1({ repo: "", owner: ZERO, at: 0n, prov: 0 })
    : encodeV2({ repo: "", signer: ZERO, at: 0n, prov: 0, method: 0, flags: 0 });

/**
 * RPC answers for every registry the shipped chain table lists for `chain`: all "no record", except
 * those in `answers` (keyed by address, value = the getRegistration reply or an Error). Tests that
 * are not about registry order use this, so listing a newer registry in chains.json cannot break them.
 */
function registryRpc(chain, selector, answers = {}) {
  const given = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k.toLowerCase(), v]));
  const rpc = {};
  for (const { version, address } of chain.registries) {
    const key = address.toLowerCase();
    rpc[key] = { [selector]: key in given ? given[key] : encodeNone(version) };
  }
  return rpc;
}

/** The legacy v1 registry listed for a chain (lowercase), whatever else is listed above it. */
const v1Registry = (chain) => chain.registries.find((r) => r.version === 1).address.toLowerCase();

/** A Response-like object from text (uses the real Response class from Node). */
const textResponse = (body, init = {}) => new Response(body, { status: 200, ...init });

/**
 * Fake fetch. `handlers` is a function (url, init) => Response | Promise<Response> | throw.
 * Records every call in `.calls`.
 */
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls.length);
  };
  fn.calls = calls;
  return fn;
}

/**
 * A fake chain: routes JSON-RPC eth_call by (to, selector) and serves GitHub raw files.
 * rpc: { [toLower]: { [selector]: resultHex | Error | {error:{code,message}} } }
 * files: { [url]: string | number (status) | Error }
 */
function fakeWorld({ rpc = {}, files = {}, code = {}, storage = {} } = {}) {
  // eth_getCode: every address holds code unless a test says otherwise ("0x" = a wallet).
  const codeOf = Object.fromEntries(Object.entries(code).map(([k, v]) => [k.toLowerCase(), v]));
  // eth_getStorageAt: every slot is empty (not a proxy) unless a test says otherwise.
  // storage: { [addressLower]: { [slotLower]: wordHex | Error | {error:{code,message}} } }
  const storageOf = Object.fromEntries(Object.entries(storage).map(([k, v]) => [k.toLowerCase(), v]));
  return fakeFetch(async (url, init) => {
    if (url.startsWith("https://raw.githubusercontent.com/")) {
      const file = files[url];
      if (file instanceof Error) throw file;
      if (typeof file === "number") return new Response("", { status: file });
      if (file === undefined) return new Response("Not Found", { status: 404 });
      return textResponse(file);
    }
    const body = JSON.parse(init.body);
    if (body.method === "eth_getCode") {
      const reply = String(body.params[0]).toLowerCase() in codeOf ? codeOf[String(body.params[0]).toLowerCase()] : "0x6001";
      if (reply instanceof Error) throw reply;
      if (reply && reply.error) return Response.json({ jsonrpc: "2.0", id: 1, error: reply.error });
      return Response.json({ jsonrpc: "2.0", id: 1, result: reply });
    }
    if (body.method === "eth_getStorageAt") {
      const slots = storageOf[String(body.params[0]).toLowerCase()] || {};
      const slot = String(body.params[1]).toLowerCase();
      const reply = slot in slots ? slots[slot] : ZERO_WORD;
      if (reply instanceof Error) throw reply;
      if (reply && reply.error) return Response.json({ jsonrpc: "2.0", id: 1, error: reply.error });
      return Response.json({ jsonrpc: "2.0", id: 1, result: reply });
    }
    const { to, data } = body.params[0];
    const reply = (rpc[to.toLowerCase()] || {})[data.slice(0, 10)];
    if (reply instanceof Error) throw reply;
    if (reply === undefined) return Response.json({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted" } });
    if (reply && reply.error) return Response.json({ jsonrpc: "2.0", id: 1, error: reply.error });
    return Response.json({ jsonrpc: "2.0", id: 1, result: reply });
  });
}

const tallyJson = (...contracts) => JSON.stringify({ version: 1, contracts });

module.exports = {
  root, lib, chains, arc, vectors, ZERO, ZERO_WORD, SIGNER, TARGET, REPO,
  encodeV1, encodeV2, encodeNone, encodeAddressWord, registryRpc, v1Registry, textResponse, fakeFetch, fakeWorld, tallyJson,
};
