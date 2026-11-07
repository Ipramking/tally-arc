# Publishing the extension on the Chrome Web Store

Everything the listing needs is prepared here. The only steps that need a person are creating the developer
account and pressing upload, because the listing is published under that account's name.

## 1. Build the package

```bash
npm --prefix extension run pack     # writes extension/dist/tally-extension-<version>.zip
```

The zip holds exactly the files the extension runs (the manifest, the service worker, the libraries, the content
script, the popup and the icons), byte for byte, and nothing else: no tests, tooling or dependencies. The same sources
give the same bytes. `extension/test/pack.test.js` checks all of that, and `extension/test/manifest.test.js` checks the
listing limits (name at most 45 characters, description at most 132).

## 2. The developer account (needs you)

- Register at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole). There is a
  one-time registration fee (US$5) and the Google account needs 2-step verification.
- The publisher name is shown on the listing, so use the account you want tied to it. Publishing as a business can
  require extra verification.

## 3. Fill in the listing

| Field | Value |
|---|---|
| Name | `Tally: Contract Provenance` (from the manifest) |
| Summary | The manifest's `description` |
| Category | Developer Tools |
| Language | English |
| Homepage | https://tallyarc.tech |
| Support | https://github.com/Ipramking/tally-arc/issues |
| Privacy policy | https://tallyarc.tech/privacy |
| Visibility | **Unlisted** first (see below) |

**Detailed description**

> Tally shows who vouches for a smart contract's source, right next to the contract's address on a block explorer.
>
> On supported explorers every contract address gets a small badge:
> - Verified: the signer proved control on-chain and still holds it, the code is unchanged, the contract is not an upgradeable proxy, and the project's own repository (tally.json) lists the contract and names the signer's wallet.
> - Control proven: control is proven and held, but the repository does not confirm everything yet, or the contract is an upgradeable proxy.
> - Stale: control moved or the code changed since registration.
> - Self-attested: a claim with no on-chain proof.
> - Unverified: nobody has registered it.
>
> Click a badge to see the evidence and the registration history.
>
> Tally is provenance, not an audit. A badge says whose name is on a contract and where its source lives. It does not say the code is safe.
>
> Lookups are read-only. The extension asks the network's public RPC endpoint for the registry record and GitHub for the repository's tally.json. There are no accounts, no analytics and no keys. Open source (MIT): https://github.com/Ipramking/tally-arc
>
> The networks it supports are listed at https://github.com/Ipramking/tally-arc/blob/master/docs/networks.md, and any EVM network can be added to the chain table.

**Single purpose:** show a provenance badge next to smart-contract addresses on supported block explorers.

**Permission justifications** (the Privacy practices tab asks for each)

| Permission | Justification |
|---|---|
| Host access to the RPC endpoints of the supported networks | Read-only JSON-RPC calls (`eth_call`, `eth_getCode`, `eth_getStorageAt`) to read the Tally registry record and the contract's current state. |
| Host access to `https://raw.githubusercontent.com/*` | Reads the public `tally.json` of the repository named in a record, to confirm that the repository lists the contract. |
| Content script on the supported explorers' pages | Finds contract addresses in the page and draws a badge beside each. |
| Remote code | None. The extension loads only its own files, and its CSP forbids anything else. |

There is no `permissions` entry beyond hosts: no tabs, no history, no storage permission, no cookies.

**Data usage** (also on the Privacy practices tab). Declare *Website content*: the contract addresses found on an
explorer page are sent to the network's RPC endpoint and used only to look up the record. Declare nothing else.
Certify that the data is not sold, not used for anything unrelated to the single purpose, and not used for credit or
lending decisions. The privacy policy page says the same.

**Screenshots** (1280 x 800 or 640 x 400, up to five). With the extension loaded, capture:

1. A verified contract on the explorer: `https://scan.bohr.life/address/0xEC84A560DF15cCb86d96c86Bb61d8CEB1c744452`
2. Not everything green: `.../address/0x636B032623Fc41c001759fB7abD368Cb1566C9A7` (stale) and
   `.../address/0x42144a33b26D08cbFB68cF205AAdE3430eAde600` (an upgradeable proxy, control proven)
3. The toolbar popup after a lookup
4. The studio record page with the evidence list and the history

The 128 px store icon is already in the package. A small promo tile (440 x 280) is optional; the logos are in
[`brand/`](../brand).

## 4. Start unlisted

Choose **Unlisted** visibility: anyone with the link can install it and it does not appear in search. That is the right
first state for a build that partners are testing, such as a chain team trying Tally on its testnet. Share the link, and
switch to Public after it has had some real use. Review takes a few days and can take longer for an extension that
asks for host access.

## 5. After it is approved

- Replace "There is no store listing yet" in the README and in [integrating.md](integrating.md) with the link.
- To ship an update, raise `version` in both `extension/manifest.json` and `extension/package.json` (a test requires
  them to match), run `npm run chains:sync` if `chains.json` changed, `npm test`, then `npm --prefix extension run pack`
  and upload the new zip.
- Adding a network adds site access. Chrome asks existing users to approve it when the extension updates; that is intended.
