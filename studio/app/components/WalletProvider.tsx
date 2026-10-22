"use client";

// One wallet connection for the whole studio. It lives in the root layout, so it
// survives moving between pages, and the chosen wallet is remembered in this
// browser so a returning visitor is reconnected without a popup.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Address } from "viem";
import { isAddress } from "@/lib/safe-url";
import { discoverWallets, friendlyError, type DiscoveredWallet } from "@/lib/wallet";
import { browserStore, forgetWallet, recallWallet, rememberWallet, restoreAccount, revokeAccess } from "@/lib/wallet-session";

interface WalletState {
  /** Installed wallets. null while the page is still looking. */
  wallets: DiscoveredWallet[] | null;
  /** The selected wallet: the one connected, or the one a connect would use. */
  wallet: DiscoveredWallet | null;
  account: Address | null;
  /** The last connection error, shown where the user acted. Cleared by the next attempt. */
  error: string | null;
  /** Ask the wallet for an account. Resolves to it, or null when it was refused or failed. */
  connect: (walletId?: string) => Promise<Address | null>;
  /** Forget the connection in this browser, and ask the wallet to stop sharing the account. */
  disconnect: () => void;
  /** Pick another wallet to connect with. Drops the current connection. */
  select: (walletId: string) => void;
}

const WalletContext = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const state = useContext(WalletContext);
  if (!state) throw new Error("useWallet must be used inside WalletProvider.");
  return state;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<DiscoveredWallet[] | null>(null);
  const [walletId, setWalletId] = useState("");
  const [account, setAccount] = useState<Address | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wallet = wallets?.find((w) => w.id === walletId) ?? null;

  // Find the installed wallets, then reconnect silently to the one used last time.
  useEffect(() => {
    let live = true;
    discoverWallets(window).then(async (found) => {
      if (!live) return;
      const remembered = recallWallet(browserStore());
      const preferred = found.find((w) => w.id === remembered) ?? found[0] ?? null;
      setWallets(found);
      setWalletId(preferred?.id ?? "");
      if (preferred && preferred.id === remembered) {
        const restored = await restoreAccount(preferred.provider);
        if (live && restored) setAccount(restored);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  // Follow account switches and locks made inside the wallet.
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

  const connect = useCallback(
    async (id?: string): Promise<Address | null> => {
      const target = (id ? wallets?.find((w) => w.id === id) : wallet) ?? null;
      if (!target) return null;
      setError(null);
      try {
        const accounts = await target.provider.request({ method: "eth_requestAccounts" });
        const first = Array.isArray(accounts) ? accounts[0] : null;
        if (!isAddress(first)) throw new Error("The wallet did not return an account.");
        setWalletId(target.id);
        setAccount(first);
        rememberWallet(browserStore(), target.id);
        return first;
      } catch (e) {
        setError(friendlyError(e));
        return null;
      }
    },
    [wallet, wallets],
  );

  const disconnect = useCallback(() => {
    const provider = wallet?.provider;
    setAccount(null);
    setError(null);
    forgetWallet(browserStore());
    if (provider) void revokeAccess(provider);
  }, [wallet]);

  const select = useCallback((id: string) => {
    setWalletId(id);
    setAccount(null);
    setError(null);
  }, []);

  const value = useMemo<WalletState>(() => ({ wallets, wallet, account, error, connect, disconnect, select }), [wallets, wallet, account, error, connect, disconnect, select]);
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
