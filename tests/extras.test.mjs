// SharedTabs. Copyright (C) 2026 Ahsan Nawazish. SPDX-License-Identifier: AGPL-3.0-only. Additional terms: ADDITIONAL-TERMS.md (LICENSE.txt in the download)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { encodeGif } from '../extension/gif.js';
import { parseKeys, parseModifiers } from '../extension/policy.js';

test('keys and modifiers', () => {
  assert.deepEqual(parseKeys('Tab Tab Enter').map((k) => k.key), ['Tab', 'Tab', 'Enter']);
  assert.equal(parseKeys('ArrowDown', 5).length, 5);
  assert.equal(parseKeys(' ')[0].key, ' ');
  assert.throws(() => parseKeys('Tab Control+v'), /Clipboard/);
  assert.throws(() => parseKeys('a b', 60), /At most 100/);
  assert.equal(parseModifiers('ctrl+Shift'), 10);
  assert.equal(parseModifiers(undefined), 0);
  assert.throws(() => parseModifiers('hyper'), /Unknown modifier/);
});

// A reference decoder, so the encoder is checked against the format rather than against itself.
function decode(g) {
  const b = Buffer.from(g);
  assert.equal(b.toString('latin1', 0, 6), 'GIF89a');
  const w = b.readUInt16LE(6); const h = b.readUInt16LE(8);
  const pal = b.subarray(13, 13 + 768);
  let i = 13 + 768;
  const frames = [];
  for (;;) {
    const t = b[i++];
    if (t === 0x3b) { assert.equal(i, b.length); return { w, h, frames }; }
    if (t === 0x21) { i++; while (b[i]) i += b[i] + 1; i++; continue; }
    assert.equal(t, 0x2c);
    i += 9;
    const min = b[i++];
    const data = [];
    while (b[i]) { data.push(...b.subarray(i + 1, i + 1 + b[i])); i += b[i] + 1; }
    i++;
    const out = [];
    let size = min + 1; let bit = 0; let table = []; let prev = null;
    const reset = () => { table = Array.from({ length: 258 }, (_, k) => (k < 256 ? [k] : [])); size = min + 1; prev = null; };
    reset();
    for (;;) {
      let code = 0;
      for (let k = 0; k < size; k++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << k;
      if (code === 256) { reset(); continue; }
      if (code === 257) break;
      const entry = table[code] ?? [...prev, prev[0]];
      for (const v of entry) out.push(v);
      if (prev && table.length < 4096) table.push([...prev, entry[0]]);
      if (table.length === 1 << size && size < 12) size++;
      prev = entry;
    }
    assert.equal(out.length, w * h);
    frames.push(out.map((v) => [pal[v * 3], pal[v * 3 + 1], pal[v * 3 + 2]]));
  }
}
test('GIF encoder round-trips, including noise that fills the LZW table', async () => {
  const w = 160; const h = 120;
  const make = [(x, y) => [x < 80 ? 255 : 0, y < 60 ? 255 : 0, 128], (x, y) => [(x * 7919 + y * 104729) % 256, (x * 31 + y * 17) % 256, (x ^ y) & 255], () => [255, 255, 255]];
  const px = make.map((f) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set([...f(x, y), 255], (y * w + x) * 4); return d; });
  const g = decode(await encodeGif(w, h, 3, async (i) => px[i], [10, 20, 30]));
  assert.deepEqual([g.w, g.h, g.frames.length], [w, h, 3]);
  for (const [k, worst] of [[0, 40], [1, 80], [2, 12]]) {
    let max = 0; let sum = 0;
    g.frames[k].forEach((c, q) => { for (let j = 0; j < 3; j++) { const e = Math.abs(c[j] - px[k][q * 4 + j]); sum += e; if (e > max) max = e; } });
    assert.ok(sum / (w * h * 3) < worst / 3, `frame ${k} mean error ${sum / (w * h * 3)}`);
  }
  const one = decode(await encodeGif(1, 1, 1, async () => new Uint8ClampedArray([9, 9, 9, 255]), [5]));
  assert.equal(one.frames.length, 1);
});

test('no system-ui font in the service worker: it crashes Chrome 158', () => {
  const code = fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  assert.doesNotMatch(code, /\.font\s*=\s*['"`][^'"`]*system-ui/);
});
