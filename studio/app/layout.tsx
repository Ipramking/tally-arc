import type { Metadata, Viewport } from "next";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-sans/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "./globals.css";
import { STUDIO_URL } from "@/lib/chain";

// Every page is rendered per request so the Content-Security-Policy nonce
// created in proxy.ts can be applied to the framework's scripts.
export const dynamic = "force-dynamic";

const title = "Tally: contract provenance you can check";
const description =
  "Know the code before you sign. Tally links a deployed contract to its public source, and only says verified when the on-chain proof, the live code and the repository agree.";

export const metadata: Metadata = {
  metadataBase: new URL(STUDIO_URL),
  title: { default: title, template: "%s | Tally" },
  description,
  openGraph: { title, description, siteName: "Tally", type: "website" },
  twitter: { card: "summary_large_image", title, description },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Film grain: a fixed, subtle texture across every surface. */}
        <div className="grain" aria-hidden="true" />
        <a className="skip" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
