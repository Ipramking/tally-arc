import Link from "next/link";

export default function Home() {
  return (
    <main className="wrap">
      <div className="brand">
        <span className="mark" />
        <span className="name">TALLY</span>
        <span className="net">Arc Mainnet · 5042 · USDC gas</span>
      </div>

      <h1>Cryptographic provenance for Arc contracts.</h1>
      <p className="lede">
        On Arc, gas is real dollars — a malicious approval drains USDC directly.
        Tally links a deployed contract to its public source, and{" "}
        <b>proves control on-chain</b> instead of just claiming it.
      </p>

      <div className="card">
        <div className="spread" style={{ justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 700 }}>Register a contract</div>
            <div className="muted small">
              Sign an EIP-712 payload; a relayer submits it on Arc.
            </div>
          </div>
          <Link href="/register">
            <button>Open register →</button>
          </Link>
        </div>

        <hr />

        <div style={{ fontWeight: 700, marginBottom: 8 }}>
          1-click evaluator presets
        </div>
        <div className="presets">
          <Link href="/register?address=0x0000000000000000000000000000000000000000">
            <button className="ghost">Preset A · Verified</button>
          </Link>
          <Link href="/register?address=0x000000000000000000000000000000000000dEaD">
            <button className="ghost">Preset B · Unverified</button>
          </Link>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          Replace the preset addresses with your deployed demo contracts before
          submission.
        </p>
      </div>

      <p className="muted small" style={{ marginTop: 24 }}>
        Badge for your README:{" "}
        <code>![Tally](https://tally.build/api/badge/0xYourContract)</code>
      </p>
    </main>
  );
}
