"use strict";
// Compares a repository's tally.json with the chain. This is the check a CI job runs: every contract the
// repository lists must have an on-chain record that names this repository and the listed wallet, and the
// record must still hold (control not moved, code unchanged).
//
// The repository half of the rule is judged here against the file in hand, not fetched from GitHub, so a pull
// request that edits tally.json is checked with its own edit. The on-chain half is the same lookup the studio and
// the extension run.
const path = require("node:path");
const { LIB } = require("./paths");

const lookupLib = require(path.join(LIB, "lookup.js"));
const repoProof = require(path.join(LIB, "repo-proof.js"));
const status = require(path.join(LIB, "status.js"));
const safe = require(path.join(LIB, "safe-url.js"));

const MAX_ENTRIES = 1000;

const problem = (severity, code, message) => ({ severity, code, message });
const short = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;

function finalize(result) {
  const severities = result.problems.map((p) => p.severity);
  result.status = severities.includes("error") ? "error" : severities.includes("unknown") ? "unknown" : severities.includes("warning") ? "warning" : "ok";
  return result;
}

function summarize(results) {
  const count = (s) => results.filter((r) => r.status === s).length;
  const errors = count("error");
  const unknown = count("unknown");
  const warnings = count("warning");
  return { ok: errors === 0 && unknown === 0, errors, unknown, warnings, results };
}

async function checkEntry(entry, index, context) {
  const { tally, chains, repository, fetchImpl, timeoutMs, studioUrl } = context;
  const result = {
    index,
    chainId: entry && typeof entry === "object" ? entry.chainId : undefined,
    address: entry && typeof entry === "object" ? entry.address : undefined,
    signer: entry && typeof entry.signer === "string" ? entry.signer : null,
    chain: null,
    level: null,
    problems: [],
  };

  if (!entry || typeof entry !== "object" || !Number.isSafeInteger(entry.chainId) || !safe.isAddress(entry.address)) {
    result.problems.push(problem("error", "invalid-entry", "an entry needs a numeric chainId and a 0x contract address"));
    return finalize(result);
  }
  if (entry.signer !== undefined && entry.signer !== null && !(typeof entry.signer === "string" && safe.isAddress(entry.signer))) {
    result.problems.push(problem("error", "invalid-signer", "signer must be a 0x wallet address"));
    return finalize(result);
  }

  const chain = chains.find((c) => c.id === entry.chainId);
  if (!chain) {
    result.problems.push(problem("error", "unknown-chain", `chain id ${entry.chainId} is not in the chain table; pass one that lists it with --chains`));
    return finalize(result);
  }
  result.chain = chain.key;
  if (!chain.registries.length) {
    result.problems.push(problem("error", "no-registry", `no registry is deployed on ${chain.name}, so nothing can be registered or checked there`));
    return finalize(result);
  }

  const looked = await lookupLib.lookup({
    chain,
    address: entry.address,
    fetchImpl,
    timeoutMs,
    repoCheck: async (record) => ({
      ...repoProof.judgeEntries(repoProof.matchEntries(tally.contracts, chain.id, entry.address), record.signer),
      url: "tally.json",
    }),
  });

  if (!looked.ok) {
    result.level = "unknown";
    result.problems.push(problem("unknown", "unreadable", `could not read ${chain.name}: ${looked.error}`));
    return finalize(result);
  }

  result.level = looked.level;
  const record = looked.registration;

  if (!record) {
    if (looked.level === "wallet") {
      result.problems.push(problem("error", "not-a-contract", `${short(entry.address)} holds no contract code on ${chain.name}; it is a wallet, so there is nothing to register`));
    } else {
      const where = studioUrl ? ` Register it at ${studioUrl}/register?address=${entry.address}&chain=${chain.key}` : "";
      result.problems.push(problem("error", "not-registered", `no registry on ${chain.name} has a record for this contract.${where}`));
    }
    return finalize(result);
  }

  result.record = { registry: record.registry, registryVersion: record.registryVersion, signer: record.signer, method: record.method };

  // The on-chain record must name this repository, not someone else's.
  if (repository) {
    const parsed = safe.parseGithubRepo(record.githubRepo);
    const named = parsed ? `${parsed.owner}/${parsed.repo}` : null;
    if (!named || named.toLowerCase() !== repository.toLowerCase()) {
      result.problems.push(
        problem("error", "other-repository", `the on-chain record names ${named ?? "a repository that is not a plain GitHub link"}, not ${repository}; register it again naming this repository`),
      );
    }
  }

  // The repository must name the wallet that registered.
  if (looked.repo && looked.repo.status === "signer-mismatch") {
    const named = looked.repo.named ? ` (it names ${short(looked.repo.named)})` : "";
    result.problems.push(problem("error", "signer-mismatch", `tally.json names a different wallet than the one that registered${named}; the record was signed by ${record.signer}`));
  } else if (looked.repo && looked.repo.status === "confirmed" && looked.repo.bound !== true) {
    result.problems.push(problem("error", "signer-missing", `tally.json lists this contract without a signer, so it cannot be verified; add "signer": "${record.signer}"`));
  }

  switch (looked.level) {
    case "verified":
      break;
    case "stale":
      result.problems.push(
        problem(
          "error",
          "stale",
          record.codeCurrent === false
            ? "the code at this address changed after it was registered (an upgrade or a redeploy); register it again"
            : "control moved: the signer no longer controls the contract (a deployer's record goes stale once another owner exists); the new controller must register it",
        ),
      );
      break;
    case "self-attested":
      result.problems.push(problem("warning", "self-attested", "the record carries no on-chain proof of control, so it can never be verified"));
      break;
    case "control-proven":
      if (record.upgradeable === true) {
        result.problems.push(problem("warning", "proxy", "the contract is an upgradeable proxy: its code hash does not change when its implementation does, so it stops at control proven"));
      } else if (record.registryVersion === 1) {
        result.problems.push(problem("warning", "legacy-registry", "the record is on the legacy v1 registry, which cannot see code changes; register it again on v2 to be verified"));
      } else if (!result.problems.length) {
        result.problems.push(problem("warning", "not-verified", status.describe(looked.level, record, looked.repo)));
      }
      break;
    default:
      break;
  }

  return finalize(result);
}

