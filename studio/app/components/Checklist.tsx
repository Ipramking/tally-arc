import type { Lookup } from "@/lib/lookup";
import { METHOD_LABEL } from "@/lib/registry";
import { isLive } from "@/lib/status";

type Row = { state: "ok" | "bad" | "warn" | "na"; title: string; detail: string };

const MARK: Record<Row["state"], string> = { ok: "\u2713", bad: "\u2717", warn: "!", na: "\u2013" };
const SR: Record<Row["state"], string> = { ok: "Passed", bad: "Failed", warn: "Needs attention", na: "Not applicable" };

const REPO_DETAIL: Record<string, string> = {
  confirmed: "tally.json in the repository lists this contract on this network.",
  "not-listed": "tally.json exists, but this contract is not listed in it.",
  "signer-mismatch": "tally.json lists this contract but names a different wallet than the one that registered it. The repository's owner has to update it, or the wallet it names has to register.",
  "no-file": "The repository has no tally.json at its root.",
  "invalid-file": "tally.json is not valid (wrong shape, wrong version or too large).",
  "invalid-repo": "The repository link recorded on-chain is not a plain GitHub repository, so it was not fetched.",
  unavailable: "The repository could not be checked right now. Try again shortly.",
};

/** The evidence behind a level, one row per thing a clean "verified" needs. */
export function buildChecklist(result: Extract<Lookup, { ok: true }>): Row[] {
  const reg = result.registration;
  if (!reg) {
    return [{ state: "bad", title: "Registered on-chain", detail: "No registry has a record for this address." }];
  }
  const registered: Row = { state: "ok", title: "Registered on-chain", detail: `Registry v${reg.registryVersion}, record signed by the address shown above.` };
  if (reg.provenance === "SELF_ATTESTED") {
    return [
      registered,
      { state: "bad", title: "Control proven", detail: "The signer made a claim without proving control. Anyone can do that for a contract with no owner." },
      { state: "na", title: "Code unchanged", detail: "Not meaningful without a control proof." },
      { state: "na", title: "Repository lists this contract", detail: "A self-attested record can never be shown as verified, whatever the repository says." },
    ];
  }

  const control: Row = {
    state: "ok",
    title: "Control proven by the signer",
    detail: `Proved with ${METHOD_LABEL[reg.method]} when the record was written.`,
  };
  const stillHeld: Row =
    reg.controlCurrent === true
      ? { state: "ok", title: "Signer still controls the contract", detail: "Checked just now against the live contract." }
      : { state: "bad", title: "Signer still controls the contract", detail: "The signer no longer controls this contract. Ownership or admin rights moved." };
  const code: Row =
    reg.codeCurrent === null
      ? { state: "warn", title: "Code unchanged since registration", detail: "Not tracked: the legacy v1 registry does not record the code hash. Re-register on v2 to track it." }
      : reg.codeCurrent
        ? { state: "ok", title: "Code unchanged since registration", detail: "The code hash at this address matches the one recorded." }
        : { state: "bad", title: "Code unchanged since registration", detail: "The code at this address is different from what was registered." };

  const live = isLive(reg);
  const repo: Row = !live
    ? { state: "na", title: "Repository lists this contract", detail: "Not checked: the proof above no longer holds." }
    : result.repo?.status === "confirmed"
      ? {
          state: "ok",
          title: "Repository lists this contract",
          detail: result.repo.bound
            ? "tally.json lists this contract and names the wallet that registered it, so the repository vouches for that wallet."
            : `${REPO_DETAIL.confirmed} It names no wallet; naming the signer there makes the proof stronger.`,
        }
      : {
          state: result.repo?.status === "unavailable" ? "warn" : "bad",
          title: "Repository lists this contract",
          detail: REPO_DETAIL[result.repo?.status ?? "unavailable"],
        };

  return [registered, control, stillHeld, code, repo];
}

export function Checklist({ rows }: { rows: Row[] }) {
  return (
    <ul className="checklist">
      {rows.map((row) => (
        <li key={row.title} className={`check ${row.state}`}>
          <span className="mark" aria-hidden="true">
            {MARK[row.state]}
          </span>
          <div>
            <strong>
              {row.title} <span className="sr-only">{SR[row.state]}</span>
            </strong>
            <span className="detail">{row.detail}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
