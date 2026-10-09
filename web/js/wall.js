// Live wall piece: fetches state from the Worker and draws the composition on a canvas,
// redrawn slowly so the lines drift. Light/dark and welcome changes crossfade.
import { compose, PALETTE } from '../lib/art.js';
import { sunPosition } from '../lib/sun.js';

const API = window.ATLANTICO?.api ?? '';
const params = new URLSearchParams(location.search);
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');

let state = null;
let shown = { dark: null, welcome: null, at: 0, prev: null };
const FADE_MS = 3000;

async function refresh() {
  try {
    const q = params.get('scenario') ? `?scenario=${encodeURIComponent(params.get('scenario'))}` : '';
    const r = await fetch(`${API}/api/wall${q}`, { cache: 'no-store' });
    if (r.ok) state = await r.json();
  } catch { /* keep the last state; the sea doesn't stop */ }
}

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
}

function draw(comp, alpha) {
  const p = comp.dark ? PALETTE.dark : PALETTE.light;
  const sw = Math.max(0.7, Math.min(comp.width, comp.height) / 1100);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, comp.width, comp.height);
  ctx.strokeStyle = p.fg;
  ctx.fillStyle = p.fg;
  ctx.lineWidth = sw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const l of comp.lines) {
    ctx.globalAlpha = alpha * l.alpha;
    ctx.setLineDash(l.dotted ? [sw, sw * 5] : []);
    ctx.beginPath();
    ctx.moveTo(l.pts[0], l.pts[1]);
    for (let k = 2; k < l.pts.length; k += 2) ctx.lineTo(l.pts[k], l.pts[k + 1]);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const c of comp.circles) {
    ctx.globalAlpha = alpha * c.alpha;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    c.fill ? ctx.fill() : ctx.stroke();
  }
  for (const t of comp.texts) {
    ctx.globalAlpha = alpha * t.alpha;
    ctx.font = `${t.italic ? 'italic ' : ''}300 ${t.size * 1.5}px 'Cormorant Garamond', Georgia, serif`;
    ctx.textAlign = t.align;
    ctx.letterSpacing = `${(t.size * 0.06).toFixed(1)}px`;
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.restore();
}

function compFor(s, dark, welcome, now) {
  const sun = s.simulate && params.get('sun') ? JSON.parse(params.get('sun')) : sunPosition(new Date(now), s.lat, s.lon);
  return compose({ ...s.conditions, sun }, {
    width: canvas.width, height: canvas.height, lat: s.lat, lon: s.lon,
    dark, visitors: s.visitors, welcome, time: now / 1000,
  });
}

let last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (!state || now - last < 33) return;
  last = now;
  const t = Date.now();
  const welcome = state.welcome && state.welcome.until > t ? state.welcome : null;
  const dark = params.get('mode') === 'light' ? false : params.get('mode') === 'dark' ? true : state.dark || !!welcome;
  const key = `${dark}|${welcome?.name ?? ''}`;
  if (shown.key !== key) {
    shown = { key, dark, welcome, at: t, prev: shown.key ? { dark: shown.dark, welcome: shown.welcome } : null };
  }
  const f = Math.min(1, (t - shown.at) / FADE_MS);
  if (shown.prev && f < 1) draw(compFor(state, shown.prev.dark, shown.prev.welcome, t), 1);
  draw(compFor(state, dark, welcome, t), shown.prev ? f * f * (3 - 2 * f) : 1);
}

addEventListener('resize', resize);
resize();
await refresh();
canvas.classList.add('fade-in');
setInterval(refresh, params.get('scenario') ? 60000 : 15000);
requestAnimationFrame(frame);
