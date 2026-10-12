#!/usr/bin/env node
// Generates every chain-dependent file from the single source of truth, chains.json.
//
//   node scripts/sync-chains.mjs           write the generated files
//   node scripts/sync-chains.mjs --check   exit 1 if any generated file is out of date (CI)
//
// Generated:
//   studio/lib/chains.generated.ts     typed chain table for the Next.js studio
//   extension/chains.generated.js      chain table for the browser extension
//   extension/manifest.json            ONLY content_scripts[0].matches and host_permissions
//
// Hardhat reads chains.json directly, so it needs no generated file.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Extra origins the extension's service worker fetches besides the RPCs: the
// repository's tally.json.
const EXTRA_HOSTS = ["https://raw.githubusercontent.com/*"];

function fail(message) {
  console.error(`chains.json: ${message}`);
  process.exit(1);
}

function httpsOrigin(value, what, { pathAllowed }) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${what} is not a valid URL: ${JSON.stringify(value)}`);
  }
  if (url.protocol !== "https:") fail(`${what} must use https: ${value}`);
  if (url.username || url.password) fail(`${what} must not embed credentials`);
  if (url.search || url.hash) fail(`${what} must not have a query or fragment`);
  if (!pathAllowed && (url.pathname !== "/" || value.endsWith("/"))) {
    fail(`${what} must be a bare origin without a path or trailing slash: ${value}`);
  }
  return url;
}

function validate(config) {
  if (typeof config !== "object" || config === null) fail("top level must be an object");
  httpsOrigin(config.studioUrl, "studioUrl", { pathAllowed: false });
  if (!Array.isArray(config.chains) || config.chains.length === 0) fail("chains must be a non-empty array");

  const keys = new Set();
  const ids = new Set();
  const origins = new Set();
  for (const chain of config.chains) {
    const where = `chain "${chain?.key}"`;
    if (!KEY.test(chain?.key ?? "")) fail(`${where}: key must be lowercase letters, digits and dashes`);
    if (keys.has(chain.key)) fail(`duplicate key "${chain.key}"`);
    keys.add(chain.key);
    if (!Number.isSafeInteger(chain.id) || chain.id <= 0) fail(`${where}: id must be a positive integer`);
    if (ids.has(chain.id)) fail(`duplicate chain id ${chain.id}`);
    ids.add(chain.id);
    if (typeof chain.name !== "string" || !chain.name) fail(`${where}: name is required`);
    if (typeof chain.testnet !== "boolean") fail(`${where}: testnet must be a boolean`);
    const cur = chain.nativeCurrency;
    if (!cur || typeof cur.name !== "string" || typeof cur.symbol !== "string" || !Number.isInteger(cur.decimals) || cur.decimals < 0 || cur.decimals > 36) {
      fail(`${where}: nativeCurrency needs name, symbol and integer decimals`);
    }
    httpsOrigin(chain.rpcUrl, `${where}: rpcUrl`, { pathAllowed: true });
    if (typeof chain.explorer?.name !== "string") fail(`${where}: explorer.name is required`);
    const explorerOrigin = httpsOrigin(chain.explorer.url, `${where}: explorer.url`, { pathAllowed: false }).origin;
    // Two chains sharing an explorer origin would make the extension's
    // hostname -> chain lookup ambiguous.
    if (origins.has(explorerOrigin)) fail(`${where}: explorer ${explorerOrigin} is already used by another chain`);
    origins.add(explorerOrigin);
    if (!Array.isArray(chain.registries)) fail(`${where}: registries must be an array`);
    for (const registry of chain.registries) {
      if (![1, 2].includes(registry.version)) fail(`${where}: registry version must be 1 or 2`);
      if (!ADDRESS.test(registry.address ?? "")) fail(`${where}: bad registry address ${registry.address}`);
    }
    const presets = chain.presets ?? {};
    for (const [name, address] of Object.entries(presets)) {
      if (!["verified", "unverified"].includes(name)) fail(`${where}: unknown preset "${name}"`);
      if (!ADDRESS.test(address)) fail(`${where}: bad preset address ${address}`);
    }
  }
  if (!keys.has(config.defaultChain)) fail(`defaultChain "${config.defaultChain}" is not in chains`);
}

/** Stable JSON: 2-space indent, arrays of strings inline when short. */
function formatJson(value, indent = "") {
  const next = indent + "  ";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every((item) => typeof item !== "object" || item === null)) {
      const inline = `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
      if (indent.length + inline.length <= 78) return inline;
    }
    return `[\n${value.map((item) => next + formatJson(item, next)).join(",\n")}\n${indent}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    return `{\n${entries.map(([k, v]) => `${next}${JSON.stringify(k)}: ${formatJson(v, next)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

function normalize(config) {
  return {
    studioUrl: config.studioUrl,
    defaultChain: config.defaultChain,
    chains: config.chains.map((chain) => ({
      key: chain.key,
      id: chain.id,
      name: chain.name,
      testnet: chain.testnet,
      nativeCurrency: { name: chain.nativeCurrency.name, symbol: chain.nativeCurrency.symbol, decimals: chain.nativeCurrency.decimals },
      rpcUrl: chain.rpcUrl,
      explorer: { name: chain.explorer.name, url: chain.explorer.url },
      registries: chain.registries.map((r) => ({ version: r.version, address: r.address })),
      presets: { ...(chain.presets ?? {}) },
    })),
  };
}

const BANNER = "GENERATED by scripts/sync-chains.mjs from chains.json. Do not edit by hand; run `npm run chains:sync`.";

function renderStudio(data) {
  const chains = formatJson(data.chains, "");
  return `// ${BANNER}

export type RegistryVersion = 1 | 2;

export interface RegistryDef {
  readonly version: RegistryVersion;
  readonly address: \`0x\${string}\`;
}

export interface ChainDef {
  readonly key: string;
  readonly id: number;
  readonly name: string;
  readonly testnet: boolean;
  readonly nativeCurrency: { readonly name: string; readonly symbol: string; readonly decimals: number };
  readonly rpcUrl: string;
  readonly explorer: { readonly name: string; readonly url: string };
  /** Newest first. The first entry receives writes; every entry is read. */
  readonly registries: readonly RegistryDef[];
  readonly presets: { readonly verified?: \`0x\${string}\`; readonly unverified?: \`0x\${string}\` };
}

export const STUDIO_URL = ${JSON.stringify(data.studioUrl)};
export const DEFAULT_CHAIN_KEY = ${JSON.stringify(data.defaultChain)};

export const CHAINS = ${chains} as const satisfies readonly ChainDef[];
`;
}

function renderExtension(data) {
  const body = formatJson({ studioUrl: data.studioUrl, defaultChain: data.defaultChain, chains: data.chains }, "  ");
  return `// ${BANNER}
(function (root) {
  const TALLY_CHAINS = ${body};
  root.TALLY_CHAINS = TALLY_CHAINS;
  if (typeof module !== "undefined" && module.exports) module.exports = TALLY_CHAINS;
})(typeof globalThis !== "undefined" ? globalThis : this);
`;
}

function renderManifest(data, existing) {
  const manifest = JSON.parse(existing);
  const explorers = data.chains.map((c) => `${new URL(c.explorer.url).origin}/*`);
  const rpcs = data.chains.map((c) => `${new URL(c.rpcUrl).origin}/*`);
  const unique = (list) => [...new Set(list)];
  manifest.content_scripts[0].matches = unique(explorers);
  // Network access happens in the service worker: JSON-RPC endpoints and the
  // repository host. Explorers need no host permission; content scripts are
  // injected through `matches`.
  manifest.host_permissions = unique([...rpcs, ...EXTRA_HOSTS]);
  return formatJson(manifest) + "\n";
}

const config = JSON.parse(readFileSync(join(root, "chains.json"), "utf8"));
validate(config);
const data = normalize(config);

const manifestPath = join(root, "extension/manifest.json");
const outputs = [
  [join(root, "studio/lib/chains.generated.ts"), renderStudio(data)],
  [join(root, "extension/chains.generated.js"), renderExtension(data)],
  [manifestPath, renderManifest(data, readFileSync(manifestPath, "utf8"))],
];

let stale = 0;
for (const [path, content] of outputs) {
  const rel = relative(root, path);
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (current === content) {
    console.log(`ok       ${rel}`);
  } else if (CHECK) {
    console.error(`STALE    ${rel}`);
    stale++;
  } else {
    writeFileSync(path, content);
    console.log(`wrote    ${rel}`);
  }
}

if (stale) {
  console.error(`\n${stale} generated file(s) are out of date. Run: npm run chains:sync`);
  process.exit(1);
}
