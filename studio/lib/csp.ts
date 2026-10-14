// Content-Security-Policy for the studio pages, built per request with a nonce.
// Scripts run only with the nonce (plus 'strict-dynamic' for the bundles they
// load), so injected markup cannot execute. Network access is limited to this
// origin and the chains' RPC endpoints, which the register flow reads directly.
import { CHAINS } from "./chains.generated";

export const rpcOrigins: readonly string[] = [...new Set(CHAINS.map((chain) => new URL(chain.rpcUrl).origin))];

export function buildCsp(nonce: string, isDev = false): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${rpcOrigins.join(" ")}`.trim(),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  return directives.join("; ");
}
