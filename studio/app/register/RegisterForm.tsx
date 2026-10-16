"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Address, Hex } from "viem";
import { ChainSwitch } from "../components/ChainSwitch";
import { LiveTallySnippet } from "../components/LiveTallySnippet";
import { REVERT_HELP } from "@/lib/abi";
import { chains, explorerTxUrl, writeRegistry, type ChainDef } from "@/lib/chain";
import { planProof } from "@/lib/prove";
import { parseRecent, readRecentRaw, rememberRegistration, saveRecent, subscribeRecent } from "@/lib/recent";
import { explainPlan, reviewRegistration, validateRegisterInput, type PlanView } from "@/lib/register";
import { submitRegistration, type Step } from "@/lib/register-flow";
import { isAddress, parseGithubRepo, shorten } from "@/lib/safe-url";
import { discoverWallets, friendlyError, switchToChain, type DiscoveredWallet } from "@/lib/wallet";

const BUSY_TEXT: Record<Step | "checking", string> = {
  checking: "Reading the contract…",
  network: "Switching network…",
  sign: "Waiting for your signature…",
  simulate: "Checking the transaction…",
  send: "Waiting for you to approve the transaction…",
  confirm: "Waiting for confirmation…",
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
  // The confirmation belongs to one exact review. Change anything and it has to be given again.
  const [ack, setAck] = useState<string | null>(null);
  // What this browser registered before. The server renders none, so first paint matches on both sides.
  const recentRaw = useSyncExternalStore(subscribeRecent, readRecentRaw, () => null);
  const recent = useMemo(() => parseRecent(recentRaw), [recentRaw]);

  const wallet = wallets?.find((w) => w.id === walletId) ?? null;
  const input = validateRegisterInput({ target, repo, buildHash });
  const touched = target.trim() !== "" || repo.trim() !== "";
  const planKey = account && input.ok ? `${account}:${input.target}` : null;
  const view = checked && planKey === checked.key ? checked.view : null;

  const review =
    view && view.method !== null && input.ok && account
      ? reviewRegistration({ chainName: chain.name, target: input.target, account, method: view.method, repo: input.repo, buildHash: input.buildHash })
      : null;
  const reviewKey = review && view && input.ok ? `${planKey}|${input.repo}|${input.buildHash}|${view.method}` : null;
  const acked = reviewKey !== null && ack === reviewKey;
  // Show an error beside the step it belongs to.
  const errorAt = !account ? "wallet" : review ? "review" : "contract";
  const errorBox = error ? (
    <div className="status err" role="alert">
      {error}
    </div>
  ) : null;

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
      return;
    }
    // Move the wallet onto the chosen network now, not only at signing time. If the wallet
    // refuses, the connection stands and signing asks again.
    try {
      await switchToChain(wallet.provider, chain);
    } catch (e) {
      setError(`Connected, but your wallet did not switch to ${chain.name}: ${friendlyError(e)} It will be asked again when you sign.`);
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
    if (!wallet || !account || !registry || !input.ok || !view || view.method === null || !acked) return;
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
      setAck(null);
      saveRecent(rememberRegistration(recent, { chain: chain.key, target: input.target, repo: input.repo, buildHash: input.buildHash }));
    } catch (e) {
      setError(friendlyError(e, REVERT_HELP));
    } finally {
      setBusy(null);
    }
  }

  if (!registry) {
    return (
      <div className="panel">
        <div className="kicker">Network</div>
        <p className="hint">No registry is deployed on {chain.name} yet, so nothing can be registered here. Pick another network, or see docs/deploy-v2.md in the repository to deploy one.</p>
        <div className="mt-24">
          <ChainSwitch current={chain.key} />
        </div>
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
        <div className="kicker">Network and wallet</div>
        <p className="hint">Choose the network the contract is on. Connecting your wallet switches it to that network for you.</p>
        <div className="mt-24">
          <ChainSwitch current={chain.key} />
        </div>

        <div className="spread mt-24">
          {account ? (
            <>
              <span className="mono small">Connected: {shorten(account)}</span>
              {wallets && wallets.length > 1 && (
                <select className="input" aria-label="Wallet" value={walletId} onChange={(e) => (setWalletId(e.target.value), setAccount(null))}>
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              )}
            </>
          ) : (
            <>
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
                {wallets === null ? "Looking for wallets…" : `Connect wallet to ${chain.name}`}
              </button>
            </>
          )}
        </div>
        {wallets !== null && wallets.length === 0 && (
          <p className="status warn" role="status">
            No browser wallet found. Install one (MetaMask, Rabby or similar), then reload this page.
          </p>
        )}
        {errorAt === "wallet" && errorBox}
      </div>

      <div className="panel">
        <div className="kicker">Contract and source</div>

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
          {!account && <p className="hint">Connect your wallet above first. The check tells you whether this wallet can register this contract.</p>}
        </div>

        {view && (
          <div className={`status ${view.tone}`} role="status">
            <strong>{view.title}</strong>
            {view.detail}
          </div>
        )}
        {errorAt === "contract" && errorBox}
      </div>

      {input.ok && (done || review) && registry.version === 2 && (
        <div className="panel">
          <div className="kicker">Publish tally.json</div>
          <p className="hint">
            This is how the repository itself agrees the contract is its own. Anyone can point a record at someone else&apos;s repository, so Tally only shows <b>verified</b> when the repository&apos;s
            tally.json lists the contract and names the wallet that registered it (the file below already does). Commit it to the root, on the default branch, then check it below. Doing it before you
            sign means the record is verified straight away.
          </p>
          <div className="mt-24">
            <LiveTallySnippet repo={input.repo} chainKey={chain.key} chainId={chain.id} address={input.target} signer={account ?? undefined} />
          </div>
        </div>
      )}

      {review && view && !done && (
        <div className="panel">
          <div className="kicker">Review and sign</div>
          <dl className="record mt-24">
            {review.lines.map((line) => (
              <Fragment key={line.term}>
                <dt>{line.term}</dt>
                <dd>{line.value}</dd>
              </Fragment>
            ))}
          </dl>
          <label className={review.unproven ? "consent warn" : "consent"}>
            <input type="checkbox" checked={acked} onChange={(e) => setAck(e.target.checked ? reviewKey : null)} />
            <span>{review.consent}</span>
          </label>
          <div className="mt-24">
            <button type="button" className="btn" onClick={submit} disabled={busy !== null || !acked}>
              {busy && busy !== "checking" ? BUSY_TEXT[busy] : "Sign and register"}
              {busy === null && <span aria-hidden="true">&rarr;</span>}
            </button>
            <p className="hint">You sign a message that expires in one hour, then approve one transaction. The signature only works on {chain.name}.</p>
          </div>
          {errorAt === "review" && errorBox}
        </div>
      )}

      {done && (
        <div className="panel">
          <div className="status ok" role="status">
            <strong>{done.confirmed ? "Registered." : "Submitted."}</strong>
            {done.confirmed ? "The record is on-chain." : "The transaction was sent but has not confirmed yet."}{" "}
            <a href={explorerTxUrl(chain, done.hash)} target="_blank" rel="noopener noreferrer">
              View transaction
            </a>
            {" or "}
            <Link href={`/c/${done.target}?chain=${chain.key}`}>open the record and its history</Link>.
          </div>
          <p className="hint">The record reads verified once the repository&apos;s tally.json lists this contract and names the wallet that signed. The panel above shows the file and can check that it is live.</p>
        </div>
      )}

      {recent.length > 0 && (
        <div className="panel" aria-label="Registered from this browser">
          <div className="kicker">Registered from this browser</div>
          <p className="hint">Kept on this device only. Each link opens that contract&apos;s record and its full history.</p>
          <ul className="recent">
            {recent.map((r) => {
              const known = chains.find((c) => c.key === r.chain);
              const repoName = parseGithubRepo(r.repo);
              return (
                <li key={`${r.chain}:${r.target}`}>
                  <Link href={`/c/${r.target}?chain=${r.chain}`}>{shorten(r.target)}</Link>
                  <span>{known ? known.name : r.chain}</span>
                  {repoName && (
                    <span>
                      {repoName.owner}/{repoName.repo}
                    </span>
                  )}
                  <span className="when">{new Date(r.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
