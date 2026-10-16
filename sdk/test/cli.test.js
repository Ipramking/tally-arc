const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { lib, arc, encodeV2, encodeNone, encodeAddressWord, registryRpc, fakeWorld, SIGNER, TARGET } = require("../../extension/test/helpers");
const { main, loadChains } = require("../cli.js");

const registry = lib("registry.js");
const sel = registry.GET_REGISTRATION;

const REG_V2 = "0x4444444444444444444444444444444444444444";
const chain = { ...arc, key: "test-chain", id: 31337, name: "Test Chain", registries: [{ version: 2, address: REG_V2 }] };
const CHAINS_FILE = JSON.stringify({ chains: [{ key: "test-chain", id: 31337, name: "Test Chain", rpcUrl: "https://rpc.test.example", registries: [{ version: 2, address: REG_V2 }] }] });
const TALLY = JSON.stringify({ version: 1, contracts: [{ chainId: 31337, address: TARGET, signer: SIGNER }] });
const IMPL = encodeAddressWord("0x6666666666666666666666666666666666666666");

const world = (v2, extra = {}) => fakeWorld({ rpc: registryRpc(chain, sel, { [REG_V2]: v2 ?? encodeNone(2) }), ...extra });

/** Runs the command with in-memory files and captured output. */
async function run(argv, { files = {}, env = {}, fetchImpl, appendFails = false } = {}) {
  const out = [];
  const err = [];
  const appended = [];
  const all = { "tally.json": TALLY, "chains.json": CHAINS_FILE, ...files };
  const io = {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    readFile: (p) => {
      const key = Object.keys(all).find((k) => path.resolve(k) === p);
      if (key === undefined) throw new Error(`ENOENT: no such file ${p}`);
      return all[key];
    },
    appendFile: (p, text) => {
      if (appendFails) throw new Error("read-only");
      appended.push([p, text]);
    },
    fetchImpl,
  };
  const code = await main(argv, env, io);
  return { code, out: out.join(""), err: err.join(""), appended };
}
const args = (...extra) => ["--chains", "chains.json", "--repository", "acme/vault", ...extra];

test("--help prints the usage and the exit codes", async () => {
  const r = await run(["--help"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /Usage: tally-verify/);
  assert.match(r.out, /Exit code: 0 all good, 1 a record and the file disagree, 2 something could not be checked/);
});

test("usage mistakes exit 1 and print the usage", async () => {
  for (const argv of [["--nope"], ["extra"], ["--timeout", "5"], ["--timeout", "abc"], ["--repository", "not-a-repo"]]) {
    const r = await run(argv);
    assert.equal(r.code, 1, argv.join(" "));
    assert.match(r.err, /tally-verify:/, argv.join(" "));
  }
});

test("a missing or unreadable tally.json fails with the reason", async () => {
  const missing = await run(["--file", "nope.json"]);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /cannot read nope\.json/);
  const broken = await run([], { files: { "tally.json": "{not json" } });
  assert.equal(broken.code, 1);
  assert.match(broken.err, /cannot read tally\.json as JSON/);
});

test("a passing run exits 0 and lists every contract", async () => {
  const r = await run(args(), { fetchImpl: world(encodeV2()) });
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /ok\s+test-chain\s+0x0f39…0cCb\s+verified/);
  assert.match(r.out, /1 checked: 1 ok, 0 with warnings, 0 failing, 0 could not be checked/);
  assert.match(r.out, /records must name acme\/vault/);
});

test("--json prints the whole result, including the exit code", async () => {
  const r = await run(args("--json"), { fetchImpl: world(encodeV2()) });
  const body = JSON.parse(r.out);
  assert.equal(body.ok, true);
  assert.equal(body.exitCode, 0);
  assert.equal(body.results[0].level, "verified");
});

test("a failing run exits 1 and explains each problem", async () => {
  const r = await run(args(), { fetchImpl: world(encodeV2({ flags: 2 })) });
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL\s+test-chain/);
  assert.match(r.out, /control moved/);
});

test("a chain that cannot be read exits 2", async () => {
  const r = await run(args(), { fetchImpl: world(new TypeError("network down")) });
  assert.equal(r.code, 2);
  assert.match(r.out, /could not read Test Chain/);
});

