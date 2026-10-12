import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Checklist, buildChecklist } from "../../components/Checklist";
import { CopyButton } from "../../components/CopyButton";
import { Nav } from "../../components/Nav";
import { StatusBadge } from "../../components/StatusBadge";
import { chainLabel, explorerAddressUrl, resolveChain, serverChain, STUDIO_URL, type ChainDef } from "@/lib/chain";
import { lookupContract } from "@/lib/lookup";
import { tallyJsonSnippet } from "@/lib/register";
import { METHOD_LABEL } from "@/lib/registry";
import { displayText, isAddress, parseGithubRepo, shorten } from "@/lib/safe-url";
import { describe, isLive, LEVELS } from "@/lib/status";

type Props = {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ chain?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { address } = await params;
  return { title: isAddress(address) ? shorten(address) : "Contract record" };
}

function Shell({ chain, eyebrow, title, lede, children }: { chain: ChainDef | null; eyebrow: string; title: string; lede: string; children?: ReactNode }) {
  return (
    <>
      <Nav chip={chain ? chainLabel(chain) : undefined}>
        <Link href="/" className="hide-sm">
          Home
        </Link>
      </Nav>
      <main id="main" className="wrap-narrow">
        <div className="form-head">
          <div className="eyebrow">
            <span className="dot" />
            {eyebrow}
          </div>
          <h1 className="display compact">{title}</h1>
          <p className="lede tight">{lede}</p>
        </div>
        {children}
      </main>
      <div className="pad-bottom" />
    </>
  );
}

export default async function RecordPage({ params, searchParams }: Props) {
  const { address } = await params;
  const { chain: chainParam } = await searchParams;
  const chain = resolveChain(chainParam);

  if (!chain) {
    return <Shell chain={null} eyebrow="Provenance record" title="Unknown network." lede="This studio does not know that network. Pick one from the home page or check the link you followed." />;
  }
  if (!isAddress(address)) {
    return <Shell chain={chain} eyebrow="Provenance record" title="Not an address." lede="That does not look like a contract address: it should start with 0x and be 42 characters long." />;
  }

  const result = await lookupContract({ chain: serverChain(chain), address });
  const level = result.level;
  const registration = result.ok ? result.registration : null;
  const lede = result.ok ? describe(level, registration, result.repo) : `Could not read ${chain.name} right now (${displayText(result.error, 120)}). Try again shortly.`;

  const repoLink = result.ok ? result.repoLink : null;
  const parsedRepo = registration ? parseGithubRepo(registration.githubRepo) : null;
  const hasV2 = chain.registries.some((r) => r.version === 2);
  const needsTallyJson = result.ok && registration !== null && isLive(registration) && result.repo?.status !== "confirmed";
  const badgeUrl = `${STUDIO_URL}/api/badge/${address}?chain=${chain.key}`;
  const registerHref = `/register?address=${address}&chain=${chain.key}`;
  const canRegister = chain.registries.length > 0;

  return (
    <Shell chain={chain} eyebrow="Provenance record" title={`${LEVELS[level].label}.`} lede={lede}>
      <section className="panel" aria-label="Summary">
        <div className="panel-top">
          <StatusBadge level={level} />
          <a className="btn-ghost" href={explorerAddressUrl(chain, address)} target="_blank" rel="noopener noreferrer">
            <span className="u">On {chain.explorer.name}</span>
            <span className="arw" aria-hidden="true">
              &#8599;
            </span>
          </a>
        </div>

        <dl className="record">
          <dt>Contract</dt>
          <dd>{address}</dd>
          <dt>Network</dt>
          <dd>{chainLabel(chain)}</dd>
          {registration && (
            <>
              <dt>Source</dt>
              <dd>
                {parsedRepo && repoLink ? (
                  <a href={repoLink} target="_blank" rel="noopener noreferrer">
                    {parsedRepo.owner}/{parsedRepo.repo}
                  </a>
                ) : (
                  <span>{displayText(registration.githubRepo, 80) || "none"} (not a plain GitHub link, so it is not linked)</span>
                )}
              </dd>
              {registration.buildHash && (
                <>
                  <dt>Build</dt>
                  <dd>{displayText(registration.buildHash, 66)}</dd>
                </>
              )}
              <dt>Signer</dt>
              <dd>{registration.signer}</dd>
              <dt>Proof</dt>
              <dd>{registration.provenance === "SELF_ATTESTED" ? "None (self-attested)" : METHOD_LABEL[registration.method]}</dd>
              <dt>Registered</dt>
              <dd>{new Date(registration.registeredAt * 1000).toUTCString()}</dd>
              <dt>Registry</dt>
              <dd>
                v{registration.registryVersion} {shorten(registration.registry)}
              </dd>
            </>
          )}
        </dl>

        {(level === "unverified" || level === "self-attested" || level === "stale") && canRegister && (
          <div className="mt-24">
            <Link href={registerHref} className="btn">
              {level === "unverified" ? "Register this contract" : "Register again"}
              <span aria-hidden="true">&rarr;</span>
            </Link>
          </div>
        )}
      </section>

      {result.ok && registration && (
        <section className="panel" aria-label="Evidence">
          <div className="kicker">Evidence</div>
          <div className="mt-24">
            <Checklist rows={buildChecklist(result)} />
          </div>
        </section>
      )}

      {needsTallyJson && registration && (
        <section className="panel" aria-label="Make it verified">
          <div className="kicker">Make it verified</div>
          {registration.registryVersion === 1 ? (
            <p className="hint">
              This record is on the legacy v1 registry, which cannot track code changes, so it stays at control proven.{" "}
              {hasV2 ? "Register it again on v2; the register page then shows the tally.json to publish." : "Once v2 is deployed on this network, register it again; the register page then shows the tally.json to publish."}
            </p>
          ) : (
            <>
              <p className="hint">Add this file to the root of the repository as tally.json (on the default branch). The record turns verified as soon as it is live.</p>
              <div className="mt-24 stack">
                <pre className="code">{tallyJsonSnippet(chain.id, address)}</pre>
                <CopyButton text={tallyJsonSnippet(chain.id, address)} label="Copy tally.json" />
              </div>
            </>
          )}
        </section>
      )}

      <section className="panel" aria-label="Badge">
        <div className="kicker">Live badge</div>
        <div className="mt-24 stack">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/badge/${address}?chain=${chain.key}`} alt={`Tally status for ${shorten(address)}`} height={20} />
          <div className="snippet">
            <code>{`![Tally](${badgeUrl})`}</code>
            <CopyButton text={`![Tally](${badgeUrl})`} label="Copy" />
          </div>
        </div>
      </section>
    </Shell>
  );
}
