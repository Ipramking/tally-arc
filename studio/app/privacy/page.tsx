import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "../components/Nav";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What the Tally studio and the Tally browser extension do with data: look up public information, and nothing else.",
};

export default function PrivacyPage() {
  return (
    <>
      <Nav>
        <Link href="/" className="hide-sm">
          Home
        </Link>
      </Nav>

      <main id="main" className="wrap-narrow">
        <div className="form-head">
          <div className="eyebrow">
            <span className="dot" />
            Privacy
          </div>
          <h1 className="display compact">Nothing to collect.</h1>
          <p className="lede tight">Tally looks up public information. It has no accounts, no tracking and no analytics, and it never sees a private key.</p>
        </div>

        <section className="panel" aria-label="The studio">
          <div className="kicker">This website</div>
          <p className="hint">
            <b>Looking up an address.</b> The server reads public blockchain data and, when a record names a GitHub repository, that repository&apos;s public <span className="mono">tally.json</span>. It
            keeps the answer in memory for 30 seconds so a busy badge does not repeat the work. The addresses involved are public and are not tied to you.
          </p>
          <p className="hint">
            <b>Registering a contract.</b> Your wallet signs in your browser; Tally never receives a key. The page remembers, in your browser only, the network you chose and the contracts you registered from
            it. Clearing the site&apos;s data removes that.
          </p>
          <p className="hint">
            <b>Hosting.</b> The studio runs on Vercel, which keeps standard request logs (IP address, browser and URL) to run and protect the service. The studio adds no cookies, trackers or analytics of its own.
          </p>
        </section>

        <section className="panel" aria-label="The extension">
          <div className="kicker">The browser extension</div>
          <p className="hint">
            <b>What it reads.</b> On the block explorer pages it supports, it reads the contract addresses in the page&apos;s address and links. For each one, its background worker asks the network&apos;s
            public RPC endpoint for the registry record, and asks <span className="mono">raw.githubusercontent.com</span> for the repository&apos;s <span className="mono">tally.json</span>. So the
            addresses on pages you view are sent to those servers, as with any web request. Nothing goes to Tally&apos;s own servers unless you click a badge, which opens that address in the studio.
          </p>
          <p className="hint">
            <b>What it keeps.</b> One setting in its popup: the network you chose last. It collects no browsing history and no personal information, runs no analytics, sells or shares nothing, and loads no
            remote code.
          </p>
        </section>

        <p className="hint">
          Questions or a concern: open an issue on <a href="https://github.com/Ipramking/tally-arc/issues">GitHub</a>. To report a vulnerability, see the repository&apos;s security policy.
        </p>
      </main>
    </>
  );
}
