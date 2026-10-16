# Tally: project summary

Copy-paste blocks for grant forms and applications. Keep it in step with the code: the
claims below are the ones the current repository supports.

---

## Project name
Tally

## Tagline
Contract provenance you can check. Know the code before you sign.

## Links
- Studio: https://tally-studio.vercel.app
- Registry v2 on Arc mainnet: https://explorer.arc.io/address/0xd3F1D46675DE21FD3e15D42214d5C67a77631203
- Registry v1 on Arc mainnet: https://explorer.arc.io/address/0x459Cab32306c439a408cA6b8672CcF6c6A0536d9
- Demo contract and its record: https://tally-studio.vercel.app/c/0x0f399C0143CAd70b43D18a5696026B0cEdcA0cCb
- Public repo: https://github.com/Ipramking/tally-arc
- Builder profile: https://github.com/Ipramking

---

## Short description (what it does)
Tally links a deployed smart contract to its public source repository and makes that
link checkable instead of merely asserted. A registry records that the signer proved
control of the contract on-chain (as its owner, an admin, or its deployer) together with
the contract's code hash. A contract only shows as **verified** when that proof still holds,
the code is unchanged, and the repository's own `tally.json` lists the contract. Anything
less is labelled for what it is: control proven, stale, self-attested, unverified, or
unavailable.

Three surfaces share one decision rule:
- A Manifest V3 Chrome extension that tags addresses on the block explorer.
- A Next.js studio with a one-signature EIP-712 register flow, record pages that show the
  evidence behind every level, and a live SVG badge for READMEs.
- `TallyRegistryV2.sol` (EIP-712, ERC-1271, code-hash tracking, append-only history, no owner
  and no upgrade path), deployed on Arc mainnet alongside the original `TallyRegistry.sol`.

## How it uses Arc
Arc settles gas in native USDC, so a single malicious approval or contract call costs real
dollars. Tally puts a trust signal in front of the user at exactly that moment.

On Arc mainnet (chain ID 5042):
- The v2 registry takes new registrations and the v1 registry is still read; both are deployed
  and read live by every client.
- Registrations are transactions paid in Arc's native USDC gas, and the EIP-712 signing domain
  is bound to the chain and the registry address.
- The extension and the badge API read Arc state directly over its public RPC. Networks and
  registry addresses live in one file, `chains.json`, so adding another chain is a one-file change.

## Technical credibility
- The security model is written down, including what Tally does **not** claim (it is not an
  audit, and it does not prove a repository builds to the deployed bytecode):
  `docs/security.md`.
- The v1 registry's weaknesses are pinned by tests, and v2 fixes them (rank-based updates so
  squatters cannot lock anyone out, ERC-1271 for multisig owners, code-hash tracking, validated
  repository strings, gas-capped probes of hostile contracts).
- The studio's ABIs and EIP-712 types, and the extension's byte-level decoder, are checked against
  the real compiled contracts, and all three packages run in CI.
- Clients treat every registry and repository string as hostile input: strict link parsing,
  text-only rendering, a nonce-based Content-Security-Policy, and a failure to read the chain
  shows "unavailable" rather than a misleading "unverified".
- Status: v2 is deployed on Arc mainnet (and on BOT Chain's Bohr testnet) but has not had an external
  audit.

## What's next
- Run an external audit before real value depends on it.
- A hosted, gasless relayer so users register with a signature and zero gas.
- CI auto-registration on release tags, binding a release to its source at ship time.
- Reproducible-build verification, so "verified" can eventually say the source compiles to the
  deployed bytecode.

## On-chain addresses (Arc mainnet, chain 5042)
- Registry v2: `0xd3F1D46675DE21FD3e15D42214d5C67a77631203`
- Registry v1: `0x459Cab32306c439a408cA6b8672CcF6c6A0536d9`
- Demo contract: `0x0f399C0143CAd70b43D18a5696026B0cEdcA0cCb`

## Payout wallet
Given directly in each grant form: a fresh wallet that can receive USDC on Arc, separate
from the wallet used for deployment.
