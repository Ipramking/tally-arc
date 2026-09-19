"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
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
    <main className="wrap">
      <div className="brand">
        <span className="mark" />
        <span className="name">TALLY</span>
        <span className="net">Arc Mainnet · 5042</span>
      </div>

      <h1>Register contract provenance</h1>
      <p className="lede">
        Sign once to link this contract to its source. If the contract exposes{" "}
        <code>owner()</code>, only the owner can register it — that record is
        marked <b>owner-proven</b>.
      </p>

      <div className="card">
        <div className="spread" style={{ justifyContent: "space-between" }}>
          {isConnected ? (
            <>
              <span className="small mono">{short(address)}</span>
              <button className="ghost" onClick={() => disconnect()}>
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={() => connect({ connector: connectors[0] })}
              disabled={connecting}
            >
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
          )}
        </div>

        <label>Target contract address</label>
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="0x…"
        />

        <label>Public source repo</label>
        <input
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder="https://github.com/you/project"
        />

        <label>Build / commit hash (optional)</label>
        <input
          value={buildHash}
          onChange={(e) => setBuildHash(e.target.value)}
          placeholder="0x… or git SHA"
        />

        <div style={{ marginTop: 20 }}>
          <button
            onClick={handleRegister}
            disabled={!isConnected || !validTarget || busy || !registryConfigured}
          >
            {busy ? "Awaiting wallet…" : "Sign & register"}
          </button>
        </div>

        {!registryConfigured && (
          <div className="status err">
            Registry address not set. Add{" "}
            <code>NEXT_PUBLIC_REGISTRY_ADDRESS</code> to <code>.env.local</code>.
          </div>
        )}

        {txHash && (
          <div className="status ok">
            Registered. View on Arc:{" "}
            <a
              href={`${arc.blockExplorers.default.url}/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
            >
              {short(txHash)}
            </a>
          </div>
        )}
        {error && <div className="status err">{error}</div>}
      </div>
    </main>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<main className="wrap">Loading…</main>}>
      <RegisterInner />
    </Suspense>
  );
}
