# Adding a chain

Networks live in one file, [`chains.json`](../chains.json). Everything else is generated
from it or reads it directly, so adding a chain is one edit and one command.

## 1. Edit `chains.json`

Add an object to `chains`:

```json
{
  "key": "my-chain",
  "id": 12345,
  "name": "My Chain",
  "testnet": false,
  "nativeCurrency": { "name": "Ether", "symbol": "ETH", "decimals": 18 },
  "rpcUrl": "https://rpc.my-chain.example",
  "explorer": { "name": "My Explorer", "url": "https://explorer.my-chain.example", "api": "https://explorer.my-chain.example/api" },
  "registries": [],
  "presets": {}
}
```

| Field | Rule |
|---|---|
| `key` | Lowercase letters, digits and dashes; unique. Used in URLs (`?chain=my-chain`) and env names. |
| `id` | The chain id; unique. |
| `rpcUrl` | `https` only, no credentials, no query string. Its origin is added to the extension's host permissions and to the studio's `connect-src`. |
| `explorer.url` | Bare `https` origin, no trailing slash, and **not shared with another chain** (the extension picks the chain from the page's hostname). |
| `website` | Optional. The network's own site, a bare `https` origin. The studio footer links the name to it for every mainnet that sets one. |
| `explorer.api` | Optional. An Etherscan-style API (Blockscout answers it) that `hardhat verify` can use to publish the registry's source. Leave it out if the explorer cannot be scripted. |
| `maxHeadAgeSeconds` | Optional, 0 to 86400, default 300. How old the newest block of the answering node may be before its answer is refused (see "Lagging nodes" below). `0` turns the check off. Set it higher only for a chain that produces blocks slowly or only when there are transactions. |
| `registries` | Newest first. The first entry receives new registrations; **every** entry is read. `version` is `1` or `2`. |
| `presets` | Optional `verified` and `unverified` example addresses for the popup and home page. |

Use endpoints you have confirmed from the chain's own documentation. A wrong RPC can
make every record on that chain look wrong.

## 2. Regenerate the clients

```bash
npm run chains:sync
```

This validates the file, then rewrites `studio/lib/chains.generated.ts`,
`extension/chains.generated.js`, the generated parts of `extension/manifest.json`
(`content_scripts[0].matches` and `host_permissions`) and [networks.md](networks.md). Never edit those
by hand: CI runs `npm run chains:check` and fails if they are out of date. CI also runs
`npm run neutral:check`, which fails if source code names a specific network, so a network fact belongs
in `chains.json` and nowhere else.

Hardhat reads `chains.json` directly. The network name is the key in camelCase
(`my-chain` becomes `myChain`), and `MY_CHAIN_RPC_URL` overrides the RPC.

## 3. Deploy a registry

```bash
cd contracts
npm run deploy -- --network myChain
```

Add the printed address to the chain's `registries`, then run `npm run chains:sync` again.
See [deploy-v2.md](deploy-v2.md) for the full, careful version.

## 4. Check it

```bash
npm test
```

Then try it by hand: register a contract on a testnet, publish its `tally.json`, and
open `/c/<address>?chain=my-chain` in the studio.

## What a chain needs

Tally is for EVM chains. It reads state only through standard JSON-RPC and standard opcodes, so a chain
works if it offers:

- **RPC methods:** `eth_call`, `eth_getCode`, `eth_getStorageAt`, `eth_getTransactionCount`, `eth_getBlockByNumber`,
  and `eth_getLogs` for a single block (the provenance history). A public endpoint that rate-limits or
  blocks any of these shows up as "unavailable" in the clients, never as a wrong answer.
- **Opcodes:** `EXTCODEHASH`, `STATICCALL` and CREATE address derivation. The contracts are compiled for the
  `paris` EVM version, so a chain does not need newer opcodes.
- **Browser access for the register page:** the RPC must allow requests from the studio's origin (CORS), or
  the register page cannot run its checks. The lookups the studio, the badge API and the extension make
  do not depend on this.
- **Explorer links** of the form `/address/0x...` and `/tx/0x...`, which is what Etherscan-style and
  Blockscout explorers use.

## Lagging nodes

A public RPC is often one address in front of several nodes, and one of them can fall behind or freeze. Its
answers are well formed and old: "no record" for a contract that was registered an hour ago. A lookup
therefore sends every read together with a request for the latest block, in one batch, so the node that
answers the read also reports how old its chain is. If that block is older than `maxHeadAgeSeconds` the read
is retried (the load balancer may pick another node) and then refused, and the lookup is **Unavailable**,
never **Unverified**. The check needs `eth_getBlockByNumber` and batch requests; an endpoint that refuses
batches is read with two separate requests instead, which is weaker because they can reach different nodes.

The block's timestamp is compared with the clock of the device that is looking. A clock that is wrong by
more than the limit makes every lookup unavailable, and the message says so. A chain with slow or on-demand
blocks needs a higher `maxHeadAgeSeconds`.

## Things to know

- **Explorer pages.** The extension badges links of the form `/address/0x...` and
  `/token/0x...` on the explorer's origin, and the address in the page's own URL. If an
  explorer uses a different structure, adjust the selectors in `extension/content/content.js`.
- **Extension permissions.** A new chain adds new site access for the extension. Chrome asks
  existing users to approve it when the extension updates; that is intended.
- **Contract compatibility.** v2 relies on `codehash`, `staticcall` and CREATE address rules
  that are standard on EVM chains. The contracts are compiled for the `paris` EVM version so
  they run on chains that have not adopted newer opcodes.
