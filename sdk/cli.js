"use strict";
// The tally-verify command. All input and output goes through `io`, so it can be tested without a terminal,
// a file system or a network.
const path = require("node:path");
const { parseArgs } = require("node:util");
const { CHAINS } = require("./paths");
const { verifyTallyFile, exitCodeFor } = require("./verify.js");

const USAGE = `Usage: tally-verify [options]

Checks that every contract listed in a repository's tally.json has an on-chain Tally record that
names this repository and the listed wallet, and that the record still holds (control not moved,
code unchanged).

Options:
  --file <path>        the tally.json to check (default: ./tally.json)
  --repository <o/n>   the repository the records must name (default: $GITHUB_REPOSITORY; "none" skips the check)
  --chains <path>      a chain table for networks the bundled one lacks (chains.json format, or an array); merged by chain id
  --strict             count warnings (proxy, legacy registry, self-attested) as failures
  --json               print the result as JSON
  --timeout <ms>       per-request timeout (default 15000)
  -h, --help           show this help

Exit code: 0 all good, 1 a record and the file disagree, 2 something could not be checked.`;

const short = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "");

function loadChains(customText) {
  const bundled = require(CHAINS);
  const byId = new Map(bundled.chains.map((chain) => [chain.id, chain]));
  if (customText === undefined) return { chains: [...byId.values()], studioUrl: bundled.studioUrl };

  let parsed;
  try {
    parsed = JSON.parse(customText);
  } catch {
    throw new Error("the --chains file is not valid JSON");
  }
  const list = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.chains) ? parsed.chains : null;
  if (!list) throw new Error('the --chains file must be an array of chains or { "chains": [ ... ] }');
  for (const chain of list) {
    const where = `chain ${JSON.stringify(chain && chain.key)}`;
    if (!chain || typeof chain !== "object" || !Number.isSafeInteger(chain.id) || chain.id <= 0) throw new Error(`${where}: id must be a positive integer`);
    if (typeof chain.key !== "string" || typeof chain.name !== "string") throw new Error(`${where}: key and name are required`);
    let url;
    try {
      url = new URL(chain.rpcUrl);
    } catch {
      throw new Error(`${where}: rpcUrl is not a URL`);
    }
    if (url.protocol !== "https:" || url.username || url.password) throw new Error(`${where}: rpcUrl must be https without credentials`);
    if (!Array.isArray(chain.registries)) throw new Error(`${where}: registries must be an array`);
    for (const registry of chain.registries) {
      if (![1, 2].includes(registry.version) || !/^0x[0-9a-fA-F]{40}$/.test(registry.address || "")) throw new Error(`${where}: bad registry ${JSON.stringify(registry)}`);
    }
    byId.set(chain.id, chain);
  }
  return { chains: [...byId.values()], studioUrl: (!Array.isArray(parsed) && parsed.studioUrl) || bundled.studioUrl };
}

// GitHub workflow commands: data and property values must be escaped.
const escapeData = (value) => String(value).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (value) => escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");

function render(summary, file) {
  const out = [];
  const tag = { ok: "ok    ", warning: "warn  ", error: "FAIL  ", unknown: "????? " };
  for (const r of summary.results) {
    const what = r.address ? `${(r.chain || `chain ${r.chainId}`).padEnd(12)} ${short(r.address)}` : `entry ${r.index}`;
    out.push(`${tag[r.status]} ${what}  ${r.level ?? ""}`.trimEnd());
    for (const p of r.problems) out.push(`         - ${p.message}`);
  }
  const checked = summary.results.length;
  const ok = summary.results.filter((r) => r.status === "ok").length;
  out.push("", `${checked} checked: ${ok} ok, ${summary.warnings} with warnings, ${summary.errors} failing, ${summary.unknown} could not be checked`);
  return out.join("\n");
}

