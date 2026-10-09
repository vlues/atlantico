// Rasterize a composition for e-ink panels and encode it (PNG or raw packed bits).
// Everything is drawn as anti-aliased coverage first, then reduced to the panel's inks with a
// clean threshold — crisp lines and real serif type, no dither noise. No dependencies.
import { textGlyphs } from './type.js';

// Non-zero polygon coverage with 4×4 subsampling and an active-edge list.
// Calls emit(x, y, coverage) for every touched pixel inside a W×H frame.
function scan(contours, W, H, emit) {
  const edges = [];
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
  for (const c of contours) {
    for (let k = 0; k < c.length; k += 2) {
      const ax = c[k], ay = c[k + 1], bx = c[(k + 2) % c.length], by = c[(k + 3) % c.length];
      if (ay === by) continue;
      const e = ay < by ? { y0: ay, y1: by, x: ax, dx: (bx - ax) / (by - ay), dir: 1 } : { y0: by, y1: ay, x: bx, dx: (ax - bx) / (ay - by), dir: -1 };
      edges.push(e);
      minY = Math.min(minY, e.y0); maxY = Math.max(maxY, e.y1);
      minX = Math.min(minX, ax, bx); maxX = Math.max(maxX, ax, bx);
    }
  }
  if (!edges.length) return;
  edges.sort((a, b) => a.y0 - b.y0);
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(H - 1, Math.ceil(maxY));
  const rx0 = Math.max(0, Math.floor(minX)), rx1 = Math.min(W - 1, Math.ceil(maxX));
  if (rx1 < rx0) return;
  const row = new Float32Array(W);
  const active = [], xs = [];
  let next = 0;
  for (let py = y0; py <= y1; py++) {
    row.fill(0, rx0, rx1 + 1);
    let any = false;
    for (let s = 0; s < 4; s++) {
      const sy = py + (s + 0.5) / 4;
      while (next < edges.length && edges[next].y0 <= sy) active.push(edges[next++]);
      let n = 0;
      for (const e of active) if (e.y1 > sy) active[n++] = e;
      active.length = n;
      if (n < 2) continue;
      xs.length = 0;
      for (const e of active) xs.push([e.x + (sy - e.y0) * e.dx, e.dir]);
      xs.sort((a, b) => a[0] - b[0]);
      let wind = 0;
      for (let k = 0; k < xs.length - 1; k++) {
        wind += xs[k][1];
        if (!wind) continue;
        const a = Math.max(0, xs[k][0]), b = Math.min(W, xs[k + 1][0]);
        if (b <= a) continue;
        any = true;
        for (let sx = Math.floor(a * 4); sx < Math.ceil(b * 4); sx++) {
          const lo = Math.max(a, sx / 4), hi = Math.min(b, (sx + 1) / 4);
          if (hi > lo) row[sx >> 2] += (hi - lo) * 4 / 16;
        }
      }
    }
    if (any) for (let px = rx0; px <= rx1; px++) if (row[px] > 0) emit(px, py, Math.min(1, row[px]));
  }
}

// Rendered glyphs are kept per size and quarter-pixel offset: a warm Worker reuses them, so
// re-rendering the wall (every few minutes, the same captions) costs almost nothing for type.
const glyphCache = new WeakMap();
function glyphCoverage(g, k, fx, fy) {
  let m = glyphCache.get(g);
  if (!m) glyphCache.set(g, (m = new Map()));
  const id = `${k.toFixed(5)}|${fx}|${fy}`;
  let cov = m.get(id);
  if (!cov) {
    const contours = g.contours.map((c) => c.map((v, j) => (j % 2 ? fy / 4 + v * k : fx / 4 + v * k)));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of contours) for (let j = 0; j < c.length; j += 2) {
      x0 = Math.min(x0, c[j]); x1 = Math.max(x1, c[j]); y0 = Math.min(y0, c[j + 1]); y1 = Math.max(y1, c[j + 1]);
    }
    if (!contours.length || x0 === Infinity) cov = { bx: 0, by: 0, w: 0, h: 0, a: new Float32Array(0) };
    else {
      const bx = Math.floor(x0), by = Math.floor(y0), w = Math.ceil(x1) - bx + 1, h = Math.ceil(y1) - by + 1;
      const a = new Float32Array(w * h);
      scan(contours.map((c) => c.map((v, j) => (j % 2 ? v - by : v - bx))), w, h, (px, py, v) => { a[py * w + px] = v; });
      cov = { bx, by, w, h, a };
    }
    m.set(id, cov);
  }
  return cov;
}

