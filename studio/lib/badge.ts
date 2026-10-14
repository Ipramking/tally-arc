// SVG status badge for READMEs. The text is always one of a fixed set of
// strings, never anything read from the chain, and is XML-escaped regardless.
import type { Level } from "./status";

export type BadgeState = Level | "invalid-address" | "unknown-network";

const VALUE: Record<BadgeState, string> = {
  verified: "verified",
  "control-proven": "control proven",
  stale: "stale",
  "self-attested": "self-attested",
  unverified: "unverified",
  unknown: "unknown",
  "invalid-address": "invalid address",
  "unknown-network": "unknown network",
};

// Fill colours (ink text sits on all of them with good contrast).
const COLOR: Record<BadgeState, string> = {
  verified: "#34d399",
  "control-proven": "#62b0ec",
  stale: "#f5b942",
  "self-attested": "#a39f93",
  unverified: "#ef4444",
  unknown: "#6b6b78",
  "invalid-address": "#6b6b78",
  "unknown-network": "#6b6b78",
};

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c] as string);

export function badgeSvg(state: BadgeState, label = "tally"): string {
  const value = VALUE[state];
  const lw = Math.round(30 + label.length * 6.4);
  const vw = Math.round(22 + value.length * 6.6);
  const w = lw + vw;
  const text = escapeXml(`${label}: ${value}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${text}">
  <title>${text}</title>
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-opacity=".12" stop-color="#fff"/><stop offset="1" stop-opacity=".12"/></linearGradient>
  <rect rx="3" width="${w}" height="20" fill="#101012"/>
  <rect rx="3" x="${lw}" width="${vw}" height="20" fill="${COLOR[state]}"/>
  <rect rx="3" width="${w}" height="20" fill="url(#s)"/>
  <g text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${lw / 2}" y="14" fill="#cbc8bf">${escapeXml(label)}</text>
    <text x="${lw + vw / 2}" y="14" fill="#0a0a0b" font-weight="600">${escapeXml(value)}</text>
  </g>
</svg>`;
}

export const BADGE_STATES = Object.keys(VALUE) as BadgeState[];