function annotations(summary, file) {
  const lines = [];
  for (const r of summary.results) {
    for (const p of r.problems) {
      const command = p.severity === "warning" ? "warning" : "error";
      const title = r.address ? `Tally ${r.chain || r.chainId} ${short(r.address)}` : "Tally";
      lines.push(`::${command} file=${escapeProperty(file)},title=${escapeProperty(title)}::${escapeData(p.message)}`);
    }
  }
  return lines;
}

function markdown(summary) {
  const icon = { ok: "ok", warning: "warning", error: "**failing**", unknown: "could not check" };
  const rows = summary.results.map((r) => {
    const detail = r.problems.map((p) => p.message.replace(/\|/g, "\\|")).join("<br>") || "";
    return `| ${r.chain || r.chainId || ""} | \`${r.address || ""}\` | ${r.level ?? ""} | ${icon[r.status]} | ${detail} |`;
  });
  return ["## Tally records", "", "| Network | Contract | Level | Result | Details |", "|---|---|---|---|---|", ...rows, ""].join("\n");
}

/**
 * @param {string[]} argv arguments after the command name
 * @param {Record<string, string|undefined>} env
 * @param {{stdout(text: string): void, stderr(text: string): void, readFile(path: string): string, appendFile(path: string, text: string): void, fetchImpl?: typeof fetch}} io
 * @returns {Promise<number>} the exit code
 */
async function main(argv, env, io) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        file: { type: "string" },
        repository: { type: "string" },
        chains: { type: "string" },
        strict: { type: "boolean" },
        json: { type: "boolean" },
        timeout: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    }).values;
  } catch (error) {
    io.stderr(`tally-verify: ${error.message}\n\n${USAGE}\n`);
    return 1;
  }
  if (args.help) {
    io.stdout(`${USAGE}\n`);
    return 0;
  }

  const timeoutMs = args.timeout === undefined ? 15000 : Number(args.timeout);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) {
    io.stderr("tally-verify: --timeout must be a whole number of milliseconds between 100 and 120000\n");
    return 1;
  }

  const file = args.file || "tally.json";
  let tally;
  try {
    tally = JSON.parse(io.readFile(path.resolve(file)));
  } catch (error) {
    io.stderr(`tally-verify: cannot read ${file} as JSON: ${error.message}\n`);
    return 1;
  }

  let table;
  try {
    table = loadChains(args.chains === undefined ? undefined : io.readFile(path.resolve(args.chains)));
  } catch (error) {
    io.stderr(`tally-verify: ${error.message}\n`);
    return 1;
  }

  const wanted = args.repository ?? env.GITHUB_REPOSITORY;
  const repository = !wanted || wanted === "none" ? undefined : wanted;
  if (repository !== undefined && !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repository)) {
    io.stderr(`tally-verify: --repository must look like owner/name, got ${JSON.stringify(repository)}\n`);
    return 1;
  }

  const summary = await verifyTallyFile({ tally, chains: table.chains, repository, fetchImpl: io.fetchImpl, timeoutMs, studioUrl: table.studioUrl });
  const code = exitCodeFor(summary, { strict: Boolean(args.strict) });

  if (args.json) {
    io.stdout(`${JSON.stringify({ ...summary, exitCode: code }, null, 2)}\n`);
  } else {
    const note = repository ? `records must name ${repository}` : "not checking which repository the records name (set --repository or GITHUB_REPOSITORY)";
    io.stdout(`tally-verify: ${file}; ${note}\n\n${render(summary, file)}\n`);
  }
  if (env.GITHUB_ACTIONS === "true") for (const line of annotations(summary, file)) io.stdout(`${line}\n`);
  if (env.GITHUB_STEP_SUMMARY) {
    try {
      io.appendFile(env.GITHUB_STEP_SUMMARY, `${markdown(summary)}\n`);
    } catch {
      // the summary is a courtesy; never fail the check over it
    }
  }
  return code;
}

module.exports = { main, loadChains, USAGE };
