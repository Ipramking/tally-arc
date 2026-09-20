import Link from "next/link";

/* Tally monogram - five-bar tally count (four strokes + a diagonal). The
   product's namesake, used as the nav mark and the seal's center glyph. */
function TallyMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <g
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <line x1="5" y1="4" x2="5" y2="20" />
        <line x1="10" y1="4" x2="10" y2="20" />
        <line x1="15" y1="4" x2="15" y2="20" />
        <line x1="20" y1="4" x2="20" y2="20" />
        <line x1="3" y1="19" x2="22" y2="5" />
      </g>
    </svg>
  );
}

function Seal() {
  const ring =
    "TALLY · CONTRACT PROVENANCE · ON ARC MAINNET · TALLY · ON-CHAIN · ";
  return (
    <div className="seal" aria-hidden="true">
      <div className="halo" />
      <div className="ring-text">
        <svg viewBox="0 0 100 100">
          <defs>
            <path
              id="sealpath"
              d="M50,50 m-39,0 a39,39 0 1,1 78,0 a39,39 0 1,1 -78,0"
            />
          </defs>
          <text>
            <textPath href="#sealpath" startOffset="0">
              {ring}
            </textPath>
          </text>
        </svg>
      </div>
      <div className="glyph">
        <TallyMark />
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <>
      <header className="wrap">
        <nav className="nav">
          <Link href="/" className="brand">
            <TallyMark className="mark" />
            <span className="name">Tally</span>
          </Link>
          <div className="nav-links">
            <a href="#how" className="hide-sm">
              How it works
            </a>
            <a href="#proof" className="hide-sm">
              Proof model
            </a>
            <span className="chip mono">Arc mainnet · 5042</span>
          </div>
        </nav>
      </header>

      <main>
        {/* Hero ---------------------------------------------------------- */}
        <section className="wrap hero">
          <div>
            <div className="eyebrow reveal">
              <span className="dot" />
              Arc Mainnet
              <span className="sep">/</span>
              USDC-native gas
              <span className="sep">/</span>
              <span style={{ color: "var(--taupe-dim)" }}>Pre-flight</span>
            </div>

            <h1 className="display reveal" style={{ animationDelay: "0.08s" }}>
              Know the code
              <br />
              <span className="dim">before you sign.</span>
            </h1>

            <p className="lede reveal" style={{ animationDelay: "0.22s" }}>
              On Arc, gas is settled in <b>real USDC</b>, so one malicious approval
              drains actual dollars. Tally links a deployed contract to its public
              source and <b>proves control on-chain</b>, so the badge you see is
              earned, not merely claimed.
            </p>

            <div className="cta-row reveal" style={{ animationDelay: "0.34s" }}>
              <Link href="/register" className="btn">
                Register a contract
                <span aria-hidden="true">→</span>
              </Link>
              <Link href="/c/0x0f399C0143CAd70b43D18a5696026B0cEdcA0cCb" className="btn-ghost">
                <span className="u">See a provenance record</span>
                <span className="arw">↗</span>
              </Link>
            </div>
          </div>

          <div className="seal-stage reveal" style={{ animationDelay: "0.2s" }}>
            <Seal />
          </div>
        </section>

        {/* Proof model - the thesis ------------------------------------- */}
        <section id="proof" className="wrap section">
          <div className="section-head">
            <h2 className="title">
              Two states. Only one of them says verified.
            </h2>
            <p className="sub">
              Tally never pretends to verify what the chain can’t check. The
              registry enforces the difference at registration time.
            </p>
          </div>

          <div className="states">
            <div className="state">
              <span className="badge proven">
                <span className="swatch" /> Owner-proven
              </span>
              <h3>The signer is the owner</h3>
              <p>
                The target exposes <span className="mono">owner()</span> and the
                signer <b>is</b> that owner. A strong, on-chain link, and the
                only state shown as <span className="mono">Tally Verified</span>.
              </p>
              <div className="rule">
                Anyone else who tries is reverted on-chain.
              </div>
            </div>

            <div className="state">
              <span className="badge self">
                <span className="swatch" /> Self-attested
              </span>
              <h3>A claim, labelled as one</h3>
              <p>
                The target has no ownership surface (an EOA or non-Ownable
                contract). The claimed source is recorded but shown as{" "}
                <b>unproven</b>: never green, never “verified”.
              </p>
              <div className="rule">
                It can never overwrite an owner-proven record.
              </div>
            </div>
          </div>
        </section>

        {/* How it works - a real sequence ------------------------------- */}
        <section id="how" className="wrap section">
          <div className="section-head">
            <h2 className="title">Detect, sign, settle.</h2>
            <p className="sub">
              The extension reads Arc directly; the studio takes one EIP-712
              signature; a relayer can pay the USDC gas.
            </p>
          </div>

          <div className="steps">
            <div className="step">
              <div className="idx">01</div>
              <h3>Detect</h3>
              <p>
                The extension spots a contract address on the Arc explorer and
                reads its Tally record: proven, self-attested, or unregistered.
              </p>
            </div>
            <div className="step">
              <div className="idx">02</div>
              <h3>Sign</h3>
              <p>
                In the studio you sign one EIP-712 payload pinned to chain 5042.
                No gas leaves your wallet at signing time.
              </p>
            </div>
            <div className="step">
              <div className="idx">03</div>
              <h3>Settle</h3>
              <p>
                The registration lands on Arc. The badge flips to owner-proven
                the moment the chain confirms your control.
              </p>
            </div>
          </div>
        </section>

        {/* Badge for READMEs -------------------------------------------- */}
        <section className="wrap section">
          <div className="section-head">
            <h2 className="title">A live badge for your README.</h2>
            <p className="sub">
              The badge reads Arc on every request, so it can’t drift from the
              on-chain truth.
            </p>
          </div>

          <div className="snippet">
            <code>![Tally](https://tally-studio.vercel.app/api/badge/0xYourContract)</code>
            <span className="tag">SVG · live</span>
          </div>

          <div style={{ marginTop: 34 }}>
            <div className="kicker" style={{ marginBottom: 14 }}>
              Evaluator presets
            </div>
            <div className="presets">
              <Link href="/c/0x0f399C0143CAd70b43D18a5696026B0cEdcA0cCb" className="preset">
                <span className="swatch" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--proven)" }} />
                Preset A · Verified
              </Link>
              <Link href="/c/0x000000000000000000000000000000000000dEaD" className="preset">
                <span className="swatch" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--unverified)" }} />
                Preset B · Unverified
              </Link>
            </div>
            <p className="muted small" style={{ marginTop: 12 }}>
              Swap these for your deployed demo contracts before submission.
            </p>
          </div>
        </section>
      </main>

      <footer className="wrap footer">
        <span>Provenance for Arc</span>
        <span>Chain ID 5042 · USDC gas</span>
      </footer>
    </>
  );
}
