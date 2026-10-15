import { explorerAddressUrl, explorerTxUrl, type ChainDef } from "@/lib/chain";
import type { HistoryItem, MergedHistory } from "@/lib/history";
import { METHOD_LABEL } from "@/lib/registry";
import { displayText, parseGithubRepo, shorten } from "@/lib/safe-url";

const LEVEL_LABEL = { NONE: "No record", SELF_ATTESTED: "Self-attested", CONTROL_PROVEN: "Control proven" } as const;

function heading(item: HistoryItem): string {
  if (item.kind === "REVOKED") return "Record removed";
  return item.provenance === "CONTROL_PROVEN" ? "Registered as control proven" : "Registered as self-attested";
}

function tone(item: HistoryItem): string {
  if (item.kind === "REVOKED") return "tl-revoked";
  return item.provenance === "CONTROL_PROVEN" ? "tl-control" : "tl-self";
}

/** What differs from the previous registration of the same contract (the next older registration in the list). */
function changes(item: HistoryItem, older: HistoryItem | undefined): string[] {
  if (item.kind !== "REGISTERED" || !older) return [];
  const out: string[] = [];
  if (item.signer.toLowerCase() !== older.signer.toLowerCase()) out.push("signer");
  if (item.repo !== null && older.repo !== null && item.repo !== older.repo) out.push("repository");
  if (item.buildHash !== null && older.buildHash !== null && item.buildHash !== older.buildHash) out.push("build");
  if (item.provenance !== older.provenance || item.method !== older.method) {
    out.push(`level (${LEVEL_LABEL[older.provenance].toLowerCase()} to ${LEVEL_LABEL[item.provenance].toLowerCase()})`);
  }
  return out;
}

function When({ item }: { item: HistoryItem }) {
  return (
    <span className="tl-meta">
      {item.time !== null ? new Date(item.time * 1000).toUTCString() : "Time unavailable"}, block {item.block.toLocaleString("en-US")}
    </span>
  );
}

function Entry({ chain, item, older, current }: { chain: ChainDef; item: HistoryItem; older: HistoryItem | undefined; current: boolean }) {
  const parsed = item.repo ? parseGithubRepo(item.repo) : null;
  const changed = changes(item, older);
  return (
    <li className={tone(item)}>
      <div className="tl-head">
        <span className="tl-title">{heading(item)}</span>
        {current && <span className="tl-tag">Current</span>}
        <When item={item} />
      </div>
      <p className="tl-body">
        {item.kind === "REVOKED" ? "Removed by " : "Signed by "}
        <a href={explorerAddressUrl(chain, item.signer)} target="_blank" rel="noopener noreferrer">
          {shorten(item.signer)}
        </a>
        {item.kind === "REGISTERED" && <> &middot; proof: {item.provenance === "SELF_ATTESTED" ? "none" : METHOD_LABEL[item.method]}</>}
        {item.kind === "REGISTERED" && item.repo !== null && (
          <>
            <br />
            Source:{" "}
            {parsed ? (
              <a href={parsed.url} target="_blank" rel="noopener noreferrer">
                {parsed.owner}/{parsed.repo}
              </a>
            ) : (
              displayText(item.repo, 80)
            )}
            {item.buildHash ? <> &middot; build {displayText(item.buildHash, 66)}</> : null}
          </>
        )}
        {item.txHash && (
          <>
            <br />
            <a href={explorerTxUrl(chain, item.txHash)} target="_blank" rel="noopener noreferrer">
              View transaction
            </a>
          </>
        )}
      </p>
      {changed.length > 0 && <p className="tl-changes">Changed since the previous registration: {changed.join(", ")}.</p>}
    </li>
  );
}

export function ProvenanceHistory({ chain, history }: { chain: ChainDef; history: MergedHistory }) {
  const { items, total, hasUnsupported, hasUnavailable } = history;
  const newest = items[0];

  let empty: string | null = null;
  if (items.length === 0) {
    if (hasUnavailable) empty = "History could not be read right now. Try again shortly.";
    else if (hasUnsupported) empty = "This network's registry is v1, which keeps only the latest record. Registry v2 lists every registration and removal.";
    else empty = "Nothing has been registered for this contract yet. Every registration and removal will be listed here, and none is ever overwritten.";
  }

  return (
    <section className="panel" aria-label="Provenance history">
      <div className="kicker">Provenance history</div>
      {empty ? (
        <p className="hint">{empty}</p>
      ) : (
        <>
          <p className="hint">Every registration and removal for this contract, newest first. A newer record never erases an older one.</p>
          <ol className="timeline">
            {items.map((item, i) => (
              <Entry
                key={`${item.registry}-${item.index}`}
                chain={chain}
                item={item}
                older={items.slice(i + 1).find((x) => x.kind === "REGISTERED")}
                current={i === 0 && newest.kind === "REGISTERED"}
              />
            ))}
          </ol>
          {total > items.length && <p className="hint">Showing the latest {items.length} of {total} entries.</p>}
          {hasUnsupported && <p className="hint">An older registry on this network (v1) keeps no history, so earlier records there cannot be listed.</p>}
          {hasUnavailable && <p className="hint">One registry could not be read right now, so this list may be incomplete.</p>}
        </>
      )}
    </section>
  );
}
