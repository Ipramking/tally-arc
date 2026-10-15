import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/tally-snippet/route";
import { MAX_ENTRIES } from "@/lib/repo-proof";
import { buildTallySnippet, mergeTallyContracts } from "@/lib/tally-snippet";
import { fakeWorld, OTHER, REPO, TARGET, tallyJson } from "./helpers";

const FILE = "https://raw.githubusercontent.com/acme/vault/HEAD/tally.json";
const NEW = "0x3333333333333333333333333333333333333333";
const parse = (text: string) => JSON.parse(text);

const build = (files: Record<string, string | number | Error>, address = NEW, chainId = 968) =>
  buildTallySnippet({ repoUrl: REPO, chainId, address, fetchImpl: fakeWorld({ files }) });

describe("buildTallySnippet", () => {
  it("keeps every contract already listed and adds the new one", async () => {
    const existing = [
      { chainId: 5042, address: TARGET },
      { chainId: 968, address: OTHER },
    ];
    const s = await build({ [FILE]: tallyJson(...existing) });
    expect(s.state).toBe("merged");
    expect(s.kept).toBe(2);
    expect(parse(s.text)).toEqual({ version: 1, contracts: [...existing, { chainId: 968, address: NEW }] });
    expect(s.note).toMatch(/2 contracts/);
  });

  it("keeps entries it does not understand exactly as they were", async () => {
    const odd = [{ chainId: 1, address: "0xabc", label: "keep me" }, "stray", { chainId: 5042, address: TARGET, note: "mainnet" }];
    const s = await build({ [FILE]: tallyJson(...odd) });
    expect(parse(s.text).contracts.slice(0, 3)).toEqual(odd);
    expect(parse(s.text).contracts).toHaveLength(4);
  });

  it("changes nothing when the contract is already listed, whatever the address case", async () => {
    const s = await build({ [FILE]: tallyJson({ chainId: 968, address: NEW.toUpperCase().replace("0X", "0x") }) });
    expect(s.state).toBe("listed");
    expect(parse(s.text).contracts).toHaveLength(1);
    expect(s.note).toMatch(/already lists/);
  });

  it("lists the same address on another network as a separate entry", async () => {
    const s = await build({ [FILE]: tallyJson({ chainId: 5042, address: NEW }) });
    expect(s.state).toBe("merged");
    expect(parse(s.text).contracts).toEqual([
      { chainId: 5042, address: NEW },
      { chainId: 968, address: NEW },
    ]);
  });

  it("starts the first entry of an empty list", async () => {
    const s = await build({ [FILE]: tallyJson() });
    expect(s.state).toBe("merged");
    expect(s.kept).toBe(0);
    expect(s.note).toMatch(/no contracts yet/);
    expect(parse(s.text).contracts).toEqual([{ chainId: 968, address: NEW }]);
  });

  it("offers a complete new file when the repository has none", async () => {
    const s = await build({}); // 404
    expect(s.state).toBe("fresh");
    expect(parse(s.text)).toEqual({ version: 1, contracts: [{ chainId: 968, address: NEW }] });
  });

  it("never offers a whole file when the current one cannot be read", async () => {
    for (const files of [{ [FILE]: "not json" }, { [FILE]: JSON.stringify({ version: 2, contracts: [] }) }, { [FILE]: 503 }, { [FILE]: new Error("network down") }]) {
      const s = await build(files);
      expect(s.state).toBe("manual");
      const body = parse(s.text);
      expect(body).toEqual({ chainId: 968, address: NEW }); // one entry, not a file
      expect(body.version).toBeUndefined();
      expect(s.note).toMatch(/Do not replace the file/);
    }
  });

  it("treats a repository link that is not plain GitHub as unreadable", async () => {
    const s = await buildTallySnippet({ repoUrl: "https://evil.example/a/b", chainId: 968, address: NEW, fetchImpl: fakeWorld() });
    expect(s.state).toBe("manual");
    expect(s.note).toMatch(/plain GitHub link/);
  });

  it("falls back to a single entry when the current file is over the size limit", async () => {
    const many = Array.from({ length: MAX_ENTRIES }, (_, i) => ({ chainId: 1, address: `0x${i.toString(16).padStart(40, "0")}` }));
    const s = await build({ [FILE]: tallyJson(...many) }); // about 70 KB, past the 64 KB cap clients accept
    expect(s.state).toBe("manual");
    expect(parse(s.text)).toEqual({ chainId: 968, address: NEW });
  });
});

describe("mergeTallyContracts", () => {
  it("appends without mutating its input", () => {
    const existing = Object.freeze([{ chainId: 5042, address: TARGET }]);
    const r = mergeTallyContracts(existing, 968, NEW);
    expect(r).toMatchObject({ kept: 1, alreadyListed: false, beyondLimit: false });
    expect(existing).toHaveLength(1);
  });

  it("flags a new entry that would fall beyond the entries clients read", () => {
    const many = Array.from({ length: MAX_ENTRIES }, (_, i) => ({ chainId: 1, address: `0x${i.toString(16).padStart(40, "0")}` }));
    expect(mergeTallyContracts(many, 968, NEW)).toMatchObject({ alreadyListed: false, beyondLimit: true });
    expect(mergeTallyContracts([...many.slice(0, 5), { chainId: 968, address: NEW }], 968, NEW)).toMatchObject({ alreadyListed: true, beyondLimit: false });
  });
});

describe("GET /api/tally-snippet", () => {
  const call = (query: string) => GET(new Request(`https://studio.test/api/tally-snippet?${query}`));

  it("rejects an unknown network, a bad address and a non-GitHub repository without fetching anything", async () => {
    expect((await call(`repo=${REPO}&chain=nope&address=${NEW}`)).status).toBe(400);
    expect((await call(`repo=${REPO}&chain=arc&address=0x123`)).status).toBe(400);
    expect((await call(`repo=https://evil.example/a/b&chain=arc&address=${NEW}`)).status).toBe(400);
  });

  it("is never cached by the browser", async () => {
    const res = await call(`repo=${REPO}&chain=nope&address=${NEW}`);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
