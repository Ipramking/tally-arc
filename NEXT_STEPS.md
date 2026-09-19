# Tally — Submission Playbook (what's left)

Everything from here to a submitted Arc Microgrants entry. The code is built and
verified; the remaining work is deploy → wire → demo → submit.

**Status at last checkpoint (commit `d2cb184`):**
- `contracts/` — ✅ 4/4 tests pass (incl. the anti-squat security test)
- `studio/` — ✅ `next build` passes, all 5 routes compile
- `extension/` — ✅ MV3 loads unpacked, icons generated, selector wired
- Not done yet: deploy to Arc, fill in addresses, host studio, push repo, submit.

> ⚠️ **Only Phase 1 needs money + your private key. Never paste the key into
> chat, into a repo, or anywhere but `contracts/.env` (which is gitignored).**

---

## Phase 0 — Testnet dry-run  *(free — do this first)*

Rehearse the entire flow on **Arc Testnet** before spending a cent on mainnet.
Testnet USDC gas is free from the Circle faucet, and everything is wired to
switch with one env var / one commented block.

| Field | Value |
|---|---|
| Network name | `Arc Testnet` |
| Chain ID | `5042002` |
| RPC URL | `https://rpc.testnet.arc.io` |
| Currency symbol | `USDC` |
| Block explorer | `https://explorer.testnet.arc.io` |
| Faucet | `https://faucet.circle.com` |

1. Add Arc Testnet to your wallet (values above) and grab free USDC from
   `faucet.circle.com`.
2. **Deploy the registry to testnet:**
   ```bash
   cd contracts
   cp .env.example .env      # paste DEPLOYER_PRIVATE_KEY
   npm run deploy:arcTestnet     # prints the testnet REGISTRY_ADDRESS
   ```
3. **Deploy a demo target you own** (so you can show the green owner-proven
   badge):
   ```bash
   npm run deploy:demo:arcTestnet   # prints an OwnableTarget address you own
   ```
4. **Point the studio at testnet** — in `studio/.env.local`:
   ```
   NEXT_PUBLIC_ARC_CHAIN_ID=5042002
   NEXT_PUBLIC_REGISTRY_ADDRESS=<testnet registry from step 2>
   ```
   Run `npm run dev`, open `/register`, and register the demo target while
   connected as its owner → it resolves to **OWNER_PROVEN** (green).
5. **Point the extension at testnet** — in `extension/config.js`, comment the
   MAINNET block and uncomment TESTNET, and set `REGISTRY_ADDRESS` to the
   testnet registry. The content script already runs on
   `explorer.testnet.arc.io`. Load unpacked and open the demo target's page.
6. Confirm badge API: `http://localhost:3000/api/badge/<demo-target>` → verified.

When the whole loop works on testnet, repeat Phases 1–2 on mainnet with
confidence. **Remember to switch the studio and extension back to mainnet
(`NEXT_PUBLIC_ARC_CHAIN_ID=5042`, MAINNET block) before the real submission.**

---

## Phase 1 — Wallet + USDC on Arc  *(you; funds + keys)*

1. In an EVM wallet (e.g. MetaMask), add the Arc network:
   | Field | Value |
   |---|---|
   | Network name | `Arc` |
   | Chain ID | `5042` |
   | RPC URL | `https://rpc.mainnet.arc.io` |
   | Currency symbol | `USDC` |
   | Block explorer | `https://explorer.arc.io` |
2. Get a **small amount of USDC onto Arc** for gas (a few dollars is plenty).
   Use the official bridge (see `docs.arc.io`) or a supported exchange
   withdrawal. Always confirm endpoints on arc.io / docs.arc.io — never a link
   from a DM or search ad.
3. Export the deployer wallet's private key (MetaMask → Account details → Show
   private key). Keep it private.

## Phase 2 — Deploy the contract  *(you run)*

```bash
cd contracts
cp .env.example .env      # then paste DEPLOYER_PRIVATE_KEY into .env
npm run deploy:arc
```

Output prints `TallyRegistry deployed at: 0x…` plus an explorer link.
**Copy that address** — call it `REGISTRY_ADDRESS`. If it errors, save the
output; it's usually gas (fund more USDC) or RPC (retry).

Record it here once deployed:

```
REGISTRY_ADDRESS = 0x________________________________________
Deployed tx / explorer: https://explorer.arc.io/address/0x____
```

## Phase 3 — Wire the address in  *(2 files)*

- `extension/config.js` → set `REGISTRY_ADDRESS`
- `studio/.env.local` (copy from `studio/.env.local.example`) →
  set `NEXT_PUBLIC_REGISTRY_ADDRESS`

