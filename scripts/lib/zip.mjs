import zlib from "node:zlib";

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function findEOCD(buf) {
  const min = 22;
  for (let i = buf.length - min; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { return i; }
  }
  throw new Error("no end-of-central-directory record");
}

export function readZip(buf) {
  const eocd = findEOCD(buf);
  const total = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const central = [];
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(offset) !== CEN_SIG) { throw new Error("corrupt central directory entry " + i); }
    const method = buf.readUInt16LE(offset + 10);
    const compSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLen);
    central.push({ name, method, compSize, localOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return central.map((entry) => {
    const nameLen = buf.readUInt16LE(entry.localOffset + 26);
    const extraLen = buf.readUInt16LE(entry.localOffset + 28);
    const dataStart = entry.localOffset + 30 + nameLen + extraLen;
    const raw = buf.subarray(dataStart, dataStart + entry.compSize);
    const data = entry.method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw);
    return { name: entry.name, data };
  });
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function writeZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOC_SIG, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, entry.data);
    central.push({ nameBuf, crc, size: entry.data.length, offset });
    offset += local.length + nameBuf.length + entry.data.length;
  }
  const centralStart = offset;
  for (const entry of central) {
    const rec = Buffer.alloc(46);
    rec.writeUInt32LE(CEN_SIG, 0);
    rec.writeUInt16LE(20, 4);
    rec.writeUInt16LE(20, 6);
    rec.writeUInt16LE(0, 8);
    rec.writeUInt16LE(0, 10);
    rec.writeUInt16LE(0, 12);
    rec.writeUInt16LE(0, 14);
    rec.writeUInt32LE(entry.crc, 16);
    rec.writeUInt32LE(entry.size, 20);
    rec.writeUInt32LE(entry.size, 24);
    rec.writeUInt16LE(entry.nameBuf.length, 28);
    rec.writeUInt16LE(0, 30);
    rec.writeUInt16LE(0, 32);
    rec.writeUInt16LE(0, 34);
    rec.writeUInt16LE(0, 36);
    rec.writeUInt32LE(0, 38);
    rec.writeUInt32LE(entry.offset, 42);
    chunks.push(rec, entry.nameBuf);
    offset += rec.length + entry.nameBuf.length;
  }
  const centralSize = offset - centralStart;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);
  chunks.push(eocd);
  return Buffer.concat(chunks);
}
