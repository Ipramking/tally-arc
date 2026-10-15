import { describe, expect, it } from "vitest";
import { addRecent, MAX_RECENT, parseRecent, rememberRegistration, serializeRecent, type RecentRegistration } from "@/lib/recent";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const entry = (o: Partial<RecentRegistration> = {}): RecentRegistration => ({ chain: "bot-testnet", target: A, repo: "https://github.com/acme/vault", buildHash: "abc123", at: 1_700_000_000_000, ...o });

describe("parseRecent", () => {
  it("round-trips what it stored", () => {
    const list = [entry(), entry({ target: B, chain: "arc" })];
    expect(parseRecent(serializeRecent(list))).toEqual(list);
  });

  it("returns an empty list for missing, oversized or non-JSON input", () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent("")).toEqual([]);
    expect(parseRecent("{not json")).toEqual([]);
    expect(parseRecent('{"a":1}')).toEqual([]);
    expect(parseRecent(`[${"0,".repeat(40_000)}0]`)).toEqual([]);
  });

  it("drops entries that are malformed or unsafe, and keeps the good ones", () => {
    const raw = JSON.stringify([
      entry(),
      { ...entry(), chain: "Bad Chain!" },
      { ...entry(), target: "0x123" },
      { ...entry(), repo: "javascript:alert(1)" },
      { ...entry(), repo: "https://evil.example/a/b" },
      { ...entry(), at: "yesterday" },
      { ...entry(), at: -5 },
      { ...entry(), buildHash: "<script>" }, // bad hash is blanked, entry kept
      null,
      "text",
    ]);
    const out = parseRecent(raw);
    expect(out).toHaveLength(2);
    expect(out[0].target).toBe(A);
    expect(out[1].buildHash).toBe("");
  });

  it("re-canonicalises the repository link", () => {
    const out = parseRecent(JSON.stringify([{ ...entry(), repo: "https://github.com/acme/vault/tree/main/contracts" }]));
    expect(out[0].repo).toBe("https://github.com/acme/vault");
  });

  it("never returns more than the cap", () => {
    const many = Array.from({ length: 50 }, (_, i) => entry({ target: `0x${(i + 1).toString(16).padStart(40, "0")}` }));
    expect(parseRecent(JSON.stringify(many))).toHaveLength(MAX_RECENT);
  });
});

describe("rememberRegistration", () => {
  it("stamps the entry with the time it is given and puts it first", () => {
    const list = rememberRegistration([entry({ target: B })], { chain: "arc", target: A, repo: "https://github.com/acme/vault", buildHash: "" }, 1234);
    expect(list[0]).toMatchObject({ target: A, at: 1234 });
    expect(list).toHaveLength(2);
  });
});

describe("addRecent", () => {
  it("puts the newest first and keeps the earlier ones", () => {
    const list = addRecent([entry({ target: A })], entry({ target: B, at: 2 }));
    expect(list.map((e) => e.target)).toEqual([B, A]);
  });

  it("moves a re-registered contract to the top instead of listing it twice", () => {
    const list = addRecent([entry({ target: B }), entry({ target: A })], entry({ target: A.toUpperCase().replace("0X", "0x"), at: 9 }));
    expect(list).toHaveLength(2);
    expect(list[0].at).toBe(9);
  });

  it("keeps the same address on different networks apart", () => {
    const list = addRecent([entry({ chain: "arc" })], entry({ chain: "bot-testnet" }));
    expect(list).toHaveLength(2);
  });

  it("drops the oldest beyond the cap", () => {
    let list: RecentRegistration[] = [];
    for (let i = 0; i < MAX_RECENT + 3; i++) list = addRecent(list, entry({ target: `0x${(i + 1).toString(16).padStart(40, "0")}`, at: i + 1 }));
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0].at).toBe(MAX_RECENT + 3);
  });
});
