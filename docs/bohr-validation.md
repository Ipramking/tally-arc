# Bohr validation report

A run of the BOT Chain Testnet (Bohr, chain 968) checklist on **17 October 2026**, against the live studio
(https://tally-studio.vercel.app) and the real chain, at commit `7b5e0b1819636dd902a91f50642221d12817076d`
([CI green](https://github.com/Ipramking/tally-arc/actions/runs/38945044570)). The registry is v2,
[`0x5F514879a3B1fD39e47299706031F6D85c8c9C90`](https://scan.bohr.life/address/0x5F514879a3B1fD39e47299706031F6D85c8c9C90#code),
source verified on the explorer.

This is a rehearsal by the maintainer, not the partner's review. How each part was run is stated next to it, and what was **not**
tested is listed at the end. Checks 1 to 7 ran on 17 October; check 8, a person using MetaMask, ran on 18 October.

## Results

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | A registered contract reads **Tally Verified** | Pass | `0xEC84…4452`: the record page, the badge (`tally \| verified`) and the JSON API all say verified. The repository check is `confirmed` and `bound: true` against this repo's `tally.json`. |
| 2 | An upgradeable proxy is never verified | Pass | `0x4214…e600`: **Control proven**, `upgradeable: true`, badge `control proven`. The explorer labels it "Proxy" too. |
| 3 | A contract handed to a new owner is stale | Pass | `0x636B…C9A7`: registered by its deployer, then `owner()` moved to `0x…dEaD`. It reads **Stale record** although the registry itself still calls the record current. |
| 4 | Registration through the register page | Pass, with a scripted wallet | See below. |
| 5 | The repository must name the registering wallet | Pass | Against live chain data: the right `signer` verifies, no `signer` fails (`signer-missing`), someone else's `signer` fails (`signer-mismatch`). |
| 6 | The extension on the Bohr explorer | Pass, in headless Chrome | The badge appears on `scan.bohr.life` for the demo (Tally Verified), the proxy (Control proven), the stale contract (Stale record) and the contract registered in check 4 (Control proven). Each links to the studio's record page. |
| 7 | The toolbar popup | Pass, in headless Chrome | A lookup on Bohr returns Tally Verified for the demo, with the signer shown. |
| 8 | A person registers with a real browser wallet and the contract ends **Tally Verified** | Pass, on the second attempt | MetaMask on a fresh wallet, the live register page, then `tally.json`. See below. |

**Check 8 in detail.** A person used MetaMask in a normal Chrome profile with the unpacked extension loaded, on a brand-new wallet
(`0xD6b8…2eE0`, funded with 0.5 test BOT) and a fresh contract it owns, `0xB758588f964c6EBceeafAd31c355a49c6ba7DB98` (created in
`0x027c4b7c…4ab5`). The register page added and switched to Bohr, found the wallet as `owner()`, took one signature and one transaction,
and the record read **Control proven** (signer `0xD6b8…2eE0`, method `OWNER`) with the extension's badge on the explorer. After the
repository's `tally.json` listed the contract and named that wallet (commit `e294624`), the record page and the explorer badge both read
**Tally Verified**. The registering transaction is
[`0x0a4be4ac…c039`](https://scan.bohr.life/tx/0x0a4be4ace09dca4a820ea9f73d809df90544c11ac77bf7f4c43b37a7f5c1c039) (block 27316211, 243,464 gas,
success). A captioned recording of the run exists. The first attempt did not complete, for the reason in the next section.

**A stale machine behind Bohr's public RPC.** `rpc.bohr.life` is one address in front of several nodes, and during check 8 at least one of
them was frozen at block 27311921, more than 4,700 blocks (over an hour) behind the rest. Roughly a third of requests reached it. Sampling
the same address 14 to 16 times returned heads of 27311921 and 27315xxx interleaved, and a wallet's nonce flipping between 0 and 1. The
effects seen: a transaction MetaMask submitted was accepted and never mined, so the next one queued behind it; the register page showed an
RPC error (`Cannot destructure property 'gasLimit'`, which is not a contract revert); and a lookup that reached the stale node answered
"no record" for a contract that was registered. Retrying, after clearing MetaMask's pending activity, completed the registration. It is
the node operator's to fix. For Tally it means a lookup can be wrong on a lagging node, and a freshness check on the chain head is a
possible mitigation. It matters for mainnet if `rpc.botchain.ai` is served the same way.

**Check 4 in detail.** A scripted EIP-1193 wallet (in headless Chrome 154, signing with the Bohr test wallet, so real signatures and real
transactions) drove the live register page for a fresh contract, `0x7Fa0DB5582650cab4387fd0C024cC438c63b3be4`:

1. The page found the wallet. Connecting switched it from chain 1 to Bohr by adding the chain with the right id (`0x3c8`), name, `BOT`
   symbol, RPC and explorer.
2. "Check what can be proven" reported that the wallet owns the contract, so the record would be control proven.
3. One signature and one transaction, then "Registered. The record is on-chain." with a link to the transaction on the explorer.
4. The record page and the JSON API read **Control proven**, signer `0x4e01…52a6`, method `OWNER`. It is not verified, as expected: the
   repository's `tally.json` does not list it. The page had already offered the exact file to publish, merged with the existing entries.

**Check 5 in detail.** `tally-verify` judges the file in hand, so the three cases can be run on the live demo without touching GitHub:

```
{ "chainId": 968, "address": "0xEC84…4452", "signer": "0x4e01…52a6" }  -> verified, exit 0
{ "chainId": 968, "address": "0xEC84…4452" }                            -> signer-missing, exit 1
{ "chainId": 968, "address": "0xEC84…4452", "signer": "0x2222…2222" }  -> signer-mismatch, exit 1
```

## Transactions

All on Bohr; open one at `https://scan.bohr.life/tx/<hash>`.

| What | Transaction |
|---|---|
| Registry v2 deployed | `0xd7a049e8321ae44043a96e58554b80be9cd71be3ce08da4aa675be7756d61b4b` |
| Demo `0xEC84…4452` registered | `0x78f8d6b50c94e144b924cebf52f0373f7f76d9151125256ca9c781faf68d48ba` (block 26983832) and `0x9d0f16cce3b64a9b49329b49170f2053b0ff4e5be9d041e4540a7b6ff91e25cb` (block 26983836) |
| Proxy `0x4214…e600` registered | `0x40380588dab24e3a296f7fc13f1911e0fa71221cd08c4b842fa73cb9dde9b937` (block 27065480) |
| Stale example `0x636B…C9A7` created, registered, handed over | `0xc9856d241317af1d3471c9f9428c2c5e8f97e647363a99176a8c5eeba4223159`, `0x5d10f49539ff9948e738c70c503ea7ac930c487f11791340dfde49977321da15`, `0x7386c31d1bb80c3c0c53a259df18f8ea5502cfca00872bf03dbcc09d438528a0` |
| Check 4: contract deployed | `0x2d71ad6548383b2c02c17c544f57b8aa7095d9bc9b6e2c2341985e7db6bbf1dd` (block 27208412) |
| Check 4: registered through the register page | `0xefb8213f8d30a082a025868fef099d3fa3bb3a70e965cef504e7e1b082e74f25` (block 27208734, 226,364 gas) |
| Check 8: contract `0xB758…DB98` created | `0x027c4b7c14ff506517fce5246c349ff78b286fe350233f9319c74a24f4bc4ab5` |
| Check 8: registered with MetaMask | `0x0a4be4ace09dca4a820ea9f73d809df90544c11ac77bf7f4c43b37a7f5c1c039` (block 27316211, 243,464 gas) |

## Not tested

- **Wallets other than MetaMask.** Check 8 used MetaMask. Rabby, a hardware wallet and mobile wallets were not tried.
- **A contract reaching Tally Verified through its own new GitHub repository.** Check 8 took a new contract to Tally Verified through this
  repository's `tally.json`. A team's own fresh repository was not run.
- **The extension from the Chrome Web Store, and the toolbar popup in a normal profile.** Check 8 ran the unpacked extension in a normal
  Chrome profile (explorer badges). The store listing is not published, and the popup was only checked in headless Chrome (check 7).
- **Multisig or smart-account owners through the studio.** The contract path is tested against real Safe contracts; the page with a live
  Safe is not.
- **Mainnet.** Nothing is deployed. See below for what was checked read-only.

## Automated tests

Contracts 80, studio 219, extension 145, SDK 38, all passing in CI at the commit above, plus the chain-table and neutrality checks.

## BOT Chain mainnet, read-only

Nothing was sent. On `rpc.botchain.ai`: chain id 677, every RPC method Tally uses answers, CORS allows the studio's origin, and the explorer API
responds. Deploying the registry is 2,240,016 gas, about 0.045 BOT at the current 20 gwei (about 0.09 BOT if a tool reserves a 2x fee cap);
a registration is about 0.25M gas, about 0.005 BOT. The chain entry is prepared in
[draft pull request #9](https://github.com/Ipramking/tally-arc/pull/9), not to be merged until the checks above are confirmed.

## Repeat the read-only checks

```bash
curl "https://tally-studio.vercel.app/api/lookup/0xEC84A560DF15cCb86d96c86Bb61d8CEB1c744452?chain=bot-testnet"
curl "https://tally-studio.vercel.app/api/lookup/0x42144a33b26D08cbFB68cF205AAdE3430eAde600?chain=bot-testnet"
curl "https://tally-studio.vercel.app/api/lookup/0x636B032623Fc41c001759fB7abD368Cb1566C9A7?chain=bot-testnet"
npx -p tally-provenance tally-verify --file tally.json --repository Ipramking/tally-arc
```
