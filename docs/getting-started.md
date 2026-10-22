# Getting started

Tally is permissionless. There is no account, no API key, no allowlist and no fee to Tally: you pay gas for the
registration transaction and nothing else. You do not need our approval to use it, and what you do depends on who you are.

| You are | Read |
|---|---|
| A team that ships contracts and wants them **Tally Verified** | [Section 1](#1-you-ship-contracts) |
| Building a wallet, explorer, dapp or monitor that should **show** the answer | [Section 2](#2-you-want-to-show-or-check-the-answer) |
| Running a **chain** and want it supported | [Section 3](#3-you-run-a-chain) |
| Wondering what you can rely on | [Section 4](#4-what-you-can-rely-on) |

The reference pages are [integrating.md](integrating.md) (the API, the library, on-chain reads), [security.md](security.md)
(what a level means and what it does not), [networks.md](networks.md) (every supported network and registry) and
[adding-a-chain.md](adding-a-chain.md).

## 1. You ship contracts

**You need:** the wallet that owns the contract (`owner()`), holds its default admin role, or deployed it with a plain
`CREATE`; a public GitHub repository; and a little gas in the network's token (for example about 0.005 USDC on Arc).

1. **Register.** Open the [register page](https://tallyarc.tech/register), pick the network, connect the wallet,
   enter the contract and its repository, run **Check what can be proven**, sign once and approve one transaction. From a
   script: `REGISTRY=0x... TARGET=0x... REPO=https://github.com/you/project npm run register -- --network <name>` in `contracts/`.
2. **Publish `tally.json`** at the root of that repository, on the default branch. The register page shows the exact file:
   ```json
   { "version": 1, "contracts": [ { "chainId": 12345, "address": "0x...", "signer": "0xTheWalletThatRegistered" } ] }
   ```
   `signer` is required: the repository has to name the wallet that registered.
3. **Check that it worked,** any one of these:
   - the record page `https://tallyarc.tech/c/<address>?chain=<key>` reads **Tally Verified** with every row of the
     evidence list ticked;
   - `curl "https://tallyarc.tech/api/lookup/<address>?chain=<key>"` returns `"level": "verified"`;
   - in your repository, `npx -p tally-provenance tally-verify` ends with `1 checked: 1 ok`.

   GitHub caches raw files for a few minutes, so a new `tally.json` can take that long to show.
4. **Show it.** Put the badge in your README, `![Tally](https://tallyarc.tech/api/badge/<address>?chain=<key>)`.
   People with the browser extension see it next to your address on the explorer.
5. **Keep it true.** Add the [GitHub Action](integrating.md#check-tallyjson-in-ci) so a record that went stale fails a build
   instead of misleading a user. Register again after an upgrade or redeploy that changes the code, and after a hand-over
   (the new owner registers and the repository's `signer` line is updated).

**When it is not green**

| You see | Why | What to do |
|---|---|---|
| Control proven, repository "has no tally.json" or "does not list this contract" | The file is missing, is not on the default branch, or GitHub has not refreshed yet | Commit `tally.json` at the root of the default branch and wait a few minutes |
| Control proven, "does not name the wallet" | The entry has no `signer` | Add `"signer": "<the wallet that registered>"` |
| Control proven, "names a different wallet" | The file's `signer` is not the wallet that signed | Fix the file, or register again from the listed wallet |
| Control proven, "upgradeable proxy" | An EIP-1967 proxy was detected: its code hash does not change when its implementation does | Expected. A proxy cannot be verified, whatever the repository says |
| Control proven, "legacy v1 registry" | The record is on the first registry, which cannot see code changes | Register again on v2 |
| Stale, control moved | The contract has a new owner (or a deployer's contract now has another owner) | The new owner registers, and the `signer` line is updated |
| Stale, code changed | An upgrade or redeploy changed the code at the address | Register again |
| Self-attested | A claim with no on-chain proof, only possible for a contract with no owner | It can never be green. To be provable, a contract needs an `owner()` or an admin role, or has to be deployed directly by the registering wallet |
| Unverified | Nobody has registered it on this network | Register it |
| Unavailable | The chain, a registry or GitHub could not be read | Try again. Never read it as unverified |

## 2. You want to show or check the answer

- **Checking one contract:** the record page, the badge, the [browser extension](../README.md#using-tally), or the API call above.
- **Showing it in a product:** `GET /api/lookup/<address>?chain=<key>` returns the level, a label, one plain sentence and the
  evidence as JSON. Show `label` and `summary` as they are, treat a `503` as "could not check", and never turn the level
  into a score of your own. The shape, the status codes and the caching are in [integrating.md](integrating.md#json-api).
- **In code:** `npm install tally-provenance` gives `lookup()` for any chain you can describe, plus the `tally-verify` command.
- **From a contract:** read `getRegistration(target)`, and see the warning in [integrating.md](integrating.md#read-the-registry-from-a-contract)
  about what the registry's own flags do not tell you.

## 3. You run a chain

Tally works on any EVM chain; a network is one entry in [`chains.json`](../chains.json). What a chain needs (standard RPC methods,
the `paris` EVM version, `/address/` and `/tx/` explorer links, an RPC that allows browser requests for the register page) is in
[adding-a-chain.md](adding-a-chain.md). There are two ways to make it official.

**On the hosted studio and the shared extension**

1. Rehearse on your testnet: add the chain to `chains.json`, deploy the registry (`npm run deploy -- --network <name>`, see
   [deploy-v2.md](deploy-v2.md)), list its address, run `npm run chains:sync`, register a demo contract, publish its `tally.json`, and
   see **Tally Verified**. The Bohr testnet entry is a worked example.
2. Repeat on mainnet, and publish the registry's source on your explorer.
3. Open a pull request with the `chains.json` change and the files `chains:sync` regenerates. CI checks that they are in sync, that no
   source code names a network, and that every suite passes.
4. After the merge, the maintainer redeploys the hosted studio and ships an extension update. That is a manual step today. Chrome
   asks existing extension users to approve the new site access.

**On your own copy.** Fork the repository, set `studioUrl` and your chains in `chains.json`, run `npm run chains:sync`, and deploy
`studio/` (a standard Next.js app on Node 22.12 or newer; on Vercel, set the root directory to `studio`). Optionally read a chain
through your own RPC with `TALLY_RPC_URL_<KEY>`. Build your own extension with `npm --prefix extension run pack`
([chrome-web-store.md](chrome-web-store.md)). The library and the Action take your chain table too: `--chains chains.json`, or
the Action's `chains:` input. Your studio, API and badges then run on your terms, with your own availability. A third party has not yet
run this end to end, so tell us where it snags.

## 4. What you can rely on

- **The registry is immutable.** It has no owner, no admin and no upgrade path, and its address on a network never changes. A fix ships as
  a new registry listed first; records on the old one stay readable.
- **The hosted studio and API are best effort,** with no uptime promise. Answers are cached for 30 seconds. The JSON has a `schema`
  field that changes only when a field is removed or changes meaning. If you need guarantees, run your own.
- **The package and the Action follow semver.** `tally-provenance` has no runtime dependencies. The Action's `v1` tag moves forward for
  compatible fixes.
- **It has not been audited,** and it is provenance, not safety: a badge says whose name is on a contract and where its source lives.
  [security.md](security.md) lists exactly what is and is not checked, including the known limits (proxies beyond EIP-1967, what "control"
  means, repository identity).
- **Records and their history are public and permanent.** A revoke removes the current record, not the history.

Questions, bugs and chain requests: [SUPPORT.md](../SUPPORT.md). To report a vulnerability: [SECURITY.md](../SECURITY.md).
