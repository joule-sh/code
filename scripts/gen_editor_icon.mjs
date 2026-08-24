import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "editor", "media", "icon.png");

const SIZE = 256;
const PAD = 30;
const VIEW = 16;
const SAMPLES = 4;
const BACKGROUND = [0x10, 0x14, 0x18];
const MARK = [0xff, 0xff, 0xff];

const STEM_X = 8.5;
const STEM_TOP = 2;
const STEM_BOTTOM = 8;
const BOWL_CENTRE = [5.5, 8];
const BOWL_RADIUS = 3;
const HALF_STROKE = 1.5;
const DOT_CENTRE = [13, 12];
const DOT_RADIUS = 1.75;
const SHIFT = [0.125, 0.875];

function distanceToStem(x, y) {
  const cy = Math.min(Math.max(y, STEM_TOP), STEM_BOTTOM);
  return Math.hypot(x - STEM_X, y - cy);
}

function distanceToBowl(x, y) {
  const dx = x - BOWL_CENTRE[0];
  const dy = y - BOWL_CENTRE[1];
  if (dy >= 0) { return Math.abs(Math.hypot(dx, dy) - BOWL_RADIUS); }
  const left = Math.hypot(x - (BOWL_CENTRE[0] - BOWL_RADIUS), dy);
  const right = Math.hypot(x - (BOWL_CENTRE[0] + BOWL_RADIUS), dy);
  return Math.min(left, right);
}

function covered(x, y) {
  if (Math.min(distanceToStem(x, y), distanceToBowl(x, y)) <= HALF_STROKE) { return true; }
  return Math.hypot(x - DOT_CENTRE[0], y - DOT_CENTRE[1]) <= DOT_RADIUS;
}

function coverage(px, py) {
  const scale = (SIZE - PAD * 2) / VIEW;
  let hits = 0;
  for (let sy = 0; sy < SAMPLES; sy++) {
    for (let sx = 0; sx < SAMPLES; sx++) {
      const x = (px + (sx + 0.5) / SAMPLES - PAD) / scale - SHIFT[0];
      const y = (py + (sy + 0.5) / SAMPLES - PAD) / scale - SHIFT[1];
      if (covered(x, y)) { hits++; }
    }
  }
  return hits / (SAMPLES * SAMPLES);
}

function pixels() {
  const stride = SIZE * 3 + 1;
  const raw = Buffer.alloc(stride * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const row = y * stride;
    for (let x = 0; x < SIZE; x++) {
      const a = coverage(x, y);
      for (let c = 0; c < 3; c++) {
        raw[row + 1 + x * 3 + c] = Math.round(BACKGROUND[c] * (1 - a) + MARK[c] * a);
      }
    }
  }
  return raw;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) { c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) { c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8); }
  return (c ^ -1) >>> 0;
}

function chunk(type, body) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0);
  const tagged = Buffer.concat([Buffer.from(type, "ascii"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tagged), 0);
  return Buffer.concat([head, tagged, crc]);
}

function png(raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const out = png(pixels());
fs.writeFileSync(OUT, out);
console.log(`gen-editor-icon: ${path.relative(ROOT, OUT)} (${SIZE}x${SIZE}, ${out.length} bytes)`);
