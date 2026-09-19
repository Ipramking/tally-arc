// Generates the Tally toolbar icons (16/48/128) with no dependencies.
// Draws a rounded square with an Arc-cyan → USDC-blue diagonal gradient.
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

// #38BDF8 (cyan) -> #2775CA (usdc)
const C1 = [0x38, 0xbd, 0xf8];
const C2 = [0x27, 0x75, 0xca];
const BG = [0x0b, 0x0f, 0x17];

function pngFor(size) {
  const r = size * 0.22; // corner radius
  const raw = Buffer.alloc(size * (1 + size * 4)); // filter byte + RGBA per row
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      // rounded-rect mask
      const dx = Math.min(x, size - 1 - x);
      const dy = Math.min(y, size - 1 - y);
      let inside = true;
      if (dx < r && dy < r) {
        const ddx = r - dx;
        const ddy = r - dy;
        inside = ddx * ddx + ddy * ddy <= r * r;
      }
      const t = (x + y) / (2 * (size - 1));
      const col = inside
        ? [lerp(C1[0], C2[0], t), lerp(C1[1], C2[1], t), lerp(C1[2], C2[2], t)]
        : BG;
      const a = inside ? 255 : 0;
      raw[p++] = col[0];
      raw[p++] = col[1];
      raw[p++] = col[2];
      raw[p++] = a;
    }
  }
  return encodePng(size, size, raw);
}

// --- minimal PNG encoder ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(w, h, raw) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, "icons");
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), pngFor(size));
  console.log(`wrote icons/icon${size}.png`);
}
