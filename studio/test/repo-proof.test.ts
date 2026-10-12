import { describe, expect, it } from "vitest";
import { checkRepoProof, MAX_FILE_BYTES } from "@/lib/repo-proof";
import { fakeWorld, tallyJson, TARGET } from "./helpers";

const REPO = "https://github.com/acme/vault";
const FILE = "https://raw.githubusercontent.com/acme/vault/HEAD/tally.json";
const check = (fetchImpl: ReturnType<typeof fakeWorld>, overrides: Partial<Parameters<typeof checkRepoProof>[0]> = {}) =>
  checkRepoProof({ repoUrl: REPO, chainId: 5042, address: TARGET, fetchImpl, ...overrides });
const serving = (body: string | number | Error) => fakeWorld({ files: { [FILE]: body } });

describe("repo proof (tally.json)", () => {
  it("confirmed when tally.json lists this chain and address", async () => {
    const world = serving(tallyJson({ chainId: 1, address: TARGET }, { chainId: 5042, address: TARGET }));
    expect(await check(world)).toEqual({ status: "confirmed", url: FILE });
    expect(world.calls[0].url).toBe(FILE);
  });

  it("address comparison ignores case and extra fields are tolerated", async () => {
    const body = JSON.stringify({ version: 1, name: "Vault", contracts: [{ chainId: 5042, address: TARGET.toLowerCase(), label: "main" }] });
    expect((await check(serving(body))).status).toBe("confirmed");
  });

  it("requests are locked down", async () => {
    const world = serving(tallyJson());
    await check(world);
    expect(world.calls[0].init).toMatchObject({ method: "GET", credentials: "omit", redirect: "error", cache: "no-store" });
  });

  it("not-listed: right file, wrong chain or address", async () => {
    expect((await check(serving(tallyJson({ chainId: 1, address: TARGET })))).status).toBe("not-listed");
    expect((await check(serving(tallyJson({ chainId: 5042, address: `0x${"9".repeat(40)}` })))).status).toBe("not-listed");
    expect((await check(serving(tallyJson()))).status).toBe("not-listed");
  });

  it("chainId must be a number and address a valid address string", async () => {
    expect((await check(serving(tallyJson({ chainId: "5042", address: TARGET })))).status).toBe("not-listed");
    expect((await check(serving(tallyJson({ chainId: 5042, address: [TARGET] })))).status).toBe("not-listed");
    expect((await check(serving(tallyJson(null, 7, "x")))).status).toBe("not-listed");
  });

  it("no-file on 404, unavailable on other HTTP errors", async () => {
    expect((await check(serving(404))).status).toBe("no-file");
    for (const status of [403, 429, 500, 502]) {
      const result = await check(serving(status));
      expect(result.status).toBe("unavailable");
      expect(result.detail).toBe(`HTTP ${status}`);
    }
  });

  it("redirects, network errors and timeouts are 'unavailable', never followed", async () => {
    expect((await check(serving(new TypeError("redirect mode is set to error")))).status).toBe("unavailable");
    const timeout = await check(serving(new DOMException("timed out", "TimeoutError")));
    expect(timeout).toMatchObject({ status: "unavailable", detail: "timeout" });
  });

  it("invalid-file for malformed or unexpected content", async () => {
    const bad = ["not json", "[]", "null", '"x"', "{}", '{"version":2,"contracts":[]}', '{"version":1}', '{"version":1,"contracts":{}}', '{"version":"1","contracts":[]}'];
    for (const body of bad) expect((await check(serving(body))).status, body).toBe("invalid-file");
  });

  it("invalid-file when the file is too large", async () => {
    const result = await check(serving("x".repeat(MAX_FILE_BYTES + 1)));
    expect(result).toMatchObject({ status: "invalid-file", detail: "too large" });
  });

  it("only the first 1000 entries of contracts are read", async () => {
    const filler = Array.from({ length: 1000 }, () => 1);
    const late = JSON.stringify({ version: 1, contracts: [...filler, { chainId: 5042, address: TARGET }] });
    expect((await check(serving(late))).status).toBe("not-listed");
    const early = JSON.stringify({ version: 1, contracts: [...filler.slice(1), { chainId: 5042, address: TARGET }] });
    expect((await check(serving(early))).status).toBe("confirmed");
  });

  it("invalid-repo for anything that is not a plain github.com repository, without any request", async () => {
    for (const repoUrl of ["javascript:alert(1)", "https://evil.example/acme/vault", "https://github.com/acme", ""]) {
      const world = serving(tallyJson());
      expect((await check(world, { repoUrl })).status, repoUrl).toBe("invalid-repo");
      expect(world.calls).toHaveLength(0);
    }
  });

  it("path segments after owner/repo never change which file is fetched", async () => {
    const world = serving(tallyJson({ chainId: 5042, address: TARGET }));
    await check(world, { repoUrl: "https://github.com/acme/vault/tree/main/contracts" });
    expect(world.calls[0].url).toBe(FILE);
  });
});
