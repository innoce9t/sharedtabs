// Small GIF89a encoder: one shared palette (median cut) and LZW. Frames are fetched twice, so only one
// decoded frame is in memory at a time.

function medianCut(hist, max) {
  const colors = [];
  for (let c = 0; c < 32768; c++) if (hist[c]) colors.push(c);
  if (!colors.length) colors.push(0);
  const ch = (c, i) => (c >> (10 - 5 * i)) & 31;
  const box = (list) => {
    let best = { axis: 0, range: -1 };
    for (let i = 0; i < 3; i++) {
      let lo = 31; let hi = 0;
      for (const c of list) { const v = ch(c, i); if (v < lo) lo = v; if (v > hi) hi = v; }
      if (hi - lo > best.range) best = { axis: i, range: hi - lo };
    }
    let count = 0;
    for (const c of list) count += hist[c];
    return { list, ...best, weight: best.range * Math.sqrt(count) };
  };
  const boxes = [box(colors)];
  while (boxes.length < max) {
    let k = -1;
    for (let i = 0; i < boxes.length; i++) if (boxes[i].range > 0 && (k < 0 || boxes[i].weight > boxes[k].weight)) k = i;
    if (k < 0) break;
    const { list, axis } = boxes[k];
    list.sort((a, b) => ch(a, axis) - ch(b, axis));
    let total = 0;
    for (const c of list) total += hist[c];
    let cut = 1; let sum = hist[list[0]];
    while (cut < list.length - 1 && sum + hist[list[cut]] / 2 < total / 2) sum += hist[list[cut++]];
    boxes.splice(k, 1, box(list.slice(0, cut)), box(list.slice(cut)));
  }
  const palette = new Uint8Array(768);
  const lookup = new Int16Array(32768).fill(-1);
  boxes.forEach((b, i) => {
    const sum = [0, 0, 0]; let count = 0;
    for (const c of b.list) {
      lookup[c] = i;
      count += hist[c];
      for (let j = 0; j < 3; j++) sum[j] += ch(c, j) * hist[c];
    }
    for (let j = 0; j < 3; j++) palette[i * 3 + j] = count ? Math.round((sum[j] / count) * 255 / 31) : 0;
  });
  return { palette, lookup, size: boxes.length };
}

class Bytes {
  #parts = [];
  #buf = new Uint8Array(65536);
  #n = 0;
  put(...bytes) { for (const b of bytes) { if (this.#n === 65536) this.#flush(); this.#buf[this.#n++] = b; } }
  short(v) { this.put(v & 255, v >> 8); }
  text(s) { for (let i = 0; i < s.length; i++) this.put(s.charCodeAt(i)); }
  #flush() { this.#parts.push(this.#buf.slice(0, this.#n)); this.#n = 0; }
  done() {
    this.#flush();
    const out = new Uint8Array(this.#parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of this.#parts) { out.set(p, at); at += p.length; }
    return out;
  }
}

function lzw(out, pixels) {
  out.put(8);
  const CLEAR = 256; const END = 257;
  const block = new Uint8Array(255);
  let n = 0; let acc = 0; let bits = 0; let size = 9; let next = 258;
  let dict = new Map();
  const byte = (b) => {
    block[n++] = b;
    if (n === 255) { out.put(255, ...block); n = 0; }
  };
  const emit = (code) => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) { byte(acc & 255); acc >>>= 8; bits -= 8; }
  };
  emit(CLEAR);
  let prefix = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const p = pixels[i];
    const key = (prefix << 8) | p;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next === 4096) {
      emit(CLEAR);
      dict = new Map();
      next = 258;
      size = 9;
    } else {
      if (next === 1 << size) size++;
      dict.set(key, next++);
    }
    prefix = p;
  }
  emit(prefix);
  emit(END);
  if (bits > 0) byte(acc & 255);
  if (n) out.put(n, ...block.subarray(0, n));
  out.put(0);
}

/** getFrame(i) resolves to RGBA bytes of width * height. delays are in hundredths of a second. */
export async function encodeGif(width, height, count, getFrame, delays) {
  const hist = new Uint32Array(32768);
  for (let i = 0; i < count; i++) {
    const d = await getFrame(i);
    for (let p = 0; p < d.length; p += 12) hist[((d[p] >> 3) << 10) | ((d[p + 1] >> 3) << 5) | (d[p + 2] >> 3)]++;
  }
  const { palette, lookup, size } = medianCut(hist, 256);
  const nearest = (c) => {
    const r = ((c >> 10) & 31) * 255 / 31; const g = ((c >> 5) & 31) * 255 / 31; const b = (c & 31) * 255 / 31;
    let best = 0; let dist = Infinity;
    for (let i = 0; i < size; i++) {
      const e = (palette[i * 3] - r) ** 2 + (palette[i * 3 + 1] - g) ** 2 + (palette[i * 3 + 2] - b) ** 2;
      if (e < dist) { dist = e; best = i; }
    }
    lookup[c] = best;
    return best;
  };

  const out = new Bytes();
  out.text('GIF89a');
  out.short(width);
  out.short(height);
  out.put(0xf7, 0, 0, ...palette);
  out.put(0x21, 0xff, 11);
  out.text('NETSCAPE2.0');
  out.put(3, 1, 0, 0, 0);
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < count; i++) {
    const d = await getFrame(i);
    for (let p = 0, q = 0; q < pixels.length; p += 4, q++) {
      const c = ((d[p] >> 3) << 10) | ((d[p + 1] >> 3) << 5) | (d[p + 2] >> 3);
      const k = lookup[c];
      pixels[q] = k < 0 ? nearest(c) : k;
    }
    out.put(0x21, 0xf9, 4, 4);
    out.short(delays[i]);
    out.put(0, 0, 0x2c, 0, 0, 0, 0);
    out.short(width);
    out.short(height);
    out.put(0);
    lzw(out, pixels);
  }
  out.put(0x3b);
  return out.done();
}
