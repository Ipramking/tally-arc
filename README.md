<p align="center">
  <img src="brand/png/tally-lockup-ink.png" alt="Tally" width="360" />
</p>

# Tally: contract provenance you can check

Tally links a deployed smart contract to its public source repository and makes
that link **checkable**. A contract is only shown as **verified** when three
independent things agree:

1. **Control**: the signer proved on-chain that they own, administer or deployed
   the contract, and still do.
2. **Code**: the bytecode at the address is unchanged since the record was written.
3. **Source**: the repository's `tally.json` lists this contract on this network and names the wallet that registered it.

An upgradeable proxy is never shown as verified, because its code hash does not change when its implementation does.
Anything less is labelled for what it is.

Tally is chain-neutral. It works on any EVM chain, and a network is one entry in
[`chains.json`](chains.json): the studio, the extension and the deploy scripts all read it, and CI fails if
source code names a specific network. It is live today on Arc and on BOT Chain's Bohr testnet.
[docs/networks.md](docs/networks.md) lists every network with its registry addresses and an example
verified contract, and [docs/adding-a-chain.md](docs/adding-a-chain.md) shows how to add yours.

**Studio:** https://tallyarc.tech

**Start here:** [docs/getting-started.md](docs/getting-started.md) takes a team from nothing to Tally Verified, shows how to check and
show the answer, and says what a chain needs to be supported.

## Status

| | |
|---|---|
| Registry | **v2** ([`TallyRegistryV2.sol`](contracts/contracts/TallyRegistryV2.sol)) is immutable, has no owner, and is the only registry that can reach **verified**. The original **v1** is still read where it was deployed and is capped at **control proven** (it cannot see code changes). Deployed registries: [docs/networks.md](docs/networks.md). Deploying another: [docs/deploy-v2.md](docs/deploy-v2.md). |
| This repository's contracts | Listed in [`tally.json`](tally.json), the file this project uses to prove its own demo contracts. |
| External audit | None yet. See [docs/security.md](docs/security.md) for what has and has not been checked. |

## Trust levels

Every surface (explorer badge, README badge, record page) uses the same rule, so
what you see is what the chain supports.

| Level | Colour | Meaning |
|---|---|---|
| **Verified** | green | v2 record, control proven and still held, code unchanged, not an upgradeable proxy, and the repository lists the contract and names the wallet that signed. |
| **Control proven** | blue | Control proven and still held, but the repository is unconfirmed or names no wallet, the contract is an upgradeable proxy, or the record is on legacy v1. |
| **Stale** | amber | Control moved to someone else (a deployer stops counting once the contract has another owner), or the code changed after registration. Treated as void. |
| **Self-attested** | grey | A claim with no on-chain proof. Only possible for contracts that have no owner. Never green. |
| **Unverified** | red | No record exists. |
| **Unavailable** | hollow | The chain or registry could not be read. Never shown as unverified: failing to look is not the same as finding nothing. |

## What is in the repo

| Path | What it is |
|---|---|
| [`contracts/`](contracts) | `TallyRegistryV2.sol` (EIP-712, ERC-1271, code-hash tracking), the original `TallyRegistry.sol` (v1, deployed, untouched), Hardhat tests, deploy and register scripts |
| [`studio/`](studio) | Next.js app: record pages with the evidence behind every level, the register flow, a live SVG badge API |
| [`extension/`](extension) | Manifest V3 Chrome extension: badges on the block explorer and a lookup popup |
| [`sdk/`](sdk) | `tally-provenance`: the lookup library and the `tally-verify` command, for other packages and for CI (`npm install tally-provenance`) |
| [`action.yml`](action.yml) | A GitHub Action that runs `tally-verify`: it fails the build when `tally.json` and the on-chain records disagree |
| [`chains.json`](chains.json) | The single source of truth for networks and registry addresses |
| [`tally.json`](tally.json) | This repository's own provenance file (see below) |
| [`docs/`](docs) | [Getting started](docs/getting-started.md), [integrating Tally](docs/integrating.md), [Bohr validation report](docs/bohr-validation.md), [publishing the extension](docs/chrome-web-store.md), [security model](docs/security.md), [networks](docs/networks.md), [deploying a registry](docs/deploy-v2.md), [adding a chain](docs/adding-a-chain.md) |
| [`scripts/`](scripts) | `sync-chains.mjs`, which generates the studio and extension config and the network list from `chains.json`, and `check-neutral.mjs`, which keeps source code free of network-specific names |
| [`test-vectors/`](test-vectors) | Decision-rule vectors shared by the studio and extension tests, so both apply the same trust rules |
| [`brand/`](brand) | Logo, icon and colour tokens (SVG and PNG) |
| [`SUPPORT.md`](SUPPORT.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), [`SECURITY.md`](SECURITY.md) | Where to ask, how to contribute and what CI enforces, and how to report a vulnerability |
| [`SUBMISSION.md`](SUBMISSION.md) | The text of this project's Arc Microgrants application |

