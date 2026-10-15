// What this browser has registered, so the previous contract does not vanish
// from the page when the next one is registered. Stored in localStorage only
// (nothing leaves the browser) and always read back as untrusted input.
import { isAddress, parseGithubRepo } from "./safe-url";

export interface RecentRegistration {
  /** Chain key from chains.json, for example "arc" or "bot-testnet". */
  chain: string;
  target: string;
  /** Canonical https://github.com/owner/repo link. */
  repo: string;
  buildHash: string;
  /** Milliseconds since the epoch. */
  at: number;
}

export const RECENT_KEY = "tally.recent.v1";
export const MAX_RECENT = 12;

const CHAIN_KEY = /^[a-z0-9-]{1,40}$/;
const HASH = /^[A-Za-z0-9._-]{0,66}$/;

/** Parse the stored text. Anything malformed is dropped, never trusted or repaired. */
export function parseRecent(raw: string | null): RecentRegistration[] {
  if (!raw || raw.length > 64 * 1024) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: RecentRegistration[] = [];
  for (const item of data.slice(0, MAX_RECENT * 2)) {
    const e = item as Partial<RecentRegistration> | null;
    if (!e || typeof e !== "object") continue;
    if (typeof e.chain !== "string" || !CHAIN_KEY.test(e.chain)) continue;
    if (typeof e.target !== "string" || !isAddress(e.target)) continue;
    const repo = typeof e.repo === "string" ? parseGithubRepo(e.repo) : null;
    if (!repo) continue;
    const buildHash = typeof e.buildHash === "string" && HASH.test(e.buildHash) ? e.buildHash : "";
    if (typeof e.at !== "number" || !Number.isFinite(e.at) || e.at <= 0) continue;
    out.push({ chain: e.chain, target: e.target, repo: repo.url, buildHash, at: e.at });
    if (out.length === MAX_RECENT) break;
  }
  return out;
}

/** Newest first. Registering the same contract on the same network again moves it to the top. */
export function addRecent(list: readonly RecentRegistration[], entry: RecentRegistration): RecentRegistration[] {
  const same = (e: RecentRegistration) => e.chain === entry.chain && e.target.toLowerCase() === entry.target.toLowerCase();
  return [entry, ...list.filter((e) => !same(e))].slice(0, MAX_RECENT);
}

/** `addRecent`, stamping the entry with the current time (the clock is read here, not in a component). */
export function rememberRegistration(list: readonly RecentRegistration[], entry: Omit<RecentRegistration, "at">, now: number = Date.now()): RecentRegistration[] {
  return addRecent(list, { ...entry, at: now });
}

export const serializeRecent = (list: readonly RecentRegistration[]): string => JSON.stringify(list.slice(0, MAX_RECENT));

// Browser side. Written for React's useSyncExternalStore: subscribe to changes made in
// other tabs ("storage") and in this one (our own event), and read the raw text.
export const RECENT_EVENT = "tally:recent-changed";

export function subscribeRecent(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(RECENT_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(RECENT_EVENT, callback);
  };
}

/** The stored text, or null when there is none or storage is blocked. */
export function readRecentRaw(): string | null {
  try {
    return window.localStorage.getItem(RECENT_KEY);
  } catch {
    return null;
  }
}

/** Save the list and tell this tab's subscribers. A blocked storage just means it is not remembered. */
export function saveRecent(list: readonly RecentRegistration[]): void {
  try {
    window.localStorage.setItem(RECENT_KEY, serializeRecent(list));
    window.dispatchEvent(new Event(RECENT_EVENT));
  } catch {
    // keep going without saving
  }
}
