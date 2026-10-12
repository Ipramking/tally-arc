import Link from "next/link";
import type { ReactNode } from "react";
import { TallyMark } from "./TallyMark";

export function Nav({ children, chip }: { children?: ReactNode; chip?: string }) {
  return (
    <header className="wrap">
      <nav className="nav" aria-label="Main">
        <Link href="/" className="brand">
          <TallyMark className="mark" />
          <span className="name">Tally</span>
        </Link>
        <div className="nav-links">
          {children}
          {chip && <span className="chip mono">{chip}</span>}
        </div>
      </nav>
    </header>
  );
}
