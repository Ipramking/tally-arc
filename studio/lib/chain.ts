// Chain selection on top of the generated table (from the repo-wide chains.json).
import { CHAINS, DEFAULT_CHAIN_KEY, STUDIO_URL, type ChainDef, type RegistryDef } from "./chains.generated";

export { STUDIO_URL };
export type { ChainDef, RegistryDef };

export const chains: readonly ChainDef[] = CHAINS;

export const defaultChain: ChainDef = chains.find((c) => c.key === DEFAULT_CHAIN_KEY) ?? chains[0];

/** Resolve `?chain=` (a key from chains.json or a numeric chain id). Missing means the default; unknown means null. */
export function resolveChain(param: string | string[] | null | undefined): ChainDef | null {
  const value = Array.isArray(param) ? param[0] : param;
  if (value === undefined || value === null || value === "") return defaultChain;
  return chains.find((c) => c.key === value || String(c.id) === value) ?? null;
}

/** Registry that receives new registrations (newest first), or null if none is deployed. */
export function writeRegistry(chain: ChainDef): RegistryDef | null {
  return chain.registries[0] ?? null;
}

export function explorerAddressUrl(chain: ChainDef, address: string): string {
  return `${chain.explorer.url}/address/${address}`;
}

export function explorerTxUrl(chain: ChainDef, hash: string): string {
  return `${chain.explorer.url}/tx/${hash}`;
}

/**
 * Server-side RPC URL. TALLY_RPC_URL_<KEY> (key upper-cased, dashes to
 * underscores) overrides the public endpoint, for example a private provider.
 * Only https URLs are accepted.
 */
export function serverChain(chain: ChainDef, env: Record<string, string | undefined> = process.env): ChainDef {
  const override = env[`TALLY_RPC_URL_${chain.key.toUpperCase().replace(/-/g, "_")}`];
  if (!override) return chain;
  try {
    const url = new URL(override);
    if (url.protocol === "https:" && !url.username && !url.password) return { ...chain, rpcUrl: override };
  } catch {
    // fall through to the public endpoint
  }
  return chain;
}

/** The same page on another network: sets `?chain=` and keeps every other query parameter. */
export function chainHref(pathname: string, search: string, key: string): string {
  const params = new URLSearchParams(search);
  params.set("chain", key);
  return `${pathname}?${params.toString()}`;
}

/** How a chain is named in the UI: its name and chain id, for example "My Chain \u00b7 12345". */
export function chainLabel(chain: ChainDef): string {
  return `${chain.name} \u00b7 ${chain.id}`;
}
