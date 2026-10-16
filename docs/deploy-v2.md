# Deploying a registry

The registry is deployed once per network. This guide is the procedure for any EVM chain in
[`chains.json`](../chains.json), and for redeploying. Which networks have one today is in
[networks.md](networks.md); this project's own deployments, with their transactions, are listed at the end.
Deploying needs a wallet, so it is done by whoever runs the deployment.

> **Deploying a contract is permanent.** The registry has no owner, no admin key and no
> upgrade path. If you deploy the wrong thing, you cannot change it; you deploy another
> and list it first. Rehearse on a testnet before mainnet.
>
> Never paste a private key into a chat, an issue, a commit or a pull request. It belongs
> in `contracts/.env` (git-ignored), and nowhere else.

## Before you start

- Node 22.12 or newer, and `npm --prefix contracts ci`.
- The chain must be in `chains.json` ([adding-a-chain.md](adding-a-chain.md)). Hardhat reads the
  network from there: the chain key in camelCase is the network name (`my-chain` is `myChain`).
- A **fresh wallet** holding only what the deployment needs, funded in the chain's gas token. The
  registry deploy uses about 2.2M gas and a first registration about 0.25M. Tools reserve gas at their
  fee cap (often twice the base fee) before sending, so hold more than the amount spent. Worked
  example, Arc, where gas is a flat 20 gwei in USDC: about 0.045 USDC to deploy and 0.005 USDC to
  register, so about 0.1 USDC in the wallet.
- `cp contracts/.env.example contracts/.env`, then set `DEPLOYER_PRIVATE_KEY`.
- `npm test` passes on your machine.

## 1. Rehearse on a testnet

Use a testnet in `chains.json` (one with `"testnet": true`). Below, `<network>` is its camelCase key.

```bash
cd contracts
npm run deploy -- --network <network>        # prints the registry address and the chains.json line
npm run deploy:demo -- --network <network>   # an OwnableTarget owned by your deployer wallet
```

Add the registry to that chain in `chains.json` (`{ "version": 2, "address": "0x..." }`), then from the
repo root run `npm run chains:sync`. Register the demo and check it:

```bash
cd contracts
REGISTRY=0x<registry> TARGET=0x<demo> REPO=https://github.com/<you>/<repo> \
  npm run register -- --network <network>
```

Add `{ "chainId": <id>, "address": "0x<demo>", "signer": "0x<the wallet that registered it>" }` to that
repository's `tally.json` (`signer` is required for **verified**), push it, and open
`/c/0x<demo>?chain=<key>` in the studio (`npm --prefix studio run dev`). You should see **Tally Verified**
with every row of the evidence checklist ticked.

## 2. Deploy to mainnet

```bash
cd contracts
npm run deploy -- --network <network>
```

Check the output before moving on: the chain id, the deployer you expect, and the printed registry
address. Copy the address.

## 3. List it, newest first

In `chains.json`, put the new registry at the **top** of the chain's `registries`. If the chain already has
an older registry, keep it below, so its records keep being read:

```json
"registries": [
  { "version": 2, "address": "0x<new registry>" },
  { "version": 1, "address": "0x<older registry, if any>" }
]
```

```bash
npm run chains:sync
npm test
```

## 4. Register a demo contract on it

Register a contract you control and list it in the chain's `presets.verified`, so the home page and the
extension popup have a working example. The wallet that owns (or deployed) the demo must sign:

```bash
cd contracts
REGISTRY=0x<registry> TARGET=0x<demo> REPO=https://github.com/<you>/<repo> \
  npm run register -- --network <network>
```

Then list the demo in your repository's `tally.json`, with `signer`, and push it to the default branch.

## 5. Ship the clients

- Redeploy the studio from the merged commit.
- Reload the extension (`chrome://extensions`, the reload icon). A chain that is new to the table adds
  new site access, and Chrome asks existing users to approve it when the extension updates; that is intended.

## 6. Verify

- `/c/<demo>?chain=<key>` shows **Tally Verified** and a fully ticked checklist.
- `/api/badge/<demo>?chain=<key>` renders a green **verified** badge.
- The extension shows a green badge on the same address on the explorer.

If anything is wrong, **do not** try to fix the deployed registry; correct `chains.json` (for example
remove the bad entry) and deploy another if needed. Clients follow `chains.json`.

## 7. Verify the source on the explorer

Verified source lets anyone read the contract on the explorer and match it to this repository. A chain whose
explorer has an `api` entry in `chains.json` (Blockscout and Etherscan-style explorers) accepts it straight
from Hardhat:

```bash
cd contracts
npx hardhat verify --network <network> 0x<registry>
npx hardhat verify --network <network> 0x<demo> 0x<demo owner>   # constructor arguments follow the address
```

The compiler settings come from `hardhat.config.js` (solc 0.8.24, optimizer at 200 runs, `paris`), so they
match the deployment exactly. For an explorer that a script cannot reach (for example one behind a bot
challenge) leave `api` out of `chains.json` and verify through the explorer's web form with the same
settings. [networks.md](networks.md) shows which of the two each network uses.

## This project's deployments

| Chain | What | Address | Transaction |
|---|---|---|---|
| Arc mainnet (5042) | Registry v2 | `0xd3F1D46675DE21FD3e15D42214d5C67a77631203` | `0x546011b15c995015236464463b0bc9a94112b9ad496d5c44a151cc8a8a62d028` (block 26165146) |
| Arc mainnet (5042) | Demo `0x0f399C0143CAd70b43D18a5696026B0cEdcA0cCb` registered on v2 | | `0x7af97de860047bddf18d4614e93e10c0857bf6efe938a3e49d6565b0d0d07093` (block 26165189) |
| Bohr testnet (968) | Registry v2 | `0x5F514879a3B1fD39e47299706031F6D85c8c9C90` | source verified on scan.bohr.life |
| Bohr testnet (968) | Example: EIP-1967 proxy, owner-proven `0x42144a33b26D08cbFB68cF205AAdE3430eAde600` | | `0x40380588dab24e3a296f7fc13f1911e0fa71221cd08c4b842fa73cb9dde9b937` |
| Bohr testnet (968) | Example: deployer record, then handed to another owner `0x636B032623Fc41c001759fB7abD368Cb1566C9A7` | | `0x5d10f49539ff9948e738c70c503ea7ac930c487f11791340dfde49977321da15` |

On Arc, the deployer and the demo's owner are the same wallet, `0xB2Cd6331395DED6747b9e94b736b8C7edC0947B5`,
which is the `signer` that `tally.json` names for the demo. The Arc explorer sits behind a bot challenge, so
Arc sources are verified through its web form.

The two Bohr examples are synthetic contracts that show where the registry says more than the clients
will. The registry reports both as fully "control current" with unchanged code; Tally reads the first
as **control proven** (an upgradeable proxy is never verified) and the second as **stale** (its deployer
no longer owns it). They are registered under a path inside this repository on purpose and are not
listed in `tally.json`.
