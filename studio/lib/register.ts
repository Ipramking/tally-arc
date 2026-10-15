// Pure helpers for the register flow: input validation that mirrors the
// registry's own checks (so mistakes are caught before a wallet prompt, not by
// a revert), a plain-English reading of the proof plan, and the tally.json the
// repository needs for the record to reach "verified".
import { getAddress, isAddress as isChecksumAddress, type Address } from "viem";
import type { ProofPlan } from "./prove";
import type { ProofMethod } from "./registry";
import { isAddress, parseGithubRepo, shorten } from "./safe-url";

const BUILD_HASH_RE = /^[A-Za-z0-9._-]{0,66}$/;

export type RegisterInput = { target: string; repo: string; buildHash: string };
export type ValidInput = { ok: true; target: Address; repo: string; buildHash: string };
export type InvalidInput = { ok: false; error: string };

export function validateRegisterInput(input: RegisterInput): ValidInput | InvalidInput {
  const target = input.target.trim();
  // A mixed-case address with a bad checksum is a typo; never "fix" it silently.
  if (!isAddress(target) || !isChecksumAddress(target, { strict: true })) {
    return { ok: false, error: "Enter a valid 0x contract address (42 characters; mixed-case addresses must have a correct checksum)." };
  }
  const parsed = parseGithubRepo(input.repo.trim());
  if (!parsed) return { ok: false, error: "The repository must be a GitHub link like https://github.com/owner/repo." };
  const buildHash = input.buildHash.trim();
  if (!BUILD_HASH_RE.test(buildHash)) {
    return { ok: false, error: "The build hash may only use letters, digits, dots, dashes and underscores (66 characters at most)." };
  }
  return { ok: true, target: getAddress(target), repo: parsed.url, buildHash };
}

export interface PlanView {
  tone: "ok" | "warn" | "bad";
  title: string;
  detail: string;
  /** What the registry will be asked to record; null when registration cannot succeed. */
  method: ProofMethod | null;
  deployerNonce: number;
}

/** Turn a proof plan into the sentence the person reads before signing. */
export function explainPlan(plan: ProofPlan, ctx: { registryVersion: 1 | 2; chainName: string }): PlanView {
  const legacy = ctx.registryVersion === 1;
  const view = (tone: PlanView["tone"], title: string, detail: string, method: ProofMethod | null, deployerNonce = 0): PlanView => ({
    tone,
    title,
    detail,
    method,
    deployerNonce,
  });

  switch (plan.method) {
    case "NO_CODE":
      return view("bad", "No contract at this address", `Nothing is deployed at this address on ${ctx.chainName}. Check the address and the network.`, null);
    case "BLOCKED":
      return view(
        "bad",
        "Another wallet controls this contract",
        `owner() is ${shorten(plan.owner)}. Connect that wallet to register it: the registry refuses an unproven claim for a contract that has an owner.`,
        null,
      );
    case "OWNER":
      return view("ok", "Your wallet is the owner", "owner() returns your address, so the record will be control-proven.", "OWNER");
    case "ADMIN_ROLE":
      return legacy
        ? view("warn", "Admin role cannot be proven on v1", "The legacy v1 registry only understands owner(), so this would be recorded as self-attested. Wait for v2 to prove it.", "NONE")
        : view("ok", "Your wallet holds the admin role", "hasRole(DEFAULT_ADMIN_ROLE) is true for your address, so the record will be control-proven.", "ADMIN_ROLE");
    case "DEPLOYER":
      return legacy
        ? view("warn", "Deployer proof is not supported on v1", "The legacy v1 registry cannot check who deployed a contract, so this would be recorded as self-attested. Wait for v2 to prove it.", "NONE")
        : view(
            "ok",
            "Your wallet deployed this contract",
            `The registry will check that CREATE(your address, nonce ${plan.deployerNonce}) is this contract. The record is control-proven, and the contract's owner or admin can replace it later.`,
            "DEPLOYER",
            plan.deployerNonce,
          );
    case "NONE":
      return view(
        "warn",
        "Nothing on-chain proves who controls this contract",
        "It has no owner() or admin role and your wallet did not deploy it, so only a self-attested claim is possible. It will show as self-attested and never as verified.",
        "NONE",
      );
  }
}

export interface Review {
  lines: { term: string; value: string }[];
  /** The sentence the person must agree to before the sign button works. */
  consent: string;
  /** True when nothing proves control: the record will be a self-attested claim. */
  unproven: boolean;
}

/** What the person is about to sign, in plain words, so nobody registers by accident. */
export function reviewRegistration(a: { chainName: string; target: string; account: string; method: ProofMethod; repo: string; buildHash: string }): Review {
  const unproven = a.method === "NONE";
  const repo = parseGithubRepo(a.repo);
  const wallet = shorten(a.account);
  const proof: Record<ProofMethod, string> = {
    NONE: "None. This will be a self-attested claim.",
    OWNER: `Your wallet ${wallet} is the owner of this contract (owner())`,
    ADMIN_ROLE: `Your wallet ${wallet} holds the admin role of this contract`,
    DEPLOYER: `Your wallet ${wallet} deployed this contract`,
  };
  return {
    unproven,
    lines: [
      { term: "Contract", value: `${shorten(a.target)} on ${a.chainName}` },
      { term: "Proof", value: proof[a.method] },
      { term: "Source", value: `${repo ? `${repo.owner}/${repo.repo}` : a.repo}${a.buildHash ? `, build ${a.buildHash}` : ""}` },
      { term: "Public", value: "Permanent. Every registration stays in this contract's history. Nothing about the contract itself changes." },
    ],
    consent: unproven
      ? "I understand this will be recorded as self-attested: nothing proves I control this contract, and everyone will see it labelled unproven."
      : "I control this contract and I am allowed to link it to this repository.",
  };
}

/** The file that goes at the repository root so the record can become "verified". */
export function tallyJsonSnippet(chainId: number, address: string): string {
  return `${JSON.stringify({ version: 1, contracts: [{ chainId, address }] }, null, 2)}\n`;
}
