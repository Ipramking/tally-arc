# tally-provenance

Ask whether a smart contract's source is vouched for, on any EVM chain, and fail CI when a repository's
`tally.json` and the chain disagree. This is the [Tally](https://tally-studio.vercel.app) lookup code the studio and
the browser extension run, as a package.

No runtime dependencies. Node 20 or newer (it uses the global `fetch`).

## Look a contract up

```js
const { lookup, getChain, describe } = require("tally-provenance"); // or: import { lookup } from "tally-provenance"

const chain = getChain("bot-testnet"); // by key or chain id; null if the bundled table lacks it (keys: docs/networks.md)
const result = await lookup({ chain, address: "0x...", timeoutMs: 15000 });

if (!result.ok) {
  // The chain or a registry could not be read. This is NOT "unverified".
} else {
  console.log(result.level, describe(result.level, result.registration, result.repo));
}
```

`result.level` is `verified`, `control-proven`, `stale`, `self-attested`, `unverified`, `wallet` or `unknown`. What each
means, and what none of them means (no audit, no safety rating), is in the
[trust levels](https://github.com/Ipramking/tally-arc#trust-levels) and the
[security model](https://github.com/Ipramking/tally-arc/blob/master/docs/security.md).

**Another network.** `lookup` takes any chain object, so a network the bundled table does not list works too:

```js
const chain = {
  key: "my-chain",
  id: 12345,
  name: "My Chain",
  rpcUrl: "https://rpc.my-chain.example", // https only
  registries: [{ version: 2, address: "0x..." }], // newest first
};
```

Prefer the hosted JSON API when you do not want to make RPC calls yourself:
`GET https://tally-studio.vercel.app/api/lookup/<address>?chain=<key>`.

## Check `tally.json` in CI

```
npx -p tally-provenance tally-verify
```

or `tally-verify` once the package is installed. It reads `./tally.json` and, for every contract listed, requires that:

- a registry on that chain has a record for it;
- the record names this repository (`--repository owner/name`, or `$GITHUB_REPOSITORY`);
- the entry names the wallet that registered (`"signer"`), because **verified** needs it;
- the record still holds: control has not moved and the code has not changed.

An upgradeable proxy, a legacy-registry record and a self-attested record are warnings (failures with `--strict`).
The file is judged as it is in your checkout, so a pull request that edits `tally.json` is checked with its own edit.

| Exit code | Meaning |
|---|---|
| 0 | every contract passes |
| 1 | a record and the file disagree |
| 2 | something could not be checked (the chain did not answer); this never counts as a pass |

Options: `--file`, `--repository`, `--chains <file>` (networks the bundled table lacks), `--strict`, `--json`, `--timeout`.

### As a GitHub Action

```yaml
# .github/workflows/tally.yml
on:
  push:
    paths: [tally.json]
  schedule:
    - cron: "17 6 * * 1" # weekly: a record can go stale after an upgrade
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Ipramking/tally-arc@v1
        with:
          strict: "false"
```

It prints annotations on `tally.json` and a table in the job summary.

## Licence

MIT.
