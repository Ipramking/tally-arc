"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
  useSignTypedData,
  useWriteContract,
} from "wagmi";
import { isAddress } from "viem";
import { arc } from "@/lib/arc";
import {
  REGISTRY_ADDRESS,
  registryDomain,
  registerTypes,
  tallyRegistryAbi,
} from "@/lib/registry";

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

function RegisterInner() {
  const params = useSearchParams();
  const prefilled = params.get("address") || "";

  const [target, setTarget] = useState(prefilled);
  const [repo, setRepo] = useState("");
  const [buildHash, setBuildHash] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setTarget(prefilled), [prefilled]);

  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { signTypedDataAsync, isPending: signing } = useSignTypedData();
  const { writeContractAsync, isPending: writing } = useWriteContract();

  const validTarget = useMemo(() => isAddress(target), [target]);

  const { data: nonce } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: tallyRegistryAbi,
    functionName: "nonces",
    args: validTarget ? [target as `0x${string}`] : undefined,
    chainId: arc.id,
    query: { enabled: validTarget },
  });

  const registryConfigured = !/^0x0+$/.test(REGISTRY_ADDRESS);

  async function handleRegister() {
    setError(null);
    setTxHash(null);
    try {
      if (!validTarget) throw new Error("Enter a valid target address.");
      if (!repo) throw new Error("Enter a GitHub repo URL.");
      const currentNonce = (nonce as bigint | undefined) ?? 0n;

      // 1) Sign the EIP-712 payload (relayer-friendly; signer pays no gas).
      const signature = await signTypedDataAsync({
        domain: registryDomain,
        types: registerTypes,
        primaryType: "Register",
        message: {
          target: target as `0x${string}`,
          githubRepo: repo,
          buildHash,
          nonce: currentNonce,
        },
      });

      // 2) Submit. (Here the same wallet relays; any relayer could.)
      const hash = await writeContractAsync({
        address: REGISTRY_ADDRESS,
        abi: tallyRegistryAbi,
        functionName: "registerWithSignature",
        args: [target as `0x${string}`, repo, buildHash, signature],
        chainId: arc.id,
      });
      setTxHash(hash);
    } catch (e: any) {
      setError(e.shortMessage || e.message || "Registration failed");
    }
  }

  const busy = signing || writing;

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
              ← Home
            </Link>
            <span className="chip mono">{arc.name} · {arc.id}</span>
          </div>
        </nav>
      </header>

      <main className="wrap-narrow">
        <div className="form-head">
          <div className="eyebrow">
            <span className="dot" />
            EIP-712 · one signature
          </div>
          <h1 className="display" style={{ fontSize: "clamp(34px,5vw,48px)" }}>
            Register provenance.
          </h1>
          <p className="lede" style={{ marginTop: 18 }}>
            Sign once to bind this contract to its source. If it exposes{" "}
            <span className="mono">owner()</span>, only the owner can register,
            and that record becomes <b>owner-proven</b>.
          </p>
        </div>

        <div className="panel">
          <div className="panel-top">
            <span className="kicker">Wallet</span>
            {isConnected ? (
              <span className="spread">
                <span className="mono small" style={{ color: "var(--paper-2)" }}>
                  {short(address)}
                </span>
                <button className="btn-ghost" onClick={() => disconnect()}>
                  <span className="u">Disconnect</span>
                </button>
              </span>
            ) : (
              <button
                className="btn"
                onClick={() => connect({ connector: connectors[0] })}
                disabled={connecting}
              >
                {connecting ? "Connecting…" : "Connect wallet"}
              </button>
            )}
          </div>

          <label className="field-label" htmlFor="target">
            Target contract address
          </label>
          <input
            id="target"
            className="input"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="0x…"
          />

          <label className="field-label" htmlFor="repo">
            Public source repo
          </label>
          <input
            id="repo"
            className="input"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="https://github.com/you/project"
          />

          <label className="field-label" htmlFor="hash">
            Build / commit hash (optional)
          </label>
          <input
            id="hash"
            className="input"
            value={buildHash}
            onChange={(e) => setBuildHash(e.target.value)}
            placeholder="0x… or git SHA"
          />

          <div style={{ marginTop: 26 }}>
            <button
              className="btn"
              onClick={handleRegister}
              disabled={!isConnected || !validTarget || busy || !registryConfigured}
            >
              {busy ? "Awaiting wallet…" : "Sign & register"}
              {!busy && <span aria-hidden="true">→</span>}
            </button>
          </div>

          {!registryConfigured && (
            <div className="status err">
              Registry address not set. Add{" "}
              <span className="mono">NEXT_PUBLIC_REGISTRY_ADDRESS</span> to your
              environment.
            </div>
          )}

          {txHash && (
            <div className="status ok">
              Registered on {arc.name}.{" "}
              <a
                href={`${arc.blockExplorers.default.url}/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                View transaction {short(txHash)} ↗
              </a>
            </div>
          )}
          {error && <div className="status err">{error}</div>}
        </div>

        <p className="muted small" style={{ marginTop: 22 }}>
          Signatures are pinned to chain {arc.id}, so they’re valid only on{" "}
          {arc.name}.
        </p>
      </main>

      <div style={{ height: 56 }} />
    </>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <main className="wrap-narrow" style={{ paddingTop: 80 }}>
          <span className="mono muted">Loading…</span>
        </main>
      }
    >
      <RegisterInner />
    </Suspense>
  );
}
