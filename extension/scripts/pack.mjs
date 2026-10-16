#!/usr/bin/env node
// Builds the zip you upload to the Chrome Web Store: the files the extension runs and nothing else (no tests, no
// tooling, no node_modules). Deterministic: sorted paths and a fixed timestamp, so the same sources give the same bytes.
//
//   node scripts/pack.mjs [--out <dir>]     writes <dir>/tally-extension-<version>.zip (default: dist/)
//
// It fails if the manifest points at a file that would not be in the zip.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

const ROOT_FILES = ["manifest.json", "background.js", "chains.generated.js"];
const DIRECTORIES = ["lib", "content", "popup", "icons"];

function walk(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    return entry.isDirectory() ? walk(rel) : entry.name.startsWith(".") ? [] : [rel];
  });
}

const files = [...ROOT_FILES, ...DIRECTORIES.flatMap(walk)].sort();

// Everything the manifest references must be in the package.
const referenced = [
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
  manifest.action?.default_popup,
  manifest.background?.service_worker,
  ...(manifest.content_scripts ?? []).flatMap((c) => [...(c.js ?? []), ...(c.css ?? [])]),
].filter(Boolean);
const missing = referenced.filter((file) => !files.includes(file));
if (missing.length) {
  console.error(`pack: the manifest references files that are not in the package: ${missing.join(", ")}`);
  process.exit(1);
}

// A fixed DOS timestamp (1980-01-01 00:00:00) keeps the output identical from run to run.
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;

function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const deflated = deflateRawSync(data, { level: 9 });
    const smaller = deflated.length < data.length;
    const body = smaller ? deflated : data;
    const method = smaller ? 8 : 0;
    const crc = crc32(data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: names are UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBytes, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // version made by
    entry.writeUInt16LE(20, 6); // version needed
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);

    offset += local.length + nameBytes.length + body.length;
  }
  const centralSize = central.reduce((total, chunk) => total + chunk.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}

const outFlag = process.argv.indexOf("--out");
const outDir = resolve(outFlag > -1 ? process.argv[outFlag + 1] : join(root, "dist"));
const archive = zip(files.map((name) => ({ name, data: readFileSync(join(root, name)) })));
mkdirSync(outDir, { recursive: true });
const target = join(outDir, `tally-extension-${manifest.version}.zip`);
writeFileSync(target, archive);

console.log(`wrote ${target}`);
console.log(`${files.length} files, ${(archive.length / 1024).toFixed(1)} KB, sha256 ${createHash("sha256").update(archive).digest("hex")}`);
if (!existsSync(target)) process.exit(1);
