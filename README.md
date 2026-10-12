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
3. **Source**: the repository's `tally.json` lists this contract on this network.

Anything less is labelled for what it is. Built for [Arc](https://arc.io), where
gas is paid in USDC and a bad approval costs real dollars; it works on any EVM chain
you add to [`chains.json`](chains.json).

**Studio:** https://tally-studio.vercel.app

## Status

| | |
|---|---|
| Registry **v1** on Arc mainnet (chain 5042) | [`0x459Cab32306c439a408cA6b8672CcF6c6A0536d9`](https://explorer.arc.io/address/0x459Cab32306c439a408cA6b8672CcF6c6A0536d9). Deployed and immutable. Still read by every client, capped at **control proven** (it cannot see code changes). |
| Registry **v2** | Implemented and tested ([`TallyRegistryV2.sol`](contracts/contracts/TallyRegistryV2.sol)). **Not deployed yet**; see [docs/deploy-v2.md](docs/deploy-v2.md). Until it is, nothing can reach **verified**. |
| Demo contract | [`0x0f399C0143CAd70b43D18a5696026B0cEdcA0cCb`](https://explorer.arc.io/address/0x0f399C0143CAd70b43D18a5696026B0cEdcA0cCb), listed in this repo's [`tally.json`](tally.json) |
| External audit | None yet. See [docs/security.md](docs/security.md) for what has and has not been checked. |

## Trust levels

Every surface (explorer badge, README badge, record page) uses the same rule, so
what you see is what the chain supports.

| Level | Colour | Meaning |
|---|---|---|
| **Verified** | green | v2 record, control proven and still held, code unchanged, repository confirms. |
| **Control proven** | blue | Control proven and still held, but the repository is unconfirmed, or the record is on legacy v1. |
| **Stale** | amber | Control moved to someone else, or the code changed after registration. Treated as void. |
| **Self-attested** | grey | A claim with no on-chain proof. Only possible for contracts that have no owner. Never green. |
| **Unverified** | red | No record exists. |
| **Unavailable** | hollow | The chain or registry could not be read. Never shown as unverified: failing to look is not the same as finding nothing. |

## What is in the repo

| Path | What it is |
|---|---|
| [`contracts/`](contracts) | `TallyRegistryV2.sol` (EIP-712, ERC-1271, code-hash tracking), the original `TallyRegistry.sol` (v1, deployed, untouched), Hardhat tests, deploy and register scripts |
| [`studio/`](studio) | Next.js app: record pages with the evidence behind every level, the register flow, a live SVG badge API |
| [`extension/`](extension) | Manifest V3 Chrome extension: badges on the block explorer and a lookup popup |
| [`chains.json`](chains.json) | The single source of truth for networks and registry addresses |
| [`tally.json`](tally.json) | This repository's own provenance file (see below) |
| [`docs/`](docs) | [Security model](docs/security.md), [deploying v2](docs/deploy-v2.md), [adding a chain](docs/adding-a-chain.md) |

## Using Tally

**Register a contract.** Open the studio's [register page](https://tally-studio.vercel.app/register),
connect the wallet that controls the contract, and sign one EIP-712 message. The
registry checks `owner()`, the default admin role, or the deployer address, and
records the code hash. Anyone may relay the signature.

**Publish `tally.json`.** Commit this file to the root of the repository you
registered, on the default branch:

```json
{
  "version": 1,
  "contracts": [
    { "chainId": 5042, "address": "0xYourContract" }
  ]
}
```

Clients read it from `https://raw.githubusercontent.com/<owner>/<repo>/HEAD/tally.json`.
Without it a record stays at **control proven**.

**Add a badge to your README.**

```markdown
![Tally](https://tally-studio.vercel.app/api/badge/0xYourContract?chain=arc)
```

**Install the extension.** There is no store listing yet. Open `chrome://extensions`,
turn on Developer mode, choose **Load unpacked**, and select the [`extension/`](extension)
folder. Visit any address page on the Arc explorer, or use the toolbar popup to look
up an address.

## Development

Node 22.12 or newer. Each package installs its own dependencies.

```bash
npm --prefix contracts ci && npm --prefix studio ci && npm --prefix extension ci

npm test                  # chain-table check, then contracts, studio and extension tests
npm run chains:sync       # regenerate client config after editing chains.json
npm --prefix studio run dev   # http://localhost:3000
```

| Suite | Command | What it covers |
|---|---|---|
| Contracts | `npm run test:contracts` | v2 behaviour, hostile targets, v1 limitations pinned, and that the studio's ABIs and EIP-712 types match the real contracts |
| Studio | `npm run test:studio` | trust-level logic, registry decoding, hardened RPC, repository proof, register flow, badge, CSP |
| Extension | `npm run test:extension` | the same shared test vectors, service worker, content script, popup, manifest rules |

The studio also has `npm run typecheck`, `npm run lint` and `npm run build`; all of it
runs in [CI](.github/workflows/ci.yml).

## Security

See [SECURITY.md](SECURITY.md) to report a vulnerability and
[docs/security.md](docs/security.md) for the threat model, what each control does, and the
known limits. Short version: everything read from a registry or a repository is treated
as hostile input, clients fail towards "unavailable" rather than a misleading answer, and
the registry has no owner, no upgrade path and no admin key.

## Configuration

Networks, RPC endpoints, explorers and registry addresses live in
[`chains.json`](chains.json). Edit it, run `npm run chains:sync`, and the studio, the
extension (including its manifest host permissions) and the Hardhat networks follow.
See [docs/adding-a-chain.md](docs/adding-a-chain.md).

## License

MIT. See [LICENSE](LICENSE).
