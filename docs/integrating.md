# Integrating Tally

New to Tally? [getting-started.md](getting-started.md) is the short, ordered path; this page is the reference.

Tally answers one question about a deployed contract: *has anyone put their name to its source, and does
the evidence hold up right now?* This page is for four kinds of reader: people checking a contract,
teams registering one, products that want to show the answer, and chains that want to be supported.
It works the same on every network in [networks.md](networks.md); `<key>` below is a network key from there.

What the answers mean is in the [README](../README.md#trust-levels). What they do **not** mean (no audit,
no safety rating, no proof the source builds to the bytecode) is in [security.md](security.md).

## 1. Check a contract

- **Studio:** `https://tally-studio.vercel.app/c/<address>?chain=<key>` shows the level, the evidence behind it
  and the registration history.
- **Extension:** badges on the explorer pages of every network in the table, and a lookup popup. There is no
  store listing yet: open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and select the
  [`extension/`](../extension) folder.
- **Badge:** `https://tally-studio.vercel.app/api/badge/<address>?chain=<key>` is an SVG that always answers `200`.

## 2. Register your contract

You need the wallet that **owns** the contract (`owner()`), holds its **default admin role**, or **deployed** it
with a plain `CREATE`. About five minutes, and one transaction in the network's gas token (for example about
0.005 USDC on Arc).

1. Open the studio's [register page](https://tally-studio.vercel.app/register), pick the network and connect the
   wallet. It switches to the network for you.
2. Enter the contract and its GitHub repository, then **Check what can be proven**, sign one message, and
   approve one transaction.
3. Commit a `tally.json` to the repository root, on the default branch. The register page shows the exact file:

   ```json
   { "version": 1, "contracts": [ { "chainId": 12345, "address": "0x...", "signer": "0xTheWalletThatRegistered" } ] }
   ```

   `signer` is required for **verified**: the repository has to name the wallet that registered.
4. Add the badge to your README.

After that the record reads **Tally Verified**. Three things will move it back, and all three are intended:

- the contract's code changes (an upgrade, a redeploy at the same address): the record goes **stale**; register again;
- control moves to another owner: **stale** until the new owner registers (a hand-over is explicit on both sides);
- the contract is an upgradeable proxy: it stops at **control proven**, because a proxy's code hash does not change
  when its implementation does.

**From a script:** `REGISTRY=0x... TARGET=0x... REPO=https://github.com/you/project npm run register -- --network <name>`
from `contracts/`. It needs the wallet's key in `contracts/.env`, so keep it out of CI.

**Multisig or smart-account owners:** the registry accepts ERC-1271 signatures, so a Safe or another smart account can be
the owner and the signer. The contract path is tested against the real Safe v1.4.1 contracts
([`contracts/test/safe.test.js`](../contracts/test/safe.test.js)): a 2-of-3 Safe registers a contract it owns, relayed by an
account that is not an owner. The recipe: build the claim, take its digest from `registry.hashClaim(claim)`, have the
owners sign the Safe message for that digest, concatenate their signatures in ascending owner-address order, and let any
account call `register(claim, signature)`. What has **not** been tried is doing this through the studio's register page
with a live Safe connected over WalletConnect; the page signs with the connected wallet, and whether a Safe returns its
signature to a dapp in time depends on the Safe client.

## 3. Show the answer in your product

### JSON API

```
GET https://tally-studio.vercel.app/api/lookup/<address>?chain=<key>
```

Without `chain` the default network in `chains.json` is used, and the response always says which. Example, for the
demo contract on Arc:

```json
{
  "schema": 1,
  "ok": true,
  "level": "verified",
  "label": "Tally Verified",
  "summary": "The signer proved control on-chain, the code is unchanged, and the repository lists this contract and names the signer's wallet.",
  "chain": { "key": "arc", "id": 5042, "name": "Arc" },
  "address": "0x0f399C0143CAd70b43D18a5696026B0cEdcA0cCb",
  "registration": {
    "registry": "0xd3F1D46675DE21FD3e15D42214d5C67a77631203",
    "registryVersion": 2,
    "signer": "0xB2Cd6331395DED6747b9e94b736b8C7edC0947B5",
    "provenance": "CONTROL_PROVEN",
    "method": "OWNER",
    "registeredAt": 1792104282,
    "controlCurrent": true,
    "codeCurrent": true,
    "upgradeable": false,
    "buildHash": ""
  },
  "repository": { "url": "https://github.com/Ipramking/tally-arc", "owner": "Ipramking", "repo": "tally-arc" },
  "repoCheck": { "status": "confirmed", "bound": true, "tallyJson": "https://raw.githubusercontent.com/Ipramking/tally-arc/HEAD/tally.json" },
  "links": {
    "record": "https://tally-studio.vercel.app/c/0x0f399C0143CAd70b43D18a5696026B0cEdcA0cCb?chain=arc",
    "badge": "https://tally-studio.vercel.app/api/badge/0x0f399C0143CAd70b43D18a5696026B0cEdcA0cCb?chain=arc",
    "explorer": "https://explorer.arc.io/address/0x0f399C0143CAd70b43D18a5696026B0cEdcA0cCb"
  }
}
```

