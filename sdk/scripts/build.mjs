#!/usr/bin/env node
// Copies the shared lookup code into the package so it is self-contained when published:
//   ../extension/lib/*.js            -> lib/
//   ../extension/chains.generated.js -> chains.js
//   ../LICENSE                       -> LICENSE
// The extension stays the single source. `npm pack` runs this (prepack) and then removes the copies
// (postpack, --clean), so a working tree never carries a stale copy that would shadow the extension.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const extension = join(here, "..", "extension");
const generated = [join(here, "lib"), join(here, "chains.js"), join(here, "LICENSE")];

for (const path of generated) rmSync(path, { recursive: true, force: true });
if (process.argv.includes("--clean")) process.exit(0);

if (!existsSync(join(extension, "lib"))) {
  console.error("sdk/scripts/build.mjs: ../extension/lib not found; run this from a checkout of the repository");
  process.exit(1);
}
mkdirSync(join(here, "lib"));
let copied = 0;
for (const name of readdirSync(join(extension, "lib"))) {
  if (!name.endsWith(".js")) continue;
  copyFileSync(join(extension, "lib", name), join(here, "lib", name));
  copied++;
}
copyFileSync(join(extension, "chains.generated.js"), join(here, "chains.js"));
copyFileSync(join(here, "..", "LICENSE"), join(here, "LICENSE"));
console.log(`copied ${copied} library files, the chain table and the licence into the package`);
