import { chains, resolveChain } from "@/lib/chain";
import { cachedLookup } from "@/lib/lookup-cache";
import { lookupJson, SCHEMA_VERSION } from "@/lib/lookup-json";
import { isAddress } from "@/lib/safe-url";

// Public, read-only data, so any origin may read it. No credentials are involved.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status: number, cacheControl: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Referrer-Policy": "no-referrer",
      ...CORS,
    },
  });
}

/**
 * GET /api/lookup/<address>?chain=<key>
 *
 *   200  an answer, including "unverified" and "wallet"
 *   400  the address or the chain is not valid
 *   503  the chain or a registry could not be read; the body has level "unknown" (never read it as "unverified")
 *
 * Without ?chain= the answer is for the default network in chains.json; the response always says which.
 */
export async function GET(request: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const chain = resolveChain(new URL(request.url).searchParams.get("chain"));

  if (!isAddress(address)) {
    return json({ schema: SCHEMA_VERSION, ok: false, error: "invalid address: expected 0x followed by 40 hex characters" }, 400, "public, max-age=3600");
  }
  if (!chain) {
    return json(
      { schema: SCHEMA_VERSION, ok: false, error: "unknown chain", chains: chains.map((c) => ({ key: c.key, id: c.id, name: c.name, hasRegistry: c.registries.length > 0 })) },
      400,
      "public, max-age=300",
    );
  }

  const result = await cachedLookup(chain, address);
  if (!result.ok) return json(lookupJson(chain, address, result), 503, "no-store");
  return json(lookupJson(chain, address, result), 200, "public, max-age=30, s-maxage=30, stale-while-revalidate=120");
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
