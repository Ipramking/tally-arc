#!/usr/bin/env node
// Keeps the code chain-neutral. No network is special-cased in source: every network fact
// (name, id, RPC, explorer, registry, gas token) lives in chains.json and in the files generated
// from it. Documentation and tests may name networks; code may not.
//
//   node scripts/check-neutral.mjs     exit 1 if a source file names a specific network (run by CI and `npm test`)

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const FORBIDDEN = [
  [/\barc\b/i, "names a specific network"],
  [/\b5042(002)?\b/, "hard-codes a specific chain id"],
  [/\bUSDC\b/, "hard-codes a specific gas token"],
  [/\bCircle\b/, "names a specific network operator"],
];

// This repository's own name is a fact about the project, not a network.
const ALLOWED_FRAGMENTS = [/Ipramking\/tally-arc/g];

const SCANNED = /\.(mjs|js|ts|tsx|json|yml|yaml|html)$/;
const SKIPPED = [
  /^chains\.json$/, // the data
  /^tally\.json$/, // this repository's own provenance file
  /(^|\/)chains\.generated\./, // generated from the data
  /^docs\//, // documentation may name networks
  /(^|\/)test\//, // fixtures name real networks on purpose
  /^test-vectors\//,
  /package-lock\.json$/,
  /^extension\/manifest\.json$/, // its host lists are generated from the data
  /^scripts\/check-neutral\.mjs$/, // this file lists what it forbids
];

const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
const problems = [];
let scanned = 0;

for (const file of files) {
  if (!SCANNED.test(file) || SKIPPED.some((pattern) => pattern.test(file))) continue;
  scanned++;
  readFileSync(join(root, file), "utf8")
    .split(/\r?\n/)
    .forEach((line, index) => {
      const text = ALLOWED_FRAGMENTS.reduce((acc, pattern) => acc.replace(pattern, ""), line);
      for (const [pattern, what] of FORBIDDEN) {
        if (pattern.test(text)) problems.push(`${file}:${index + 1}: ${what}: ${line.trim().slice(0, 110)}`);
      }
    });
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} place(s) special-case a network. Move the fact into chains.json, or reword it.`);
  process.exit(1);
}
console.log(`ok       no network is special-cased in ${scanned} source files`);
