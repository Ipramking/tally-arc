// What the studio remembers about a connected wallet between pages and visits.
// Only the wallet's EIP-6963 id is stored, never an address and never a key.
// Coming back, the page asks that wallet who is connected (eth_accounts), which
// answers without a popup, so a returning visitor is reconnected silently.
import type { Address } from "viem";
import { isAddress } from "./safe-url";
import type { Eip1193Provider } from "./wallet";

export const WALLET_KEY = "tally.wallet";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const ID_RE = /^[\w .:@/-]{1,100}$/;

/** The browser's localStorage, or null when it is blocked (private windows, strict settings). */
export function browserStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The wallet id remembered from an earlier connection, or null. */
export function recallWallet(store: Store | null): string | null {
  try {
    const value = store?.getItem(WALLET_KEY);
    return typeof value === "string" && ID_RE.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function rememberWallet(store: Store | null, id: string): void {
  try {
    if (ID_RE.test(id)) store?.setItem(WALLET_KEY, id);
  } catch {
    // Storage full or blocked: the connection still works for this visit.
  }
}

export function forgetWallet(store: Store | null): void {
  try {
    store?.removeItem(WALLET_KEY);
  } catch {
    // Nothing to do: there was nothing readable to forget.
  }
}

/** The account the wallet already shares with this site, without opening a prompt. */
export async function restoreAccount(provider: Eip1193Provider): Promise<Address | null> {
  try {
    const accounts = await provider.request({ method: "eth_accounts" });
    const first = Array.isArray(accounts) ? accounts[0] : null;
    return isAddress(first) ? first : null;
  } catch {
    return null;
  }
}

/** Ask the wallet to stop sharing its account with this site. Wallets that cannot do this are left as they are. */
export async function revokeAccess(provider: Eip1193Provider): Promise<void> {
  try {
    await provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
  } catch {
    // Not supported by this wallet. The site has still forgotten it.
  }
}
