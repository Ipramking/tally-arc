"use client";

import { useState } from "react";

/** Copies `text` to the clipboard. Falls back to a no-op label if the clipboard is unavailable. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button type="button" className="btn-ghost" onClick={copy} aria-live="polite">
      <span className="u">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}</span>
    </button>
  );
}
