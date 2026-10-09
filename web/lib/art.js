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

// ── Editions ─────────────────────────────────────────────────────────────────
// Every day is a new numbered edition: its own drawing style, palette, horizon and grain, so the
// same sea never looks the same twice. Consecutive days never share a style or a palette.

export const STYLES = ['lineas', 'puntos', 'bandas', 'horizonte', 'trazo'];
export const STYLE_NAMES = { lineas: 'Líneas', puntos: 'Puntos', bandas: 'Bandas', horizonte: 'Horizonte', trazo: 'Trazo' };

// Screen palettes (e-ink always uses its own inks). Each has a paper and a night version.
export const PALETTES = [
  { name: 'Cal', light: { bg: '#f2f0eb', fg: '#141414', here: '#8a6524' }, dark: { bg: '#0a0a0b', fg: '#e9e6df', here: '#e2bf7e' } },
  { name: 'Arena', light: { bg: '#efe6d8', fg: '#2a221c', here: '#9b5a26' }, dark: { bg: '#13100d', fg: '#ecdfcb', here: '#e9b679' } },
  { name: 'Bruma', light: { bg: '#e7ebea', fg: '#1b282c', here: '#7b5a1c' }, dark: { bg: '#0a1114', fg: '#d9e3e3', here: '#e0c690' } },
  { name: 'Salina', light: { bg: '#f3ede8', fg: '#3a2b28', here: '#9a4430' }, dark: { bg: '#110c0c', fg: '#eee2dc', here: '#e69d7f' } },
  { name: 'Pizarra', light: { bg: '#e8e8e4', fg: '#22252a', here: '#6f5a26' }, dark: { bg: '#0d0f12', fg: '#e3e5e9', here: '#d9c28b' } },
  { name: 'Índigo', light: { bg: '#edeff4', fg: '#1b2240', here: '#8a6a2a' }, dark: { bg: '#090c19', fg: '#e0e4f2', here: '#ebc57e' } },
];

const EPOCH = Date.UTC(2026, 9, 8); // edition Nº 1
const DAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const TZ = 'Europe/Madrid';
let dayFmt = null, clockFmt = null;