- `level` is one of `verified`, `control-proven`, `stale`, `self-attested`, `unverified`, `wallet` or `unknown`.
  Show `label` and `summary` as they are; do not map them to a colour or a score of your own.
- **Status codes.** `200` is an answer, including `unverified` and `wallet`. `400` is a bad address or chain (the body
  lists the known chains). `503` means the chain or a registry could not be read: the body has `level: "unknown"`.
  Treat that as "could not check", **never** as "unverified".
- `registration`, `repository` and `repoCheck` are `null` when there is nothing to report. Nothing in the body is free
  text from the chain or from GitHub: the repository is reduced to a parsed owner and name.
- CORS is open and answers are cached for 30 seconds. It is a best-effort public service with no SLA; if you need
  guarantees, run your own studio (it is open source; `TALLY_RPC_URL_<KEY>` points it at your own RPC).
- `schema` changes only when a field is removed or changes meaning.

### Embed the badge or link to the record

`![Tally](https://tally-studio.vercel.app/api/badge/<address>?chain=<key>)` and
`https://tally-studio.vercel.app/c/<address>?chain=<key>`.

### Use the library

[`sdk/`](../sdk) is `tally-provenance`: the same lookup code the studio's rules are tested against, dependency-free
and typed, for Node 20+ and bundlers: `npm install tally-provenance`.

```js
const { lookup, getChain } = require("tally-provenance");

const chain = getChain("my-chain"); // from the bundled table, by key or chain id; or pass your own chain object
const r = await lookup({ chain, address, timeoutMs: 15000 });
// r.ok, r.level, r.registration, r.repo, r.error
```

`lookup` takes any chain object (`key`, `id`, `name`, an https `rpcUrl`, `registries`), so a network the bundled table
does not list works too. See [`sdk/README.md`](../sdk/README.md).

### Check `tally.json` in CI

`tally-verify` (in the same package) and the GitHub Action fail a build when a repository's `tally.json` and the chain
disagree: a listed contract with no record, a record naming another repository or another wallet, a record that went
stale after an upgrade or a hand-over, or an entry without `signer`. A proxy, a legacy-registry record and a
self-attested record are warnings (failures with `strict`). The file is judged as it is in the checkout, so a pull
request that edits `tally.json` is checked with its own edit.

```yaml
# .github/workflows/tally.yml
on:
  push:
    paths: [tally.json]
  schedule:
    - cron: "17 6 * * 1" # weekly: a record goes stale after an upgrade nobody re-registered
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Ipramking/tally-arc@v1
```

Exit codes: `0` all good, `1` a record and the file disagree, `2` the chain could not be read (never a pass).
This repository runs the same action on its own `tally.json`.

### Read the registry from a contract

`getRegistration(target)` returns the record and two flags: bit 0 is "control still held", bit 1 is "code unchanged".
A contract that gates on provenance should require `provenance == 2` (control proven), `flags == 3`, and
`method` of `1` (owner) or `2` (admin role). That is **control proven**, not **verified**: the registry cannot see the
repository check, and it reports a deployer's record as current forever, so do not accept `method == 3` for anything
that matters. If proxies are possible, also check the EIP-1967 implementation and beacon slots yourself.

## 4. Add your network

Edit one file and run one command; the studio, the extension, the deploy scripts and the network list all follow.
[adding-a-chain.md](adding-a-chain.md) has the steps and what a chain needs (standard RPC methods, `paris` EVM,
`/address/` and `/tx/` explorer links). [deploy-v2.md](deploy-v2.md) is the careful procedure for deploying the
registry, which is immutable and has no owner.

## 5. Trying it for real

A sensible order, each step cheap and reversible until the last:

1. **Read-only, now.** Look up contracts you know on a live network, in the studio or the API. Nothing to install.
2. **Testnet rehearsal.** Register a contract you control on a testnet that has a registry, publish `tally.json`, and
   watch it go from *unverified* to *control proven* to *verified*.
3. **Pilot on mainnet.** Register one or two of your own contracts. It costs one transaction each. Records and their
   history are public and permanent (a revoke removes the current record, not the history), and the registry has not
   been audited, so describe the badge as provenance, never as a safety rating.
4. **Wire it in.** Call the API from your wallet, explorer or dapp, add the badge to your READMEs, and run the
   GitHub Action so a record that goes stale after an upgrade fails a build instead of being found by a user.

Known limits (proxies beyond EIP-1967, what "control" means, repository identity) are listed in
[security.md](security.md#7-what-is-not-covered).
