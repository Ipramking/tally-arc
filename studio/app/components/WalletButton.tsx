"use client";

import { useEffect, useRef, useState } from "react";
import { shorten } from "@/lib/safe-url";
import { useWallet } from "./WalletProvider";

/**
 * The connect-wallet control in the nav. The connection is shared by every page
 * (see WalletProvider), so connecting once here is enough everywhere.
 */
export function WalletButton() {
  const { wallets, wallet, account, error, connect, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Close on Escape or a click outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function connectWith(id: string) {
    setBusy(true);
    const connected = await connect(id);
    setBusy(false);
    // Stay open on a failure so the reason is visible beside the button.
    setOpen(connected === null);
  }

  function onClick() {
    if (!account && wallets?.length === 1) {
      void connectWith(wallets[0].id);
      return;
    }
    setOpen((current) => !current);
  }

  const label = busy ? "Connecting…" : account ? shorten(account) : "Connect wallet";

  return (
    <div className="wallet" ref={root}>
      <button type="button" className="chip wallet-btn" onClick={onClick} disabled={wallets === null || busy} aria-expanded={open} aria-controls="wallet-pop">
        {account && <span className="wallet-dot" aria-hidden="true" />}
        <span className="mono">{label}</span>
      </button>

      {open && (
        <div className="wallet-pop" id="wallet-pop">
          {account ? (
            <>
              <p className="wallet-note">Connected with {wallet?.name ?? "your wallet"}. This stays connected on every page of this site.</p>
              <p className="wallet-addr mono">{account}</p>
              <button
                type="button"
                className="wallet-action"
                onClick={() => {
                  disconnect();
                  setOpen(false);
                }}
              >
                Disconnect
              </button>
            </>
          ) : wallets && wallets.length === 0 ? (
            <p className="wallet-note">No browser wallet found. Install one (MetaMask, Rabby or similar), then reload this page.</p>
          ) : (
            <>
              {wallets && wallets.length > 1 && <p className="wallet-note">Choose a wallet.</p>}
              {wallets && wallets.length > 1 && (
                <ul className="wallet-list">
                  {wallets.map((w) => (
                    <li key={w.id}>
                      <button type="button" className="wallet-action" onClick={() => void connectWith(w.id)}>
                        {w.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {!account && error && (
            <p className="wallet-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
