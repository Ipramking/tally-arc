import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "../components/Nav";
import { RegisterForm } from "./RegisterForm";
import { resolveChain } from "@/lib/chain";
import { isAddress } from "@/lib/safe-url";

export const metadata: Metadata = { title: "Register a contract" };

type Props = { searchParams: Promise<{ address?: string | string[]; chain?: string | string[] }> };

export default async function RegisterPage({ searchParams }: Props) {
  const params = await searchParams;
  const chain = resolveChain(params.chain);
  const address = typeof params.address === "string" && isAddress(params.address) ? params.address : "";

  return (
    <>
      <Nav chain={chain?.key}>
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

        {chain && (
          <p className="banner" role="note">
            <b>Registering is for the wallet that controls a contract.</b> The registry checks owner(), the admin role or the deployer address, and refuses everyone else. If you only want to know whether a
            contract is verified, you do not need this page.
            {address && (
              <>
                {" "}
                <Link href={`/c/${address}?chain=${chain.key}`}>Open this contract&apos;s record instead</Link>.
              </>
            )}
          </p>
        )}

        {chain ? (
          <RegisterForm key={chain.key} chain={chain} initialAddress={address} />
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
