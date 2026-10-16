# Deploying registry v2

v2 is deployed on Arc mainnet (`0xd3F1D46675DE21FD3e15D42214d5C67a77631203`, 2026-10-15) and on
BOT Chain's Bohr testnet. This guide is the procedure for deploying it on another chain, or
redeploying it. Deploying needs a wallet, so it is done by the repository owner.

> **Deploying a contract is permanent.** The registry has no owner, no admin key and no
> upgrade path. If you deploy the wrong thing, you cannot change it; you deploy another
> and list it first. Rehearse on testnet before mainnet.
>
> Never paste a private key into a chat, an issue, a commit or a pull request. It belongs
> in `contracts/.env` (git-ignored), and nowhere else.

## Before you start

- Node 22.12 or newer, and `npm --prefix contracts ci`.
- A **fresh wallet** holding only what the deployment needs. On Arc, gas is paid in USDC and the
  base fee is a flat 20 gwei: the registry deploy uses about 2.22M gas (about 0.045 USDC) and
  registering a demo about 0.005 USDC. Tools reserve gas at their fee cap (often twice the base
  fee) before sending, so hold about 0.1 USDC, not just what is spent.
- `cp contracts/.env.example contracts/.env`, then set `DEPLOYER_PRIVATE_KEY`.
- `npm test` passes on your machine.

## 1. Rehearse on testnet (free)

Arc Testnet (chain `5042002`, faucet at https://faucet.circle.com) is already in
`chains.json`.

```bash
cd contracts
npm run deploy:arcTestnet            # prints the registry address and the chains.json line
npm run deploy:demo:arcTestnet       # an OwnableTarget owned by your deployer wallet
```

Add the registry to `arc-testnet` in `chains.json` (`{ "version": 2, "address": "0x..." }`),
then from the repo root `npm run chains:sync`. Register the demo and check it:

```bash
cd contracts
REGISTRY=0x<registry> TARGET=0x<demo> REPO=https://github.com/<you>/<repo> \
  npx hardhat run scripts/register.js --network arcTestnet
```

Add `{ "chainId": 5042002, "address": "0x<demo>", "signer": "0x<the wallet that registered it>" }`
to that repository's `tally.json` (`signer` is required for **verified**), push it, and open `/c/0x<demo>?chain=arc-testnet` in the studio (`npm --prefix studio run dev`).
You should see **Tally Verified** with every row of the evidence checklist ticked.

## 2. Deploy to mainnet

```bash
cd contracts
npm run deploy:arc
```

Check the output before moving on: chain id `5042`, the deployer you expect, and the
printed registry address. Copy the address.

## 3. List it, newest first

In `chains.json`, put the new registry at the **top** of `arc.registries` and keep v1 below it,
so existing v1 records keep being read:

```json
"registries": [
  { "version": 2, "address": "0x<new v2 registry>" },
  { "version": 1, "address": "0x459Cab32306c439a408cA6b8672CcF6c6A0536d9" }
]
```

```bash
npm run chains:sync
npm test
```

## 4. Register the demo contract on v2

The demo (`0x0f399C0143CAd70b43D18a5696026B0cEdcA0cCb`) is owned by the wallet that deployed
it, so that wallet must sign:

```bash
cd contracts
REGISTRY=0x<new v2 registry> TARGET=0x0f399C0143CAd70b43D18a5696026B0cEdcA0cCb \
REPO=https://github.com/Ipramking/tally-arc \
  npx hardhat run scripts/register.js --network arc
```

This repository's [`tally.json`](../tally.json) already lists the demo, so once the file is on
the default branch the record can reach **verified**.

## 5. Ship the clients

- Redeploy the studio from the merged commit.
- Reload the extension (`chrome://extensions`, the reload icon). `chains.json` adds no new hosts for
  this change, so Chrome shows no new permission prompt.

## 6. Verify

- `/c/0x0f399C0143CAd70b43D18a5696026B0cEdcA0cCb?chain=arc` shows **Tally Verified** and a fully
  ticked checklist.
- `/api/badge/0x0f399C0143CAd70b43D18a5696026B0cEdcA0cCb?chain=arc` renders a green **verified** badge.
- The extension shows a green badge on the same address on the explorer.

If anything is wrong, **do not** try to fix the deployed registry; correct `chains.json` (for example
remove the bad entry) and deploy another if needed. Clients follow `chains.json`.

## Verify the source on the explorer

Verified source lets anyone read the contract on the explorer and match it to this repository.
Blockscout explorers, including BOT Chain's Bohr testnet and mainnet, accept it straight from Hardhat:

```bash
cd contracts
npx hardhat verify --network botTestnet 0x<registry>
npx hardhat verify --network botTestnet 0x<demo> 0x<demo owner>   # constructor arguments follow the address
```

The compiler settings come from `hardhat.config.js` (solc 0.8.24, optimizer at 200 runs, `paris`), so
they match the deployment exactly. The networks that can be verified this way are listed in
`VERIFY_API` in that file; add a chain there once its explorer accepts verification. Arc's explorer
sits behind a bot challenge that a script cannot pass, so Arc contracts are verified through the
explorer's web form instead.

Example: the Bohr testnet registry, verified at
https://scan.bohr.life/address/0x5F514879a3B1fD39e47299706031F6D85c8c9C90#code (the explorer shows the
license as "none" because the plugin does not send the license type).

## Deployments

| Chain | What | Address | Transaction |
|---|---|---|---|
| Arc mainnet (5042) | Registry v2 | `0xd3F1D46675DE21FD3e15D42214d5C67a77631203` | `0x546011b15c995015236464463b0bc9a94112b9ad496d5c44a151cc8a8a62d028` (block 26165146) |
| Arc mainnet (5042) | Demo `0x0f399C0143CAd70b43D18a5696026B0cEdcA0cCb` registered on v2 | | `0x7af97de860047bddf18d4614e93e10c0857bf6efe938a3e49d6565b0d0d07093` (block 26165189) |
| Bohr testnet (968) | Registry v2 | `0x5F514879a3B1fD39e47299706031F6D85c8c9C90` | source verified on scan.bohr.life |

On Arc, the deployer and the demo's owner are the same wallet, `0xB2Cd6331395DED6747b9e94b736b8C7edC0947B5`,
which is the `signer` that `tally.json` names for the demo.
