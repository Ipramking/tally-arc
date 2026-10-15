import { describe, expect, it } from "vitest";
import { buildTallySnippet, mergeTallyContracts } from "@/lib/tally-snippet";
import { fakeWorld, OTHER, REPO, SIGNER, TARGET, tallyJson } from "./helpers";

const FILE = "https://raw.githubusercontent.com/acme/vault/HEAD/tally.json";
const NEW = "0x3333333333333333333333333333333333333333";
const parse = (text: string) => JSON.parse(text);
const build = (files: Record<string, string | number | Error>, signer?: string, address = NEW) =>
  buildTallySnippet({ repoUrl: REPO, chainId: 968, address, signer, fetchImpl: fakeWorld({ files }) });

describe("tally.json that names the wallet", () => {
  it("names the registering wallet in a new entry and keeps everything already listed", async () => {
    const existing = [{ chainId: 5042, address: TARGET, signer: OTHER }];
    const s = await build({ [FILE]: tallyJson(...existing) }, SIGNER);
    expect(s.state).toBe("merged");
    expect(parse(s.text).contracts).toEqual([...existing, { chainId: 968, address: NEW, signer: SIGNER }]);
    expect(s.note).toMatch(/names 0x1111/);
  });

  it("names the wallet in a brand new file too", async () => {
    const s = await build({}, SIGNER);
    expect(s.state).toBe("fresh");
    expect(parse(s.text).contracts).toEqual([{ chainId: 968, address: NEW, signer: SIGNER }]);
  });

  it("offers a single entry that names the wallet when the current file cannot be read", async () => {
    const s = await build({ [FILE]: "not json" }, SIGNER);
    expect(s.state).toBe("manual");
    expect(parse(s.text)).toEqual({ chainId: 968, address: NEW, signer: SIGNER });
  });

  it("leaves a file alone when the entry already names this wallet, whatever its case", async () => {
    const s = await build({ [FILE]: tallyJson({ chainId: 968, address: NEW, signer: SIGNER.toUpperCase().replace("0X", "0x") }) }, SIGNER);
    expect(s.state).toBe("listed");
  });

  it("leaves a file alone when the entry names nobody (the old format keeps working)", async () => {
    const s = await build({ [FILE]: tallyJson({ chainId: 968, address: NEW }) }, SIGNER);
    expect(s.state).toBe("listed");
    expect(parse(s.text).contracts).toEqual([{ chainId: 968, address: NEW }]);
  });

  it("offers a corrected file when the entry names a different wallet, changing only that entry's signer", async () => {
    const keep = { chainId: 5042, address: TARGET, signer: OTHER, label: "mainnet" };
    const stale = { chainId: 968, address: NEW, signer: OTHER, label: "demo" };
    const s = await build({ [FILE]: tallyJson(keep, stale) }, SIGNER);
    expect(s.state).toBe("update");
    expect(parse(s.text).contracts).toEqual([keep, { ...stale, signer: SIGNER }]);
    expect(s.note).toMatch(/names a different wallet \(0x2222/);
    expect(s.note).toMatch(/Only the repository's owner/);
  });

  it("never rewrites an entry when no signer is known", async () => {
    const s = await build({ [FILE]: tallyJson({ chainId: 968, address: NEW, signer: OTHER }) });
    expect(s.state).toBe("listed");
    expect(parse(s.text).contracts).toEqual([{ chainId: 968, address: NEW, signer: OTHER }]);
  });
});

describe("mergeTallyContracts with a signer", () => {
  it("reports what it changed", () => {
    const r = mergeTallyContracts([{ chainId: 968, address: NEW, signer: OTHER }], 968, NEW, SIGNER);
    expect(r).toMatchObject({ alreadyListed: true, updated: true, named: OTHER.toLowerCase() });
    expect(mergeTallyContracts([], 968, NEW, SIGNER)).toMatchObject({ alreadyListed: false, updated: false });
  });
});
