"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="wrap-narrow">
      <div className="form-head">
        <div className="eyebrow">
          <span className="dot" />
          Error
        </div>
        <h1 className="display compact">Something went wrong.</h1>
        <p className="lede tight">The page could not be shown. Nothing was changed on-chain.</p>
        <div className="cta-row">
          <button type="button" className="btn" onClick={reset}>
            Try again
          </button>
          <Link href="/" className="btn-ghost">
            <span className="u">Back home</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