/** The calendar day in Cádiz for a moment in time. */
export function localDay(ms) {
  dayFmt ??= new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const [y, m, d] = dayFmt.format(new Date(ms)).split('-').map(Number);
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** 24-hour clock time in Cádiz. */
export function clock(ms) {
  clockFmt ??= new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return clockFmt.format(new Date(ms));
}

function shuffled(list, seed) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(hash(i, seed, 97) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Each cycle uses every item once in a fresh order; the seam between cycles never repeats.
function rotation(list, day, salt) {
  const n = list.length, c = Math.floor(day / n), k = ((day % n) + n) % n;
  const order = shuffled(list, c * 31 + salt), prev = shuffled(list, (c - 1) * 31 + salt);
  if (order[0] === prev[n - 1]) [order[0], order[1]] = [order[1], order[0]];
  return order[k];
}

/** The edition for a moment in time (or with its style forced, for previews). */
export function edition(ms = Date.now(), style = null) {
  const { y, m, d, dow } = localDay(ms);
  const day = Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 86400000);
  const st = STYLES.includes(style) ? style : rotation(STYLES, day, 1);
  const h = (k) => hash(day, k, 2026);
  return {
    n: day + 1, day, style: st, palette: rotation(PALETTES, day, 2),
    seed: 7 + day * 13,
    horizon: st === 'horizonte' ? 0.5 + 0.04 * h(1) : 0.32 + 0.07 * h(1),
    margin: 0.07 + 0.03 * h(2),
    density: 0.85 + 0.3 * h(3),
    grain: h(4),
    label: `Nº ${day + 1} · ${STYLE_NAMES[st]} · ${DAYS_ES[dow]} ${d} de ${MONTHS_ES[m - 1]}`,
  };
}

/** The lit part of the moon as a polygon: limb on the sunward side, terminator back. */
function moonShape(x, y, r, phase) {
  const side = phase < 0.5 ? 1 : -1;
  const tx = Math.cos(phase * TAU);
  const pts = [];
  for (let k = 0; k <= 24; k++) { const a = -Math.PI / 2 + (Math.PI * k) / 24; pts.push(x + side * r * Math.cos(a), y + r * Math.sin(a)); }
  for (let k = 24; k >= 0; k--) { const a = -Math.PI / 2 + (Math.PI * k) / 24; pts.push(x + side * r * tx * Math.cos(a), y + r * Math.sin(a)); }
  return pts;
}

/** Sea temperature, the tide and the moon, as a caption. */
export function liveLine(c) {
  const parts = [];
  if (c.seaTemp != null) parts.push(`sea ${Math.round(c.seaTemp)} °C`);
  if (c.nextTide) parts.push(`tide ${c.tideTrend ? `${c.tideTrend}, ` : ''}${c.nextTide.type} at ${clock(Date.parse(c.nextTide.at))}`);
  if (c.moon && c.moon.fraction > 0.02) parts.push(`moon ${Math.round(c.moon.fraction * 100)} % ${c.moon.waxing ? 'waxing' : 'waning'}`);
  return parts.join(' · ');
}

/**
 * @param {object} c conditions: waveHeight m, wavePeriod s, waveDirection °, windSpeed km/h,
 *   windDirection ° (from), tide m (sea level vs mean), sun {altitude, azimuth}, moon (moonPosition),
 *   seaTemp °C, tideTrend, nextTide, cloudCover %, precipitation mm
 * @param {object} o width, height, dark, time (s, for drift), print (bitmap), captions (default true),
 *   date (ms; picks the edition) or edition, style (force one), seed,
 *   visitors [{id, visits, here, name}], hero (id of the star being welcomed), reveal (0..1, its entrance),
 *   welcome {name, greeting, visits, since}
 */
export function compose(c, o = {}) {
  const W = o.width ?? 1600, H = o.height ?? 1000;
  const S = Math.min(W, H);
  const t = o.time ?? 0;
  const ed = o.edition ?? edition(o.date ?? Date.now(), o.style);
  const style = ed.style;
  const seed = o.seed ?? ed.seed;
  const dark = !!o.dark;
  const pal = dark ? ed.palette.dark : ed.palette.light;
  const lat = o.lat ?? HOME.lat, lon = o.lon ?? HOME.lon;

  const mx = Math.round(W * ed.margin);
  const fw = W - 2 * mx;
  const tide = clamp(c.tide ?? 0, -2, 2);
  const horizon = H * ed.horizon - tide * H * 0.03;
  const bottom = H * 0.84;
  const fh = bottom - horizon;
  // Bitmaps (o.print) get fewer, airier lines: they must read at arm's length on paper-like ink.
  const spacing = o.print ? Math.max(6, S * 0.0135) : Math.max(4.2, S * 0.0105);
  let N = o.lineCount ?? clamp(Math.round((fh / spacing) * ed.density), 22, 90);
  if (style === 'horizonte' && o.lineCount == null) N = clamp(Math.round(N * 0.4), 10, 30);
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

  // Long undulation along each line; each edition has its own grain.
  const k2 = clamp(9 / T, 0.7, 2.6);
  const underAmp = 0.12 + 1.8 * Math.pow(hN, 1.3);
  const grain = 1.5 + 2 * ed.grain;

  // Wind: the downwind side lifts like a filled sail; chop roughens the line.
  const ws = c.windSpeed ?? 5;
  const to = (((c.windDirection ?? 270) + 180) * Math.PI) / 180;
  const ex = Math.sin(to), ny = Math.cos(to);
  const wN = Math.pow(clamp(ws / 45, 0, 1.5), 1.35);
  const bend = wN * 7;
  const chop = clamp(wN * 0.24, 0, 0.26);
  const bowC = 0.5 - 0.3 * ex;
  const big = style === 'horizonte' ? 1.7 : 1;

  // Sun and moon, placed as seen from the beach looking out to sea.
  const place = (body) => ({
    x: mx + fw * clamp(0.5 + (body.azimuth - HOME.coastFacing) / 120, 0.05, 0.95),
    y: horizon - (clamp(body.altitude, 0, 55) / 55) * (horizon - H * 0.13),
  });
  const sun = c.sun ?? { altitude: -10, azimuth: 0 };
  let sunMark = null;
  if (sun.altitude > -0.5) sunMark = { ...place(sun), r: S * 0.02 * big, alt: sun.altitude };
  let moonMark = null;
  if (c.moon && c.moon.altitude > 0 && sun.altitude < 3 && c.moon.fraction > 0.02) {
    moonMark = { ...place(c.moon), r: S * 0.019 * big, phase: c.moon.phase, fraction: c.moon.fraction };
  }

  const persp = (z) => (z >= 0 ? 0.5 * z + 0.5 * Math.pow(z, 1.5) : 0.5 * z);
  const rows = []; // the sea, one polyline per line (split where the sun glitters)
  for (let i = 0; i < N; i++) {
    const s = i / (N - 1);
    const env = 0.35 + 0.65 * s;
    let cur = [], ph = [];
    const flush = () => { if (cur.length >= 4) rows.push({ pts: cur, ph, alpha: 0.45 + 0.55 * Math.min(1, s * 3), row: s }); cur = []; ph = []; };
    for (let x = mx; x <= W - mx + 0.01; x += step) {
      const u = (x - mx) / fw;
      const swell = Math.sin(TAU * ((s * Math.cos(r) + u * Math.sin(r) * (fw / fh)) / lambda - drift));
      let d = swellAmp * env * swell;
      d += underAmp * env * Math.sin(TAU * (u * k2 + s * 0.45 - drift * 0.6) + noise(u * grain, s * 2, seed) * 1.2);
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
      ph.push(swell);
    }
    flush();
  }

  // The day's style: the same sea, drawn another way.
  const lines = [];
  for (const l of rows) {
    const base = { alpha: l.alpha, row: l.row };
    if (style === 'puntos') {
      // Stipple: round dots, larger and further apart toward the viewer.
      lines.push({ ...base, pts: l.pts, weight: 1.3 + 1.8 * l.row, dash: [0, S * (0.0055 + 0.011 * l.row)] });
    } else if (style === 'bandas') {
      // The swell as bands of light: lines break on the backs of the waves; bigger sea, wider gaps.
      const thr = -0.65 + 0.7 * hN;
      let seg = [];
      for (let q = 0; q < l.ph.length; q++) {
        if (l.ph[q] > thr) seg.push(l.pts[2 * q], l.pts[2 * q + 1]);
        else { if (seg.length >= 4) lines.push({ ...base, pts: seg, weight: 1.2 }); seg = []; }
      }
      if (seg.length >= 4) lines.push({ ...base, pts: seg, weight: 1.2 });
    } else if (style === 'trazo') {
      // Calligraphic: the stroke swells on the faces of the waves.
      for (let q = 0; q + 1 < l.ph.length; q += 4) {
        const end = Math.min(l.ph.length - 1, q + 4);
        const slope = Math.abs(l.pts[2 * end + 1] - l.pts[2 * q + 1]) / Math.max(1, l.pts[2 * end] - l.pts[2 * q]);
        const w = 0.45 + 0.8 * l.row + 1.3 * Math.max(0, l.ph[q]) + 5 * slope;
        lines.push({ ...base, pts: l.pts.slice(2 * q, 2 * end + 2), weight: Math.round(clamp(w, 0.45, 3.4) * 4) / 4 });
      }
    } else if (style === 'horizonte') {
      lines.push({ ...base, pts: l.pts, weight: 1.6 + 0.6 * l.row });
    } else {
      lines.push({ ...base, pts: l.pts });
    }
  }

  // Weather in the sky, live: clouds as stacked strokes drifting with the wind, rain slanting with it.
  const sky = { x0: mx, x1: W - mx, y0: H * 0.1, y1: horizon - S * 0.05 };
  const weather = [];
  const nClouds = Math.round(clamp((c.cloudCover ?? 0) / 100, 0, 1) * 7);
  for (let k = 0; k < nClouds; k++) {
    const L = S * (0.1 + 0.16 * hash(k, 1, seed + 5));
    const span = fw + L;
    const moved = o.print ? 0 : t * (2 + ws * 0.15) * (ex >= 0 ? 1 : -1);
    const cx = mx - L / 2 + ((((hash(k, 2, seed + 5) * span + moved) % span) + span) % span);
    const cy = sky.y0 + (sky.y1 - S * 0.02 - sky.y0) * Math.pow(hash(k, 3, seed + 5), 0.6);
    for (let j = 0; j < 3; j++) {
      const len = L * [1, 0.7, 0.42][j], x0 = Math.max(mx, cx - len / 2 + L * 0.08 * j), x1 = Math.min(W - mx, cx + len / 2 + L * 0.08 * j);
      if (x1 - x0 > S * 0.01) weather.push({ pts: [x0, cy + j * S * 0.008, x1, cy + j * S * 0.008], alpha: 0.42 - 0.1 * j, weight: 0.9 });
    }
  }
  const rain = c.precipitation ?? 0;
  if (rain > 0.05) {
    const n = Math.round(clamp(rain / 2, 0.15, 1) * (o.print ? 50 : 130));
    const len = S * 0.022, slant = clamp(ex * (0.15 + wN), -0.7, 0.7), range = horizon - H * 0.08;
    for (let k = 0; k < n; k++) {
      const x = mx + hash(k, 7, seed) * fw;
      const y = H * 0.08 + ((hash(k, 8, seed) * range + (o.print ? 0 : t * S * 0.3)) % range);
      weather.push({ pts: [x, y, x + slant * len, y + len], alpha: 0.4, weight: 0.75 });
    }
  }

  const circles = [];
  const shapes = [];
  if (sunMark && sunMark.y > H * 0.08) {
    circles.push({ x: sunMark.x, y: sunMark.y, r: sunMark.r, fill: dark, alpha: 0.9, accent: 'sun' });
  }
  if (moonMark) {
    circles.push({ x: moonMark.x, y: moonMark.y, r: moonMark.r, fill: false, alpha: 0.3, accent: 'moon' });
    shapes.push({ pts: moonShape(moonMark.x, moonMark.y, moonMark.r, moonMark.phase), alpha: 0.95, accent: 'moon' });
  }

  // Visitors: one star each, placed deterministically in the sky by id. Regulars burn a little
  // brighter; guests who are here right now sparkle and carry their name.
  const reveal = clamp(o.reveal ?? 1, 0, 1);
  const grow = 1 - Math.pow(1 - reveal, 3);
  const stars = [];
  let heroAt = null; // where the welcomed star is, even before it has appeared (screens animate toward it)
  for (const v of o.visitors ?? []) {
    const h = hashString(String(v.id));
    const px = sky.x0 + (sky.x1 - sky.x0) * hash(h, 1, 11);
    const py = sky.y0 + (sky.y1 - sky.y0) * Math.pow(hash(h, 2, 13), 0.8);
    if (sunMark && Math.hypot(px - sunMark.x, py - sunMark.y) < sunMark.r * 2.5) continue;
    if (moonMark && Math.hypot(px - moonMark.x, py - moonMark.y) < moonMark.r * 2.2) continue;
    const hero = o.hero != null && v.id === o.hero;
    if (hero) heroAt = { x: px, y: py };
    if (hero && reveal < 0.02) continue; // still on its way in
    stars.push({ x: px, y: py, h, v, hero, here: !!v.here || hero });
  }
  const hero = stars.find((d) => d.hero) ?? null;
  // Typography.
  const cap = o.print ? Math.max(9.5, S * 0.019) : Math.max(9, S * 0.017);
  const textW = (str, size) => [...str].length * size * 0.62; // close enough for Cormorant
  const texts = [];
  let block = null;
  if (o.welcome?.name) {
    const big = Math.max(18, S * 0.07);
    const cy = (H * 0.1 + horizon) / 2 - big * 0.15;
    const line = welcomeLine(o.welcome, c);
    const half = Math.max(textW(o.welcome.name, big), textW(o.welcome.greeting ?? '', big * 0.42), textW(line, cap * 1.05)) / 2;
    const pad = S * 0.05;
    let cx = W / 2;
    const top = cy - big * 1.35, bot = cy + big * 1.2 + cap * 0.4;
    // The guest's own star stays in view: the words step aside if they would cover it.
    const hp = heroAt;
    if (hp && hp.y > top - pad && hp.y < bot + pad && Math.abs(hp.x - cx) < half + pad) {
      cx = hp.x < W / 2 ? hp.x + pad + half : hp.x - pad - half;
      cx = clamp(cx, mx + half, W - mx - half);
    }
    block = { x0: cx - half - S * 0.015, x1: cx + half + S * 0.015, y0: top, y1: bot };
    texts.push({ text: o.welcome.greeting ?? 'Bienvenido', x: cx, y: cy - big * 0.85, size: big * 0.42, align: 'center', italic: true, alpha: 0.85, role: 'greeting' });
    texts.push({ text: o.welcome.name, x: cx, y: cy + big * 0.55, size: big, align: 'center', alpha: 1, role: 'name' });
    if (line) texts.push({ text: line, x: cx, y: cy + big * 1.2, size: cap * 1.05, align: 'center', italic: true, alpha: 0.75, role: 'line' });
  }
  const inBlock = (d) => block && d.x > block.x0 && d.x < block.x1 && d.y > block.y0 && d.y < block.y1;
  const dots = stars.filter((d) => d.hero || !inBlock(d));

  const links = [];
  if (!o.welcome && !o.print) {
    const quiet = dots.filter((d) => !d.here); // guests who are here stand apart from the constellation
    for (const a of quiet) {
      let best = null, bd = S * 0.11;
      for (const b of quiet) {
        const dd = Math.hypot(a.x - b.x, a.y - b.y);
        if (b !== a && dd < bd) { bd = dd; best = b; }
      }
      if (best) links.push({ pts: [a.x, a.y, best.x, best.y], alpha: 0.18, dotted: true });
    }
  }

  const sparks = [];
  const labels = [];
  for (const d of dots) {
    const regular = 1 + 0.22 * Math.min(4, Math.max(0, (d.v.visits ?? 1) - 1));
    if (!d.here) {
      circles.push({ x: d.x, y: d.y, r: Math.max(1, S * 0.0022) * regular, fill: true, alpha: o.welcome ? 0.35 : 0.75, accent: 'visitor' });
      continue;
    }
    // A four-point sparkle: thicker near the core, hairline at the tips, slow twinkle on screens.
    const tw = o.print ? 1 : 1 + 0.12 * Math.sin(t * 1.7 + (d.h % 628) / 100);
    const L = (d.hero ? S * 0.05 * grow : S * 0.027) * tw * (d.hero ? 1 : regular * 0.85);
    const d0 = S * (d.hero ? 0.009 : 0.006);
    const thin = o.print ? 1 : 0.8;
    for (const [dx, dy, len] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [0.7071, 0.7071, 0.42], [-0.7071, 0.7071, 0.42], [0.7071, -0.7071, 0.42], [-0.7071, -0.7071, 0.42]]) {
      const l = Math.max(d0 * 1.2, L * len);
      sparks.push({ pts: [d.x + dx * d0, d.y + dy * d0, d.x + dx * (d0 + (l - d0) * 0.45), d.y + dy * (d0 + (l - d0) * 0.45)], alpha: 0.95, weight: len < 1 ? thin : 1.5, accent: 'here' });
      if (len === 1) sparks.push({ pts: [d.x + dx * d0, d.y + dy * d0, d.x + dx * l, d.y + dy * l], alpha: 0.9, weight: thin, accent: 'here' });
    }
    circles.push({ x: d.x, y: d.y, r: S * (d.hero ? 0.0062 : 0.0045), fill: true, alpha: 1, accent: 'here' });
    circles.push({ x: d.x, y: d.y, r: S * (d.hero ? 0.017 + 0.004 * Math.sin(t * 0.9) * (o.print ? 0 : 1) : 0.0115), fill: false, alpha: d.hero ? 0.55 : 0.4, accent: 'here' });
    if (d.v.name && !(d.hero && o.welcome)) labels.push(d);
  }

  // Names beside the stars of guests who are here, kept clear of the words, the sun, other stars
  // and each other.
  const box = (x, y, r, owner) => ({ x0: x - r, x1: x + r, y0: y - r, y1: y + r, owner });
  const placed = block ? [block] : [];
  if (sunMark) placed.push(box(sunMark.x, sunMark.y, sunMark.r * 1.6));
  if (moonMark) placed.push(box(moonMark.x, moonMark.y, moonMark.r * 1.5));
  for (const d of dots) placed.push(box(d.x, d.y, S * (d.hero ? 0.05 : d.here ? 0.026 : 0.007), d));
  for (const d of labels) {
    const hit = (b) => placed.some((p) => p.owner !== d && b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0);
    const size = cap * 0.95, w = textW(d.v.name, size), gap = S * 0.022;
    const tries = [
      { x: d.x + gap, y: d.y + size * 0.35, align: 'left' },
      { x: d.x - gap, y: d.y + size * 0.35, align: 'right' },
      { x: d.x, y: d.y + gap + size * 1.1, align: 'center' },
      { x: d.x, y: d.y - gap - size * 0.2, align: 'center' },
    ];
    for (const p of tries) {
      const x0 = p.align === 'left' ? p.x : p.align === 'right' ? p.x - w : p.x - w / 2;
      const b = { x0, x1: x0 + w, y0: p.y - size * 1.1, y1: p.y + size * 0.35 };
      if (b.x0 < mx * 0.5 || b.x1 > W - mx * 0.5 || hit(b)) continue;
      placed.push(b);
      texts.push({ text: d.v.name, x: p.x, y: p.y, size, align: p.align, italic: true, alpha: 0.9, accent: 'here' });
      break;
    }
  }

  // Reflections: a column of glints on the water straight below a light, spreading toward the
  // viewer. The welcomed star's is drawn in as it arrives; the moon's follows its brightness.
  const shimmer = o.print ? 0 : Math.floor(t * 2.5);
  const column = (x, reach, strength, accent, salt) => {
    const out = [];
    for (let k = 0; k < rows.length; k++) {
      const l = rows[k];
      if (l.row > reach * 1.05) continue;
      if (hash(k, 5 + salt, seed + shimmer) > (0.82 - 0.25 * l.row) * strength) continue;
      const half = Math.max(step * 1.6, S * (0.004 + 0.022 * l.row) * (0.45 + hash(k, 6 + salt, seed + shimmer)) * (accent === 'moon' ? big : 1));
      const pts = [];
      for (let q = 0; q < l.pts.length; q += 2) if (Math.abs(l.pts[q] - x) <= half) pts.push(l.pts[q], l.pts[q + 1]);
      // On a one-colour panel glints can only differ from the sea by weight, so they are bolder.
      if (pts.length >= 4) out.push({ pts, alpha: 1, weight: (o.print ? 3.6 : 2.2) - l.row, accent });
    }
    return out;
  };
  const glints = [];
  if (moonMark && dark && moonMark.fraction > 0.2) glints.push(...column(moonMark.x, 1, 0.35 + 0.65 * moonMark.fraction, 'moon', 20));
  if (hero) glints.push(...column(hero.x, reveal, 1, 'here', 0));

  if (o.captions !== false) {
    const portrait = W < H * 1.3;
    const top = H * 0.075, by = H - H * 0.06;
    texts.unshift({ text: 'Atlántico', x: mx, y: top, size: cap * 1.25, align: 'left', italic: false, alpha: 0.9 });
    texts.push(portrait
      ? { text: ed.label, x: mx, y: top + cap * 2, size: cap, align: 'left', italic: true, alpha: 0.7 }
      : { text: ed.label, x: W - mx, y: top, size: cap, align: 'right', italic: true, alpha: 0.7 });
    const wName = windName(ws, c.windDirection ?? 0);
    const sea = `swell ${(c.waveHeight ?? 0).toFixed(1)} m · ${Math.round(T)} s · ${compass(c.waveDirection ?? 0)}` +
      `    wind ${Math.round(ws)} km/h ${compass(c.windDirection ?? 0)}${wName && wName !== 'calma' ? ` (${wName})` : ''}`;
    const live = liveLine(c);
    const coords = `${dms(lat, 'N', 'S')}  ${dms(lon, 'E', 'W')}`;
    if (portrait) {
      const rowsUp = live ? 2 : 1;
      texts.push({ text: coords, x: mx, y: by - cap * 2.1 * rowsUp, size: cap, align: 'left', alpha: 0.7 });
      texts.push({ text: sea, x: mx, y: by - (live ? cap * 2.1 : 0), size: cap, align: 'left', alpha: 0.7 });
      if (live) texts.push({ text: live, x: mx, y: by, size: cap, align: 'left', alpha: 0.7 });
    } else {
      texts.push({ text: coords, x: mx, y: by, size: cap, align: 'left', alpha: 0.7 });
      texts.push({ text: sea, x: W - mx, y: by - (live ? cap * 1.8 : 0), size: cap, align: 'right', alpha: 0.7 });
      if (live) texts.push({ text: live, x: W - mx, y: by, size: cap, align: 'right', alpha: 0.7 });
    }
  }

  return {
    width: W, height: H, dark, horizon, edition: { n: ed.n, style, label: ed.label, palette: ed.palette.name },
    palette: { ...pal, visitor: pal.fg, sun: pal.fg, moon: pal.fg },
    lines: [...weather, ...links, ...lines, ...glints, ...sparks], shapes, circles, texts,
    hero: heroAt,
  };
}

