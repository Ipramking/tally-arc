// Shared, short-lived cache for badge lookups. README badges can be hit by many
// readers at once; a burst for one contract costs one lookup per instance.
import { TtlCache } from "./cache";
import { serverChain } from "./chain";
import type { ChainDef } from "./chains.generated";
import { lookupContract, type Lookup } from "./lookup";

export const OK_TTL_MS = 30_000;
export const FAIL_TTL_MS = 5_000;

const cache = new TtlCache<Lookup>(500);

export function cachedLookup(chain: ChainDef, address: string): Promise<Lookup> {
  return cache.get(`${chain.key}:${address.toLowerCase()}`, () => lookupContract({ chain: serverChain(chain), address }), (value) =>
    value.ok ? OK_TTL_MS : FAIL_TTL_MS,
  );
}
