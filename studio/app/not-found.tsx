import Link from "next/link";
import { Nav } from "./components/Nav";

export default function NotFound() {
  return (
    <>
      <Nav />
      <main id="main" className="wrap-narrow">
        <div className="form-head">
          <div className="eyebrow">
            <span className="dot" />
            404
          </div>
          <h1 className="display compact">Nothing here.</h1>
          <p className="lede tight">That page does not exist.</p>
          <div className="cta-row">
            <Link href="/" className="btn">
              Back home
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