const ORD = {
  es: ['primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta', 'séptima', 'octava', 'novena', 'décima'],
  en: ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'],
};

function ago(ms, es) {
  const h = ms / 3600000, d = h / 24;
  const n = (v, one, many) => (v === 1 ? one : many.replace('#', v));
  if (h < 20) return es ? 'hace unas horas' : 'a few hours ago';
  if (h < 44) return es ? 'ayer' : 'yesterday';
  if (d < 14) return es ? `hace ${Math.round(d)} días` : `${Math.round(d)} days ago`;
  if (d < 60) return n(Math.round(d / 7), es ? 'hace una semana' : 'a week ago', es ? 'hace # semanas' : '# weeks ago');
  if (d < 700) return n(Math.round(d / 30.4), es ? 'hace un mes' : 'a month ago', es ? 'hace # meses' : '# months ago');
  return n(Math.round(d / 365), es ? 'hace un año' : 'a year ago', es ? 'hace # años' : '# years ago');
}

/**
 * The personal line under a guest's name: which visit this is and how long it has been,
 * or, the first time, that their star is new and which wind brought them.
 */
export function welcomeLine(w, c = {}, lang = 'es') {
  const es = lang === 'es';
  const n = w.visits ?? 1;
  const wn = windName(c.windSpeed ?? 0, c.windDirection ?? 0);
  const wind = !wn ? null : wn === 'calma' ? (es ? 'mar en calma' : 'a calm sea') : es ? `llegas con ${wn}` : `arriving with the ${wn}`;
  if (n <= 1) return [es ? 'tu estrella, desde hoy' : 'your star, from today', wind].filter(Boolean).join(' · ');
  const ord = ORD[es ? 'es' : 'en'][n - 1];
  const visit = ord ? `${ord} ${es ? 'visita' : 'visit'}` : es ? `visita ${n}` : `visit ${n}`;
  const since = w.since ? (es ? `la anterior, ${ago(w.since, true)}` : `the last one ${ago(w.since, false)}`) : wind;
  return [visit, since].filter(Boolean).join(' · ');
}

