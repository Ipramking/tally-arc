/* Tally monogram: a five-bar tally count (four strokes crossed by a diagonal).
   The product's namesake, used as the nav mark and the seal's centre glyph. */
export function TallyMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="5" y1="4" x2="5" y2="20" />
        <line x1="10" y1="4" x2="10" y2="20" />
        <line x1="15" y1="4" x2="15" y2="20" />
        <line x1="20" y1="4" x2="20" y2="20" />
        <line x1="3" y1="19" x2="22" y2="5" />
      </g>
    </svg>
  );
}
