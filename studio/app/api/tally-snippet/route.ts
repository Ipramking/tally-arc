import { TtlCache } from "@/lib/cache";
import { resolveChain } from "@/lib/chain";
import { isAddress, parseGithubRepo } from "@/lib/safe-url";
import { buildTallySnippet, type Snippet } from "@/lib/tally-snippet";

// A person who just committed their tally.json wants to see it picked up within
// seconds, so this is short. It still stops a burst from hammering GitHub.
const TTL_MS = 10_000;
const FRESH_TTL_MS = 2_000;
const cache = new TtlCache<Snippet>(300);

const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function bad(error: string) {
  return Response.json({ error }, { status: 400, headers });
}

/**
 * GET /api/tally-snippet?repo=<github url>&chain=<key|id>&address=<0x...>
 * The tally.json to publish for this contract, merged with what the repository already lists.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const repo = params.get("repo") ?? "";
  const address = params.get("address") ?? "";
  const chain = resolveChain(params.get("chain"));

  if (!chain) return bad("unknown network");
  if (!isAddress(address)) return bad("not an address");
  const parsed = parseGithubRepo(repo);
  if (!parsed) return bad("not a plain GitHub repository link");
  // Optional: the wallet that registered the contract, so the file can name it.
  const signerParam = params.get("signer");
  if (signerParam !== null && !isAddress(signerParam)) return bad("signer is not an address");
  const signer = signerParam ?? undefined;

  // "Check again" sends r>0: it must read GitHub afresh, so it skips the 10 s entry. A short
  // separate entry still collapses a burst of clicks into one request.
  const fresh = (params.get("r") ?? "0") !== "0";
  const key = `${chain.id}:${address.toLowerCase()}:${parsed.owner.toLowerCase()}/${parsed.repo.toLowerCase()}:${signer?.toLowerCase() ?? "-"}${fresh ? ":fresh" : ""}`;
  const snippet = await cache.get(key, () => buildTallySnippet({ repoUrl: parsed.url, chainId: chain.id, address, signer }), () => (fresh ? FRESH_TTL_MS : TTL_MS));
  return Response.json(snippet, { headers });
}
