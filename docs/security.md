# Security model

This is the threat model for Tally: what a "verified" badge means, what each part of
the system defends against, and what is deliberately **not** covered. If something here
and the code disagree, the code and its tests win; please open an issue.

To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## 1. What Tally claims

Tally answers one question for a person about to sign: *has anyone put their name to
the source of this contract, and does the evidence hold up right now?*

It does **not** say the code is safe, audited, or that the repository builds to the
deployed bytecode. A registry cannot know that. Anything that sounds like it does is a bug.

## 2. How a level is decided

One function decides every level the user sees, in the studio
([`studio/lib/status.ts`](../studio/lib/status.ts)) and in the extension
([`extension/lib/status.js`](../extension/lib/status.js)). Both are tested against the same
vectors in [`test-vectors/`](../test-vectors) so they cannot drift.

| Level | Requires |
|---|---|
| **verified** | A **v2** record that is control-proven, the signer **still controls** the contract, the code hash is **unchanged**, and the repository's `tally.json` **lists** this contract on this chain. |
| **control proven** | Control proven and still held, but the repository check did not confirm. Also the cap for legacy v1 records (v1 has no code hash). |
| **stale** | A control proof that no longer holds: control moved, or the code changed. |
| **self-attested** | A claim without on-chain proof. |
| **unverified** | No registry has a record. |
| **unknown** | A registry could not be read. |

Rules that matter:

- **Failure is never "unverified".** If any registry read fails, the answer is *unknown*,
  because a missing record on one registry cannot be trusted while another is unreachable.
  If only the repository check fails, the record stays at *control proven*; it never
  rounds up to verified.
- **Several registries.** Clients read every registry listed for a chain. The strongest
  evidence wins (live control, then stale control, then self-attested); ties go to the
  newest registry. A throwaway self-attested record on a newer registry cannot hide a
  live control proof on an older one.
- **Deployer proofs** (`CREATE(signer, nonce) == target`) are permanent facts, so they stay
  "control current". The contract's current owner or admin can always replace them with a
  stronger claim.

## 3. Registry v2

[`TallyRegistryV2.sol`](../contracts/contracts/TallyRegistryV2.sol). It has no owner, no
upgrade path, no pause switch and no privileged role, so there is nothing for an
attacker (or the maintainer) to take over.

| Property | How |
|---|---|
| Who can register | Anyone can relay; the **signer** must authorise with an EIP-712 signature. ERC-1271 is supported, so Safes and smart accounts can register. |
| Control is proven on-chain | `OWNER` (`owner() == signer`), `ADMIN_ROLE` (`hasRole(DEFAULT_ADMIN_ROLE, signer)`) or `DEPLOYER` (`CREATE(signer, nonce) == target`). A declared proof that fails **reverts**; it is never silently downgraded. |
| No self-attesting a controlled contract | A claim with no proof reverts `ControllerExists` if the contract has an `owner()`. |
| Squatters cannot lock anyone out | Updates are rank based (owner/admin 3, deployer 2, self-attested 1). The strongest *live* claim wins, and a record whose code changed counts as nothing. v1 had no such rule (V1-2 below). |
| Code changes void records | The code hash is stored at registration and compared on every read. |
| Replay protection | Per-signer sequential nonce, a signature deadline, and a domain bound to the chain and the registry address. |
| Hostile targets | `owner()` and `hasRole()` are probed with a gas cap and exactly one return word read. A target cannot revert the registration, burn meaningful gas, or return oversized data. Tested against gas bombs, return bombs, reverting and dirty-answer targets. |
| Stored text is constrained | Repository: `https://github.com/` prefix, characters `[A-Za-z0-9._/-]`, no empty or dot-only segments, 200 bytes at most. Build hash: `[A-Za-z0-9._-]`, 66 bytes at most. So `javascript:` URLs, markup and control characters never reach storage. |
| Removal | The record's signer, or whoever controls the target now, can `revoke` it. |
| History | The registry keeps one current record per contract but forgets nothing: every registration and removal is appended to that contract's history (`historyLength`, `getHistory`). A replaced or revoked record stays readable, with who signed it and in which block; the repository and build hash of each entry are in that block's `Registered` event. Reading it needs one call and single-block log queries, which every RPC allows. |

