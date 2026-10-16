"use strict";
// Where the shared lookup code lives. Published, the package carries its own copy in ./lib and ./chains.js
// (scripts/build.mjs copies them from the extension at pack time). Inside this repository, and when the
// GitHub Action runs from a checkout of it, they are read straight from the extension, so there is one copy.
const fs = require("node:fs");
const path = require("node:path");

const packedLib = path.join(__dirname, "lib");
const packedChains = path.join(__dirname, "chains.js");

const LIB = fs.existsSync(path.join(packedLib, "lookup.js")) ? packedLib : path.join(__dirname, "..", "extension", "lib");
const CHAINS = fs.existsSync(packedChains) ? packedChains : path.join(__dirname, "..", "extension", "chains.generated.js");

module.exports = { LIB, CHAINS };
