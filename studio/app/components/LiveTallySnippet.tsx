"use client";

import { useEffect, useState } from "react";
import type { Snippet } from "@/lib/tally-snippet";
import { SnippetView } from "./SnippetView";

type State = { key: string; snippet: Snippet } | null;

/**
 * Asks the studio for the tally.json to publish, merged with what the repository
 * already lists. If that cannot be done it falls back to a single entry to ADD,
 * never to a whole file that could be pasted over the existing one.
 *
 * "Check again" re-reads the repository, so a person can confirm the file is live
 * before they sign.
 */
export function LiveTallySnippet({ repo, chainKey, chainId, address, signer }: { repo: string; chainKey: string; chainId: number; address: string; signer?: string }) {
  const [round, setRound] = useState(0);
  const key = `${chainKey}:${address}:${repo}:${signer ?? "-"}:${round}`;
  const [state, setState] = useState<State>(null);

  useEffect(() => {
    const controller = new AbortController();
    const fallback = (): Snippet => ({
      state: "manual",
      text: `${JSON.stringify(signer ? { chainId, address, signer } : { chainId, address }, null, 2)}\n`,
      kept: 0,
      note: 'We could not check your current tally.json. Do not replace the file. Add this entry to its "contracts" list.',
    });
    const query = new URLSearchParams({ repo, chain: chainKey, address, r: String(round) });
    if (signer) query.set("signer", signer);
    fetch(`/api/tally-snippet?${query}`, { signal: controller.signal, cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Snippet>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((snippet) => setState({ key, snippet }))
      .catch((error) => {
        if (error?.name !== "AbortError") setState({ key, snippet: fallback() });
      });
    return () => controller.abort();
  }, [key, repo, chainKey, chainId, address, signer, round]);

  if (!state || state.key !== key) return <p className="hint">Reading your repository&hellip;</p>;
  const listed = state.snippet.state === "listed";
  return (
    <>
      {listed && (
        <p className="status ok" role="status">
          Your repository already lists this contract. Nothing to publish.
        </p>
      )}
      <SnippetView snippet={state.snippet} />
      <div className="mt-24">
        <button type="button" className="btn-ghost" onClick={() => setRound((n) => n + 1)}>
          <span className="u">Check again</span>
        </button>
      </div>
    </>
  );
}
