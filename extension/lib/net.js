// Small network helpers shared by the RPC reader and the repository checker.
// Every request gets a deadline and a hard cap on how much of the response is read.
(function (root, factory) {
  const api = factory();
  root.TallyNet = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DEFAULT_TIMEOUT_MS = 8000;

  /** An AbortSignal that fires after `ms`, or undefined where unsupported. */
  function timeoutSignal(ms) {
    const delay = typeof ms === "number" ? ms : DEFAULT_TIMEOUT_MS;
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      return AbortSignal.timeout(delay);
    }
    if (typeof AbortController === "undefined") return undefined;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), delay);
    return controller.signal;
  }

  class TooLargeError extends Error {
    constructor(limit) {
      super("response larger than " + limit + " bytes");
      this.name = "TooLargeError";
    }
  }

  /**
   * Read a response body as UTF-8 text, stopping (and cancelling the stream) as
   * soon as it exceeds `limit` bytes. Never buffers an unbounded body.
   */
  async function readLimited(response, limit) {
    const declared = Number(response.headers && response.headers.get && response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > limit) {
      if (response.body && response.body.cancel) response.body.cancel().catch(() => {});
      throw new TooLargeError(limit);
    }
    if (!response.body || !response.body.getReader) {
      const text = await response.text();
      if (text.length > limit) throw new TooLargeError(limit);
      return text;
    }
    const reader = response.body.getReader();
    const chunks = [];
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

  return { DEFAULT_TIMEOUT_MS, timeoutSignal, readLimited, TooLargeError };
});
