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
  "explorer": { "name": "My Explorer", "url": "https://explorer.my-chain.example" },
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
| `registries` | Newest first. The first entry receives new registrations; **every** entry is read. `version` is `1` or `2`. |
| `presets` | Optional `verified` and `unverified` example addresses for the popup and home page. |

Use endpoints you have confirmed from the chain's own documentation. A wrong RPC can
make every record on that chain look wrong.

## 2. Regenerate the clients

```bash
npm run chains:sync
```

This validates the file, then rewrites `studio/lib/chains.generated.ts`,
`extension/chains.generated.js` and the generated parts of `extension/manifest.json`
(`content_scripts[0].matches` and `host_permissions`). Never edit those by hand: CI runs
`npm run chains:check` and fails if they are out of date.

Hardhat reads `chains.json` directly. The network name is the key in camelCase
(`my-chain` becomes `myChain`), and `MY_CHAIN_RPC_URL` overrides the RPC.

## 3. Deploy a registry

```bash
cd contracts
npx hardhat run scripts/deploy.js --network myChain
```

Add the printed address to the chain's `registries`, then run `npm run chains:sync` again.
See [deploy-v2.md](deploy-v2.md) for the full, careful version.

## 4. Check it

```bash
npm test
```

Then try it by hand: register a contract on a testnet, publish its `tally.json`, and
open `/c/<address>?chain=my-chain` in the studio.

## Things to know

- **Explorer pages.** The extension badges links of the form `/address/0x...` and
  `/token/0x...` on the explorer's origin, and the address in the page's own URL. If an
  explorer uses a different structure, adjust the selectors in `extension/content/content.js`.
- **Extension permissions.** A new chain adds new site access for the extension. Chrome asks
  existing users to approve it when the extension updates; that is intended.
- **Contract compatibility.** v2 relies on `codehash`, `staticcall` and CREATE address rules
  that are standard on EVM chains. The contracts are compiled for the `paris` EVM version so
  they run on chains that have not adopted newer opcodes.
