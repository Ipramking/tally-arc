# Security policy

## Reporting a vulnerability

Please report security issues **privately**, not in a public issue or pull request.

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and
choose **Report a vulnerability**. Include what you found, how to reproduce it, and which
component it affects (`contracts/`, `studio/` or `extension/`).

This is a small project maintained by one person, so there is no guaranteed response time,
but reports are read and taken seriously. Please give a reasonable window to fix an issue
before disclosing it.

## Scope

In scope:

- `contracts/contracts/TallyRegistryV2.sol` and the scripts that deploy and use it.
- The studio (`studio/`), including the badge API and the register flow.
- The browser extension (`extension/`).
- Anything that makes a record show a **higher trust level than the evidence supports**,
  for example showing "verified" without a live control proof, an unchanged code hash, a
  contract that is not a detected proxy, and a `tally.json` that lists the contract and names
  the signer.

Known and documented, so not vulnerabilities on their own: the limits of the legacy v1
registry (it is deployed and immutable), the repository-proof limits (such as repo-jacking),
the registry-level behaviours the clients compensate for (a deployer's record staying
"control current", proxies keeping their code hash across an upgrade, self-attested slots on
contracts nobody can prove control of), and the items listed under "What is not covered" in
[docs/security.md](docs/security.md). A way to make a client show a higher level than those
rules allow is a vulnerability.

## Deployed contracts

The v1 registry on Arc mainnet is immutable and cannot be patched. If you find a problem
in it, a report is still welcome: the clients can compensate, and v2 exists to fix its
known weaknesses.

## Please do not

- Test against other people's contracts or wallets in ways that cost them money.
- Send private keys or seed phrases to anyone, including in a report. Nothing in this
  project needs them.
