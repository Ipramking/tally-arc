import { badgeSvg, type BadgeState } from "@/lib/badge";
import { resolveChain } from "@/lib/chain";
import { cachedLookup } from "@/lib/lookup-cache";
import { isAddress } from "@/lib/safe-url";

function svg(state: BadgeState, maxAgeSeconds: number) {
  return new Response(badgeSvg(state), {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": `public, max-age=${maxAgeSeconds}, s-maxage=${maxAgeSeconds}, stale-while-revalidate=300`,
      // Served as an image only: no sniffing, no scripts, no framing tricks.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const chain = resolveChain(new URL(request.url).searchParams.get("chain"));

  // Always 200 with a badge, so a README never shows a broken image.
  if (!isAddress(address)) return svg("invalid-address", 3600);
  if (!chain) return svg("unknown-network", 3600);

  const result = await cachedLookup(chain, address);
  return svg(result.level, result.ok ? 60 : 10);
}
