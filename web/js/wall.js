// Live wall piece: fetches state from the Worker and draws the composition on a canvas,
// redrawn slowly so the lines drift. Light/dark and welcome changes crossfade.
// A cheap version check every few seconds means an arrival reaches the wall almost at once,
// and a new release of the site reloads the page by itself.
import { compose, hashString } from '../lib/art.js';
import { sunPosition } from '../lib/sun.js';
import { moonPosition } from '../lib/moon.js';
import { paint, arrival, revealAt } from './paint.js';

const API = window.ATLANTICO?.api ?? '';
const params = new URLSearchParams(location.search);
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');

let state = null;
let version = null;
let shown = { key: null, dark: null, welcome: null, at: 0, prev: null };
let visit = null; // the arrival being played: { key, start, until, w }
const FADE_MS = 3000;

async function refresh() {
  try {
    const q = params.get('scenario') ? `?scenario=${encodeURIComponent(params.get('scenario'))}` : '';
    const r = await fetch(`${API}/api/wall${q}`, { cache: 'no-store' });
    if (r.ok) state = await r.json();
  } catch { /* keep the last state; the sea doesn't stop */ }
}

async function poll() {
  try {
    const r = await fetch(`${API}/api/wall/version`, { cache: 'no-store' });
    const v = r.ok ? await r.text() : null;
    if (v && v !== version) { version = v; await refresh(); }
  } catch { /* offline: try again shortly */ }
}

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
}

let moon = { at: 0 };
function compFor(s, dark, welcome, now, e) {
  const sun = s.simulate && params.get('sun') ? JSON.parse(params.get('sun')) : sunPosition(new Date(now), s.lat, s.lon);
  if (now - moon.at > 60000) moon = { at: now, pos: moonPosition(new Date(now), s.lat, s.lon) };
  return compose({ ...s.conditions, sun, moon: moon.pos }, {
    width: canvas.width, height: canvas.height, lat: s.lat, lon: s.lon, date: now, style: params.get('style') ?? s.style,
    dark, visitors: s.visitors, welcome, hero: welcome?.id, reveal: welcome ? revealAt(e) : 1, time: now / 1000,
  });
}

let last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (!state || now - last < 33) return;
  last = now;
  const t = Date.now();

  // Play each arrival once, from the moment this screen hears about it, for at least 22 s.
  const w = state.welcome;
  if (w && w.until > t && visit?.key !== `${w.id}:${w.at}`) visit = { key: `${w.id}:${w.at}`, start: t, until: Math.max(w.until, t + 22000), w };
  const playing = visit && t < visit.until ? visit : null;
  const welcome = playing?.w ?? null;
  const e = playing ? (t - playing.start) / 1000 : null;

  const dark = params.get('mode') === 'light' ? false : params.get('mode') === 'dark' ? true : state.dark || !!welcome;
  const key = `${dark}|${playing?.key ?? ''}`;
  if (shown.key !== key) {
    shown = { key, dark, welcome, e0: playing?.start, at: t, prev: shown.key ? { dark: shown.dark, welcome: shown.welcome, e0: shown.e0 } : null };
  }
  const f = Math.min(1, (t - shown.at) / FADE_MS);
  if (shown.prev && f < 1) {
    const pe = shown.prev.e0 ? (t - shown.prev.e0) / 1000 : null;
    paint(ctx, compFor(state, shown.prev.dark, shown.prev.welcome, t, pe), 1, pe);
  }
  const comp = compFor(state, dark, welcome, t, e);
  paint(ctx, comp, shown.prev ? f * f * (3 - 2 * f) : 1, e);
  if (playing) arrival(ctx, comp, e, hashString(playing.key));
}

// A wall runs for months: when a new version of the site is published, pick it up.
let release = null;
async function checkRelease() {
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const { sha } = await r.json();
    if (release && sha !== release) location.reload();
    release = sha;
  } catch { /* offline */ }
}

addEventListener('resize', resize);
resize();
await refresh();
canvas.classList.add('fade-in');
setInterval(params.get('scenario') ? refresh : poll, params.get('scenario') ? 60000 : 4000);
setInterval(refresh, 5 * 60000); // weather and visitors, even if nothing announced a change
checkRelease();
setInterval(checkRelease, 10 * 60000);
requestAnimationFrame(frame);
