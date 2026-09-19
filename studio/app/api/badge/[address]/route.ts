import { createPublicClient, http, isAddress } from "viem";
import { arc } from "@/lib/arc";
import { REGISTRY_ADDRESS, tallyRegistryAbi } from "@/lib/registry";

export const runtime = "edge";
export const revalidate = 60;

type Style = { label: string; value: string; color: string };

function badgeSvg({ label, value, color }: Style) {
  const lw = 46 + label.length * 6.2;
  const vw = 24 + value.length * 6.6;
  const w = lw + vw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${label}: ${value}">
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-opacity=".1" stop-color="#fff"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <rect rx="3" width="${w}" height="20" fill="#151C28"/>
  <rect rx="3" x="${lw}" width="${vw}" height="20" fill="${color}"/>
  <rect rx="3" width="${w}" height="20" fill="url(#s)"/>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,sans-serif" font-size="11">
    <text x="${lw / 2}" y="14" fill="#7d8aa0">${label}</text>
    <text x="${lw + vw / 2}" y="14">${value}</text>
  </g>
</svg>`;
}

function respond(svg: string) {
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=60, s-maxage=60",
    },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: { address: string } }
) {
  const address = params.address;
  if (!isAddress(address)) {
    return respond(
      badgeSvg({ label: "tally", value: "bad address", color: "#f59e0b" })
    );
  }

  try {
    const client = createPublicClient({ chain: arc, transport: http() });
    const res = (await client.readContract({
      address: REGISTRY_ADDRESS,
      abi: tallyRegistryAbi,
      functionName: "getRegistration",
      args: [address as `0x${string}`],
    })) as readonly [string, string, string, bigint, number, boolean];

    const provenance = Number(res[4]);
    if (provenance === 2)
      return respond(
        badgeSvg({ label: "tally", value: "verified", color: "#10B981" })
      );
    if (provenance === 1)
      return respond(
        badgeSvg({ label: "tally", value: "self-attested", color: "#38BDF8" })
      );
    return respond(
      badgeSvg({ label: "tally", value: "unverified", color: "#f59e0b" })
    );
  } catch {
    return respond(
      badgeSvg({ label: "tally", value: "unknown", color: "#7d8aa0" })
    );
  }
}
