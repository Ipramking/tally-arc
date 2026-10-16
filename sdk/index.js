"use strict";
// Public entry point. Everything here is the same code the studio's rules are tested against: the lookup,
// the level wording, and the CI check.
const path = require("node:path");
const { LIB, CHAINS } = require("./paths");
const { verifyTallyFile, exitCodeFor } = require("./verify.js");

const lookupLib = require(path.join(LIB, "lookup.js"));
const status = require(path.join(LIB, "status.js"));
const table = require(CHAINS);

/** Find a chain in a table by key ("my-chain") or by chain id (12345 or "12345"). */
function getChain(keyOrId, chains = table.chains) {
  const wanted = String(keyOrId);
  return chains.find((chain) => chain.key === wanted || String(chain.id) === wanted) ?? null;
}

/** lookup() with the defaults the types promise: the global fetch and a 15 second timeout. */
function lookup(options) {
  return lookupLib.lookup({ ...options, fetchImpl: options.fetchImpl ?? globalThis.fetch, timeoutMs: options.timeoutMs ?? 15000 });
}

module.exports = {
  /** lookup({ chain, address, fetchImpl?, timeoutMs? }) -> { ok, level, registration, repo, repoLink } | { ok: false, level: "unknown", error } */
  lookup,
  /** One plain sentence for a level. */
  describe: status.describe,
  /** Fixed wording for every level: { label, short }. */
  LEVELS: status.LEVELS,
  /** The chains bundled with this version. Pass your own chain object to lookup() for any other EVM network. */
  chains: table.chains,
  defaultChain: table.defaultChain,
  studioUrl: table.studioUrl,
  getChain,
  verifyTallyFile,
  exitCodeFor,
};
