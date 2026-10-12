// Browser wallet plumbing: EIP-6963 discovery (so several installed wallets do
// not fight over window.ethereum) with a window.ethereum fallback, and chain
// switching with add-chain from the repo-wide chain table. No dependencies.
import { defineChain, type Chain } from "viem";
import type { ChainDef } from "./chains.generated";

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

export interface DiscoveredWallet {
  id: string;
  name: string;
  provider: Eip1193Provider;
}

interface AnnounceDetail {
  info?: { uuid?: unknown; name?: unknown };
  provider?: unknown;
}

function isProvider(value: unknown): value is Eip1193Provider {
  return typeof value === "object" && value !== null && typeof (value as Eip1193Provider).request === "function";
}

/**
 * Collect injected wallets. `target` is the window in the browser; it is a
 * parameter so the logic can be tested without one.
 */
export function discoverWallets(
  target: Pick<EventTarget, "addEventListener" | "removeEventListener" | "dispatchEvent"> & { ethereum?: unknown },
  waitMs = 250,
): Promise<DiscoveredWallet[]> {
  return new Promise((resolve) => {
    const found = new Map<string, DiscoveredWallet>();
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<AnnounceDetail>).detail;
      if (!detail || !isProvider(detail.provider)) return;
      const uuid = typeof detail.info?.uuid === "string" ? detail.info.uuid : `wallet-${found.size}`;
      const name = typeof detail.info?.name === "string" ? detail.info.name.slice(0, 40) : "Browser wallet";
      found.set(uuid, { id: uuid, name, provider: detail.provider });
    };
    target.addEventListener("eip6963:announceProvider", onAnnounce);
    target.dispatchEvent(new Event("eip6963:requestProvider"));

    setTimeout(() => {
      target.removeEventListener("eip6963:announceProvider", onAnnounce);
      if (found.size === 0 && isProvider(target.ethereum)) {
        found.set("window.ethereum", { id: "window.ethereum", name: "Browser wallet", provider: target.ethereum });
      }
      resolve([...found.values()]);
    }, waitMs);
  });
}

export function toViemChain(chain: ChainDef): Chain {
  return defineChain({
    id: chain.id,
    name: chain.name,
    testnet: chain.testnet,
    nativeCurrency: { ...chain.nativeCurrency },
    rpcUrls: { default: { http: [chain.rpcUrl] } },
    blockExplorers: { default: { name: chain.explorer.name, url: chain.explorer.url } },
  });
}

export const hexChainId = (id: number) => `0x${id.toString(16)}`;

interface WalletError {
  code?: number;
}

/** Switch the wallet to `chain`, adding it first if the wallet has never seen it. */
export async function switchToChain(provider: Eip1193Provider, chain: ChainDef): Promise<void> {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChainId(chain.id) }] });
  } catch (error) {
    if ((error as WalletError)?.code !== 4902) throw error; // 4902: unrecognised chain
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hexChainId(chain.id),
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [chain.rpcUrl],
          blockExplorerUrls: [chain.explorer.url],
        },
      ],
    });
  }
}

/** A short, human message for wallet and contract errors. */
export function friendlyError(error: unknown, revertHelp: Readonly<Record<string, string>> = {}): string {
  const e = error as { code?: number; shortMessage?: string; message?: string; name?: string; cause?: unknown; data?: { errorName?: string } };
  if (e?.code === 4001) return "You rejected the request in your wallet.";
  const walk = (value: unknown, depth = 0): string | null => {
    if (!value || typeof value !== "object" || depth > 5) return null;
    const v = value as { data?: { errorName?: string }; cause?: unknown; errorName?: string };
    const name = v.errorName ?? v.data?.errorName;
    if (name && revertHelp[name]) return revertHelp[name];
    return walk(v.cause, depth + 1);
  };
  const help = walk(error);
  if (help) return help;
  const message = e?.shortMessage || e?.message || "Something went wrong.";
  return message.length > 240 ? `${message.slice(0, 239)}\u2026` : message;
}
