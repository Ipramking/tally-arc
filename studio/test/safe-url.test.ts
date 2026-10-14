import { describe, expect, it } from "vitest";
import { displayText, isAddress, parseGithubRepo, shorten, tallyJsonUrl } from "@/lib/safe-url";
import { vectors } from "./helpers";

describe("safe-url", () => {
  it("parseGithubRepo matches the shared vectors", () => {
    for (const v of vectors("safe-url.json").parseGithubRepo) {
      expect(parseGithubRepo(v.input), `${JSON.stringify(v.input)} (${v.why ?? "ok"})`).toEqual(v.expected);
    }
  });

  it("isAddress matches the shared vectors", () => {
    for (const v of vectors("safe-url.json").isAddress) expect(isAddress(v.input), JSON.stringify(v.input)).toBe(v.expected);
  });

  it("only the canonical URL is ever linked; the tally.json URL is derived from owner/repo alone", () => {
    const parsed = parseGithubRepo("https://github.com/owner/repo/tree/main/x.git")!;
    expect(parsed.url).toBe("https://github.com/owner/repo");
    expect(tallyJsonUrl(parsed)).toBe("https://raw.githubusercontent.com/owner/repo/HEAD/tally.json");
  });

  it("displayText strips invisible and bidi characters and truncates", () => {
    const hostile = ["ab", String.fromCharCode(0x202e), "cd", String.fromCharCode(0x200b), "ef", String.fromCharCode(0), "g"].join("");
    expect(displayText(hostile)).toBe("abcdefg");
    expect(displayText("x".repeat(100), 10)).toBe(`${"x".repeat(9)}\u2026`);
    expect(displayText(42)).toBe("");
  });

  it("shorten", () => {
    expect(shorten("0x0f399C0143CAd70b43D18a5696026B0cEdcA0cCb")).toBe("0x0f39\u20260cCb");
    expect(shorten("nope")).toBe("");
    expect(shorten(undefined)).toBe("");
  });
});
