"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { CopyButton } from "../components/CopyButton";
import { REVERT_HELP } from "@/lib/abi";
import { explorerTxUrl, writeRegistry, type ChainDef } from "@/lib/chain";
import { planProof } from "@/lib/prove";
import { explainPlan, tallyJsonSnippet, validateRegisterInput, type PlanView } from "@/lib/register";
import { submitRegistration, type Step } from "@/lib/register-flow";
import { isAddress, shorten } from "@/lib/safe-url";
import { discoverWallets, friendlyError, type DiscoveredWallet } from "@/lib/wallet";

const BUSY_TEXT: Record<Step | "checking", string> = {
  checking: "Reading the contract\u2026",
  network: "Switching network\u2026",
  sign: "Waiting for your signature\u2026",
  simulate: "Checking the transaction\u2026",
  send: "Waiting for you to approve the transaction\u2026",
  confirm: "Waiting for confirmation\u2026",
};

type Done = { hash: Hex; confirmed: boolean; target: Address };

export function RegisterForm({ chain, initialAddress }: { chain: ChainDef; initialAddress: string }) {
  const registry = writeRegistry(chain);
  const [wallets, setWallets] = useState<DiscoveredWallet[] | null>(null);
  const [walletId, setWalletId] = useState("");
  const [account, setAccount] = useState<Address | null>(null);
  const [target, setTarget] = useState(initialAddress);
  const [repo, setRepo] = useState("");
  const [buildHash, setBuildHash] = useState("");
  const [checked, setChecked] = useState<{ key: string; view: PlanView } | null>(null);
  const [busy, setBusy] = useState<Step | "checking" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const wallet = wallets?.find((w) => w.id === walletId) ?? null;
  const input = validateRegisterInput({ target, repo, buildHash });
  const touched = target.trim() !== "" || repo.trim() !== "";
  const planKey = account && input.ok ? `${account}:${input.target}` : null;
  const view = checked && planKey === checked.key ? checked.view : null;

  useEffect(() => {
    let live = true;
    discoverWallets(window).then((found) => {
      if (!live) return;
      setWallets(found);
      setWalletId((current) => current || found[0]?.id || "");
    });
    return () => {
      live = false;
    };
  }, []);

  // Follow account switches made inside the wallet.
  useEffect(() => {
    const provider = wallet?.provider;
    if (!provider?.on) return;
    const onAccounts = (accounts: unknown) => {
      const first = Array.isArray(accounts) ? accounts[0] : null;
      setAccount(isAddress(first) ? first : null);
    };
    provider.on("accountsChanged", onAccounts);
    return () => provider.removeListener?.("accountsChanged", onAccounts);
  }, [wallet]);

  async function connect() {
    if (!wallet) return;
    setError(null);
    try {
      const accounts = await wallet.provider.request({ method: "eth_requestAccounts" });
      const first = Array.isArray(accounts) ? accounts[0] : null;
      if (!isAddress(first)) throw new Error("The wallet did not return an account.");
      setAccount(first);
    } catch (e) {
      setError(friendlyError(e, REVERT_HELP));
    }
  }

  async function check() {
    if (!account || !input.ok || !registry) return;
    setBusy("checking");
    setError(null);
    setDone(null);
    try {
      const plan = await planProof({ rpcUrl: chain.rpcUrl, target: input.target, account });
      setChecked({ key: `${account}:${input.target}`, view: explainPlan(plan, { registryVersion: registry.version, chainName: chain.name }) });
    } catch (e) {
      setError(`Could not read ${chain.name}: ${friendlyError(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    if (!wallet || !account || !registry || !input.ok || !view || view.method === null) return;
    setBusy("network");
    setError(null);
    try {
      const result = await submitRegistration({
        provider: wallet.provider,
        chain,
        registry,
        account,
        target: input.target,
        repo: input.repo,
        buildHash: input.buildHash,
        method: view.method,
        deployerNonce: view.deployerNonce,
        onStep: setBusy,
      });
      setDone({ ...result, target: input.target });
    } catch (e) {
      setError(friendlyError(e, REVERT_HELP));
    } finally {
      setBusy(null);
    }
  }

  if (!registry) {
    return (
      <div className="panel">
        <p className="hint">No registry is deployed on {chain.name} yet, so nothing can be registered here. See docs/deploy-v2.md in the repository to deploy one.</p>
      </div>
    );
  }

  return (
    <>
      {registry.version === 1 && (
        <p className="banner" role="note">
          This network only has the legacy v1 registry. A v1 record can reach <b>control proven</b> but never <b>verified</b>, because v1 cannot detect code changes. Registering here still works; re-register
          on v2 once it is deployed.
        </p>
      )}

      <div className="panel">
        <div className="panel-top">
          <span className="kicker">Wallet</span>
          {account ? (
            <span className="spread">
              <span className="mono small">{shorten(account)}</span>
              {wallets && wallets.length > 1 && (
                <select className="input" aria-label="Wallet" value={walletId} onChange={(e) => (setWalletId(e.target.value), setAccount(null))}>
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              )}
            </span>
          ) : (
            <span className="spread">
              {wallets && wallets.length > 1 && (
                <select className="input" aria-label="Wallet" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className="btn" onClick={connect} disabled={!wallet}>
                {wallets === null ? "Looking for wallets\u2026" : "Connect wallet"}
              </button>
            </span>
          )}
        </div>
        {wallets !== null && wallets.length === 0 && (
          <p className="status warn" role="status">
            No browser wallet found. Install one (MetaMask, Rabby or similar), then reload this page.
          </p>
        )}

        <label className="field-label" htmlFor="target">
          Contract address
        </label>
        <input id="target" className="input" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="0x..." spellCheck={false} autoComplete="off" />

        <label className="field-label" htmlFor="repo">
          Public source repository
        </label>
        <input id="repo" className="input" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="https://github.com/you/project" spellCheck={false} autoComplete="off" />

        <label className="field-label" htmlFor="hash">
          Build or commit hash (optional)
        </label>
        <input id="hash" className="input" value={buildHash} onChange={(e) => setBuildHash(e.target.value)} placeholder="a git commit SHA" spellCheck={false} autoComplete="off" />

        {touched && !input.ok && <p className="hint">{input.error}</p>}

        <div className="mt-24">
          <button type="button" className="btn" onClick={check} disabled={!account || !input.ok || busy !== null}>
            {busy === "checking" ? BUSY_TEXT.checking : "Check what can be proven"}
          </button>
        </div>

        {view && (
          <div className={`status ${view.tone}`} role="status">
            <strong>{view.title}</strong>
            {view.detail}
          </div>
        )}

        {view && view.method !== null && !done && (
          <div className="mt-24">
            <button type="button" className="btn" onClick={submit} disabled={busy !== null}>
              {busy && busy !== "checking" ? BUSY_TEXT[busy] : "Sign and register"}
              {busy === null && <span aria-hidden="true">&rarr;</span>}
            </button>
            <p className="hint">You sign a message that expires in one hour, then approve one transaction. The signature only works on {chain.name}.</p>
          </div>
        )}

        {error && (
          <div className="status err" role="alert">
            {error}
          </div>
        )}

        {done && (
          <div className="status ok" role="status">
            <strong>{done.confirmed ? "Registered." : "Submitted."}</strong>
            {done.confirmed ? "The record is on-chain." : "The transaction was sent but has not confirmed yet."}{" "}
            <a href={explorerTxUrl(chain, done.hash)} target="_blank" rel="noopener noreferrer">
              View transaction
            </a>
            {" or "}
            <Link href={`/c/${done.target}?chain=${chain.key}`}>open the record</Link>.
          </div>
        )}
      </div>

      {input.ok && (done || (view && view.method !== null)) && registry.version === 2 && (
        <div className="panel">
          <div className="kicker">Last step: publish tally.json</div>
          <p className="hint">Commit this file to the root of your repository (default branch). Until it is there, the record shows as control proven rather than verified.</p>
          <div className="mt-24 stack">
            <pre className="code">{tallyJsonSnippet(chain.id, input.target)}</pre>
            <CopyButton text={tallyJsonSnippet(chain.id, input.target)} label="Copy tally.json" />
          </div>
        </div>
      )}
    </>
  );
}