### Handing a contract to a new owner

Tally keeps no owner list of its own, because a record is only as good as who controls the
contract today. To hand one over, move control of the contract itself (call
`transferOwnership(newOwner)`, or move the admin role). The new controller then registers and
signs once; their record replaces the old one, and the old one stays in the history. Until they
do, the record reads **stale**, because its signer no longer controls the contract.

### Wallets are not contracts

An address with no code cannot be registered (the registry reverts `NoCode`), so clients never
badge one. When no registry has a record and the address holds no code, the studio says "Not a
contract" and the extension draws nothing. If the chain cannot say whether an address holds code,
the answer is "unavailable", never "unverified".

### What a badge asks of the reader

A badge is read by people checking a contract, so it states a status and nothing else: the
extension never says "Register" and every badge opens the contract's record page. Registering is
offered there, in words, to the contract's controller.

Known on-chain limits: deployer proofs support deployer nonces up to 2^32 - 1; a signature
must be used in order (a signer's nonce moves on after any registration they make); the
registry says nothing about who owns the *repository* (see section 4).

## 4. Repository proof (`tally.json`)

The chain can prove who controls a contract. It cannot prove who controls a GitHub
repository, and anyone can deploy an `Ownable` contract and point it at someone else's
repository. So "verified" additionally requires the repository to agree.

The repository publishes `tally.json` at its root, on the default branch:

```json
{ "version": 1, "contracts": [ { "chainId": 5042, "address": "0x..." } ] }
```

Clients fetch `https://raw.githubusercontent.com/<owner>/<repo>/HEAD/tally.json` with:
the owner and repo name validated first; no redirects; no credentials; a timeout; at most
64 KB; only the first 1000 entries read; strict shape and version checks. Results are
`confirmed`, `not-listed`, `no-file`, `invalid-file`, `invalid-repo` or `unavailable`. Only
`confirmed` can contribute to "verified".

Limits you should know about:

- **Repo-jacking.** If a GitHub account is renamed or deleted, someone else can register
  the old name and publish a `tally.json` there. A record naming the old repository would
  then be confirmed by the wrong party.
- **Maintainers control the file.** Whoever can push to the default branch can add or
  remove entries at any time. Verified means the repository's owners agree *today*.
- **Availability.** GitHub rate limits or outages show as `unavailable`, which keeps the
  record at *control proven*. It never produces a false "verified".

## 5. Client hardening

Everything read from a registry or a repository is attacker-controlled text.

**Both clients**

- One strict parser turns a stored repository string into `owner/repo`; only the canonical
  `https://github.com/owner/repo` is ever linked. Anything else is shown as inert text.
- Invisible, bidirectional-override and control characters are stripped before display.
- Text is rendered as text. No `innerHTML`, `eval`, `dangerouslySetInnerHTML` or `window.open`.
- All network calls have a deadline, a response size cap, no redirects and no credentials.
- Registry bytes are decoded with bounds-checked decoders; malformed data is an error,
  not a half-parsed record.

**Studio**

- A per-request, nonce-based **Content-Security-Policy** ([`proxy.ts`](../studio/proxy.ts),
  [`lib/csp.ts`](../studio/lib/csp.ts)): scripts run only with the nonce; connections only to this
  origin and the configured RPC endpoints; no framing; no `unsafe-inline` or `unsafe-eval`
  in production. Plus `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`, `Cross-Origin-Opener-Policy` and HSTS ([`next.config.mjs`](../studio/next.config.mjs)).
- The register flow never asks for or handles keys. It validates input against the same
  rules as the contract, shows what will be proven before anything is signed, simulates the
  transaction so a revert is explained before the wallet prompt, and signs a message that
  expires in an hour. Wallet discovery uses EIP-6963.
- The badge API always answers `200` with an SVG whose text comes from a fixed list, served
  with `nosniff` and a sandboxing CSP, behind a small bounded cache.
- The previous `wagmi` dependency tree was removed. Production dependencies pass
  `npm audit --omit=dev` in CI.

**Extension (Manifest V3)**

- All network access happens in the **service worker**, under `host_permissions` for the
  chains' RPC endpoints and `raw.githubusercontent.com` only. There is no `permissions`
  key. The content script only sends messages and draws badges.
- The worker accepts messages only from its own extension, and derives the chain from the
  sender's page URL rather than from message contents.
- Badges link only to the studio origin. Lookups are capped per page, run with bounded
  concurrency, and a failure shows the *unavailable* badge rather than *unverified*.
- Sources must be ASCII (a test enforces it) so invisible-character tricks cannot be
  smuggled into the code.

## 6. Legacy v1 registry

v1 is deployed on Arc mainnet and immutable. Its limits are pinned by tests in
[`contracts/test/v1-limitations.test.js`](../contracts/test/v1-limitations.test.js), and the
clients compensate where they can:

| | Limitation | Client behaviour |
|---|---|---|
| V1-1 | The owner of any contract with `owner()` can attach it to any repository. | Needs the `tally.json` check, which only v2 records can use to reach "verified". |
| V1-2 | A squatter can permanently lock out the real owner of a contract with no owner. | Not fixable on v1; v2 ranks claims. |
| V1-3 | Contracts owned by another contract (multisig) can never be owner-proven. | Use v2 (ERC-1271). |
| V1-4 | After an ownership transfer neither owner can update the record. | Clients check `owner()` themselves and show *stale*. |
| V1-5 | Any string is accepted as the repository, including `javascript:` URLs. | Strict parsing and canonical links only. |

v1's own `isVerified` flag is never trusted: it stays true after ownership changes. Clients
probe `owner()` themselves, and cap v1 records at *control proven* because v1 has no code hash.

## 7. What is not covered

- **No external audit** of v2 or the clients. The contract has a thorough test suite and
  was also exercised by injecting deliberate bugs and confirming the suite caught each one
  (done by hand during development, not part of CI). That is not a substitute for an audit
  before real value depends on it.
- **RPC trust.** Clients trust the configured RPC endpoint for chain state. A malicious or
  compromised RPC could lie. Run your own endpoint for anything important (see
  `TALLY_RPC_URL_<CHAIN>` in [`studio/.env.local.example`](../studio/.env.local.example)).
- **No real-browser extension test in CI.** The extension logic, service worker, content
  script and popup are tested in jsdom against the real code, but loading it in Chrome is
  manual. Before releasing: load it unpacked, open an address page on the explorer, check
  that a badge appears and links to the studio, open the popup and look up an address, and
  confirm Chrome lists only the RPC hosts and `raw.githubusercontent.com` as site access.
- **Explorer layout drift.** Badges depend on the explorer's page structure. A redesign can
  stop them appearing; it cannot make them show a wrong level.
- **Reproducible builds.** Nothing here proves the repository compiles to the deployed
  bytecode.
- **Chrome only.** The extension targets Chrome (Manifest V3) and has no store listing yet.

## 8. Operations

- **Deployment keys.** `contracts/.env` is git-ignored. Use a fresh wallet that holds only
  what the deployment needs, and never paste a key into an issue, a chat or a commit.
- **Deploying v2** is a one-way action; follow [deploy-v2.md](deploy-v2.md) and rehearse on
  testnet first.
- **Dependencies** are updated by Dependabot. OpenZeppelin is pinned by hand because the
  registry is immutable once deployed. `npm audit --omit=dev` is clean in all three
  packages and runs in CI for the studio. Advisories remain in dev-only tooling (the studio's
  lint and test toolchain, and Hardhat's dependency tree); none of it ships in a build.
