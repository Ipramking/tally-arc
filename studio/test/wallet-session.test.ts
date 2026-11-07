import { describe, expect, it, vi } from "vitest";
import { forgetWallet, recallWallet, rememberWallet, restoreAccount, revokeAccess, WALLET_KEY } from "@/lib/wallet-session";
import type { Eip1193Provider } from "@/lib/wallet";

const ACCOUNT = "0xB2Cd6331395DED6747b9e94b736b8C7edC0947B5";

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

const throwingStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("remembering which wallet was connected", () => {
  it("stores the wallet id only, and gives it back", () => {
    const store = memoryStore();
    rememberWallet(store, "io.metamask");
    expect([...store.data.entries()]).toEqual([[WALLET_KEY, "io.metamask"]]);
    expect(recallWallet(store)).toBe("io.metamask");
  });

  it("forgets it", () => {
    const store = memoryStore({ [WALLET_KEY]: "io.metamask" });
    forgetWallet(store);
    expect(recallWallet(store)).toBeNull();
  });

  it("ignores values that are not a plausible wallet id", () => {
    expect(recallWallet(memoryStore({ [WALLET_KEY]: "" }))).toBeNull();
    expect(recallWallet(memoryStore({ [WALLET_KEY]: "x".repeat(101) }))).toBeNull();
    expect(recallWallet(memoryStore({ [WALLET_KEY]: "<script>alert(1)</script>" }))).toBeNull();
    const store = memoryStore();
    rememberWallet(store, "<script>");
    expect(store.data.size).toBe(0);
  });

  it("accepts the ids wallets really announce (uuid and reverse-DNS)", () => {
    for (const id of ["350670db-19fa-4704-a166-e52e178b59d2", "io.metamask", "com.coinbase.wallet", "window.ethereum"]) {
      const store = memoryStore();
      rememberWallet(store, id);
      expect(recallWallet(store)).toBe(id);
    }
  });

  it("keeps working when storage is blocked or missing", () => {
    expect(recallWallet(throwingStore)).toBeNull();
    expect(() => rememberWallet(throwingStore, "io.metamask")).not.toThrow();
    expect(() => forgetWallet(throwingStore)).not.toThrow();
    expect(recallWallet(null)).toBeNull();
    expect(() => rememberWallet(null, "io.metamask")).not.toThrow();
    expect(() => forgetWallet(null)).not.toThrow();
  });
});

describe("reconnecting silently", () => {
  it("asks for the shared account with eth_accounts and never opens a prompt", async () => {
    const request = vi.fn(async () => [ACCOUNT]);
    expect(await restoreAccount({ request })).toBe(ACCOUNT);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ method: "eth_accounts" });
  });

  it("returns null when the wallet shares nothing (locked, or disconnected in the wallet)", async () => {
    expect(await restoreAccount({ request: async () => [] })).toBeNull();
  });

  it("returns null for an answer that is not an address, or an error", async () => {
    expect(await restoreAccount({ request: async () => ["not an address"] })).toBeNull();
    expect(await restoreAccount({ request: async () => null })).toBeNull();
    expect(
      await restoreAccount({
        request: async () => {
          throw new Error("wallet is gone");
        },
      }),
    ).toBeNull();
  });
});

describe("disconnecting", () => {
  it("asks the wallet to revoke the shared account", async () => {
    const request = vi.fn(async () => null);
    await revokeAccess({ request } as Eip1193Provider);
    expect(request).toHaveBeenCalledWith({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
  });

  it("does not fail for wallets that cannot revoke", async () => {
    await expect(
      revokeAccess({
        request: async () => {
          throw Object.assign(new Error("method not supported"), { code: 4200 });
        },
      }),
    ).resolves.toBeUndefined();
  });
});
