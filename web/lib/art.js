// Atlántico — the generative wall piece.
// Pure geometry: conditions in, polylines/circles/texts out. No DOM, no I/O.
// Rendered by canvas (web), SVG (Worker live view) and the bitmap rasterizer (e-ink).

export const HOME = { lat: 36.5986, lon: -6.2797, coastFacing: 245 };

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function hash(i, j, seed) {
  let h = Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * 2 - 1;
}

export function hashString(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

function dms(v, pos, neg) {
  const a = Math.abs(v);
  const d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.round(((a - d) * 60 - m) * 60);
  return `${d}°${String(m).padStart(2, '0')}′${String(s).padStart(2, '0')}″${v >= 0 ? pos : neg}`;
}

/** Wind name as locals say it in the Bay of Cádiz. */
export function windName(speed, dir) {
  if (speed < 8) return 'calma';
  if (dir >= 45 && dir <= 135) return 'levante';
  if (dir >= 225 && dir <= 315) return 'poniente';
  return null;
}

/**
 * @param {object} c conditions: waveHeight m, wavePeriod s, waveDirection °, windSpeed km/h,
 *   windDirection ° (from), tide m (sea level vs mean), sun {altitude, azimuth}
 * @param {object} o width, height, dark, time (s, for drift), visitors [{id}], welcome {name}, seed
 */
export function compose(c, o = {}) {
  const W = o.width ?? 1600, H = o.height ?? 1000;
  const S = Math.min(W, H);
  const t = o.time ?? 0;
  const seed = o.seed ?? 7;
  const dark = !!o.dark;
  const lat = o.lat ?? HOME.lat, lon = o.lon ?? HOME.lon;

  const mx = Math.round(W * 0.085);
  const fw = W - 2 * mx;
  const tide = clamp(c.tide ?? 0, -2, 2);
  const horizon = H * 0.36 - tide * H * 0.03;
  const bottom = H * 0.84;
  const fh = bottom - horizon;
  // Bitmaps (o.print) get fewer, airier lines: they must read at arm's length on paper-like ink.
  const N = o.lineCount ?? clamp(Math.round(fh / (o.print ? Math.max(6, S * 0.0135) : Math.max(4.2, S * 0.0105))), 22, 90);
  const step = o.print ? Math.max(3, W / 260) : Math.max(1.5, W / 420);

  // Swell: height drives band contrast, period drives band length, direction tilts the bands.
  const hN = 1 - Math.exp(-(c.waveHeight ?? 0.3) / 1.1);
  const T = clamp(c.wavePeriod ?? 6, 2, 20);
  const lambda = clamp(0.1 + (T - 3) * 0.032, 0.09, 0.55); // as a fraction of the field
  let rel = ((((c.waveDirection ?? 270) - HOME.coastFacing) % 360) + 540) % 360 - 180;
  if (Math.abs(rel) > 90) rel = Math.sign(rel) * (180 - Math.abs(rel));
  const r = clamp(rel, -65, 65) * (Math.PI / 180);
  const swellAmp = (0.08 + 0.62 * hN) * ((lambda * (N - 1)) / TAU) * 0.9;
  const drift = t / (T * 9);

  // Long undulation along each line.
  const k2 = clamp(9 / T, 0.7, 2.6);
  const underAmp = 0.12 + 1.8 * Math.pow(hN, 1.3);

  // Wind: the downwind side lifts like a filled sail; chop roughens the line.
  const ws = c.windSpeed ?? 5;
  const to = (((c.windDirection ?? 270) + 180) * Math.PI) / 180;
  const ex = Math.sin(to), ny = Math.cos(to);
  const wN = Math.pow(clamp(ws / 45, 0, 1.5), 1.35);
  const bend = wN * 7;
  const chop = clamp(wN * 0.24, 0, 0.26);
  const bowC = 0.5 - 0.3 * ex;

  // Sun, placed as seen from the beach looking out to sea.
  const sun = c.sun ?? { altitude: -10, azimuth: 0 };
  let sunMark = null;
  if (sun.altitude > -0.5) {
    const sx = mx + fw * clamp(0.5 + (sun.azimuth - HOME.coastFacing) / 120, 0.05, 0.95);
    const sy = horizon - (clamp(sun.altitude, 0, 55) / 55) * (horizon - H * 0.12);
    sunMark = { x: sx, y: sy, r: S * 0.02, alt: sun.altitude };
  }

  const persp = (z) => (z >= 0 ? 0.5 * z + 0.5 * Math.pow(z, 1.5) : 0.5 * z);
  const lines = [];
  for (let i = 0; i < N; i++) {
    const s = i / (N - 1);
    const env = 0.35 + 0.65 * s;
    let cur = [];
    const flush = () => { if (cur.length >= 4) lines.push({ pts: cur, alpha: 0.45 + 0.55 * Math.min(1, s * 3) }); cur = []; };
    for (let x = mx; x <= W - mx + 0.01; x += step) {
      const u = (x - mx) / fw;
      let d = swellAmp * env * Math.sin(TAU * ((s * Math.cos(r) + u * Math.sin(r) * (fw / fh)) / lambda - drift));
      d += underAmp * env * Math.sin(TAU * (u * k2 + s * 0.45 - drift * 0.6) + noise(u * 2, s * 2, seed) * 1.2);
      const bu = 2 * (u - bowC);
      d -= bend * Math.abs(ex) * (0.6 - Math.min(1, bu * bu)) * (0.55 + 0.45 * s);
      d += bend * ny * (u - 0.5) * 0.9;
      d += chop * noise(u * 46 + t * 0.03, i * 0.35, seed + 3);
      const y = Math.min(H * 0.89, horizon + fh * persp(s + d / (N - 1)));

      if (sunMark && sunMark.alt < 38) {
        const half = sunMark.r * (0.8 + 3.2 * s);
        const dd = Math.abs(x - sunMark.x) / half;
        if (dd < 1) {
          const p = Math.pow(1 - dd, 0.7) * (1 - sunMark.alt / 38) * 0.9;
          if (hash(i, Math.floor(x / (step * 2.5)), seed + Math.floor(t / 5)) < p) { flush(); continue; }
        }
      }
      cur.push(x, y);
    }
    flush();
  }

  const circles = [];
  if (sunMark && sunMark.y > H * 0.08) {
    circles.push({ x: sunMark.x, y: sunMark.y, r: sunMark.r, fill: dark, alpha: 0.9, accent: 'sun' });
  }

  // Visitors: one faint dot each, placed deterministically in the sky; nearest neighbours joined.
  const dots = [];
  const sky = { x0: mx, x1: W - mx, y0: H * 0.1, y1: horizon - S * 0.05 };
  for (const v of o.visitors ?? []) {
    const h = hashString(String(v.id));
    const px = sky.x0 + (sky.x1 - sky.x0) * hash(h, 1, 11);
    const py = sky.y0 + (sky.y1 - sky.y0) * Math.pow(hash(h, 2, 13), 0.8);
    if (sunMark && Math.hypot(px - sunMark.x, py - sunMark.y) < sunMark.r * 2.5) continue;
    dots.push({ x: px, y: py });
  }
  const links = [];
  for (const a of dots) {
    let best = null, bd = S * 0.11;
    for (const b of dots) {
      const dd = Math.hypot(a.x - b.x, a.y - b.y);
      if (b !== a && dd < bd) { bd = dd; best = b; }
    }
    if (best && !o.welcome && !o.print) links.push({ pts: [a.x, a.y, best.x, best.y], alpha: 0.18, dotted: true });
  }
  const dotAlpha = o.welcome ? 0.35 : 0.75;
  for (const d of dots) circles.push({ x: d.x, y: d.y, r: Math.max(1, S * 0.0022), fill: true, alpha: dotAlpha, accent: 'visitor' });

  // Typography.
  const cap = o.print ? Math.max(9.5, S * 0.019) : Math.max(9, S * 0.017);
  const texts = [];
  texts.push({ text: 'Atlántico', x: mx, y: H * 0.075, size: cap * 1.25, align: 'left', italic: false, alpha: 0.9 });
  const wName = windName(ws, c.windDirection ?? 0);
  texts.push({
    text: `${dms(lat, 'N', 'S')}  ${dms(lon, 'E', 'W')}`,
    x: mx, y: H - H * 0.06 - (W < H * 1.3 ? cap * 2.2 : 0), size: cap, align: 'left', alpha: 0.7,
  });
  texts.push({
    text: `swell ${(c.waveHeight ?? 0).toFixed(1)} m · ${Math.round(T)} s · ${compass(c.waveDirection ?? 0)}` +
      `    wind ${Math.round(ws)} km/h ${compass(c.windDirection ?? 0)}${wName && wName !== 'calma' ? ` (${wName})` : ''}`,
    x: W < H * 1.3 ? mx : W - mx, y: H - H * 0.06, size: cap, align: W < H * 1.3 ? 'left' : 'right', alpha: 0.7,
  });
  if (o.welcome?.name) {
    const big = Math.max(18, S * 0.07);
    const cy = (H * 0.1 + horizon) / 2;
    texts.push({ text: o.welcome.greeting ?? 'Bienvenido', x: W / 2, y: cy - big * 0.85, size: big * 0.42, align: 'center', italic: true, alpha: 0.85 });
    texts.push({ text: o.welcome.name, x: W / 2, y: cy + big * 0.55, size: big, align: 'center', alpha: 1 });
  }

  return { width: W, height: H, dark, lines: [...links, ...lines], circles, texts, horizon };
}

export const PALETTE = {
  light: { bg: '#f2f0eb', fg: '#141414', sun: '#141414', visitor: '#141414' },
  dark: { bg: '#0a0a0b', fg: '#e9e6df', sun: '#e9e6df', visitor: '#e9e6df' },
};

const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

/** SVG string — used by the Worker's live view. */
export function toSVG(comp) {
  const p = comp.dark ? PALETTE.dark : PALETTE.light;
  const sw = Math.max(0.6, Math.min(comp.width, comp.height) / 1000);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${comp.width} ${comp.height}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`,
    `<rect width="100%" height="100%" fill="${p.bg}"/>`, `<g fill="none" stroke="${p.fg}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">`];
  for (const l of comp.lines) {
    let d = `M${l.pts[0].toFixed(1)} ${l.pts[1].toFixed(1)}`;
    for (let k = 2; k < l.pts.length; k += 2) d += `L${l.pts[k].toFixed(1)} ${l.pts[k + 1].toFixed(1)}`;
    out.push(`<path d="${d}" opacity="${l.alpha.toFixed(2)}"${l.dotted ? ` stroke-dasharray="1 ${sw * 4}"` : ''}/>`);
  }
  out.push('</g>');
  for (const c of comp.circles) {
    out.push(`<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${c.r.toFixed(1)}" opacity="${c.alpha}" ${c.fill ? `fill="${p.fg}"` : `fill="none" stroke="${p.fg}" stroke-width="${sw}"`}/>`);
  }
  for (const t of comp.texts) {
    out.push(`<text x="${t.x.toFixed(1)}" y="${t.y.toFixed(1)}" font-size="${(t.size * 1.5).toFixed(1)}" text-anchor="${{ left: 'start', center: 'middle', right: 'end' }[t.align]}" fill="${p.fg}" opacity="${t.alpha}" font-family="'Cormorant Garamond', Georgia, serif"${t.italic ? ' font-style="italic"' : ''} letter-spacing="0.04em">${esc(t.text)}</text>`);
  }
  out.push('</svg>');
  return out.join('');
}
