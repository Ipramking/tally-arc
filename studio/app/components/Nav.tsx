import Link from "next/link";
import type { ReactNode } from "react";
import { ChainSwitch } from "./ChainSwitch";
import { TallyMark } from "./TallyMark";
import { WalletButton } from "./WalletButton";

/** `chain` is a chain key: it shows the network picker. `chip` is plain text, for pages with no network in play. */
export function Nav({ children, chip, chain }: { children?: ReactNode; chip?: string; chain?: string }) {
  return (
    <header className="wrap">
      <nav className="nav" aria-label="Main">
        <Link href="/" className="brand">
          <TallyMark className="mark" />
          <span className="name">Tally</span>
        </Link>
        <div className="nav-links">
          {children}
          {chain ? <ChainSwitch current={chain} /> : chip && <span className="chip mono">{chip}</span>}
          <WalletButton />
        </div>
      </nav>
    </header>
  );
}
