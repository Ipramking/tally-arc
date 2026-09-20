# Tally — Arc Microgrants submission

Copy-paste blocks for the DoraHacks Arc Microgrants form.

---

## Project name
Tally

## Tagline
Pre-flight contract provenance for Arc mainnet. Know the code before you sign.

## Live deployment (open these)
- Studio (reads Arc mainnet live): https://tally-studio.vercel.app
- Registry contract on Arc mainnet: https://explorer.arc.io/address/0x459Cab32306c439a408cA6b8672CcF6c6A0536d9
- A verified, owner-proven contract: https://tally-studio.vercel.app/c/0x0f399C0143CAd70b43D18a5696026B0cEdcA0cCb

## Public repo
https://github.com/Ipramking/tally-arc

## Public builder profile
https://github.com/Ipramking

---

## Short description (what it does)
Tally links a deployed Arc contract to its public source repository and proves
that link on-chain instead of merely asserting it. If a contract exposes
`owner()`, only that owner can register it, and the registry enforces this: any
other signer is reverted. That record is the only state shown as "Tally
Verified" (green). Contracts with no ownership surface (an EOA or a non-Ownable
contract) are recorded as "self-attested" and clearly labelled unproven, never
faked as verified.

Three surfaces sit on one on-chain registry:
- A Manifest V3 Chrome extension that injects trust badges (Verified /
  Self-attested / Unverified) onto the Arc block explorer, so users get an
  honest signal before they sign.
- A Next.js studio with a one-signature EIP-712 register flow, a human-readable
  provenance page at `/c/<address>`, and a live SVG badge API for READMEs.
- `TallyRegistry.sol`, deployed on Arc mainnet, with a passing test suite that
  includes the anti-squat security test.

## How it uses Arc
Arc is the whole reason the product exists. Because Arc settles gas in native
USDC, account balances and fees are denominated in dollars, so a single
malicious approval or contract call drains real, liquid dollars. Tally surfaces
a trust signal at exactly that moment: before you sign.

Concretely on Arc mainnet (chain ID 5042):
- `TallyRegistry` is deployed and read on Arc mainnet.
- Registrations are transactions paid in Arc's native USDC gas.
- The EIP-712 signing domain is pinned to chain 5042, so a signature is valid
  only on Arc.
- The extension and the badge API read Arc state directly over
  `rpc.mainnet.arc.io`.

## Technical credibility (verified on mainnet)
- Provenance is enforced, not asserted: registering a contract you do not own
  reverts on-chain (verified live with an independent wallet, not the deployer).
- The registry supports relayed registration: the owner signs off-chain and
  pays no gas; a relayer submits and pays the USDC gas. Demonstrated on mainnet.
- `TallyRegistry.sol` ships with a Hardhat suite (4 passing, including the
  anti-squat test) and a free testnet dry-run path.

## What's next (worth taking further)
- A hosted, gasless relayer so users register with a signature and zero gas.
- CI auto-registration on release tags (bind a release to its source at ship
  time).
- Richer pre-sign risk signals in the extension (allowance/approval inspection).

## On-chain addresses (Arc mainnet, chain 5042)
- TallyRegistry: `0x459Cab32306c439a408cA6b8672CcF6c6A0536d9`
- Verified demo contract (owner-proven): `0x0f399C0143CAd70b43D18a5696026B0cEdcA0cCb`

## Payout wallet
Provide a fresh, secure wallet that can receive USDC on Arc. Do not use the
deployer wallet from development.