// Spectra 6 / ACeP-style 6-colour panels. Index = value in the raw file (firmware maps to native codes).
export const SIX = [
  [0, 0, 0], [255, 255, 255], [230, 200, 0], [190, 30, 30], [30, 60, 160], [40, 120, 60],
];

/**
 * @returns {{w:number,h:number,px:Uint8Array,colors:number,cov?:Float32Array,tint?:Uint8Array}} px holds palette
 *   indices; with { coverage: true } the anti-aliased coverage and tint are returned too (for icons).
 */
export function rasterize(comp, colors = 2, opts = {}) {
  const w = comp.width, h = comp.height;
  const cov = new Float32Array(w * h); // ink coverage 0..1
  const tint = new Uint8Array(w * h);  // 0 ink, 1 sun accent, 2 accent for guests who are here
  const tintOf = (accent) => (accent === 'sun' ? 1 : accent === 'here' ? 2 : 0);
  const scale = Math.min(w, h) / 480;
  const baseW = Math.max(1.05, 0.95 * scale); // stroke width in px

  const put = (i, a, t) => { if (a > cov[i]) { cov[i] = a; tint[i] = t; } };

  // Anti-aliased thick segment by distance to the segment.
  const seg = (x0, y0, x1, y1, lw, alpha, t) => {
    const hw = lw / 2;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - hw - 1)), maxX = Math.min(w - 1, Math.ceil(Math.max(x0, x1) + hw + 1));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - hw - 1)), maxY = Math.min(h - 1, Math.ceil(Math.max(y0, y1) + hw + 1));
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1e-9;
    const reach2 = (hw + 0.5) * (hw + 0.5);
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const cx = px + 0.5, cy = py + 0.5;
        let u = ((cx - x0) * dx + (cy - y0) * dy) / L2;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const ex = cx - (x0 + u * dx), ey = cy - (y0 + u * dy), d2 = ex * ex + ey * ey;
        if (d2 >= reach2) continue;
        const a = Math.min(1, hw + 0.5 - Math.sqrt(d2));
        if (a > 0) put(py * w + px, a * alpha, t);
      }
    }
  };

  // Filled polygons (dots, the moon) straight into the frame.
  const fill = (contours, t) => scan(contours, w, h, (px, py, a) => put(py * w + px, a, t));

  for (const l of comp.lines) {
    const p = l.pts;
    if (l.dash) {
      // Dashes (and dots, when the dash is zero long) walked along the polyline.
      const [on, off] = l.dash, period = Math.max(1, on + off);
      const lw = baseW * (0.55 + 0.45 * l.alpha) * (l.weight ?? 1);
      const t = tintOf(l.accent);
      let at = 0;
      for (let k = 2; k < p.length; k += 2) {
        const x0 = p[k - 2], y0 = p[k - 1], len = Math.hypot(p[k] - x0, p[k + 1] - y0) || 1e-9;
        for (let d = (period - (at % period)) % period; d < len; d += period) {
          const a = d / len, b = Math.min(1, (d + on) / len);
          seg(x0 + (p[k] - x0) * a, y0 + (p[k + 1] - y0) * a, x0 + (p[k] - x0) * b, y0 + (p[k + 1] - y0) * b, lw, 1, t);
        }
        at += len;
      }
      continue;
    }
    if (l.dotted) {
      for (let k = 2; k < p.length; k += 2) {
        const len = Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]);
        for (let d = 0; d < len; d += 5 * scale) {
          const f = d / len, x = p[k - 2] + (p[k] - p[k - 2]) * f, y = p[k - 1] + (p[k + 1] - p[k - 1]) * f;
          seg(x, y, x, y, baseW * 0.9, 1, 0);
        }
      }
      continue;
    }
    // Distant (faint) lines get thinner rather than grey: they break up like an engraving.
    const lw = baseW * (0.55 + 0.45 * l.alpha) * (l.weight ?? 1);
    const t = tintOf(l.accent);
    for (let k = 2; k < p.length; k += 2) seg(p[k - 2], p[k - 1], p[k], p[k + 1], lw, 1, t);
  }
  for (const sh of comp.shapes ?? []) fill([sh.pts], tintOf(sh.accent));
  for (const c of comp.circles) {
    const t = tintOf(c.accent);
    if (c.fill) {
      const r = Math.max(1.2 * scale, c.r);
      const ring = [];
      for (let a = 0; a < 48; a++) ring.push(c.x + r * Math.cos((a / 48) * Math.PI * 2), c.y + r * Math.sin((a / 48) * Math.PI * 2));
      fill([ring], t);
    } else {
      for (let a = 0; a < 96; a++) {
        const a0 = (a / 96) * Math.PI * 2, a1 = ((a + 1) / 96) * Math.PI * 2;
        seg(c.x + c.r * Math.cos(a0), c.y + c.r * Math.sin(a0), c.x + c.r * Math.cos(a1), c.y + c.r * Math.sin(a1), baseW * 1.2, 1, t);
      }
    }
  }
  for (const t of comp.texts) {
    // Small sizes use the heavier cut so hairlines survive the 1-bit threshold.
    const key = t.italic ? 'italic' : t.size < 16 * scale ? 'caption' : 'regular';
    const tint = tintOf(t.accent);
    for (const gl of textGlyphs(t.text, t.x, t.y, t.size, t.align, key)) {
      let ix = Math.floor(gl.x), iy = Math.floor(gl.y);
      let fx = Math.round((gl.x - ix) * 4), fy = Math.round((gl.y - iy) * 4);
      if (fx === 4) { ix++; fx = 0; }
      if (fy === 4) { iy++; fy = 0; }
      const cov = glyphCoverage(gl.g, gl.k, fx, fy);
      for (let gy = 0; gy < cov.h; gy++) {
        const py = iy + cov.by + gy;
        if (py < 0 || py >= h) continue;
        for (let gx = 0; gx < cov.w; gx++) {
          const v = cov.a[gy * cov.w + gx], px = ix + cov.bx + gx;
          if (v > 0 && px >= 0 && px < w) put(py * w + px, v, tint);
        }
      }
    }
  }

  // Reduce to inks.
  const px = new Uint8Array(w * h);
  const six = colors === 6;
  const bg = six ? (comp.dark ? 0 : 1) : comp.dark ? 1 : 0;
  const ink = six ? (comp.dark ? 1 : 0) : comp.dark ? 0 : 1;
  const accent = six ? [ink, 3, comp.dark ? 2 : 4] : [ink, ink, ink];
  for (let i = 0; i < px.length; i++) px[i] = cov[i] >= 0.42 ? accent[tint[i]] : bg;
  return opts.coverage ? { w, h, px, colors, cov, tint } : { w, h, px, colors };
}

