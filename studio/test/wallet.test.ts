import { describe, expect, it, vi } from "vitest";
import { REVERT_HELP } from "@/lib/abi";
import { arcChain } from "./helpers";
import { discoverWallets, friendlyError, hexChainId, switchToChain, toViemChain, type Eip1193Provider } from "@/lib/wallet";

const provider = (): Eip1193Provider => ({ request: vi.fn(async () => null) });

/** An EventTarget that answers eip6963:requestProvider with the given announcements. */
function pageWith(announcements: unknown[], ethereum?: unknown) {
  const target = new EventTarget() as EventTarget & { ethereum?: unknown };
  target.ethereum = ethereum;
  target.addEventListener("eip6963:requestProvider", () => {
    for (const detail of announcements) target.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  });
  return target;
}

describe("wallet discovery (EIP-6963)", () => {
  it("collects every announcing wallet, deduplicated by uuid", async () => {
    const a = provider();
    const b = provider();
    const wallets = await discoverWallets(
      pageWith([
        { info: { uuid: "a", name: "Alpha" }, provider: a },
        { info: { uuid: "b", name: "Beta" }, provider: b },
        { info: { uuid: "a", name: "Alpha again" }, provider: a },
      ]),
      5,
    );
    expect(wallets.map((w) => w.name).sort()).toEqual(["Alpha again", "Beta"]);
    expect(wallets.find((w) => w.id === "b")?.provider).toBe(b);
  });

  it("ignores malformed announcements and truncates long names", async () => {
    const wallets = await discoverWallets(
      pageWith([{ info: { uuid: "x", name: "No provider" } }, { provider: {} }, null, { info: { uuid: "ok", name: "n".repeat(100) }, provider: provider() }]),
      5,
    );
    expect(wallets).toHaveLength(1);
    expect(wallets[0].name).toHaveLength(40);
  });

  it("falls back to window.ethereum, and finds nothing on a page without a wallet", async () => {
    const injected = provider();
    expect((await discoverWallets(pageWith([], injected), 5)).map((w) => w.id)).toEqual(["window.ethereum"]);
    expect(await discoverWallets(pageWith([]), 5)).toEqual([]);
    expect(await discoverWallets(pageWith([], { notAProvider: true }), 5)).toEqual([]);
  });
});

describe("switchToChain", () => {
  it("switches when the wallet knows the chain", async () => {
    const p = provider();
    await switchToChain(p, arcChain);
    expect(p.request).toHaveBeenCalledTimes(1);
    expect(p.request).toHaveBeenCalledWith({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChainId(5042) }] });
  });

  it("adds the chain from the shared table when the wallet has never seen it (error 4902)", async () => {
    const request = vi.fn().mockRejectedValueOnce({ code: 4902 }).mockResolvedValueOnce(null);
    await switchToChain({ request }, arcChain);
    expect(request).toHaveBeenLastCalledWith({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: "0x13b2",
          chainName: "Arc",
          nativeCurrency: arcChain.nativeCurrency,
          rpcUrls: [arcChain.rpcUrl],
          blockExplorerUrls: [arcChain.explorer.url],
        },
      ],
    });
  });

  it("any other error, such as the user declining, is rethrown", async () => {
    const request = vi.fn().mockRejectedValue({ code: 4001 });
    await expect(switchToChain({ request }, arcChain)).rejects.toEqual({ code: 4001 });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("helpers", () => {
  it("toViemChain maps the shared table", () => {
    const chain = toViemChain(arcChain);
    expect(chain.id).toBe(5042);
    expect(chain.rpcUrls.default.http).toEqual([arcChain.rpcUrl]);
    expect(chain.blockExplorers?.default.url).toBe(arcChain.explorer.url);
  });

  it("friendlyError explains rejections and contract reverts, and bounds everything else", () => {
    expect(friendlyError({ code: 4001 })).toMatch(/rejected/);
    const nested = { shortMessage: "reverted", cause: { cause: { data: { errorName: "NotOwner" } } } };
    expect(friendlyError(nested, REVERT_HELP)).toBe(REVERT_HELP.NotOwner);
    expect(friendlyError({ errorName: "Outranked" }, REVERT_HELP)).toBe(REVERT_HELP.Outranked);
    expect(friendlyError(new Error("boom"))).toBe("boom");
    expect(friendlyError(new Error("x".repeat(500))).length).toBeLessThanOrEqual(240);
    expect(friendlyError(undefined)).toBe("Something went wrong.");
  });

  // viem words any "internal error" as `The contract function "register" reverted with the following reason: ...`.
  const viemWrapped = (reason: string, details = reason) => ({
    name: "ContractFunctionExecutionError",
    shortMessage: `The contract function "register" reverted with the following reason:\n${reason}`,
    cause: { name: "ContractFunctionRevertedError", shortMessage: `The contract function "register" reverted with the following reason:\n${reason}`, cause: { code: -32603, details } },
  });

  it("friendlyError does not call a node or wallet failure a contract revert", () => {
    for (const reason of ["Internal JSON-RPC error.", "Cannot destructure property 'gasLimit' of '(intermediate value)' as it is null.", "HTTP request failed.", "header not found"]) {
      const text = friendlyError(viemWrapped(reason), REVERT_HELP);
      expect(text, reason).toMatch(/bad answer/);
      expect(text, reason).toMatch(/not a contract rejection/);
      expect(text, reason).not.toMatch(/reverted/);
      expect(text.length).toBeLessThanOrEqual(240);
    }
  });

  it("friendlyError tells a stuck wallet transaction apart, and says how to clear it", () => {
    for (const reason of ["RPC 0x3c8 Custom eth_sendRawTransaction: replacement transaction underpriced", "nonce too low: next nonce 3, tx nonce 1", "already known"]) {
      expect(friendlyError(viemWrapped(reason), REVERT_HELP), reason).toMatch(/pending or stuck.*Clear activity tab data/);
    }
  });

  it("friendlyError still passes a real revert through", () => {
    const real = { shortMessage: 'The contract function "register" reverted with the following reason:\nexecution reverted', cause: { details: "execution reverted" } };
    expect(friendlyError(real)).toBe(real.shortMessage.slice(0, 240));
    expect(friendlyError({ ...viemWrapped("Internal JSON-RPC error."), cause: { data: { errorName: "NotOwner" } } }, REVERT_HELP)).toBe(REVERT_HELP.NotOwner);
    expect(friendlyError(new Error("The signature expired."))).toBe("The signature expired.");
  });
});
