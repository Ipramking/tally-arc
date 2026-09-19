import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

// Self-hosted at build time - no runtime Google Fonts request. Plex Sans carries
// the display/body voice; Plex Mono is leaned on for Tally's native vernacular:
// addresses, hashes, signatures, network params.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

const title = "Tally · Contract Provenance for Arc Mainnet";
const description =
  "Know the code before you sign. Tally proves, on-chain, that a deployed Arc contract is linked to its public source. Owner-proven, not just claimed.";

export const metadata: Metadata = {
  metadataBase: new URL("https://tally-studio.vercel.app"),
  title,
  description,
  openGraph: { title, description, siteName: "Tally", type: "website" },
  twitter: { card: "summary_large_image", title, description },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>
        {/* Film grain - a fixed, subtle texture across every surface. */}
        <div className="grain" aria-hidden="true" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
