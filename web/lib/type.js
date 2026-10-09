// Real typography for bitmaps: Cormorant Garamond outlines → flattened polygons.
import { FONTS } from './font-data.js';

const cache = new Map();

function glyphContours(font, key, ch) {
  const id = key + ch;
  if (cache.has(id)) return cache.get(id);
  const g = font.glyphs[ch] ?? font.glyphs['?'];
  const tok = g[1] ? g[1].split(' ') : [];
  const contours = [];
  let cur = null, x = 0, y = 0;
  for (let i = 0; i < tok.length;) {
    const c = tok[i++];
    const n = () => Number(tok[i++]);
    if (c === 'M') { x = n(); y = n(); cur = [x, y]; contours.push(cur); }
    else if (c === 'L') { x = n(); y = n(); cur.push(x, y); }
    else if (c === 'Q') {
      const cx = n(), cy = n(), ex = n(), ey = n();
      for (let k = 1; k <= 6; k++) {
        const t = k / 6, u = 1 - t;
        cur.push(u * u * x + 2 * u * t * cx + t * t * ex, u * u * y + 2 * u * t * cy + t * t * ey);
      }
      x = ex; y = ey;
    } else if (c === 'C') {
      const c1x = n(), c1y = n(), c2x = n(), c2y = n(), ex = n(), ey = n();
      for (let k = 1; k <= 8; k++) {
        const t = k / 8, u = 1 - t;
        cur.push(u * u * u * x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
          u * u * u * y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey);
      }
      x = ex; y = ey;
    }
  }
  const out = { adv: g[0], contours };
  cache.set(id, out);
  return out;
}

function layout(text, key) {
  const font = FONTS[key];
  const chars = [...text.replace(/′/g, '’').replace(/″/g, '”').replace(/−/g, '–')];
  let x = 0;
  const placed = [];
  chars.forEach((ch, i) => {
    const g = glyphContours(font, key, ch);
    placed.push({ g, x });
    x += g.adv + (font.kern[ch + chars[i + 1]] ?? 0);
  });
  return { font, placed, width: x };
}

/** Per-glyph polygon lists for `text`, cap height `cap` px, baseline at y. */
export function textContours(text, x, y, cap, align = 'left', key = 'regular', tracking = 0.04) {
  const { font, placed, width } = layout(text, key);
  const k = cap / font.capHeight;
  const track = tracking * font.upm;
  const w = (width + track * Math.max(0, placed.length - 1)) * k;
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  // One entry per glyph (each a list of contours), so callers can fill glyph by glyph.
  return placed.map(({ g, x: gx }, i) => {
    const ox = x0 + (gx + track * i) * k;
    return g.contours.map((c) => c.map((v, j) => (j % 2 ? y + v * k : ox + v * k)));
  });
}

/** Glyph placements (glyph outlines in font units, origin in px, scale), for renderers that cache glyphs. */
export function textGlyphs(text, x, y, cap, align = 'left', key = 'regular', tracking = 0.04) {
  const { font, placed, width } = layout(text, key);
  const k = cap / font.capHeight;
  const track = tracking * font.upm;
  const w = (width + track * Math.max(0, placed.length - 1)) * k;
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  return placed.map(({ g, x: gx }, i) => ({ g, x: x0 + (gx + track * i) * k, y, k }));
}