/**
 * @param {object} options
 * @param {unknown} options.tally parsed tally.json
 * @param {object[]} options.chains the chain table (see the bundled one in ./chains.js)
 * @param {string} [options.repository] "owner/name" the records must name; omit to skip that check
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.timeoutMs]
 * @param {string} [options.studioUrl] used to build "register it here" links
 * @returns {Promise<{ok: boolean, errors: number, unknown: number, warnings: number, results: object[]}>}
 */
async function verifyTallyFile(options) {
  const { tally, chains, repository, fetchImpl = globalThis.fetch, timeoutMs = 15000, studioUrl } = options;
  if (!tally || typeof tally !== "object" || tally.version !== 1 || !Array.isArray(tally.contracts)) {
    return summarize([
      finalize({
        index: -1,
        chainId: undefined,
        address: undefined,
        signer: null,
        chain: null,
        level: null,
        problems: [problem("error", "invalid-file", 'tally.json must look like { "version": 1, "contracts": [ { "chainId": 1, "address": "0x...", "signer": "0x..." } ] }')],
      }),
    ]);
  }

  const results = [];
  const entries = tally.contracts.slice(0, MAX_ENTRIES);
  for (let index = 0; index < entries.length; index++) {
    results.push(await checkEntry(entries[index], index, { tally, chains, repository, fetchImpl, timeoutMs, studioUrl }));
  }
  return summarize(results);
}

/** 0 all good, 1 a record and the file disagree, 2 something could not be checked. `strict` makes warnings count as 1. */
function exitCodeFor(summary, { strict = false } = {}) {
  if (summary.errors > 0) return 1;
  if (summary.unknown > 0) return 2;
  if (strict && summary.warnings > 0) return 1;
  return 0;
}

module.exports = { verifyTallyFile, exitCodeFor, MAX_ENTRIES };
