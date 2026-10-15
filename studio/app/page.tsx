import Link from "next/link";
import { Nav } from "./components/Nav";
import { StatusBadge } from "./components/StatusBadge";
import { TallyMark } from "./components/TallyMark";
import { defaultChain, resolveChain, STUDIO_URL } from "@/lib/chain";
import { LEVELS, type Level } from "@/lib/status";

const SOURCE_URL = "https://github.com/Ipramking/tally-arc";

const LEVEL_COPY: { level: Level; title: string; text: string }[] = [
  {
    level: "verified",
    title: "All three agree",
    text: "Control proven on-chain and still held, the code unchanged since registration, and the repository's tally.json lists this contract. Checked live, every time.",
  },
  {
    level: "control-proven",
    title: "Control, no source link",
    text: "The signer proved control and still holds it, but the repository does not confirm the contract yet. Legacy v1 records stop here because v1 cannot watch the code.",
  },
  {
    level: "stale",
    title: "The proof expired",
    text: "Control moved to someone else, or the code at the address changed after it was registered. The record is treated as void.",
  },
  {
    level: "self-attested",
    title: "A claim, labelled as one",
    text: "A repository was claimed with no on-chain proof. Only possible for contracts that have no owner, and it can never be shown as verified.",
  },
  {
    level: "unverified",
    title: "Nobody has vouched",
    text: "No record exists. That is not the same as unsafe; it only means nobody has linked this code to a source.",
  },
  {
    level: "unknown",
    title: "Could not check",
    text: "The network or the registry did not answer. Never shown as unverified, because failing to look is not the same as finding nothing.",
  },
];

const LIMITS: { title: string; text: string }[] = [
  {
    title: "It is not an audit.",
    text: "Verified says who vouches for a contract and where the source lives. It says nothing about whether that source is safe.",
  },
  {
    title: "It does not prove the repository builds to the deployed bytecode.",
    text: "That needs reproducible builds, which Tally does not do yet. The repository check proves the repo owner agrees, not that the code matches.",
  },
  {
    title: "Repositories can change hands.",
    text: "tally.json is read from the default branch at the moment you look. If a GitHub account is renamed or deleted, someone else can claim the old name.",
  },
  {
    title: "Legacy v1 records are weaker.",
    text: "The first registry cannot see ownership changes or code changes, so Tally checks ownership itself and caps v1 records at control proven.",
  },
];

