import Link from "next/link";
import { headers } from "next/headers";
import { createPublicClient, http, isAddress } from "viem";
import { arc } from "@/lib/arc";
import { REGISTRY_ADDRESS, tallyRegistryAbi } from "@/lib/registry";

// Always read fresh on-chain state.
export const dynamic = "force-dynamic";

function TallyMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="5" y1="4" x2="5" y2="20" />
        <line x1="10" y1="4" x2="10" y2="20" />
        <line x1="15" y1="4" x2="15" y2="20" />
        <line x1="20" y1="4" x2="20" y2="20" />
        <line x1="3" y1="19" x2="22" y2="5" />
      </g>
    </svg>
  );
}

function short(a?: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

type Record = {
  repo: string;
  buildHash: string;
  owner: string;
  registeredAt: number;
  provenance: number;
  isVerified: boolean;
};

export default async function ContractPage({
  params,
}: {
  params: { address: string };
}) {
  const address = params.address;
  const valid = isAddress(address);
  const configured = !/^0x0+$/.test(REGISTRY_ADDRESS);

  let rec: Record | null = null;
  let readError = false;

  if (valid && configured) {
    try {
      const client = createPublicClient({ chain: arc, transport: http() });
      const res = (await client.readContract({
        address: REGISTRY_ADDRESS,
        abi: tallyRegistryAbi,
        functionName: "getRegistration",
        args: [address as `0x${string}`],
      })) as readonly [string, string, string, bigint, number, boolean];
      rec = {
        repo: res[0],
        buildHash: res[1],
        owner: res[2],
        registeredAt: Number(res[3]),
        provenance: Number(res[4]),
        isVerified: res[5],
      };
    } catch {
      readError = true;
    }
  }

  const prov = rec?.provenance ?? 0;
  const state =
    prov === 2
      ? { cls: "proven", label: "Owner-proven", line: "The signer is the on-chain owner of this contract. Verified." }
      : prov === 1
        ? { cls: "self", label: "Self-attested", line: "A source was claimed, but control was not proven on-chain." }
        : { cls: "unverified", label: "Not registered", line: "No Tally provenance record exists for this address yet." };

  const h = headers();
  const host = h.get("host") || "tally-studio.vercel.app";
  const origin = `${host.includes("localhost") ? "http" : "https"}://${host}`;
  const badgeUrl = `${origin}/api/badge/${address}`;
  const explorer = arc.blockExplorers.default.url;

  return (
    <>
      <header className="wrap">
        <nav className="nav">
          <Link href="/" className="brand">
            <TallyMark className="mark" />
            <span className="name">Tally</span>
          </Link>
          <div className="nav-links">
            <Link href="/" className="hide-sm">
              Home
            </Link>
            <span className="chip mono">
              {arc.name} · {arc.id}
            </span>
          </div>
        </nav>
      </header>

      <main className="wrap-narrow">
        <div className="form-head">
          <div className="eyebrow">
            <span className="dot" />
            Provenance record
          </div>
          <h1
            className="display"
            style={{ fontSize: "clamp(30px,4.4vw,44px)", marginTop: 22 }}
          >
            {state.label}.
          </h1>
          <p className="lede" style={{ marginTop: 16 }}>
            {!valid
              ? "That doesn’t look like a valid contract address."
              : !configured
                ? "This studio has no registry configured yet, so provenance can’t be read."
                : readError
                  ? "Couldn’t reach Arc to read this record. Try again shortly."
                  : state.line}
          </p>
        </div>

        <div className="panel">
          <div className="panel-top">
            <span className={`badge ${state.cls}`}>
              <span className="swatch" /> {state.label}
            </span>
            <a
              className="btn-ghost"
              href={`${explorer}/address/${address}`}
              target="_blank"
              rel="noreferrer"
            >
              <span className="u">On Arc explorer</span>
              <span className="arw">↗</span>
            </a>
          </div>

          <label className="field-label">Contract</label>
          <div className="mono" style={{ wordBreak: "break-all", color: "var(--paper-2)" }}>
            {address}
          </div>

          {rec && prov > 0 && (
            <>
              <label className="field-label">Source repository</label>
              {rec.repo ? (
                <a
                  className="mono"
                  href={rec.repo}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--proven)", wordBreak: "break-all" }}
                >
                  {rec.repo} ↗
                </a>
              ) : (
                <span className="mono muted">—</span>
              )}

              {rec.buildHash && (
                <>
                  <label className="field-label">Build / commit</label>
                  <div className="mono" style={{ wordBreak: "break-all", color: "var(--paper-2)" }}>
                    {rec.buildHash}
                  </div>
                </>
              )}

              <label className="field-label">Record owner</label>
              <div className="mono" style={{ color: "var(--paper-2)" }}>
                {short(rec.owner)}
              </div>

              {rec.registeredAt > 0 && (
                <>
                  <label className="field-label">Registered</label>
                  <div className="mono" style={{ color: "var(--paper-2)" }}>
                    {new Date(rec.registeredAt * 1000).toUTCString()}
                  </div>
                </>
              )}
            </>
          )}

          {valid && prov === 0 && configured && (
            <div style={{ marginTop: 24 }}>
              <Link href={`/register?address=${address}`} className="btn">
                Register this contract
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          )}
        </div>

        {valid && (
          <div className="panel" style={{ marginTop: 20 }}>
            <label className="field-label" style={{ marginTop: 0 }}>
              Live badge
            </label>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/badge/${address}`}
              alt={`Tally status for ${short(address)}`}
              style={{ display: "block", marginBottom: 16 }}
            />
            <label className="field-label">Embed in your README</label>
            <div className="snippet" style={{ padding: "14px 16px" }}>
              <code>{`![Tally](${badgeUrl})`}</code>
              <span className="tag">SVG · live</span>
            </div>
          </div>
        )}
      </main>

      <div style={{ height: 56 }} />
    </>
  );
}
