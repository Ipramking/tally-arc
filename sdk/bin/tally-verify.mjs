#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const { main } = createRequire(import.meta.url)("../cli.js");

process.exitCode = await main(process.argv.slice(2), process.env, {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readFile: (path) => readFileSync(path, "utf8"),
  appendFile: (path, text) => appendFileSync(path, text),
  fetchImpl: globalThis.fetch,
});
