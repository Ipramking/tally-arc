# Tally — brand

The oldest, most honest way humans record truth, applied to smart contracts.

## The mark
A tally keeps a count you can't fudge: one real stroke per real thing, and the
fifth stroke crosses the other four to close the set. That crossing stroke is
Tally's thesis in one glyph — **proof completes the record.** It is also the
product's name, so mark and wordmark are the same thought. Ancient, plain, and
un-fakeable: the same three things the registry is. Owner-proven is green,
self-attested is honestly labelled, squatters are reverted on-chain. The logo
looks like that on purpose: no gradient, no gloss, just marks.

## Tokens
| Token | Hex | Use |
|---|---|---|
| Ink | `#0a0a0b` | canvas / icon background (never pure black) |
| Cream | `#f4f2ec` | mark, wordmark, body (never pure white) |
| Seal green | `#34d399` | spent ONLY on "proven" / verified, never decoration |

Typeface: **IBM Plex Sans** (display/body) + **IBM Plex Mono** (wordmark, labels,
addresses, hashes). Mono because it is the native language of what Tally verifies.

## Assets
- `tally-mark.svg` — monogram, uses `currentColor` (recolor anywhere)
- `tally-icon.svg` / `tally-icon-green.svg` — rounded-square icon
- `tally-lockup.svg` — horizontal mark + wordmark
- `png/` — rendered exports (icon 1024/512, transparent mark, lockups)

`render.py` regenerates the PNGs (it expects IBM Plex Mono SemiBold as
`PlexMono-SemiBold.ttf`, an open-licence font, not committed here).
