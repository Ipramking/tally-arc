// Network helpers shared by the RPC reader and the repository checker: every
// request gets a deadline and a hard cap on how much of the response is read.
// Mirrors extension/lib/net.js.

export const DEFAULT_TIMEOUT_MS = 8000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface NetOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export function timeoutSignal(ms: number = DEFAULT_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(ms);
}

export class TooLargeError extends Error {
  constructor(limit: number) {
    super(`response larger than ${limit} bytes`);
    this.name = "TooLargeError";
  }
}

/**
 * Read a response body as UTF-8 text, stopping (and cancelling the stream) as
 * soon as it exceeds `limit` bytes. Never buffers an unbounded body.
 */
export async function readLimited(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    response.body?.cancel().catch(() => {});
    throw new TooLargeError(limit);
  }
  if (!response.body) {
    const text = await response.text();
    if (text.length > limit) throw new TooLargeError(limit);
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      reader.cancel().catch(() => {});
      throw new TooLargeError(limit);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(bytes);
}
