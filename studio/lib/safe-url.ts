// Strict parsing and sanitising of values that come from the chain or from a
// repository. Everything read from a registry is attacker-controlled text:
// validate it before it is linked, fetched or shown.
//
// Mirrors extension/lib/safe-url.js; both are tested against test-vectors/safe-url.json.
import type { Address } from "viem";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
// GitHub login: 1-39 chars, alphanumeric or hyphen, no leading/trailing hyphen.
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const REPO_PREFIX = "https://github.com/";
const MAX_REPO_URL_LENGTH = 200;
// Control characters, zero-width characters and bidi overrides/isolates.
const INVISIBLE_RE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g;

export interface GithubRepo {
  owner: string;
  repo: string;
  /** Canonical https://github.com/<owner>/<repo>; the only form clients may link to. */
  url: string;
}

export function isAddress(value: unknown): value is Address {
  return typeof value === "string" && ADDRESS_RE.test(value);
}

/**
 * Parse a repository URL taken from a registry record. Accepts only
 * https://github.com/<owner>/<repo>[/more/path] built from [A-Za-z0-9._/-].
 * Extra path segments are accepted but dropped from the canonical URL.
 */
export function parseGithubRepo(value: unknown): GithubRepo | null {
  if (typeof value !== "string" || value.length > MAX_REPO_URL_LENGTH) return null;
  if (!value.startsWith(REPO_PREFIX)) return null;
  const rest = value.slice(REPO_PREFIX.length);
  if (!/^[A-Za-z0-9._/-]+$/.test(rest)) return null;
  const parts = rest.split("/");
  if (parts[parts.length - 1] === "") parts.pop(); // one trailing slash is fine
  if (parts.length < 2) return null;
  for (const part of parts) if (part === "" || part === "." || part === "..") return null;
  const owner = parts[0];
  let repo = parts[1];
  if (repo.endsWith(".git")) repo = repo.slice(0, -4);
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo) || repo === "." || repo === "..") return null;
  return { owner, repo, url: `${REPO_PREFIX}${owner}/${repo}` };
}

/** URL of the tally.json that must list a contract before it can be "verified". */
export function tallyJsonUrl(parsed: GithubRepo): string {
  return `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/HEAD/tally.json`;
}

/** Make untrusted text safe to display: drop invisible/bidi characters, cap length. */
export function displayText(value: unknown, max = 80): string {
  if (typeof value !== "string") return "";
  const clean = value.replace(INVISIBLE_RE, "");
  return clean.length > max ? `${clean.slice(0, max - 1)}\u2026` : clean;
}

export function shorten(address: string | undefined | null): string {
  return isAddress(address) ? `${address.slice(0, 6)}\u2026${address.slice(-4)}` : "";
}
