// Shared OpenGraph / Twitter card body, imported by the two image routes.
// Kept out of the route files themselves so neither route re-exports the other
// (@vercel/og mishandles a re-exported default at build time).
export const ogSize = { width: 1200, height: 630 };
export const ogAlt = "Tally · Contract Provenance for Arc Mainnet";
export const ogContentType = "image/png";

// Rendered by Satori: every element with more than one child sets display:flex.
export function OgCard() {
  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#0a0a0b",
        color: "#f4f2ec",
        padding: "72px 80px",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
            <g stroke="#f4f2ec" strokeWidth="2" strokeLinecap="round">
              <line x1="5" y1="4" x2="5" y2="20" />
              <line x1="10" y1="4" x2="10" y2="20" />
              <line x1="15" y1="4" x2="15" y2="20" />
              <line x1="20" y1="4" x2="20" y2="20" />
              <line x1="3" y1="19" x2="22" y2="5" />
            </g>
          </svg>
          <div style={{ marginLeft: 18, fontSize: 30, letterSpacing: 8 }}>
            TALLY
          </div>
        </div>
        <div style={{ fontSize: 22, letterSpacing: 4, color: "#8b877b" }}>
          ARC MAINNET · 5042
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 82, fontWeight: 700, letterSpacing: -2, lineHeight: 1.02 }}>
          Know the code
        </div>
        <div
          style={{
            fontSize: 82,
            fontWeight: 700,
            letterSpacing: -2,
            lineHeight: 1.02,
            color: "#cbc8bf",
          }}
        >
          before you sign.
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center" }}>
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: 7,
            background: "#34d399",
            marginRight: 16,
          }}
        />
        <div style={{ fontSize: 26, color: "#8b877b" }}>
          Owner-proven contract provenance on Arc. Not just claimed.
        </div>
      </div>
    </div>
  );
}
