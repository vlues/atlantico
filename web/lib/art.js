// Atlántico — the generative wall piece.
// Pure geometry: conditions in, polylines/circles/texts out. No DOM, no I/O.
// Rendered by canvas (web), SVG (Worker live view) and the bitmap rasterizer (e-ink).

export const HOME = { lat: 36.5986, lon: -6.2797, coastFacing: 245 };

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (v) => { const x = clamp(v, 0, 1); return x * x * (3 - 2 * x); };

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

export const STYLES = ['lineas', 'puntos', 'bandas', 'horizonte', 'trazo', 'relieve', 'contornos'];
export const STYLE_NAMES = {
  lineas: 'Líneas', puntos: 'Puntos', bandas: 'Bandas', horizonte: 'Horizonte', trazo: 'Trazo', relieve: 'Relieve', contornos: 'Contornos',
};

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

/** Lines with the points inside a rectangle removed (split where they cross it). */
function cutOut(lines, b) {
  const out = [];
  for (const l of lines) {
    let seg = [];
    for (let q = 0; q < l.pts.length; q += 2) {
      const x = l.pts[q], y = l.pts[q + 1];
      if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1) { if (seg.length >= 4) out.push({ ...l, pts: seg }); seg = []; }
      else seg.push(x, y);
    }
    if (seg.length >= 4) out.push({ ...l, pts: seg });
  }
  return out;
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
  if (style === 'relieve' && o.lineCount == null) N = clamp(Math.round(N * 0.6), 18, 52);
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
  // The sea surface: displacement (in line spacings) at u across, s deep, and the swell's phase.
  const surface = (u, s) => {
    const env = 0.35 + 0.65 * s;
    const swell = Math.sin(TAU * ((s * Math.cos(r) + u * Math.sin(r) * (fw / fh)) / lambda - drift));
    let d = swellAmp * env * swell;
    d += underAmp * env * Math.sin(TAU * (u * k2 + s * 0.45 - drift * 0.6) + noise(u * grain, s * 2, seed) * 1.2);
    const bu = 2 * (u - bowC);
    d -= bend * Math.abs(ex) * (0.6 - Math.min(1, bu * bu)) * (0.55 + 0.45 * s);
    d += bend * ny * (u - 0.5) * 0.9;
    d += chop * noise(u * 46 + t * 0.03, s * (N - 1) * 0.35, seed + 3);
    return [d, swell];
  };
  // Relieve: ridgelines whose peaks rise where the sea is busiest, like a mountain-range print.
  const peakC = 0.5 + (ed.grain - 0.5) * 0.3;
  const ridge = (u, s, d) => horizon + fh * persp(s) - (Math.abs(d) + 0.15) * (fh / (N - 1)) * (0.9 + 1.4 * hN) *
    (0.6 + 3.2 * Math.exp(-(((u - peakC) / 0.2) ** 2))) * (0.4 + 0.6 * s);
  const rows = []; // the sea, one polyline per line (split where the sun glitters)
  for (let i = 0; i < N; i++) {
    const s = i / (N - 1);
    let cur = [], ph = [];
    const flush = () => { if (cur.length >= 4) rows.push({ pts: cur, ph, alpha: 0.45 + 0.55 * Math.min(1, s * 3), row: s }); cur = []; ph = []; };
    for (let x = mx; x <= W - mx + 0.01; x += step) {
      const u = (x - mx) / fw;
      const [d, swell] = surface(u, s);
      const y = style === 'relieve' ? ridge(u, s, d) : Math.min(H * 0.89, horizon + fh * persp(s + d / (N - 1)));

      if (sunMark && sunMark.alt < 38 && style !== 'relieve') {
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
  if (style === 'relieve') {
    // Nearer ridges hide the ones behind them.
    const env = new Float64Array(rows[0]?.pts.length / 2 || 0).fill(Infinity);
    for (let k = rows.length - 1; k >= 0; k--) {
      const l = rows[k], gap = S * 0.0025;
      let seg = [];
      for (let q = 0; q < l.pts.length; q += 2) {
        const y = l.pts[q + 1], e = env[q / 2];
        if (y < e - gap) seg.push(l.pts[q], y);
        else { if (seg.length >= 4) lines.push({ pts: seg, alpha: l.alpha, row: l.row, weight: 1.15 }); seg = []; }
        if (y < e) env[q / 2] = y;
      }
      if (seg.length >= 4) lines.push({ pts: seg, alpha: l.alpha, row: l.row, weight: 1.15 });
    }
  } else if (style === 'contornos') {
    // The sea as a map: lines of equal height across the water (marching squares).
    const gx = clamp(Math.round(fw / (o.print ? 7 : 9)), 60, 180), gy = clamp(Math.round(fh / (o.print ? 7 : 9)), 24, 70);
    const inv = (z) => { let a = 0, b = 1; for (let k = 0; k < 18; k++) { const m = (a + b) / 2; if (persp(m) < z) a = m; else b = m; } return (a + b) / 2; };
    const sOf = Array.from({ length: gy + 1 }, (_, j) => inv(j / gy));
    const F = Array.from({ length: gy + 1 }, (_, j) => Float64Array.from({ length: gx + 1 }, (_, i) => surface(i / gx, sOf[j])[0] + sOf[j] * 2.2));
    let lo = Infinity, hi = -Infinity;
    for (const row of F) for (const v of row) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const nL = clamp(Math.round(10 + 8 * hN), 10, 20);
    const X = (i) => mx + (fw * i) / gx, Y = (j) => horizon + (fh * j) / gy;
    for (let li = 1; li < nL; li++) {
      const L = lo + ((hi - lo) * li) / nL;
      const alpha = 0.5 + 0.5 * (li % 4 === 0 ? 1 : 0.6), weight = li % 4 === 0 ? 1.25 : 0.85; // every fourth line heavier, like a map
      for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
        const a = F[j][i], b = F[j][i + 1], cc = F[j + 1][i + 1], d = F[j + 1][i];
        const idx = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (cc > L ? 2 : 0) | (d > L ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const f = (p, q) => (L - p) / (q - p || 1e-9);
        const T = [X(i + f(a, b)), Y(j)], R = [X(i + 1), Y(j + f(b, cc))], B = [X(i + f(d, cc)), Y(j + 1)], Lf = [X(i), Y(j + f(a, d))];
        const segs = { 1: [Lf, B], 2: [B, R], 3: [Lf, R], 4: [T, R], 5: [Lf, T, B, R], 6: [T, B], 7: [Lf, T], 8: [Lf, T], 9: [T, B], 10: [Lf, B, T, R], 11: [T, R], 12: [Lf, R], 13: [B, R], 14: [Lf, B] }[idx];
        for (let k = 0; k < segs.length; k += 2) lines.push({ pts: [...segs[k], ...segs[k + 1]], alpha, row: (j + 0.5) / gy, weight });
      }
    }
  }
  for (const l of style === 'relieve' || style === 'contornos' ? [] : rows) {
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

  // Where the water is: the sea surface at depth `sd` (0 horizon … 1 near) under x. Continuous in both,
  // so anything floating on it rides the swell smoothly instead of stepping from line to line.
  const waterY = (sd, x) => {
    const u = clamp((x - mx) / fw, 0, 1), [d] = surface(u, sd);
    return style === 'relieve' ? ridge(u, sd, d) : Math.min(H * 0.89, horizon + fh * persp(sd + d / (N - 1)));
  };

  // ── Weather, live, drawn like an engraving's sky ──────────────────────────────
  // Fair days: a few wisps of cirrus. As cloud builds: cumulus with scalloped tops and a shaded
  // base. Overcast: a hatched grey ceiling. Rain falls in slanting curtains from the clouds and rings
  // the water where it lands. All of it drifts with the real wind.
  const sky = { x0: mx, x1: W - mx, y0: H * 0.1, y1: horizon - S * 0.05 };
  const skyH = Math.max(1, sky.y1 - sky.y0);
  const rain = c.precipitation ?? 0;
  const cover = Math.max(clamp((c.cloudCover ?? 0) / 100, 0, 1), rain > 0.05 ? 0.72 : 0);
  const wdir = ex >= 0 ? 1 : -1;
  const windShift = o.print ? 0 : t * (1.5 + ws * 0.12) * wdir;
  const ink = o.print ? { a: 0.8, w: 1 } : { a: 0.42, w: 0.75 };
  const weather = [], ripples = [];
  // Only what lies between the margins (clouds drift in from one side and out of the other).
  const add = (pts, alpha, weight, into = weather) => {
    let seg = [];
    const flush = () => { if (seg.length >= 4) into.push({ pts: seg, alpha: Math.min(1, alpha), weight }); seg = []; };
    for (let q = 0; q < pts.length; q += 2) {
      if (pts[q] >= mx && pts[q] <= W - mx) seg.push(pts[q], pts[q + 1]); else flush();
    }
    flush();
  };
  const drifting = (k, len, salt) => { const span = fw + len; return mx - len / 2 + ((((hash(k, salt, seed) * span + windShift) % span) + span) % span); };

  if (cover > 0.04 && cover < 0.6) {
    // Cirrus: long fine strands high up, each with a hook at its downwind end.
    const n = 1 + Math.round(clamp((cover - 0.04) / 0.4, 0, 1) * 3);
    for (let k = 0; k < n; k++) {
      const L = fw * (0.16 + 0.18 * hash(k, 21, seed));
      const cx = drifting(k, L, 22), cy = sky.y0 + skyH * 0.45 * hash(k, 23, seed);
      for (let j = 0; j < 2; j++) {
        const len = L * (j ? 0.55 : 1), pts = [];
        for (let q = 0; q <= 28; q++) {
          const u = q / 28, uw = wdir > 0 ? u : 1 - u;
          const hook = uw > 0.8 ? Math.pow((uw - 0.8) / 0.2, 2) * S * 0.016 : 0;
          pts.push(cx - len / 2 + len * u + j * L * 0.14, cy + j * S * 0.006 + Math.sin(u * Math.PI * 1.4 + k) * S * 0.004 - hook);
        }
        add(pts, ink.a * (j ? 0.65 : 0.9), ink.w * 0.9);
      }
    }
  }
  const clouds = []; // their bases, where rain falls from
  const nCu = cover < 0.2 ? 0 : 1 + Math.round(clamp((cover - 0.2) / 0.55, 0, 1) * 3);
  for (let k = 0; k < nCu; k++) {
    // Cumulus: rounded billows (the top edge of a few overlapping circles, biggest in the middle)
    // over a flat base, with two strokes of shade inside.
    const wC = S * (0.13 + 0.12 * hash(k, 31, seed)), hC = wC * (0.32 + 0.16 * hash(k, 32, seed));
    const cx = drifting(k, wC, 33);
    const base = sky.y0 + hC + Math.max(0, skyH - hC - S * 0.02) * (0.3 + 0.6 * hash(k, 34, seed));
    const nb = 4 + Math.floor(hash(k, 35, seed) * 4);
    const puffs = Array.from({ length: nb }, (_, b) => {
      const f = (b + 0.5) / nb, rise = Math.sin(Math.PI * f);
      const rr = (wC / nb) * (0.75 + 0.35 * rise) * (0.85 + 0.35 * hash(k, 37 + b, seed));
      return { x: cx - wC / 2 + wC * (0.08 + 0.84 * f), y: base - rr * 0.5 - hC * 0.55 * rise * (0.7 + 0.3 * hash(k, 47 + b, seed)), r: rr };
    });
    const top = [];
    for (let q = 0; q <= 64; q++) {
      const x = cx - wC / 2 + (wC * q) / 64;
      let y = base;
      for (const pf of puffs) { const dx = x - pf.x; if (Math.abs(dx) < pf.r) y = Math.min(y, pf.y - Math.sqrt(pf.r * pf.r - dx * dx)); }
      if (y < base - 0.5 || top.length) top.push(x, y);
    }
    while (top.length > 4 && top[top.length - 1] >= base - 0.5) top.splice(-2, 2);
    add(top, ink.a * 1.15, ink.w * 1.1);
    add([cx - wC * 0.4, base, cx + wC * 0.42, base], ink.a * 0.75, ink.w);
    add([cx - wC * 0.3, base - hC * 0.15, cx + wC * 0.18, base - hC * 0.15], ink.a * 0.5, ink.w * 0.8);
    add([cx - wC * 0.16, base - hC * 0.28, cx + wC * 0.04, base - hC * 0.28], ink.a * 0.35, ink.w * 0.8);
    clouds.push({ x0: cx - wC * 0.38, x1: cx + wC * 0.38, y: base });
  }
  if (cover >= 0.7) {
    // Overcast: a ceiling of broken hatching, denser toward the top.
    const n = 3 + Math.round(clamp((cover - 0.7) / 0.3, 0, 1) * 5);
    for (let k = 0; k < n; k++) {
      const y = sky.y0 + skyH * 0.58 * (k / Math.max(1, n - 1)) + S * 0.004 * hash(k, 41, seed);
      let seg = [];
      for (let x = mx; x <= W - mx + 0.01; x += step * 2) {
        const bucket = Math.floor((x - windShift * 0.5) / (S * 0.055));
        if (hash(bucket, k * 7 + 42, seed) < 0.24 + 0.2 * (k / n)) { add(seg, ink.a * (0.8 - 0.35 * k / n), ink.w * 0.8); seg = []; continue; }
        seg.push(x, y + Math.sin((x - windShift * 0.5) / (S * 0.16) + k) * S * 0.003);
      }
      add(seg, ink.a * (0.8 - 0.35 * k / n), ink.w * 0.8);
    }
  }
  if (rain > 0.05) {
    // Rain: curtains slanting with the wind from each cloud (or across the sky when it's all grey)…
    const amount = clamp(rain / 2, 0.15, 1);
    const slant = clamp(ex * (0.12 + wN * 0.8), -0.6, 0.6), len = S * 0.016;
    const shafts = clouds.length ? clouds : [0.22, 0.5, 0.78].map((f) => ({ x0: mx + fw * (f - 0.11), x1: mx + fw * (f + 0.11), y: sky.y0 + skyH * 0.6 }));
    const per = Math.round(amount * (o.print ? 12 : 30));
    shafts.forEach((sh, si) => {
      const depth = Math.max(1, horizon - sh.y);
      for (let k = 0; k < per; k++) {
        const dy = (hash(k, 52 + si, seed) * depth + (o.print ? 0 : t * S * 0.4)) % depth;
        const x = sh.x0 + (sh.x1 - sh.x0) * hash(k, 53 + si, seed) + slant * dy;
        add([x, sh.y + dy, x + slant * len, sh.y + dy + len], ink.a * (1 - 0.55 * dy / depth), ink.w * 0.8);
      }
    });
    // …and rings opening on the water where it lands.
    const n = Math.round(amount * (o.print ? 14 : 36));
    for (let k = 0; k < n; k++) {
      const sd = 0.04 + 0.9 * hash(k, 61, seed), x = mx + fw * (0.03 + 0.94 * hash(k, 62, seed));
      const phase = o.print ? 0.6 : (t * 0.7 + hash(k, 63, seed)) % 1;
      const rx = S * (0.003 + 0.013 * sd) * (0.35 + 0.65 * phase), ry = rx * 0.3, y = waterY(sd, x);
      const pts = [];
      for (let q = 0; q <= 16; q++) { const a = (q / 16) * TAU; pts.push(x + rx * Math.cos(a), y + ry * Math.sin(a)); }
      add(pts, ink.a * (o.print ? 1 : 1.4 * (1 - phase)), ink.w * 0.8, ripples);
    }
  }

  const circles = [];
  const shapes = [];
  const marks = []; // drawn over the filled shapes: rigging and hulls
  if (sunMark && sunMark.y > H * 0.08) {
    circles.push({ x: sunMark.x, y: sunMark.y, r: sunMark.r, fill: dark, alpha: 0.9, accent: 'sun' });
  }
  if (moonMark) {
    circles.push({ x: moonMark.x, y: moonMark.y, r: moonMark.r, fill: false, alpha: 0.3, accent: 'moon' });
    shapes.push({ pts: moonShape(moonMark.x, moonMark.y, moonMark.r, moonMark.phase), alpha: 0.95, accent: 'moon' });
  }

  // ── Guests ────────────────────────────────────────────────────────────────────
  // By night each guest is a star with its own place in the sky: regulars burn a little brighter and
  // guests who are here sparkle and wander a little, always drifting back. By day the sun hides the
  // stars (as in life) and guests who are here are sails on the bay instead, each sailing its own slow
  // loop around its place and heeling with the real wind. At dusk the sails go in as the stars come
  // out. Arrivals: a shooting star by night; by day a boat sails in and hoists its sail. Departures:
  // by day the boat sails off over the horizon; by night the sparkle settles back into a quiet star.
  const alt = sun.altitude;
  const sailsA = o.print ? (alt > -1 ? 1 : 0) : clamp((alt + 1.5) / 4.5, 0, 1);
  const starsA = o.print ? (alt > -1 ? 0 : 1) : clamp((-1 - alt) / 5, 0, 1);
  const byDay = sailsA > starsA;
  // Dusk turns each boat into its star: the sail comes down, a light gathers at the masthead and
  // climbs into the sky to the guest's place (dawn plays it backwards: the star comes down to its
  // boat and the sail goes up). 0 under sail … 1 a star at home; on e-ink it is one or the other.
  const rise = o.print ? (alt > -1 ? 0 : 1) : clamp((3 - alt) / 9, 0, 1);
  const live = !o.print;
  const heroes = new Map((o.heroes ?? (o.hero != null ? [{ id: o.hero, reveal: o.reveal ?? 1 }] : [])).map((h) => [h.id, h]));
  const departing = new Map((o.departing ?? []).map((d) => [d.id, d]));
  // Each guest's own slow wander, returning to its place again and again.
  const wander = (h, salt, period) => {
    const w = TAU / period, ph = hash(h, salt, 5) * TAU;
    return [Math.sin(t * w + ph), Math.sin(t * w * 1.37 + ph * 1.7), Math.cos(t * w + ph)];
  };
  const starHome = (h) => ({ x: sky.x0 + (sky.x1 - sky.x0) * hash(h, 1, 11), y: sky.y0 + (sky.y1 - sky.y0) * Math.pow(hash(h, 2, 13), 0.8) });
  const starAt = (h, lively) => {
    const p = starHome(h);
    if (!live) return p;
    const [u1, u2] = wander(h, 3, lively ? 70 + 60 * hash(h, 4, 5) : 40 + 50 * hash(h, 4, 5));
    const amp = S * (lively ? 0.014 : 0.003);
    return { x: p.x + amp * u1, y: p.y + amp * 0.6 * u2 };
  };
  const boatHome = (h) => ({ sd: 0.05 + 0.32 * hash(h, 4, 19), x: mx + fw * (0.06 + 0.88 * hash(h, 3, 17)) });
  const boatAt = (h, at = t) => {
    const b = boatHome(h);
    if (!live) return { ...b, fwd: hash(h, 9, 3) < 0.5 ? 1 : -1, speed: 0 };
    const w = TAU / (150 + 150 * hash(h, 10, 5)), ph = hash(h, 8, 5) * TAU;
    const [u1, u2, dv] = [Math.sin(at * w + ph), Math.sin(at * w * 1.37 + ph * 1.7), Math.cos(at * w + ph)];
    const amp = fw * 0.07 * (0.6 + 0.8 * hash(h, 11, 5));
    // fwd eases through zero as the boat comes about (seen bow-on for a moment), rather than flipping.
    const fwd = Math.sign(dv || 1) * Math.max(0.14, Math.min(1, Math.abs(dv) * 3));
    return { x: clamp(b.x + amp * u1, mx + S * 0.03, W - mx - S * 0.03), sd: clamp(b.sd + 0.035 * u2, 0.03, 0.45), fwd, speed: Math.abs(dv) };
  };

  // Past guests by day: a few at a time sail along far out (each passes by every hour or so), and
  // someone who has just left keeps drifting out there for a while first. Deleted guests never return.
  const pastCount = Math.max(1, (o.visitors ?? []).filter((v) => !v.here).length);
  const duty = clamp(6 / pastCount, 0.05, 1);
  const ghostAt = (h, v, dep) => {
    let fwd = hash(h, 42, 7) < 0.5 ? 1 : -1, x, sd, alpha = 1;
    const lane = 0.02 + 0.2 * hash(h, 41, 7); // each has its own distance out, so they don't bunch up
    const mk = () => ({ x, wy: waterY(sd, x), sd, size: S * (0.034 + 0.07 * sd), h, v, hoist: 1, sink: 0, fwd, speed: o.print ? 0 : 0.6, ghost: 1, fade: alpha, labelFade: 0 });
    if (dep) {
      // Just left: carries on out of the bay at sailing pace, settling into its lane.
      const from = boatAt(h, t - (dep.age ?? 0)), age = Math.max(0, (dep.age ?? 0) - 8);
      fwd = Math.sign(from.fwd) || 1;
      sd = from.sd * 0.15 + (lane - from.sd * 0.15) * ease(age / 60);
      x = from.x + fwd * (fw * 0.12 + S * 0.012 * age);
      if (x < mx - S * 0.05 || x > W - mx + S * 0.05) return null;
      return mk();
    }
    if (o.print) {
      // On e-ink, a handful sit still out there.
      if (hash(h, 44, 7) > Math.min(1, 5 / pastCount)) return null;
      x = mx + fw * (0.05 + 0.9 * hash(h, 45, 7));
      sd = lane;
      return mk();
    }
    // Everyone else who has been here sails past now and then: each crossing takes a minute or
    // three, and turns come round often enough that about five are out at any time.
    const cross = 70 + 110 * hash(h, 46, 7), period = Math.max(cross * 1.4, (cross * pastCount) / 5);
    const phase = (t + hash(h, 43, 7) * period) % period;
    if (phase >= cross) return null;
    const q = phase / cross;
    x = (fwd > 0 ? mx - S * 0.03 : W - mx + S * 0.03) + fwd * (fw + S * 0.06) * q;
    sd = lane + 0.012 * Math.sin(t * 0.15 + (h % 50));
    alpha = clamp(Math.min(q, 1 - q) * 10, 0, 1);
    return mk();
  };

  const stars = [], boats = [];
  const heroAt = []; // where each welcomed guest is, even before they appear (screens animate toward it)
  const known = new Set();
  const guests = [...(o.visitors ?? [])];
  // Someone who was here a moment ago and has now gone from the list entirely (deleted): still play their exit.
  for (const d of departing.values()) if (!guests.some((v) => v.id === d.id)) guests.push({ id: d.id, visits: d.visits ?? 1, gone: true });
  for (const v of guests) {
    if (known.has(v.id)) continue;
    known.add(v.id);
    const h = hashString(String(v.id));
    const hz = heroes.get(v.id), hero = !!hz, here = !!v.here || hero;
    const dep = !here ? departing.get(v.id) : null;
    const name = v.name ?? dep?.name ?? null;
    if (hero && hz.e != null && hz.e < 0) continue; // a later member of a group, not yet on its way
    const lifting = live && here && !hero && !dep && rise > 0 && rise < 1;
    if (starsA > 0 || lifting) {
      const home = starHome(h);
      const hidden = (sunMark && Math.hypot(home.x - sunMark.x, home.y - sunMark.y) < sunMark.r * 2.5) || (moonMark && Math.hypot(home.x - moonMark.x, home.y - moonMark.y) < moonMark.r * 2.2);
      if (!hidden) {
        let P = hero && (hz.reveal ?? 1) < 1 ? home : starAt(h, here || !!dep);
        if (dep) {
          // Back to its place; a deleted guest's star sinks away instead.
          const k = ease(dep.p);
          P = v.gone ? { x: P.x, y: P.y + S * 0.05 * k } : { x: P.x + (home.x - P.x) * k, y: P.y + (home.y - P.y) * k };
        }
        let lift = null;
        if (lifting) {
          // From the masthead (a lantern while the sail comes down), up and over to its place.
          const b = boatAt(h), z = S * (0.034 + 0.07 * b.sd);
          const m = { x: b.x, y: waterY(b.sd, b.x) - z * 0.7 }, to = P;
          const c = { x: m.x + (to.x - m.x) * 0.1, y: to.y + (m.y - to.y) * 0.2 }; // straight up first, then leaning over
          const at = (u) => ({ x: (1 - u) * (1 - u) * m.x + 2 * (1 - u) * u * c.x + u * u * to.x, y: (1 - u) * (1 - u) * m.y + 2 * (1 - u) * u * c.y + u * u * to.y });
          const u = ease(clamp((rise - 0.4) / 0.6, 0, 1));
          const trail = [];
          if (u > 0.005 && u < 0.995) for (let q = 0; q < 4; q++) {
            const pts = [];
            for (let k = 0; k <= 4; k++) { const p = at(Math.max(0, u - 0.2 + 0.05 * q + 0.0125 * k)); pts.push(p.x, p.y); }
            trail.push({ pts, alpha: 0.1 + 0.12 * q });
          }
          lift = { a: Math.max(starsA, ease(clamp((rise - 0.12) / 0.28, 0, 1))), grow: 0.3 + 0.7 * u, arrived: clamp((u - 0.85) / 0.15, 0, 1), trail };
          P = at(u);
        }
        if (hero && !byDay) heroAt.push({ id: v.id, x: P.x, y: P.y, home, kind: 'star' });
        if (!(hero && (hz.reveal ?? 1) < 0.02)) stars.push({ x: P.x, y: P.y, hx: home.x, hy: home.y, h, v: { ...v, name }, hero, reveal: hz?.reveal ?? 1, here, dep: dep ? dep.p : null, gone: !!v.gone, lift });
      }
    }
    if (sailsA > 0 && !v.gone && !here && !(dep && dep.p < 1)) {
      // A guest who has been here: far out on the bay now and then, a small white sail of their own.
      const g = ghostAt(h, v, dep);
      if (g) boats.push(g);
      continue;
    }
    if (sailsA > 0 && (here || dep)) {
      let { x, sd, fwd, speed } = boatAt(h, dep ? t - (dep.age ?? 0) : t);
      let hoist = hero ? 1 - Math.pow(1 - (hz.reveal ?? 1), 3) : 1, sink = 0;
      if (!hero && !dep) { hoist = 1 - ease(clamp(rise / 0.35, 0, 1)); speed *= hoist; } // dusk: the sail comes down, the boat lies still
      if (hero && hz.e != null && live) {
        // Arriving: sails in from one side with a bare mast, stops at its place, hoists its sail.
        const home = boatHome(h), from = home.x - fw * 0.3 > mx ? 1 : -1, p = ease(clamp(hz.e / 3.4, 0, 1));
        x = home.x - from * fw * 0.3 * (1 - p); sd = home.sd; fwd = from; speed = 1 - p;
        hoist = ease(clamp((hz.e - 3) / 1.4, 0, 1));
      }
      let ghost = 0;
      if (dep) {
        // Leaving: out toward the horizon, the gold fading to white: they stay out there, a small sail.
        const k = ease(clamp(dep.p / 0.7, 0, 1));
        fwd = Math.sign(fwd) || 1;
        sd *= 1 - 0.85 * k;
        x = x + fwd * fw * 0.12 * k;
        speed = 0.8;
        ghost = clamp((dep.p - 0.45) / 0.55, 0, 1);
      }
      const wy = waterY(sd, x), size = S * (0.034 + 0.07 * sd) * (hero ? 1.25 : 1);
      if (hero && byDay) heroAt.push({ id: v.id, x, y: wy - size * 0.55, kind: 'sail', water: wy, size });
      const hb = boatHome(h);
      boats.push({ x, wy, sd, size, h, v: { ...v, name }, hero, hoist, sink, fwd, speed, leaving: !!dep, ghost, hx: hb.x, hy: waterY(hb.sd, hb.x) - size * 0.55, fade: 1, labelFade: dep ? 1 - ease(dep.p * 2) : 1 });
    }
  }

  // Typography.
  const cap = o.print ? Math.max(9.5, S * 0.019) : Math.max(9, S * 0.017);
  const textW = (str, size) => [...str].length * size * 0.62; // close enough for Cormorant
  const texts = [];
  let block = null;
  const wt = o.welcome ? welcomeText(o.welcome, c, byDay) : null;
  let clearing = null;
  if (wt) {
    // Spanish first, English small beneath, sized to fit whatever the day's horizon. One guest's
    // welcome sits in the sky beside their star; at night a group's opens a clearing in the sea
    // instead, so every arriving star stays in plain view (by day the sky is free for the words).
    const inSea = !!o.welcome.group && o.welcome.group.length > 1 && !byDay;
    const avail = inSea ? (H * 0.84 - horizon) * 0.8 : horizon - H * 0.1 - S * 0.01;
    let big = clamp(Math.min(S * 0.07, (avail - cap * 2.2) / 2.85), 14, S * 0.07);
    big = Math.min(big, (fw * 0.92) / Math.max(1, [...wt.title].length * 0.62));
    const cy = inSea ? horizon + (H * 0.84 - horizon) * 0.08 + big * 1.45 : H * 0.1 + avail * 0.5 - big * 0.05;
    const gs = Math.max(cap * 1.1, big * 0.4), en = cap * 0.85;
    const half = Math.max(textW(wt.title, big), textW(wt.greeting, gs), textW(wt.line, cap * 1.05), textW(wt.lineEn, en)) / 2;
    const pad = S * 0.05;
    let cx = W / 2;
    const top = cy - big * 1.45, bot = cy + big * 1.2 + cap * 1.6;
    // The newest guest's star stays in view: the words step aside if they would cover it.
    const hp = inSea ? null : heroAt[0]?.home ?? heroAt[0];
    if (hp && hp.y > top - pad && hp.y < bot + pad && Math.abs(hp.x - cx) < half + pad) {
      cx = hp.x < W / 2 ? hp.x + pad + half : hp.x - pad - half;
      cx = clamp(cx, mx + half, W - mx - half);
    }
    block = { x0: cx - half - S * 0.015, x1: cx + half + S * 0.015, y0: top, y1: bot };
    if (inSea) clearing = { x0: block.x0 - S * 0.03, x1: block.x1 + S * 0.03, y0: top - S * 0.02, y1: bot + S * 0.015 };
    texts.push({ text: wt.greeting, x: cx, y: cy - big * 1.05, size: gs, align: 'center', italic: true, alpha: 0.85, role: 'greeting' });
    texts.push({ text: wt.greetingEn, x: cx, y: cy - big * 1.05 + en * 1.9, size: en, align: 'center', alpha: 0.55, role: 'greeting' });
    texts.push({ text: wt.title, x: cx, y: cy + big * 0.6, size: big, align: 'center', alpha: 1, role: 'name' });
    if (wt.line) texts.push({ text: wt.line, x: cx, y: cy + big * 1.2, size: cap * 1.05, align: 'center', italic: true, alpha: 0.75, role: 'line' });
    if (wt.lineEn) texts.push({ text: wt.lineEn, x: cx, y: cy + big * 1.2 + cap * 1.55, size: en, align: 'center', alpha: 0.5, role: 'line' });
  }
  const inBlock = (d) => block && d.x > block.x0 && d.x < block.x1 && d.y > block.y0 && d.y < block.y1;
  const dots = stars.filter((d) => d.hero || !inBlock(d));

  const links = [];
  if (!o.welcome && !o.print && starsA > 0) {
    const quiet = dots.filter((d) => !d.here); // guests who are here stand apart from the constellation
    for (const a of quiet) {
      let best = null, bd = S * 0.11;
      for (const b of quiet) {
        const dd = Math.hypot(a.x - b.x, a.y - b.y);
        if (b !== a && dd < bd) { bd = dd; best = b; }
      }
      if (best) links.push({ pts: [a.x, a.y, best.x, best.y], alpha: 0.18 * starsA, dotted: true });
    }
  }

  const sparks = [];
  const labels = [];
  // Each guest's star has its own kind and its own twinkle; it gains rays and a halo with visits.
  const STAR_KINDS = ['sparkle', 'cross', 'six', 'ring', 'double', 'halo'];
  const ray = (x, y, dx, dy, d0, l, A, thin, out) => {
    out.push({ pts: [x + dx * d0, y + dy * d0, x + dx * (d0 + (l - d0) * 0.45), y + dy * (d0 + (l - d0) * 0.45)], alpha: 0.95 * A, weight: 1.5, accent: 'here' });
    out.push({ pts: [x + dx * d0, y + dy * d0, x + dx * l, y + dy * l], alpha: 0.9 * A, weight: thin, accent: 'here' });
  };
  const ellipse = (x, y, rx, ry, rot, n = 28) => {
    const pts = [];
    for (let q = 0; q <= n; q++) { const a = (q / n) * TAU; pts.push(x + rx * Math.cos(a) * Math.cos(rot) - ry * Math.sin(a) * Math.sin(rot), y + rx * Math.cos(a) * Math.sin(rot) + ry * Math.sin(a) * Math.cos(rot)); }
    return pts;
  };
  for (const d of dots) {
    const A = d.lift ? d.lift.a : starsA;
    const visits = d.v.visits ?? 1;
    const regular = 1 + 0.22 * Math.min(4, Math.max(0, visits - 1));
    const settle = d.dep != null ? ease(d.dep) : d.here ? 0 : 1; // 0 shining … 1 a quiet star
    if (settle > 0 && !d.gone) {
      circles.push({ x: d.x, y: d.y, r: Math.max(1, S * 0.0022) * regular, fill: true, alpha: (o.welcome ? 0.35 : 0.75) * A * settle, accent: 'visitor' });
      if (visits >= 4 && !o.print) { // regulars keep a faint glint even when they're away
        const gl = S * 0.006 * (1 + 0.3 * Math.sin(t * (0.6 + hash(d.h, 52, 7)) + d.h));
        for (const [dx, dy] of [[1, 0], [0, 1]]) sparks.push({ pts: [d.x - dx * gl, d.y - dy * gl, d.x + dx * gl, d.y + dy * gl], alpha: 0.35 * A * settle, weight: 0.7, accent: 'visitor' });
      }
    }
    if (settle >= 1) continue;
    const glow = (1 - settle) * A;
    const kind = STAR_KINDS[Math.floor(hash(d.h, 51, 7) * STAR_KINDS.length)];
    // Twinkling is the air: stronger in wind and low over the horizon, where the light crosses more of it.
    const lowness = clamp(1 - (horizon - d.y) / Math.max(1, horizon - H * 0.1), 0, 1);
    const pace = (0.8 + 1.6 * hash(d.h, 53, 7)) * (1 + 1.5 * wN), depth = (0.08 + 0.1 * hash(d.h, 54, 7)) * (1 + 1.2 * wN + 0.8 * lowness);
    const tw = o.print ? 1 : 1 + depth * Math.sin(t * pace + (d.h % 628) / 100);
    const grow = 1 - Math.pow(1 - d.reveal, 3), lg = d.lift ? d.lift.grow : 1;
    const L = (d.hero ? S * 0.05 * grow : S * 0.027) * tw * (d.hero ? 1 : regular * 0.85) * (0.4 + 0.6 * (1 - settle)) * lg;
    const d0 = S * (d.hero ? 0.009 : 0.006) * lg, core = S * (d.hero ? 0.0062 : 0.0045) * (0.5 + 0.5 * lg);
    // Climbing from its boat at dusk: a fading thread of light behind it.
    if (d.lift) for (const tr of d.lift.trail) sparks.push({ pts: tr.pts, alpha: tr.alpha * glow, weight: 1.1, accent: 'here' });
    const thin = o.print ? 1 : 0.8;
    const spin = (live ? t * 0.03 * (hash(d.h, 55, 7) - 0.5) : 0) + hash(d.h, 56, 7) * 0.3;
    const at = (k, n) => [Math.cos(spin + (k * TAU) / n), Math.sin(spin + (k * TAU) / n)];
    if (kind === 'sparkle') {
      for (let k = 0; k < 4; k++) { const [dx, dy] = at(k, 4); ray(d.x, d.y, dx, dy, d0, L, glow, thin, sparks); }
      for (let k = 0; k < 4; k++) { const [dx, dy] = at(k + 0.5, 4); ray(d.x, d.y, dx, dy, d0, Math.max(d0 * 1.2, L * 0.42), glow, thin, sparks); }
    } else if (kind === 'cross') {
      // Diffraction spikes: long and fine, like a bright star in a telescope.
      for (let k = 0; k < 4; k++) { const [dx, dy] = at(k, 4); sparks.push({ pts: [d.x + dx * d0 * 0.6, d.y + dy * d0 * 0.6, d.x + dx * L * 1.5, d.y + dy * L * 1.5], alpha: 0.9 * glow, weight: thin * 0.9, accent: 'here' }); }
      for (let k = 0; k < 4; k++) { const [dx, dy] = at(k + 0.5, 4); sparks.push({ pts: [d.x + dx * d0 * 0.6, d.y + dy * d0 * 0.6, d.x + dx * L * 0.3, d.y + dy * L * 0.3], alpha: 0.6 * glow, weight: thin, accent: 'here' }); }
    } else if (kind === 'six') {
      for (let k = 0; k < 6; k++) { const [dx, dy] = at(k, 6); ray(d.x, d.y, dx, dy, d0, Math.max(d0 * 1.2, L * (k % 2 ? 0.62 : 1)), glow, thin, sparks); }
    } else if (kind === 'ring') {
      // A small world with a ring, slowly turning.
      for (let k = 0; k < 4; k++) { const [dx, dy] = at(k + 0.5, 4); ray(d.x, d.y, dx, dy, d0, Math.max(d0 * 1.2, L * 0.55), glow, thin, sparks); }
      sparks.push({ pts: ellipse(d.x, d.y, L * 0.8, L * 0.26, 0.35 + spin * 2), alpha: 0.75 * glow, weight: thin, accent: 'here' });
    } else if (kind === 'double') {
      // A pair circling each other.
      const ob = S * 0.007, oa = (live ? t * 0.35 : 0) + hash(d.h, 57, 7) * TAU;
      for (const sgn of [1, -1]) {
        const cx = d.x + sgn * ob * Math.cos(oa), cy = d.y + sgn * ob * 0.6 * Math.sin(oa);
        for (let k = 0; k < 4; k++) { const [dx, dy] = at(k, 4); ray(cx, cy, dx, dy, d0 * 0.6, Math.max(d0, L * 0.55), glow, thin, sparks); }
        circles.push({ x: cx, y: cy, r: core * 0.75, fill: true, alpha: glow, accent: 'here' });
      }
    } else {
      // Halo: rings breathing out from it.
      for (let k = 0; k < 4; k++) { const [dx, dy] = at(k, 4); ray(d.x, d.y, dx, dy, d0, Math.max(d0 * 1.2, L * 0.7), glow, thin, sparks); }
      for (let i = 0; i < 2; i++) {
        const ph = live ? (t * 0.12 * pace + i / 2) % 1 : 0.4 + 0.3 * i;
        circles.push({ x: d.x, y: d.y, r: S * (0.008 + 0.026 * ph), fill: false, alpha: 0.6 * (1 - ph) * glow, accent: 'here' });
      }
    }
    // Regulars grow: hairline rays at three visits, a steady halo at six.
    if (visits >= 3 && kind !== 'sparkle') for (let k = 0; k < 4; k++) { const [dx, dy] = at(k + 0.25, 4); sparks.push({ pts: [d.x + dx * d0, d.y + dy * d0, d.x + dx * L * 0.5, d.y + dy * L * 0.5], alpha: 0.5 * glow, weight: thin * 0.8, accent: 'here' }); }
    if (visits >= 6) circles.push({ x: d.x, y: d.y, r: L * 0.95, fill: false, alpha: 0.22 * glow, accent: 'here' });
    if (kind !== 'double') circles.push({ x: d.x, y: d.y, r: core, fill: true, alpha: glow, accent: 'here' });
    if (kind === 'sparkle') circles.push({ x: d.x, y: d.y, r: S * (d.hero ? 0.017 + 0.004 * Math.sin(t * 0.9) * (live ? 1 : 0) : 0.0115), fill: false, alpha: (d.hero ? 0.55 : 0.4) * glow, accent: 'here' });
    if (d.v.name && !o.welcome && !byDay) { d.fade = (1 - settle) * (d.lift ? 0.5 + 0.5 * d.lift.arrived : 1); labels.push(d); } // during a welcome, the arrivals have the stage
  }

  // Boats: each guest has their own kind (sloop, catamaran, lateen falucho, schooner, gaff cutter) and
  // pennant; the mainsail changes each visit (stripes, their visit number, an emblem or plain). Guests
  // who are here sail gold; past guests are small white sails far out. Farther boats are drawn first.
  const BOAT_KINDS = ['sloop', 'cat', 'lateen', 'schooner', 'gaff'];
  const below = (pts, yMax) => { // keep only what is above a line (a boat going hull-down)
    const out = [];
    for (let q = 0; q < pts.length; q += 2) {
      const x1 = pts[q], y1 = pts[q + 1], x2 = pts[(q + 2) % pts.length], y2 = pts[(q + 3) % pts.length];
      if (y1 <= yMax) out.push(x1, y1);
      if ((y1 <= yMax) !== (y2 <= yMax)) { const f = (yMax - y1) / (y2 - y1); out.push(x1 + (x2 - x1) * f, yMax); }
    }
    return out;
  };
  boats.sort((p, q) => p.sd - q.sd);
  for (const b of boats) {
    const z = b.size, f = b.fwd;
    const A = sailsA * b.fade;
    if (A <= 0.01) continue;
    const gold = 1 - b.ghost; // gold for guests who are here, paper white for those who have been
    const kind = BOAT_KINDS[Math.floor(hash(b.h, 31, 7) * BOAT_KINDS.length)];
    const deco = Math.floor(hash(b.h * 31 + (b.v.visits ?? 1), 33, 7) * 4);
    // Physics of the water: the hull lies along the slope of the wave beneath it (pitching as swells
    // pass), heels with the wind, and rolls a little in time with the real wave period.
    const slope = Math.atan2(waterY(b.sd, b.x + z * 0.45) - waterY(b.sd, b.x - z * 0.45), z * 0.9);
    const roll = live ? Math.sin((t * TAU) / T + (b.h % 97)) * 0.04 * (0.3 + hN) : 0;
    const ang = clamp(slope * 0.85, -0.45, 0.45) + clamp(wN * 0.22, 0, 0.3) * wdir + roll;
    const cs = Math.cos(ang), sn = Math.sin(ang);
    const X = b.x, Y = b.wy + b.sink * z * 1.1;
    const P = (dx, dy) => [X + dx * f * z * cs - dy * z * sn, Y + dx * f * z * sn + dy * z * cs]; // dx forward, dy up (negative), in boat lengths
    const cut = b.sink > 0 ? b.wy : Infinity;
    const shape = (pts, accent, alpha) => { const q = cut < Infinity ? below(pts, cut) : pts; if (q.length >= 6 && alpha > 0.005) shapes.push({ pts: q, alpha, accent }); };
    const mark = (pts, alpha, weight, accent = 'here') => {
      if (alpha <= 0.005) return;
      if (cut === Infinity) return marks.push({ pts, alpha, weight, accent });
      let seg = [];
      for (let q = 0; q < pts.length; q += 2) {
        if (pts[q + 1] <= cut) seg.push(pts[q], pts[q + 1]);
        else { if (seg.length >= 4) marks.push({ pts: seg, alpha, weight, accent }); seg = []; }
      }
      if (seg.length >= 4) marks.push({ pts: seg, alpha, weight, accent });
    };
    // A sail: gold while they're here, outlined paper when they've been.
    const sail = (pts) => {
      shape(pts, 'here', A * gold);
      if (gold < 1) { shape(pts, 'bg', A * (1 - gold)); mark([...pts, pts[0], pts[1]], 0.7 * A * (1 - gold), 0.8, null); }
    };
    const ink = (pts, alpha, weight) => { mark(pts, alpha * gold, weight); if (gold < 1) mark(pts, alpha * (1 - gold) * 0.75, weight * 0.9, null); };
    const hoist = b.hoist, boom = -0.13;
    const long = kind === 'schooner' ? 1.18 : 1;
    const wakeA = clamp((b.speed - 0.15) / 0.35, 0, 1) * 0.4 * A * (b.ghost ? 0.5 : 1);
    if (live && wakeA > 0.01 && !b.sink) {
      // Wake: two lines opening out behind the stern, fading in and out with speed.
      const Lw = z * (0.6 + 1.8 * b.speed), sx = X - f * 0.5 * z * long;
      for (const side of [-1, 1]) mark([sx, Y + z * 0.02, sx - f * Lw, Y + z * 0.02 + side * Lw * 0.14], wakeA, 0.7, null);
    }
    // Hull (two for a catamaran): a paper silhouette so the sea doesn't show through, then its line.
    const hulls = kind === 'cat' ? [[0, -0.07, 0.55], [0, 0, 1]] : [[0, 0, 1]];
    for (const [hx, hy, ha] of hulls) {
      shape([...P(-0.56 * long, -0.13 + hy), ...P(0.6 * long, -0.13 + hy), ...P(0.44 * long, 0.02 + hy), ...P(-0.46 * long, 0.02 + hy)], 'bg', A);
      ink([...P(-0.46 * long, hy), ...P(-0.56 * long, -0.09 + hy), ...P(-0.56 * long, -0.13 + hy)], A * ha, 1.1);
      ink([...P(-0.46 * long, hy), ...P(0.44 * long, hy), ...P(0.6 * long, -0.11 + hy)], A * ha, 1.4);
    }
    if (kind === 'cat') ink([...P(0.12, -0.13), ...P(0.12, -0.2), ...P(-0.3, -0.2), ...P(-0.3, -0.13)], A * 0.8, 0.9);
    // Rig and sails.
    let mastTop = boom - 0.94 * hoist, main = null, mainLeech = null;
    if (kind === 'lateen') {
      // Falucho: a short mast and a long slanting yard with a triangular sail beneath it.
      mastTop = boom - 0.6;
      const tack = [0.46, boom + 0.02], peak = [-0.58, boom - 1.0 * hoist], clew = [-0.4, boom];
      ink([...P(0, 0.02), ...P(0, mastTop)], A, 1.1);
      if (hoist > 0.03) {
        const pts = [...P(...tack)];
        for (let q = 1; q <= 8; q++) { const u = q / 8; pts.push(...P(tack[0] + (peak[0] - tack[0]) * u, tack[1] + (peak[1] - tack[1]) * u - 0.05 * Math.sin(Math.PI * u))); }
        pts.push(...P(...clew));
        sail(pts);
        ink([...P(tack[0] + 0.06, tack[1] + 0.04), ...P(peak[0] - 0.04, peak[1] - 0.03)], A, 1.2);
      }
    } else {
      const masts = kind === 'schooner' ? [[0.22, 0.72], [-0.12, 1]] : [[0, 1]];
      for (const [mxp, mh] of masts) ink([...P(mxp, 0.02), ...P(mxp, boom - (0.94 * mh) * Math.max(hoist, 0.55))], A, 1.1);
      mastTop = boom - 0.94 * Math.max(hoist, 0.55) + 0;
      if (hoist > 0.03) {
        const luff = kind === 'schooner' ? -0.14 : -0.02, wide = kind === 'cat' ? 0.56 : kind === 'schooner' ? 0.46 : 0.5;
        const head = boom - 0.88 * hoist;
        if (kind === 'gaff') {
          // Four-sided mainsail under an angled gaff.
          const throat = [luff, boom - 0.62 * hoist], peak = [luff - 0.44, boom - 0.95 * hoist];
          main = [...P(luff, boom), ...P(...throat), ...P(...peak), ...P(luff - 0.52, boom)];
          ink([...P(...throat), ...P(peak[0] - 0.03, peak[1] - 0.02)], A, 1.1);
          mainLeech = (u) => [luff - 0.52 + 0.08 * u, boom + (peak[1] - boom) * u];
        } else {
          main = [...P(luff, head), ...P(luff, boom)];
          for (let q = 0; q <= 8; q++) { const u = q / 8; main.push(...P(luff - (wide * (1 - u) + 0.02 * u + 0.07 * Math.sin(Math.PI * u)), boom + (head - boom) * u)); }
          mainLeech = (u) => [luff - (wide * (1 - u) + 0.02 * u + 0.07 * Math.sin(Math.PI * u)), boom + (head - boom) * u];
        }
        sail(main);
        if (kind === 'schooner') { // the foresail between the masts
          const fh = boom - 0.64 * hoist;
          sail([...P(0.2, fh), ...P(0.2, boom), ...P(-0.08, boom)]);
        }
        const jibFoot = kind === 'schooner' ? 0.66 : kind === 'gaff' ? 0.38 : 0.42;
        const jibHead = kind === 'schooner' ? [0.24, boom - 0.66 * hoist] : [0.02, boom - 0.74 * hoist];
        const jib = [...P(...jibHead), ...P(jibFoot, boom), ...P(jibHead[0] + 0.01, boom)];
        shape(jib, 'bg', A);
        mark([...jib, jib[0], jib[1]], 0.9 * A * gold, 0.9);
        if (gold < 1) mark([...jib, jib[0], jib[1]], 0.7 * A * (1 - gold), 0.8, null);
        // This visit's mark on the mainsail.
        if (mainLeech && gold > 0.5 && z > S * 0.03) {
          const across = (u) => { const [lx, ly] = mainLeech(u); return [...P(luff - 0.03, ly), ...P(lx + 0.04, ly)]; };
          if (deco === 1) { for (const u of [0.3, 0.48]) mark(across(u), A * gold, 1.6, 'bg'); }
          else if (deco === 2 && !o.welcome) {
            const [lx, ly] = mainLeech(0.28), [cx, cy] = P((luff + lx) / 2, ly);
            texts.push({ text: String(b.v.visits ?? 1), x: cx, y: cy, size: z * 0.13, align: 'center', alpha: A * gold, accent: 'bg', role: 'sailno' });
          } else if (deco === 3) {
            const [lx, ly] = mainLeech(0.42), [cx, cy] = P((luff + lx) / 2, ly);
            circles.push({ x: cx, y: cy, r: z * 0.05, fill: true, alpha: A * gold, accent: 'bg' });
          }
        }
      }
    }
    // A pennant at the masthead, streaming downwind (whichever way the boat is heading).
    if (hoist > 0.5) {
      const [px, py] = P(kind === 'schooner' ? -0.12 : 0, mastTop - 0.02);
      const flap = live ? Math.sin(t * (5 + 3 * hash(b.h, 34, 7)) + b.h) * z * 0.03 : 0, len = z * (0.16 + 0.08 * hash(b.h, 35, 7));
      const swallow = hash(b.h, 36, 7) < 0.4;
      const flag = swallow
        ? [px, py, px + wdir * len, py + z * 0.02 + flap, px + wdir * len * 0.65, py + z * 0.045 + flap * 0.6, px + wdir * len, py + z * 0.07 + flap, px, py + z * 0.08]
        : [px, py, px + wdir * len, py + z * 0.04 + flap, px, py + z * 0.08];
      shape(flag, gold > 0.5 ? 'fg' : 'bg', A * (gold > 0.5 ? 0.85 : 0.9));
      if (gold <= 0.5) mark([...flag, flag[0], flag[1]], 0.6 * A, 0.7, null);
    }
    if (!b.leaving && !b.ghost) {
      mark([X - 0.36 * z, Y + 0.12 * z, X + 0.3 * z, Y + 0.12 * z], 0.5 * A, 0.8);
      mark([X - 0.2 * z, Y + 0.24 * z, X + 0.14 * z, Y + 0.24 * z], 0.3 * A, 0.8);
    }
    if (b.v.name && !o.welcome && byDay && hoist > 0.9 && b.labelFade > 0.02) labels.push({ x: X, y: Y - z * 0.55, hx: b.hx, hy: b.hy, h: b.h, v: b.v, r0: z * 0.72 + cap * 0.3, sail: true, fade: b.labelFade });
  }

  // Gulls by day, a few, gliding across with the wind (none in rain or under a grey sky).
  const gulls = [];
  if (sailsA > 0.01 && rain <= 0.05 && cover < 0.85) {
    const n = 2 + Math.floor(hash(ed.day, 71, 3) * 3);
    for (let k = 0; k < n; k++) {
      const w = S * (0.007 + 0.006 * hash(k, 72, seed));
      const x = mx + ((((hash(k, 73, seed) * fw + (o.print ? 0 : t * S * (0.004 + 0.004 * hash(k, 74, seed)) * wdir)) % fw) + fw) % fw);
      const y = sky.y0 + skyH * (0.1 + 0.75 * hash(k, 75, seed)) + (o.print ? 0 : Math.sin(t * 0.4 + k) * S * 0.006);
      if ((sunMark && Math.hypot(x - sunMark.x, y - sunMark.y) < sunMark.r * 3) || inBlock({ x, y })) continue;
      const flap = o.print ? 0 : 0.22 * Math.sin(t * (1.1 + hash(k, 76, seed)) + k * 2);
      const wing = (sg) => { const out = []; for (let q = 0; q <= 6; q++) { const u = q / 6; out.push([x + sg * w * u, y - w * (0.5 * Math.sin(Math.PI * Math.min(1, u * 1.1)) + flap * u)]); } return out; };
      gulls.push({ pts: [...wing(-1).reverse(), ...wing(1).slice(1)].flat(), alpha: (o.print ? 1 : 0.75) * sailsA, weight: o.print ? 1.1 : 0.95 });
    }
  }

  // Names float around their stars (and over their sails): each curves along a small circle and sways
  // at its own pace (its own speed, direction and starting point, new every day). Kept clear of the
  // words, the sun and moon, other guests and each other; on e-ink they sit still where they fit best.
  const box = (x, y, r, owner) => ({ x0: x - r, x1: x + r, y0: y - r, y1: y + r, owner });
  const placed = block ? [block] : [];
  if (o.captions !== false) placed.push({ x0: 0, x1: W, y0: 0, y1: H * 0.075 + cap * (W < H * 1.3 ? 2.6 : 0.8) }); // the title and edition
  if (sunMark) placed.push(box(sunMark.x, sunMark.y, sunMark.r * 1.6));
  if (moonMark) placed.push(box(moonMark.x, moonMark.y, moonMark.r * 1.5));
  // Placement is decided where each guest belongs (so names don't hop as everyone drifts) and drawn
  // where they are now.
  if (!byDay) for (const d of dots) placed.push(box(d.hx ?? d.x, d.hy ?? d.y, S * (d.hero ? 0.05 : d.here ? 0.026 : 0.007), d));
  for (const d of labels) if (d.sail) placed.push(box(d.hx ?? d.x, d.hy ?? d.y, d.r0 * 0.75, d));
  const arcBox = (x, y, r, a, span, size) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let k = 0; k <= 6; k++) {
      const p = a - span / 2 + (span * k) / 6;
      for (const rr of [r - size * 0.3, r + size * 1.4]) {
        const px = x + rr * Math.cos(p), py = y + rr * Math.sin(p);
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
    }
    return { x0, x1, y0, y1 };
  };
  for (const d of labels) {
    const hit = (b) => placed.some((p) => p.owner !== d && b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0);
    const size = cap * 0.95, w = textW(d.v.name, size);
    const u = (k) => hash(d.h, k, ed.day + 401); // this guest's own motion, new every day
    const start = -Math.PI / 2 + (u(2) - 0.5) * (d.sail ? 0.3 : 0.5);
    const angles = d.sail ? [0, -0.35, 0.35] : [0, -0.45, 0.45, -0.8, 0.8, Math.PI, Math.PI - 0.45, Math.PI + 0.45]; // over or under, never the sides
    // On its own ring first; if the sky is crowded there, a wider one.
    let r0 = 0, span = 0, a0;
    for (const ring of [1, 1.6]) {
      r0 = (d.r0 ?? S * (0.03 + 0.008 * u(1))) * ring;
      span = Math.min(Math.PI * 1.2, w / r0);
      a0 = angles.map((da) => start + da).find((a) => { const b = arcBox(d.hx ?? d.x, d.hy ?? d.y, r0, a, span, size); return b.x0 > mx * 0.5 && b.x1 < W - mx * 0.5 && !hit(b); });
      if (a0 !== undefined) break;
    }
    if (a0 === undefined) continue;
    placed.push(arcBox(d.hx ?? d.x, d.hy ?? d.y, r0, a0, span, size));
    const sway = o.print ? 0 : (d.sail ? 0.12 : 0.3) * Math.sin(t * (0.05 + 0.07 * u(3)) * (u(4) < 0.5 ? -1 : 1) + u(5) * TAU);
    const a = a0 + sway;
    texts.push({ text: d.v.name, arc: { x: d.x, y: d.y, r: r0, a }, size, italic: true, alpha: 0.95 * (d.fade ?? 1), accent: 'here', role: 'label' });
    if (!o.print) texts.push({ text: 'aquí · here', arc: { x: d.x, y: d.y, r: r0 + size * 1.35, a }, size: size * 0.58, alpha: 0.55 * (d.fade ?? 1), accent: 'here', role: 'label-sub' });
  }

  // Reflections: a column of glints on the water straight below a light, spreading toward the
  // viewer. A welcomed star's is drawn in as it arrives; the moon's follows its brightness.
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
  if (!byDay) for (const d of dots.filter((x) => x.hero).slice(0, 3)) glints.push(...column(d.x, d.reveal, starsA, 'here', hashString(String(d.v.id)) % 97));
  // Guests who are here: their star's light lies faintly on the water too, broken up by the waves.
  if (!byDay && dark) for (const d of dots.filter((x) => x.here && !x.hero && x.dep == null).slice(0, 8)) glints.push(...column(d.x, 0.45, 0.3 * starsA, 'here', hashString(String(d.v.id)) % 89).map((g) => ({ ...g, alpha: 0.55, weight: g.weight * 0.6 })));

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

  // The clearing: the sea parts around a group's welcome.
  const sea = clearing ? cutOut([...lines, ...glints, ...ripples], clearing) : [...lines, ...glints, ...ripples];

  return {
    width: W, height: H, dark, horizon, edition: { n: ed.n, style, label: ed.label, palette: ed.palette.name },
    palette: { ...pal, visitor: pal.fg, sun: pal.fg, moon: pal.fg },
    // Clouds and rain part around the welcome words.
    lines: [...(block ? cutOut(weather, { x0: block.x0 - S * 0.02, x1: block.x1 + S * 0.02, y0: block.y0 - S * 0.01, y1: block.y1 + S * 0.01 }) : weather), ...gulls, ...links, ...sea, ...sparks],
    shapes, marks, circles, texts, byDay,
    hero: heroAt[0] ?? null, heroes: heroAt,
    sun: sunMark && { x: sunMark.x, y: sunMark.y, r: sunMark.r },
    moon: moonMark && { x: moonMark.x, y: moonMark.y, r: moonMark.r },
    margin: mx,
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

/** Whether guests show as sails (true) or stars at this sun altitude (where the two cross at dusk). */
export const sailing = (altitude) => altitude > -1.25;

/**
 * The personal line under a guest's name: which visit this is and how long it has been, or, the
 * first time, that their sail (by day) or star (by night) is new and which wind brought them.
 */
export function welcomeLine(w, c = {}, lang = 'es', day = false) {
  const es = lang === 'es';
  const n = w.visits ?? 1;
  const wn = windName(c.windSpeed ?? 0, c.windDirection ?? 0);
  const wind = !wn ? null : wn === 'calma' ? (es ? 'mar en calma' : 'a calm sea') : es ? `llegas con ${wn}` : `arriving with the ${wn}`;
  if (n <= 1) {
    const yours = day ? (es ? 'tu vela en la bahía, desde hoy' : 'your sail on the bay, from today') : es ? 'tu estrella, desde hoy' : 'your star, from today';
    return [yours, wind].filter(Boolean).join(' · ');
  }
  const ord = ORD[es ? 'es' : 'en'][n - 1];
  const visit = ord ? `${ord} ${es ? 'visita' : 'visit'}` : es ? `visita ${n}` : `visit ${n}`;
  const back = day ? (es ? 'tu vela vuelve a la bahía' : 'your sail is back on the bay') : es ? 'tu estrella vuelve a brillar' : 'your star shines again';
  const since = w.since ? (es ? `la anterior, ${ago(w.since, true)}` : `the last one ${ago(w.since, false)}`) : back;
  return [visit, since].filter(Boolean).join(' · ');
}

/** The classic palette (Cal), for anything drawn without a composition. */
const COUNT = {
  es: ['una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez'],
  en: ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'],
};

/**
 * Everything the welcome says, in Spanish with English beneath. One guest: their name and their
 * own line. Several arriving together: all their names, and how many sails (by day) or stars (by
 * night) are new or returning.
 */
export function welcomeText(w, c = {}, day = false) {
  const group = w.group?.length > 1 ? w.group : null;
  if (!group) {
    const back = (w.visits ?? 1) > 1 || w.greeting === 'Hola de nuevo';
    return {
      greeting: w.greeting ?? 'Bienvenido', greetingEn: back ? 'Welcome back' : 'Welcome',
      title: w.name, line: welcomeLine(w, c, 'es', day), lineEn: welcomeLine(w, c, 'en', day),
    };
  }
  const names = group.map((g) => g.name);
  const title = names.length <= 5 ? names.join(' · ') : `${names.slice(0, 4).join(' · ')} · +${names.length - 4}`;
  const fresh = group.filter((g) => (g.visits ?? 1) <= 1).length, back = group.length - fresh;
  const n = (k, lang) => (k <= 10 ? COUNT[lang][k - 1] : String(k));
  const [one, many, oneEn] = day ? ['vela nueva', 'velas nuevas', 'sail'] : ['estrella nueva', 'estrellas nuevas', 'star'];
  const es = [fresh && `${n(fresh, 'es')} ${fresh === 1 ? one : many}`, back && `${n(back, 'es')} ${back === 1 ? 'que vuelve' : 'que vuelven'}`];
  const en = [fresh && `${n(fresh, 'en')} new ${oneEn}${fresh === 1 ? '' : 's'}`, back && `${n(back, 'en')} returning`];
  return {
    greeting: 'Bienvenidos', greetingEn: 'Welcome, everyone', title,
    line: es.filter(Boolean).join(' · '), lineEn: en.filter(Boolean).join(' · '),
  };
}

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
  out.push(`<g fill="none" stroke-linecap="round" stroke-linejoin="round">`);
  for (const l of comp.marks ?? []) out.push(`<path d="${pathOf(l.pts)}" stroke="${col(l.accent)}" stroke-width="${(sw * (l.weight ?? 1)).toFixed(2)}" opacity="${l.alpha.toFixed(2)}"/>`);
  out.push('</g>');
  for (const c of comp.circles) {
    out.push(`<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${c.r.toFixed(1)}" opacity="${c.alpha}" ${c.fill ? `fill="${col(c.accent)}"` : `fill="none" stroke="${col(c.accent)}" stroke-width="${sw}"`}/>`);
  }
  for (const t of comp.texts) {
    if (t.arc) {
      // Names around their stars, letter by letter (widths estimated; SVG is the no-script view).
      const chars = [...t.text], cw = t.size * 0.93, { x, y, r, a } = t.arc;
      const over = Math.sin(a) <= 0.25, rr = over ? r : r + t.size, span = (chars.length * cw) / rr;
      chars.forEach((ch, i) => {
        const phi = over ? a - span / 2 + ((i + 0.5) * cw) / rr : a + span / 2 - ((i + 0.5) * cw) / rr;
        const deg = ((over ? phi + Math.PI / 2 : phi - Math.PI / 2) * 180) / Math.PI;
        out.push(`<text transform="translate(${(x + rr * Math.cos(phi)).toFixed(1)} ${(y + rr * Math.sin(phi)).toFixed(1)}) rotate(${deg.toFixed(1)})" font-size="${(t.size * 1.5).toFixed(1)}" text-anchor="middle" fill="${col(t.accent)}" opacity="${t.alpha}" font-family="'Cormorant Garamond', Georgia, serif"${t.italic ? ' font-style="italic"' : ''}>${esc(ch)}</text>`);
      });
      continue;
    }
    out.push(`<text x="${t.x.toFixed(1)}" y="${t.y.toFixed(1)}" font-size="${(t.size * 1.5).toFixed(1)}" text-anchor="${{ left: 'start', center: 'middle', right: 'end' }[t.align]}" fill="${col(t.accent)}" opacity="${t.alpha}" font-family="'Cormorant Garamond', Georgia, serif"${t.italic ? ' font-style="italic"' : ''} letter-spacing="0.04em">${esc(t.text)}</text>`);
  }
  out.push('</svg>');
  return out.join('');
}
