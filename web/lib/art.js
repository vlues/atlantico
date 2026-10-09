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
 * @param {object} o width, height, dark, time (s, for drift), seed, print (bitmap), captions (default true),
 *   visitors [{id, visits, here, name}], hero (id of the star being welcomed), reveal (0..1, its entrance),
 *   welcome {name, greeting, visits, since}
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
    const flush = () => { if (cur.length >= 4) lines.push({ pts: cur, alpha: 0.45 + 0.55 * Math.min(1, s * 3), row: s }); cur = []; };
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

  // Visitors: one star each, placed deterministically in the sky by id. Regulars burn a little
  // brighter; guests who are here right now sparkle and carry their name.
  const reveal = clamp(o.reveal ?? 1, 0, 1);
  const grow = 1 - Math.pow(1 - reveal, 3);
  const sky = { x0: mx, x1: W - mx, y0: H * 0.1, y1: horizon - S * 0.05 };
  const stars = [];
  let heroAt = null; // where the welcomed star is, even before it has appeared (screens animate toward it)
  for (const v of o.visitors ?? []) {
    const h = hashString(String(v.id));
    const px = sky.x0 + (sky.x1 - sky.x0) * hash(h, 1, 11);
    const py = sky.y0 + (sky.y1 - sky.y0) * Math.pow(hash(h, 2, 13), 0.8);
    if (sunMark && Math.hypot(px - sunMark.x, py - sunMark.y) < sunMark.r * 2.5) continue;
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

  // The welcomed star's reflection: a column of glints on the water straight below it,
  // spreading toward the viewer, drawn in as the star arrives.
  const glints = [];
  if (hero) {
    const shimmer = o.print ? 0 : Math.floor(t * 2.5);
    for (let k = 0; k < lines.length; k++) {
      const l = lines[k];
      if (l.row > reveal * 1.05) continue;
      if (hash(k, 5, seed + shimmer) > 0.82 - 0.25 * l.row) continue;
      const half = S * (0.004 + 0.022 * l.row) * (0.45 + hash(k, 6, seed + shimmer));
      const pts = [];
      for (let q = 0; q < l.pts.length; q += 2) if (Math.abs(l.pts[q] - hero.x) <= half) pts.push(l.pts[q], l.pts[q + 1]);
      // On a one-colour panel the glints can only differ from the sea by weight, so they are bolder.
      if (pts.length >= 4) glints.push({ pts, alpha: 1, weight: (o.print ? 3.6 : 2.2) - l.row, accent: 'here' });
    }
  }

  if (o.captions !== false) {
    texts.unshift({ text: 'Atlántico', x: mx, y: H * 0.075, size: cap * 1.25, align: 'left', italic: false, alpha: 0.9 });
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
  }

  return {
    width: W, height: H, dark, lines: [...links, ...lines, ...glints, ...sparks], circles, texts, horizon,
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

export const PALETTE = {
  light: { bg: '#f2f0eb', fg: '#141414', sun: '#141414', visitor: '#141414', here: '#8a6524' },
  dark: { bg: '#0a0a0b', fg: '#e9e6df', sun: '#e9e6df', visitor: '#e9e6df', here: '#e2bf7e' },
};

const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

/** SVG string — used by the Worker's live view. */
export function toSVG(comp) {
  const p = comp.dark ? PALETTE.dark : PALETTE.light;
  const sw = Math.max(0.6, Math.min(comp.width, comp.height) / 1000);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${comp.width} ${comp.height}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`,
    `<rect width="100%" height="100%" fill="${p.bg}"/>`, `<g fill="none" stroke="${p.fg}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">`];
  const col = (a) => (a && p[a]) || p.fg;
  for (const l of comp.lines) {
    let d = `M${l.pts[0].toFixed(1)} ${l.pts[1].toFixed(1)}`;
    for (let k = 2; k < l.pts.length; k += 2) d += `L${l.pts[k].toFixed(1)} ${l.pts[k + 1].toFixed(1)}`;
    const extra = (l.accent ? ` stroke="${col(l.accent)}"` : '') + (l.weight ? ` stroke-width="${(sw * l.weight).toFixed(2)}"` : '');
    out.push(`<path d="${d}" opacity="${l.alpha.toFixed(2)}"${extra}${l.dotted ? ` stroke-dasharray="1 ${sw * 4}"` : ''}/>`);
  }
  out.push('</g>');
  for (const c of comp.circles) {
    out.push(`<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${c.r.toFixed(1)}" opacity="${c.alpha}" ${c.fill ? `fill="${col(c.accent)}"` : `fill="none" stroke="${col(c.accent)}" stroke-width="${sw}"`}/>`);
  }
  for (const t of comp.texts) {
    out.push(`<text x="${t.x.toFixed(1)}" y="${t.y.toFixed(1)}" font-size="${(t.size * 1.5).toFixed(1)}" text-anchor="${{ left: 'start', center: 'middle', right: 'end' }[t.align]}" fill="${col(t.accent)}" opacity="${t.alpha}" font-family="'Cormorant Garamond', Georgia, serif"${t.italic ? ' font-style="italic"' : ''} letter-spacing="0.04em">${esc(t.text)}</text>`);
  }
  out.push('</svg>');
  return out.join('');
}
