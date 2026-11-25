import zlib from 'node:zlib';

/** A plain zip of a Map(name -> Buffer). Fixed dates, so the same source always gives the same file. */
export function makeZip(files) {
  const local = [];
  const central = [];
  let at = 0;
  for (const [n, b] of files) {
    const name = Buffer.from(n);
    const data = zlib.deflateRawSync(b, { level: 9 });
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt16LE(0x5a21, 12);
    h.writeUInt32LE(zlib.crc32(b), 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(b.length, 22); h.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); h.copy(c, 6, 4, 30); c.writeUInt32LE(at, 42);
    local.push(h, name, data);
    central.push(c, name);
    at += 30 + name.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(at, 16);
  return Buffer.concat([...local, dir, end]);
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

/** Reads a zip into a Map, refusing anything that is not a small set of plain files under the allowed top-level names. */
export function readZip(buf, allowedTop) {
  const bad = (why) => { throw new Error(`The update package is not valid: ${why}.`); };
  let e = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) bad('no file list');
  const count = buf.readUInt16LE(e + 10);
  if (count === 0 || count > 200) bad('unexpected number of files');
  let at = buf.readUInt32LE(e + 16);
  const out = new Map();
  const seen = new Set();
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) bad('damaged file list');
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const packed = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const offset = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
    const parts = name.split('/');
    if (!parts.every((p) => /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(p) && !/[. ]$/.test(p) && !RESERVED.test(p))) bad(`unsafe name ${JSON.stringify(name)}`);
    if (!allowedTop.has(parts[0])) bad(`unexpected file ${JSON.stringify(name)}`);
    if (seen.has(name.toLowerCase())) bad('a file appears twice');
    seen.add(name.toLowerCase());
    total += size;
    if (size > 5_000_000 || total > 20_000_000) bad('too large');
    if (offset + 30 > buf.length || buf.readUInt32LE(offset) !== 0x04034b50) bad('damaged file');
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const raw = buf.subarray(start, start + packed);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
    else bad('unknown compression');
    if (data.length !== size || zlib.crc32(data) !== crc) bad('damaged file');
    out.set(name, data);
  }
  return out;
}
