import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "../components/Nav";
import { RegisterForm } from "./RegisterForm";
import { chainLabel, resolveChain } from "@/lib/chain";
import { isAddress } from "@/lib/safe-url";

export const metadata: Metadata = { title: "Register a contract" };

type Props = { searchParams: Promise<{ address?: string | string[]; chain?: string | string[] }> };

export default async function RegisterPage({ searchParams }: Props) {
  const params = await searchParams;
  const chain = resolveChain(params.chain);
  const address = typeof params.address === "string" && isAddress(params.address) ? params.address : "";

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
            EIP-712 &middot; one signature
          </div>
          <h1 className="display compact">Register provenance.</h1>
          <p className="lede tight">
            Sign once to link a contract to its source. The registry checks that your wallet really controls the contract, and the record only turns <b>verified</b> after the
            repository confirms it too.
          </p>
        </div>

        {chain ? (
          <RegisterForm chain={chain} initialAddress={address} />
        ) : (
          <div className="panel">
            <p className="hint">This studio does not know that network. Check the link you followed, or start from the home page.</p>
          </div>
        )}
      </main>
      <div className="pad-bottom" />
    </>
  );
}
