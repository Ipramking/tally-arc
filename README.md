# Tally — Pre-Flight Contract Provenance for Arc Mainnet

Tally links a deployed contract on **Arc Mainnet** (Chain ID `5042`, USDC as
native gas) to its **public source repository**, and — crucially — **proves
control on-chain** rather than merely asserting it.

On Arc, gas is settled in USDC, so a single malicious `approve` or contract call
drains real dollars. Tally gives users a fast, honest trust signal *before* they
sign, and gives developers a durable, verifiable link between their bytecode and
their code.

> This repo is the shipped vertical slice for **Circle's Arc Microgrants**
> (DoraHacks). It is intentionally small and end-to-end: a deployed contract, a
> browser badge, and a one-signature register flow.

**Live studio:** https://tally-studio.vercel.app  ·  **Register:** https://tally-studio.vercel.app/register

---

## What's inside

| Path | What it is |
|---|---|
| [`contracts/`](contracts) | `TallyRegistry.sol` + Hardhat tests + Arc deploy script |
| [`extension/`](extension) | Manifest V3 Chrome extension — injects badges on `explorer.arc.io`, 1-click evaluator presets |
| [`studio/`](studio) | Next.js app — `/register` EIP-712 sign flow + dynamic Markdown badge API |

## The core idea: *enforced* provenance

The registry does **not** pretend to verify things it can't. Two levels:

- **`OWNER_PROVEN`** — the target contract exposes `owner()` and the signer
  **is** that owner. Strong, on-chain-verifiable link. This is the only state
  shown as **"Tally Verified"** (green).
- **`SELF_ATTESTED`** — the target has no `owner()` surface (an EOA or a
  non-Ownable contract). The claim is recorded but shown as **"Self-attested
  (unproven)"** (blue), never as verified.

Anyone attempting to register a contract they don't own is **reverted** — see
the passing test `REJECTS an attacker trying to claim provenance…`.

## Quick start

### 1. Contracts

```bash
cd contracts
npm install
npm test            # 4 passing, incl. the anti-squat security test
cp .env.example .env   # add DEPLOYER_PRIVATE_KEY (wallet funded with USDC)
npm run deploy:arc     # deploys to Arc Mainnet, prints the address
```

Take the printed `REGISTRY_ADDRESS` and paste it into:
- `extension/config.js` → `REGISTRY_ADDRESS`
- `studio/.env.local` → `NEXT_PUBLIC_REGISTRY_ADDRESS`

### 2. Studio (register flow + badge API)

```bash
cd studio
npm install
cp .env.local.example .env.local   # set NEXT_PUBLIC_REGISTRY_ADDRESS
npm run dev                        # http://localhost:3000
```

- `/register?address=0x…` — connect wallet, sign EIP-712, submit on Arc.
- `/api/badge/0x…` — live SVG badge:
  `![Tally](https://tally-studio.vercel.app/api/badge/0xYourContract)`

> Tip: rehearse the whole flow for free on **Arc Testnet** first
> (`NEXT_STEPS.md` → Phase 0): `npm run deploy:arcTestnet`, fund via
> `faucet.circle.com`, set `NEXT_PUBLIC_ARC_CHAIN_ID=5042002`.

### 3. Extension

```bash
cd extension
node make-icons.js   # generates icons/ (only needed once)
```

Then load `extension/` as an **unpacked** extension at `chrome://extensions`
(Developer mode on). Visit an `explorer.arc.io/address/0x…` page, or click the
toolbar icon and use the 1-click demo presets.

## Verified Arc parameters (as of Sep 2026)

| | |
|---|---|
| Chain ID | `5042` (`0x13b2`) |
| RPC | `https://rpc.mainnet.arc.io` |
| Explorer | `https://explorer.arc.io` |
| Native gas | USDC (18 decimals at protocol level) |

Source: [arc.io](https://arc.io) / docs.arc.io. Always confirm endpoints there
to avoid phishing RPCs.

## How Arc is used (microgrant requirement)

- **Deployment target:** `TallyRegistry.sol` lives on Arc Mainnet.
- **Native USDC gas:** registration transactions pay gas in USDC; the deploy
  script reports the deployer's USDC balance as native currency.
- **EIP-712 domain** is pinned to `chainId 5042`, so signatures are only valid
  for Arc.
- The extension and badge API read Arc state directly over `rpc.mainnet.arc.io`.

## Submission checklist

- [x] `TallyRegistry.sol` — enforced provenance, 4 passing Hardhat tests (incl. anti-squat)
- [x] Public repo — [github.com/Ipramking/tally-arc](https://github.com/Ipramking/tally-arc)
- [x] Studio live on Vercel — [tally-studio.vercel.app](https://tally-studio.vercel.app) (`/register` EIP-712 flow + badge API)
- [x] MV3 extension — badge injection + 1-click evaluator presets, testnet-aware
- [x] Testnet dry-run wired end-to-end (chain `5042002`, one env switch)
- [ ] Deployed to Arc Mainnet, `REGISTRY_ADDRESS` documented here
- [ ] `NEXT_PUBLIC_REGISTRY_ADDRESS` set on Vercel + `extension/config.js` wired
- [ ] Demo target registered → real evaluator presets (replace placeholder addresses)
- [ ] 1-minute demo video
- [ ] DoraHacks submission under Arc Microgrants

## License

MIT — see [LICENSE](LICENSE).
