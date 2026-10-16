# Tally brand

The oldest way to keep a count, applied to smart contracts.

## The mark
A tally keeps a count that is hard to fudge: one stroke per thing, and the fifth stroke
crosses the other four to close the set. That crossing stroke is the idea behind the
product in one glyph: **proof completes the record.** The product is named after it, so
the mark and the wordmark say the same thing. Plain and hard to fake, like the registry.
Owner-proven is green, self-attested is labelled as such, and squatters are reverted
on-chain. The logo is flat on purpose: no gradient, no gloss, just marks.

## Tokens
| Token | Hex | Use |
|---|---|---|
| Ink | `#0a0a0b` | canvas and icon background (never pure black) |
| Cream | `#f4f2ec` | mark, wordmark, body (never pure white) |
| Seal green | `#34d399` | used only for "proven" and verified, never decoration |

Typeface: **IBM Plex Sans** (display and body) and **IBM Plex Mono** (wordmark, labels,
addresses, hashes). Mono because it is the native language of what Tally verifies.

## Assets
- `tally-mark.svg`: monogram, uses `currentColor` (recolour anywhere)
- `tally-icon.svg` / `tally-icon-green.svg`: rounded-square icon
- `tally-lockup.svg`: horizontal mark and wordmark
- `png/`: rendered exports (icon 1024/512, transparent mark, lockups)

`render.py` regenerates the PNGs (it expects IBM Plex Mono SemiBold as
`PlexMono-SemiBold.ttf`, an open-licence font that is not committed here).
