# Contributing

Thanks for helping. Small, focused pull requests are easiest to review.

```bash
npm --prefix contracts ci && npm --prefix studio ci && npm --prefix extension ci
npm test        # chain-table and neutrality checks, then contracts, studio, extension and SDK tests
```

Node 22.12 or newer. [README.md](README.md#development) lists the suites.

What CI enforces, so you can run it first:

- **The chain table is the only place network facts live.** After editing `chains.json`, run `npm run chains:sync` and commit the
  files it regenerates. `npm run chains:check` fails if they are stale, and `npm run neutral:check` fails if source code names a specific
  network, chain id or gas token. Adding a network is [documented](docs/adding-a-chain.md).
- **The trust rules have one test suite.** The studio and the extension implement the same decision rule and are both tested against
  the vectors in [`test-vectors/`](test-vectors). A change to a rule changes the vectors and both implementations together.
- **The deployed registry contracts are not edited,** not even their comments: source verification needs the source to match the
  deployed bytecode. A change to the registry is a new contract, listed first in `chains.json`.
- **Nothing may show a higher trust level than the evidence supports.** A failed read is "unavailable", never "unverified".

Report a vulnerability privately: [SECURITY.md](SECURITY.md). For help using Tally: [SUPPORT.md](SUPPORT.md).