/** Raw bytes for the ESP32. Mono: 1 bit/px, MSB first, 1 = black. Six: 4 bits/px, high nibble first. */
export function packRaw(r) {
  if (r.colors === 6) {
    const out = new Uint8Array(Math.ceil((r.w * r.h) / 2));
    for (let i = 0; i < r.px.length; i++) out[i >> 1] |= i & 1 ? r.px[i] : r.px[i] << 4;
    return out;
  }
  const stride = Math.ceil(r.w / 8);
  const out = new Uint8Array(stride * r.h);
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) if (r.px[y * r.w + x]) out[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
  return out;
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
async function zlib(data) {
  const cs = new CompressionStream('deflate');
  const buf = await new Response(new Blob([data]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(buf);
}

/** Indexed PNG (1-bit greyscale for mono, 4-bit palette for six). */
export async function encodePNG(r) {
  const six = r.colors === 6;
  const bits = six ? 4 : 1;
  const stride = Math.ceil((r.w * bits) / 8);
  const rows = new Uint8Array((stride + 1) * r.h);
  for (let y = 0; y < r.h; y++) {
    const o = y * (stride + 1) + 1;
    for (let x = 0; x < r.w; x++) {
      const v = r.px[y * r.w + x];
      if (six) rows[o + (x >> 1)] |= x & 1 ? v : v << 4;
      else if (!v) rows[o + (x >> 3)] |= 0x80 >> (x & 7); // greyscale: 1 = white
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, r.w); dv.setUint32(4, r.h);
  ihdr[8] = bits; ihdr[9] = six ? 3 : 0;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr)];
  if (six) parts.push(chunk('PLTE', new Uint8Array(SIX.flat())));
  parts.push(chunk('IDAT', await zlib(rows)), chunk('IEND', new Uint8Array(0)));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}