test("--strict turns a warning into a failure", async () => {
  const proxy = () => world(encodeV2(), { storage: { [TARGET]: { [registry.EIP1967_IMPLEMENTATION_SLOT]: IMPL } } });
  assert.equal((await run(args(), { fetchImpl: proxy() })).code, 0);
  assert.equal((await run(args("--strict"), { fetchImpl: proxy() })).code, 1);
});

test("the repository defaults to GITHUB_REPOSITORY, and 'none' skips the check", async () => {
  const other = () => world(encodeV2({ repo: "https://github.com/someone/else" }));
  const argv = ["--chains", "chains.json"];
  assert.equal((await run(argv, { env: { GITHUB_REPOSITORY: "acme/vault" }, fetchImpl: other() })).code, 1);
  assert.equal((await run([...argv, "--repository", "none"], { env: { GITHUB_REPOSITORY: "acme/vault" }, fetchImpl: other() })).code, 0);
  const unset = await run(argv, { fetchImpl: other() });
  assert.equal(unset.code, 0);
  assert.match(unset.out, /not checking which repository/);
});

test("under GitHub Actions it prints annotations with the data escaped, and writes the step summary", async () => {
  const env = { GITHUB_ACTIONS: "true", GITHUB_STEP_SUMMARY: "/tmp/summary.md" };
  const r = await run(args(), { env, fetchImpl: world(encodeV2({ flags: 1 })) });
  assert.equal(r.code, 1);
  assert.match(r.out, /^::error file=tally\.json,title=Tally test-chain 0x0f39…0cCb::the code at this address changed/m);
  assert.equal(r.appended.length, 1);
  assert.equal(r.appended[0][0], "/tmp/summary.md");
  assert.match(r.appended[0][1], /\| test-chain \| `0x0f399C0143CAd70b43D18a5696026B0cEdcA0cCb` \| stale \| \*\*failing\*\* \|/);

  const quiet = await run(args(), { env: {}, fetchImpl: world(encodeV2({ flags: 1 })) });
  assert.doesNotMatch(quiet.out, /::error/);
});

test("a step summary that cannot be written never changes the result", async () => {
  const r = await run(args(), { env: { GITHUB_STEP_SUMMARY: "/nope" }, fetchImpl: world(encodeV2()), appendFails: true });
  assert.equal(r.code, 0);
});

test("--chains adds networks and replaces a bundled one with the same id", () => {
  const bundledIds = loadChains(undefined).chains.map((c) => c.id);
  const merged = loadChains(CHAINS_FILE).chains;
  assert.ok(merged.some((c) => c.id === 31337));
  assert.equal(merged.length, bundledIds.length + 1);

  const id = bundledIds[0];
  const override = JSON.stringify([{ key: "mine", id, name: "Mine", rpcUrl: "https://rpc.mine.example", registries: [] }]);
  const replaced = loadChains(override).chains;
  assert.equal(replaced.length, bundledIds.length);
  assert.equal(replaced.find((c) => c.id === id).key, "mine");
});

test("--chains rejects anything unsafe or malformed", () => {
  const bad = (chain) => JSON.stringify([{ key: "x", id: 99, name: "X", rpcUrl: "https://rpc.x.example", registries: [], ...chain }]);
  assert.throws(() => loadChains("{nope"), /not valid JSON/);
  assert.throws(() => loadChains("{}"), /array of chains/);
  assert.throws(() => loadChains(bad({ rpcUrl: "http://rpc.x.example" })), /https/);
  assert.throws(() => loadChains(bad({ rpcUrl: "https://user:pw@rpc.x.example" })), /https without credentials/);
  assert.throws(() => loadChains(bad({ rpcUrl: "nope" })), /not a URL/);
  assert.throws(() => loadChains(bad({ id: 0 })), /positive integer/);
  assert.throws(() => loadChains(bad({ registries: [{ version: 3, address: REG_V2 }] })), /bad registry/);
  assert.throws(() => loadChains(bad({ registries: "x" })), /registries must be an array/);
});

test("the installed command starts and prints its usage", () => {
  const bin = path.join(__dirname, "..", "bin", "tally-verify.mjs");
  const r = spawnSync(process.execPath, [bin, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Usage: tally-verify/);
});
