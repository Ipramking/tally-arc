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
//   docs/networks.md                   the list of supported networks and their registries
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
    if (chain.explorer.api !== undefined) httpsOrigin(chain.explorer.api, `${where}: explorer.api`, { pathAllowed: true });
    // Optional: how old the newest block may be (seconds) before a node's answer is refused. 0 turns the check off.
    if (chain.maxHeadAgeSeconds !== undefined && (!Number.isInteger(chain.maxHeadAgeSeconds) || chain.maxHeadAgeSeconds < 0 || chain.maxHeadAgeSeconds > 86400)) {
      fail(`${where}: maxHeadAgeSeconds must be a whole number of seconds from 0 to 86400`);
    }
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
      ...(chain.maxHeadAgeSeconds !== undefined ? { maxHeadAgeSeconds: chain.maxHeadAgeSeconds } : {}),
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
  /** Optional. A node whose newest block is older than this (seconds) is refused. Default 300; 0 turns the check off. */
  readonly maxHeadAgeSeconds?: number;
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

const short = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;

function renderNetworks(data, config) {
  const rows = data.chains.map((chain) => {
    const source = config.chains.find((c) => c.key === chain.key);
    const registries = chain.registries.length
      ? chain.registries.map((r) => `v${r.version} [\`${short(r.address)}\`](${chain.explorer.url}/address/${r.address})`).join("<br>")
      : "none yet";
    const example = chain.presets.verified ? `[\`${short(chain.presets.verified)}\`](${data.studioUrl}/c/${chain.presets.verified}?chain=${chain.key})` : "";
    const verify = source.explorer.api ? "`hardhat verify`" : "explorer web form";
    return `| ${chain.name} | ${chain.testnet ? "testnet" : "mainnet"} | \`${chain.key}\` | ${chain.id} | ${chain.nativeCurrency.symbol} | [${chain.explorer.name}](${chain.explorer.url}) | ${registries} | ${example} | ${verify} |`;
  });
  return `<!-- ${BANNER} -->

# Networks

Every network Tally reads, from [\`chains.json\`](../chains.json). A network with a registry can have contracts
registered and looked up; one without can only be looked up, and the answer says no registry is deployed there.
Links without \`?chain=\` mean \`${data.defaultChain}\`.

| Network | Type | Key | Chain ID | Gas token | Explorer | Registries (newest first) | Example verified contract | Source verification |
|---|---|---|---|---|---|---|---|---|
${rows.join("\n")}

Tally works on any EVM chain. To add yours, see [adding-a-chain.md](adding-a-chain.md).
`;
}

const config = JSON.parse(readFileSync(join(root, "chains.json"), "utf8"));
validate(config);
const data = normalize(config);

const manifestPath = join(root, "extension/manifest.json");
const outputs = [
  [join(root, "studio/lib/chains.generated.ts"), renderStudio(data)],
  [join(root, "extension/chains.generated.js"), renderExtension(data)],
  [manifestPath, renderManifest(data, readFileSync(manifestPath, "utf8"))],
  [join(root, "docs/networks.md"), renderNetworks(data, config)],
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