/** The classic palette (Cal), for anything drawn without a composition. */
export const PALETTE = {
  light: { ...PALETTES[0].light, sun: PALETTES[0].light.fg, visitor: PALETTES[0].light.fg },
  dark: { ...PALETTES[0].dark, sun: PALETTES[0].dark.fg, visitor: PALETTES[0].dark.fg },
};

const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

/** SVG string — used by the Worker's live view. */
export function toSVG(comp) {
  const p = comp.palette ?? (comp.dark ? PALETTE.dark : PALETTE.light);
  const sw = Math.max(0.6, Math.min(comp.width, comp.height) / 1000);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${comp.width} ${comp.height}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`,
    `<rect width="100%" height="100%" fill="${p.bg}"/>`, `<g fill="none" stroke="${p.fg}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">`];
  const col = (a) => (a && p[a]) || p.fg;
  const pathOf = (pts) => {
    let d = `M${pts[0].toFixed(1)} ${pts[1].toFixed(1)}`;
    for (let k = 2; k < pts.length; k += 2) d += `L${pts[k].toFixed(1)} ${pts[k + 1].toFixed(1)}`;
    return d;
  };
  for (const l of comp.lines) {
    const extra = (l.accent ? ` stroke="${col(l.accent)}"` : '') + (l.weight ? ` stroke-width="${(sw * l.weight).toFixed(2)}"` : '') +
      (l.dash ? ` stroke-dasharray="${l.dash[0].toFixed(1)} ${l.dash[1].toFixed(1)}"` : l.dotted ? ` stroke-dasharray="1 ${sw * 4}"` : '');
    out.push(`<path d="${pathOf(l.pts)}" opacity="${l.alpha.toFixed(2)}"${extra}/>`);
  }
  out.push('</g>');
  for (const sh of comp.shapes ?? []) out.push(`<path d="${pathOf(sh.pts)}Z" fill="${col(sh.accent)}" opacity="${sh.alpha}"/>`);
  for (const c of comp.circles) {
    out.push(`<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${c.r.toFixed(1)}" opacity="${c.alpha}" ${c.fill ? `fill="${col(c.accent)}"` : `fill="none" stroke="${col(c.accent)}" stroke-width="${sw}"`}/>`);
  }
  for (const t of comp.texts) {
    out.push(`<text x="${t.x.toFixed(1)}" y="${t.y.toFixed(1)}" font-size="${(t.size * 1.5).toFixed(1)}" text-anchor="${{ left: 'start', center: 'middle', right: 'end' }[t.align]}" fill="${col(t.accent)}" opacity="${t.alpha}" font-family="'Cormorant Garamond', Georgia, serif"${t.italic ? ' font-style="italic"' : ''} letter-spacing="0.04em">${esc(t.text)}</text>`);
  }
  out.push('</svg>');
  return out.join('');
}
