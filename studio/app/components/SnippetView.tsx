import type { Snippet } from "@/lib/tally-snippet";
import { CopyButton } from "./CopyButton";

/** The tally.json to publish (or the one entry to add), with the sentence that explains it. */
export function SnippetView({ snippet }: { snippet: Snippet }) {
  const entryOnly = snippet.state === "manual";
  return (
    <>
      <p className={snippet.state === "manual" ? "hint warn" : "hint"}>{snippet.note}</p>
      <div className="mt-24 stack">
        <pre className="code">{snippet.text}</pre>
        <CopyButton text={snippet.text} label={entryOnly ? "Copy entry" : "Copy tally.json"} />
      </div>
    </>
  );
}
