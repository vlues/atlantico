// Live wall piece: fetches state from the Worker and draws the composition on a canvas,
// redrawn slowly so the lines drift. Light/dark, welcome and tour changes crossfade.
// A cheap version check every few seconds means an arrival or a tour stop reaches the wall almost
// at once, and a new release of the site reloads the page by itself. Tap the wall to turn sound on.
import { compose, hashString, STYLES } from '../lib/art.js';
import { sunPosition } from '../lib/sun.js';
import { moonPosition } from '../lib/moon.js';
import { paint, arrival, revealAt, tourOverlay, farewellOverlay, musicOverlay } from './paint.js';
import { enableSound, wakeSound, soundWanted, arrivalSound, stopSound } from './sound.js';
import { screen } from './screen.js';

const API = window.ATLANTICO?.api ?? '';
const params = new URLSearchParams(location.search);
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');

let state = null;
let version = null;
let shown = { key: null };
let visit = null; // the welcome being played: { start, until, w, starts: Map(id → when its star's entrance began) }
let stop = null;  // the tour stop being shown: { key, start, until, tour }
let note = null;  // a brief line on the wall ("sonido") after a tap
let bye = null;   // the goodbye being shown
let song = null;  // a guest's song that came on: { key, start }

async function refresh() {
  try {
    const q = params.get('scenario') ? `?scenario=${encodeURIComponent(params.get('scenario'))}` : '';
    const r = await fetch(`${API}/api/wall${q}`, { cache: 'no-store' });
    if (r.ok) {
      state = await r.json();
      state.dayAhead = Math.round((state.editionDate - Date.now()) / 86400000) || 0;
    }
  } catch { /* keep the last state; the sea doesn't stop */ }
}

async function poll() {
  try {
    const r = await fetch(`${API}/api/wall/version`, { cache: 'no-store' });
    const v = r.ok ? await r.text() : null;
    if (v && v !== version) { version = v; await refresh(); display.changed(); }
  } catch { /* offline: try again shortly */ }
}

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
}

let moon = { at: 0 };
function conditions(s, now) {
  const sun = s.simulate && params.get('sun') ? JSON.parse(params.get('sun')) : sunPosition(new Date(now), s.lat, s.lon);
  if (now - moon.at > 60000) moon = { at: now, pos: moonPosition(new Date(now), s.lat, s.lon) };
  return { ...s.conditions, sun, moon: moon.pos };
}

function compFor(s, v, now) {
  return compose(conditions(s, now), {
    width: canvas.width, height: canvas.height, lat: s.lat, lon: s.lon,
    date: now + s.dayAhead * 86400000, style: v.style ?? params.get('style') ?? s.style,
    dark: v.dark, visitors: s.visitors, welcome: v.welcome, time: now / 1000,
    heroes: v.starts ? [...v.starts].map(([id, at]) => ({ id, reveal: revealAt((now - at) / 1000) })) : v.hero ? [{ id: v.hero, reveal: 1 }] : [],
  });
}

