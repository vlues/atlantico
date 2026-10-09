// Home-screen icons, drawn by the wall piece itself: a quiet sea under a crescent moon.
// Run once: `node scripts/build-icons.mjs`. Output is committed (web/icons/).
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { compose, PALETTES } from '../web/lib/art.js';
import { rasterize } from '../web/lib/raster.js';

const out = new URL('../web/icons/', import.meta.url);
mkdirSync(out, { recursive: true });

const sea = { waveHeight: 0.6, wavePeriod: 9, waveDirection: 255, windSpeed: 10, windDirection: 260, tide: 0,
  sun: { altitude: -20, azimuth: 300 }, moon: { altitude: 32, azimuth: 262, fraction: 0.3, phase: 0.18 } };
const ed = { n: 1, style: 'horizonte', palette: PALETTES[0], seed: 11, horizon: 0.56, margin: 0.14, density: 1, grain: 0.4, label: '' };
const pal = PALETTES[0].dark;
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = ~0; for (const v of b) c = CRC[(c ^ v) & 255] ^ (c >>> 8); return ~c >>> 0; };
function chunk(type, data) {
  const b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8);
  b.writeUInt32BE(crc(b.subarray(4, 8 + data.length)), 8 + data.length);
  return b;
}

for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]) {
  const comp = compose(sea, { width: size, height: size, dark: true, captions: false, edition: ed, print: true });
  const r = rasterize(comp, 2, { coverage: true });
  const bg = rgb(pal.bg), fg = rgb(pal.fg), gold = rgb(pal.here);
  const rows = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x, a = Math.min(1, r.cov[i] * 1.15), ink = r.tint[i] ? gold : fg;
      for (let k = 0; k < 3; k++) rows[y * (size * 3 + 1) + 1 + x * 3 + k] = Math.round(bg[k] + (ink[k] - bg[k]) * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(new URL(name, out), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
  console.log(name, size);
}
