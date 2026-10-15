"use client";

import { useRouter } from "next/navigation";
import { chainHref, chainLabel, chains } from "@/lib/chain";

/** Network picker. Selecting one reloads the same page on that network and keeps the rest of the URL (for example the address). */
export function ChainSwitch({ current }: { current: string }) {
  const router = useRouter();
  return (
    <label className="chain-switch">
      <span className="sr-only">Network</span>
      <select value={current} onChange={(event) => router.push(chainHref(window.location.pathname, window.location.search, event.target.value))}>
        {chains.map((c) => (
          <option key={c.key} value={c.key}>
            {chainLabel(c)}
          </option>
        ))}
      </select>
    </label>
  );
}