## Phase 4 — Create the demo presets

You want one contract you **own** so it shows owner-proven green.

1. Deploy a tiny demo target you own (see the helper `deploy:demo` script if
   added), or reuse any contract whose `owner()` is your wallet.
2. Register it through the studio `/register` page (Phase 5) → it becomes
   `OWNER_PROVEN`.
3. In `extension/config.js`:
   - `PRESETS.VERIFIED` = that registered contract's address
   - `PRESETS.UNVERIFIED` = any unregistered address (e.g. `0x…dEaD`)
4. In `studio/app/page.tsx`, update the two preset `href` addresses to match.

## Phase 5 — Test locally  *(you click)*

```bash
cd studio
npm run dev            # http://localhost:3000
```

- Visit `/register`, connect wallet, register a contract, confirm the tx on Arc.
- Load `extension/` unpacked at `chrome://extensions` (enable Developer mode).
- Open an `explorer.arc.io/address/0x…` page → badge should inject.
- Click the toolbar icon → try both 1-click presets.

## Phase 6 — Host the studio  *(so the extension hand-off works publicly)*

Deploy `studio/` to Vercel:
1. Push the repo (Phase 7) and import it in Vercel, root directory `studio`.
2. Set env var `NEXT_PUBLIC_REGISTRY_ADDRESS` (and optionally
   `NEXT_PUBLIC_ARC_RPC_URL`).
3. Point `extension/config.js` `STUDIO_URL` at the deployed URL (or your
   `tally.build` domain).
4. Confirm the badge API responds: `https://<studio-url>/api/badge/<REGISTRY_ADDRESS>`

## Phase 7 — Public repo

```bash
cd "C:/Users/lenovo/Documents/Tally Arc"
git remote add origin https://github.com/<you>/tally-arc.git
git push -u origin main
```

(If your default branch is `master`, push that, or rename first with
`git branch -M main`.)

## Phase 8 — Demo video + submit

- Record a ~1-minute screen capture: register flow → tx on Arc explorer →
  extension badge flipping Unverified → Verified.
- Submit at https://dorahacks.io/hackathon/arc-microgrants/detail with:
  - live `REGISTRY_ADDRESS` on Arc mainnet
  - public repo URL
  - short "what you built" + "how Arc is used" text (see below)
  - your public builder profile

---

## Requirement → where it's satisfied

| Microgrant requirement | Satisfied by |
|---|---|
| Live deployment on Arc mainnet | `TallyRegistry` deployed (Phase 2) |
| Public repo | Phase 7 |
| Short description of what you built | Draft below |
| Explain how Arc is being used | Draft below + README "How Arc is used" |
| Public builder profile | Your DoraHacks profile |

---

## Draft submission text (edit freely)

**What you built**
> Tally is a pre-flight security and contract-provenance suite for Arc Mainnet.
> An on-chain registry (`TallyRegistry`) links a deployed contract to its public
> source repo, and *enforces* that link: if the contract exposes `owner()`, only
> that owner can register it (owner-proven), otherwise it's clearly labelled
> self-attested — never faked as verified. A Manifest V3 Chrome extension injects
> Verified / Self-attested / Unverified badges on the Arc explorer so users get a
> trust signal before they sign, and a Next.js studio provides a one-signature
> EIP-712 registration flow plus a live README badge API.

**How Arc is used**
> The registry is deployed and read on Arc Mainnet (chain ID 5042). Registrations
> are transactions paid in Arc's native USDC gas, and the EIP-712 signing domain
> is pinned to chain 5042 so signatures are valid only on Arc. Because Arc settles
> gas in USDC, a malicious approval drains real dollars — which is exactly the risk
> Tally's pre-flight badge is built to surface. The extension and badge API query
> Arc state directly over `rpc.mainnet.arc.io`.

---

## Things Claude can do solo (just ask)

- [ ] `deploy:demo` helper script (deploys an Ownable target you own → easy Phase 4)
- [ ] Vercel config + env list for the studio
- [ ] Polished demo-video shot list / narration
- [ ] `hardhat verify` / publish-ABI setup for the explorer

## Verified Arc parameters (as of 2026-09)

| | |
|---|---|
| Chain ID | `5042` (`0x13b2`) |
| RPC | `https://rpc.mainnet.arc.io` |
| Testnet RPC | `https://rpc.testnet.arc.io` (chain `5042002`) |
| Explorer | `https://explorer.arc.io` |
| Native gas | USDC (18 decimals at protocol level) |

Source: arc.io / docs.arc.io. The original PDF's `rpc.arc.network` was wrong.