function Seal() {
  // 40 characters fill the circle exactly: the ring is 245 units around and each character takes about 6.
  const ring = "TALLY - CONTRACT PROVENANCE - ON-CHAIN - ";
  return (
    <div className="seal" aria-hidden="true">
      <div className="halo" />
      <div className="ring-text">
        <svg viewBox="0 0 100 100">
          <defs>
            <path id="sealpath" d="M50,50 m-39,0 a39,39 0 1,1 78,0 a39,39 0 1,1 -78,0" />
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

type HomeProps = { searchParams: Promise<{ chain?: string | string[] }> };

export default async function Home({ searchParams }: HomeProps) {
  const { chain: chainParam } = await searchParams;
  // The home page is lenient: an unknown ?chain= falls back to the default network.
  const chain = resolveChain(chainParam) ?? defaultChain;
  const presets = chain.presets;
  const example = presets.verified ?? "0x0000000000000000000000000000000000000000";
  const badge = `![Tally](${STUDIO_URL}/api/badge/0xYourContract?chain=${chain.key})`;

  return (
    <>
      <Nav chain={chain.key}>
        <a href="#proof" className="hide-sm">
          Proof model
        </a>
        <a href="#how" className="hide-sm">
          How it works
        </a>
      </Nav>

      <main id="main">
        <section className="wrap hero">
          <div>
            <div className="eyebrow reveal">
              <span className="dot" />
              Contract provenance
            </div>

            <h1 className="display reveal d1">
              Know the code
              <br />
              <span className="dim">before you sign.</span>
            </h1>

            <p className="lede reveal d2">
              Tally links a deployed contract to its public source and makes the link checkable. A contract only shows as{" "}
              <b>verified</b> when the on-chain proof, the live code and the source repository all agree. Anything less is labelled for what it is.
            </p>

            <div className="cta-row reveal d3">
              <Link href={`/register?chain=${chain.key}`} className="btn">
                Register a contract
                <span aria-hidden="true">&rarr;</span>
              </Link>
              <Link href={`/c/${example}?chain=${chain.key}`} className="btn-ghost">
                <span className="u">See an example record</span>
                <span className="arw" aria-hidden="true">
                  &#8599;
                </span>
              </Link>
            </div>
          </div>

          <div className="seal-stage reveal d2">
            <Seal />
          </div>
        </section>

        <section id="proof" className="wrap section">
          <div className="section-head">
            <h2 className="title">Verified means three things agree.</h2>
            <p className="sub">
              Registering a source link is easy to fake. So Tally checks the claim from three independent directions and only turns green when all of them hold.
            </p>
          </div>

          <div className="triad">
            <div className="cell">
              <h3>1. Control</h3>
              <p>
                The signer proved on-chain that they own, administer or deployed the contract. The registry checks this itself when the record is written, and clients re-check it whenever someone looks.
              </p>
            </div>
            <div className="cell">
              <h3>2. Code</h3>
              <p>
                The registry stores the code hash at registration. If the bytecode at the address ever changes, the record goes stale instead of vouching for code nobody looked at.
              </p>
            </div>
            <div className="cell">
              <h3>3. Source</h3>
              <p>
                The repository publishes a <span className="mono">tally.json</span> that lists the contract and its network. A claim about a repository that does not agree is never shown as verified.
              </p>
            </div>
          </div>
        </section>

        <section className="wrap section">
          <div className="section-head">
            <h2 className="title">Six states. One of them is green.</h2>
            <p className="sub">Every badge, extension tag and record page uses the same rule, so what you see is what the chain supports.</p>
          </div>

          <div className="states">
            {LEVEL_COPY.map((item) => (
              <div className="state" key={item.level}>
                <StatusBadge level={item.level} label={LEVELS[item.level].label} />
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="how" className="wrap section">
          <div className="section-head">
            <h2 className="title">Register, publish, check anywhere.</h2>
            <p className="sub">One signature from the wallet that controls the contract, one small file in the repository.</p>
          </div>

          <div className="steps">
            <div className="step">
              <div className="idx">01</div>
              <h3>Register</h3>
              <p>Sign one EIP-712 message in the studio. The registry checks owner(), the admin role or the deployer address, and records the code hash.</p>
            </div>
            <div className="step">
              <div className="idx">02</div>
              <h3>Publish</h3>
              <p>
                Commit a <span className="mono">tally.json</span> to the repository root listing the contract. It takes one minute and is what turns control proven into verified.
              </p>
            </div>
            <div className="step">
              <div className="idx">03</div>
              <h3>Check</h3>
              <p>The browser extension tags addresses on the explorer, the README badge stays current, and this site shows the evidence behind every level.</p>
            </div>
          </div>
        </section>

        <section className="wrap section">
          <div className="section-head">
            <h2 className="title">A live badge for your README.</h2>
            <p className="sub">The badge reads the chain on every request, so it cannot drift from the truth.</p>
          </div>

          <div className="snippet">
            <code>{badge}</code>
            <span className="tag">SVG &middot; live</span>
          </div>

          <div className="mt-34">
            <div className="kicker">Try it</div>
            <div className="presets mt-24">
              {presets.verified && (
                <Link href={`/c/${presets.verified}?chain=${chain.key}`} className="preset">
                  Registered example
                </Link>
              )}
              {presets.unverified && (
                <Link href={`/c/${presets.unverified}?chain=${chain.key}`} className="preset">
                  Unregistered example
                </Link>
              )}
            </div>
          </div>
        </section>

        <section className="wrap section">
          <div className="section-head">
            <h2 className="title">What Tally does not claim.</h2>
            <p className="sub">A provenance tool that overstates itself is worse than none. These are the limits, stated up front.</p>
          </div>
          <ul className="limits">
            {LIMITS.map((item) => (
              <li key={item.title}>
                <strong>{item.title}</strong>
                {item.text}
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="wrap footer">
        <span>Tally &middot; contract provenance</span>
        <a href={SOURCE_URL} rel="noopener noreferrer">
          Source &amp; security notes
        </a>
      </footer>
    </>
  );
}