let last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (!state || now - last < 33) return;
  last = now;
  const t = Date.now();

  // Play each welcome from the moment this screen hears about it, for at least 22 s. People who
  // arrive together join the same welcome: each star gets its own entrance, a beat apart, and the
  // ones already shining are not restarted.
  const w = state.welcome;
  if (w && w.until > t) {
    const members = w.group ?? [w];
    if (!visit || t >= visit.until || !members.some((m) => visit.starts.has(m.id))) visit = { start: t, until: 0, starts: new Map() };
    let added = 0;
    for (const m of members) if (!visit.starts.has(m.id)) visit.starts.set(m.id, t + 900 * added++);
    if (added) { visit.until = Math.max(visit.until, t + 22000); arrivalSound(); }
    visit.until = Math.max(visit.until, w.until);
    visit.w = w;
  }
  const playing = visit && t < visit.until ? visit : null;
  const welcome = playing?.w ?? null;
  const e = playing ? (t - playing.start) / 1000 : null;

  // The guest tour, one stop at a time (an arrival takes precedence).
  const tr = state.tour;
  if (tr && tr.until > t && stop?.key !== `${tr.stop}:${tr.at}`) {
    stop = { key: `${tr.stop}:${tr.at}`, start: t, until: tr.until, tour: tr };
    stopSound(tr.stop);
  }
  const touring = !playing && stop && t < stop.until ? stop : null;
  const te = touring ? (t - touring.start) / 1000 : 0;
  // The editions stop (and the demo showcase) walks through every style, three seconds each.
  const style = touring?.tour.stop === 'edition' ? STYLES[Math.floor(te / 3) % STYLES.length] : null;
  // A guest's song: their star is the one that calls out while the band is up.
  const m = state.music?.by ? state.music : null;
  if (m && song?.key !== `${m.by.id}:${m.at}`) { song = { key: `${m.by.id}:${m.at}`, start: t }; stopSound('star'); }
  const singing = m && song && !playing && !touring ? (t - song.start) / 1000 : null;
  const hero = touring?.tour.stop === 'star' ? touring.tour.id : singing != null && singing < 25 ? m.by.id : null;

  const dark = params.get('mode') === 'light' ? false : params.get('mode') === 'dark' ? true : state.dark || !!welcome;
  const view = { dark, welcome, e, style, hero, starts: playing?.starts };
  const key = `${dark}|${playing ? `${playing.start}:${playing.starts.size}` : ''}|${touring?.key ?? ''}|${style ?? ''}`;
  if (shown.key !== key) shown = { key, view, at: t, fade: style ? 1200 : 3000, prev: shown.key ? shown.view : null };
  const f = Math.min(1, (t - shown.at) / shown.fade);
  if (shown.prev && f < 1) {
    const pv = { ...shown.prev, e: shown.prev.e != null ? shown.prev.e + (t - shown.at) / 1000 : null };
    paint(ctx, compFor(state, pv, t), 1, pv.e);
  }
  const comp = compFor(state, view, t);
  paint(ctx, comp, shown.prev ? f * f * (3 - 2 * f) : 1, e);
  if (playing) {
    for (const h of comp.heroes) {
      const at = playing.starts.get(h.id);
      if (at != null && t >= at) arrival(ctx, comp, (t - at) / 1000, hashString(`${h.id}:${at}`), h);
    }
  }
  if (touring) tourOverlay(ctx, comp, touring.tour, te, conditions(state, t), { style });
  if (singing != null) musicOverlay(ctx, comp, m, singing);
  const fw = state.farewell;
  if (fw && fw.until > t && !playing) {
    if (bye?.key !== `${fw.id}:${fw.at}`) { bye = { key: `${fw.id}:${fw.at}`, start: t }; stopSound('end'); }
    farewellOverlay(ctx, comp, fw, (t - bye.start) / 1000);
  }
  // Night: dim (or go dark) after midnight, unless something is happening in the room.
  const dim = display.night(t, !!(playing || touring || singing != null || (fw && fw.until > t)));
  if (dim > 0) { ctx.save(); ctx.globalAlpha = dim; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.restore(); }
  display.shift(t);
  if (note && t < note.until) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, (note.until - t) / 600);
    ctx.fillStyle = comp.palette.fg;
    ctx.textAlign = 'center';
    ctx.font = `italic 300 ${Math.min(canvas.width, canvas.height) * 0.03}px 'Cormorant Garamond', Georgia, serif`;
    ctx.fillText(note.text, canvas.width / 2, canvas.height * 0.94);
    ctx.restore();
  }
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

// One tap turns sound on (arrival chimes, tour sounds); another turns it off.
canvas.addEventListener('click', async () => {
  const on = await enableSound(!soundWanted());
  note = { text: on ? 'sonido · sound on' : 'silencio · sound off', until: Date.now() + 2500 };
});

const display = screen({ api: API, canvas });
addEventListener('resize', resize);
resize();
await refresh();
wakeSound();
canvas.classList.add('fade-in');
setInterval(params.get('scenario') ? refresh : poll, params.get('scenario') ? 60000 : 4000);
setInterval(refresh, 5 * 60000); // weather and visitors, even if nothing announced a change
checkRelease();
setInterval(checkRelease, 10 * 60000);
requestAnimationFrame(frame);
