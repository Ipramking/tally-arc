const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");
const { root } = require("./helpers");

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

function build() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "tally-pack-"));
  const run = spawnSync(process.execPath, [path.join(root, "scripts", "pack.mjs"), "--out", out], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return fs.readFileSync(path.join(out, `tally-extension-${manifest.version}.zip`));
}

/** A small reader for the zip we write: names and inflated contents, checked against the stored CRCs. */
function readZip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, "end of central directory");
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const entries = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50, "central directory entry");
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const size = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const offset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    const dataStart = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    const raw = buffer.subarray(dataStart, dataStart + size);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    assert.equal(zlib.crc32(data) >>> 0, crc, `crc of ${name}`);
    entries[name] = data;
    cursor += 46 + nameLength;
  }
  return entries;
}

const onDisk = (rel) => fs.readFileSync(path.join(root, rel));
const walk = (dir) =>
  fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));

test("the package holds exactly the files the extension runs, byte for byte", () => {
  const entries = readZip(build());
  const expected = ["manifest.json", "background.js", "chains.generated.js", ...["lib", "content", "popup", "icons"].flatMap(walk)].sort();
  assert.deepEqual(Object.keys(entries).sort(), expected);
  for (const [name, data] of Object.entries(entries)) assert.ok(onDisk(name).equals(data), `${name} matches the source`);
});

test("it ships no tests, tooling, dependencies or package files", () => {
  for (const name of Object.keys(readZip(build()))) {
    assert.doesNotMatch(name, /^(test|scripts|node_modules|dist)\//, name);
    assert.doesNotMatch(name, /package(-lock)?\.json|\.py$|\.md$/, name);
    assert.doesNotMatch(name, /^\/|\\|\.\./, "no absolute, backslash or parent paths");
  }
});

test("every file the manifest references is in the package", () => {
  const names = Object.keys(readZip(build()));
  const referenced = [
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    manifest.action.default_popup,
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap((c) => [...c.js, ...(c.css || [])]),
  ];
  for (const file of referenced) assert.ok(names.includes(file), file);
});

test("the same sources give the same bytes", () => {
  assert.ok(build().equals(build()));
});

test("the package is small", () => {
  assert.ok(build().length < 200 * 1024);
});

test("the listing limits hold: a name of at most 45 characters and a description of at most 132", () => {
  assert.ok(manifest.name.length <= 45, `name is ${manifest.name.length}`);
  assert.ok(manifest.description.length <= 132, `description is ${manifest.description.length}`);
});