## Using Tally

Building Tally into a project or a product (registering, the JSON API, the library, adding a network, trying it for
real) is covered in [docs/integrating.md](docs/integrating.md). The short version:

**Register a contract.** Open the studio's [register page](https://tallyarc.tech/register),
connect the wallet that controls the contract, and sign one EIP-712 message. The
registry checks `owner()`, the default admin role, or the deployer address, and
records the code hash. Anyone may relay the signature.

**Publish `tally.json`.** Commit this file to the root of the repository you
registered, on the default branch:

```json
{
  "version": 1,
  "contracts": [
    { "chainId": 12345, "address": "0xYourContract", "signer": "0xTheWalletThatRegistered" }
  ]
}
```

`chainId` is the network's chain id (see [docs/networks.md](docs/networks.md)). Clients read the file from
`https://raw.githubusercontent.com/<owner>/<repo>/HEAD/tally.json`. Without the file, or without
`signer`, a record stays at **control proven**. The register page shows the exact file to publish,
signer included.

**Add a badge to your README.**

```markdown
![Tally](https://tallyarc.tech/api/badge/0xYourContract?chain=<network-key>)
```

Network keys are listed in [docs/networks.md](docs/networks.md).

**Install the extension.** There is no store listing yet. Open `chrome://extensions`,
turn on Developer mode, choose **Load unpacked**, and select the [`extension/`](extension)
folder. Visit any address page on a supported explorer, or use the toolbar popup to look
up an address.

## Development

Node 22.12 or newer. Each package installs its own dependencies.

```bash
npm --prefix contracts ci && npm --prefix studio ci && npm --prefix extension ci

npm test                  # chain-table and neutrality checks, then contracts, studio and extension tests
npm run chains:sync       # regenerate client config after editing chains.json
npm --prefix studio run dev   # http://localhost:3000
```

| Suite | Command | What it covers |
|---|---|---|
| Contracts | `npm run test:contracts` | v2 behaviour, hostile targets, v1 limitations pinned, and that the studio's ABIs and EIP-712 types match the real contracts |
| Studio | `npm run test:studio` | trust-level logic, registry decoding, hardened RPC, repository proof, register flow, badge, CSP |
| Extension | `npm run test:extension` | the same shared test vectors, service worker, content script, popup, manifest rules |
| SDK | `npm run test:sdk` | the `tally.json` check and its exit codes, the command line, the public API and its types |

The studio also has `npm run typecheck`, `npm run lint` and `npm run build`; all of it
runs in [CI](.github/workflows/ci.yml).

## Security

See [SECURITY.md](SECURITY.md) to report a vulnerability and
[docs/security.md](docs/security.md) for the threat model, what each control does, and the
known limits (upgradeable proxies, what "control" means, repository identity). Short version:
everything read from a registry or a repository is treated as hostile input, clients fail
towards "unavailable" rather than a misleading answer, and the registry has no owner, no
upgrade path and no admin key.

## Configuration

Networks, RPC endpoints, explorers and registry addresses live in
[`chains.json`](chains.json). Edit it, run `npm run chains:sync`, and the studio, the
extension (including its manifest host permissions) and the Hardhat networks follow.
See [docs/adding-a-chain.md](docs/adding-a-chain.md).

## License

MIT. See [LICENSE](LICENSE).
