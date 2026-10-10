// Live wall piece: fetches state from the Worker and draws the composition on a canvas,
// redrawn slowly so the lines drift. Light/dark, welcome and tour changes crossfade.
// A cheap version check every few seconds means an arrival or a tour stop reaches the wall almost
// at once, and a new release of the site reloads the page by itself. Tap the wall to turn sound on.
import { compose, hashString, STYLES } from '../lib/art.js';
import { sunPosition } from '../lib/sun.js';
import { moonPosition } from '../lib/moon.js';
import { paint, arrival, revealAt, tourOverlay, farewellOverlay, musicOverlay, band } from './paint.js';
import { enableSound, wakeSound, soundWanted, arrivalSound, stopSound, surpriseSound } from './sound.js';
import { recipe } from '../lib/surprise.js';
import { drawSurprise, moments } from './surprise.js';
import { screen } from './screen.js';

const API = window.ATLANTICO?.api ?? '';
const params = new URLSearchParams(location.search);
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');

let state = null;
let version = null;
let shown = { key: null };
let visit = null; // the welcome being played: { start, until, w, starts: Map(id → when its star's entrance began) }
// On the household TV (kiosk.sh shared) the Pi may have just woken the TV for this arrival: give
// the TV a few seconds to come on before the shooting star, so the guest sees all of it.
const TV = params.has('tv');
const TV_WAKE = TV ? 6000 : 0;
let away = null;   // since when the TV has shown something else, and who was here then
let missed = null; // who left meanwhile, named once on the way back
let calib = null;  // the marks the Pi's camera uses to find the screen
let stop = null;  // the tour stop being shown: { key, start, until, tour }
let note = null;  // a brief line on the wall ("sonido") after a tap
// Guests who were here at the last look, and those leaving now: their exit plays for 8 seconds, then
// by day their boat carries on out of the bay for a few minutes before joining the others far out.
let present = null;
const leaving = new Map();
const EXIT_MS = 8000, AFTER_MS = 4 * 60000;
function track(visitors) {
  const now = new Map(visitors.filter((v) => v.here).map((v) => [v.id, v]));
  if (present) for (const [id, v] of present) if (!now.has(id) && !leaving.has(id)) leaving.set(id, { start: Date.now(), name: v.name, visits: v.visits });
  for (const id of now.keys()) leaving.delete(id);
  present = now;
}
let bye = null;   // the goodbye being shown
let surprise = null; // { id, rec, started }
let song = null;  // a guest's song that came on: { key, start }

async function refresh() {
  try {
    const q = params.get('scenario') ? `?scenario=${encodeURIComponent(params.get('scenario'))}` : '';
    const r = await fetch(`${API}/api/wall${q}`, { cache: 'no-store' });
    if (r.ok) {
      state = await r.json();
      state.dayAhead = Math.round((state.editionDate - Date.now()) / 86400000) || 0;
      track(state.visitors);
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

// The sun: the real one, or the Demo panel's time of day. When the Demo changes it the screen
// travels there instead of jumping, unhurried through dusk and dawn (where the boats become stars
// and back) and quick through the rest of the sky.
let sunShown = null, sunMove = null;
const BAND = [-6.5, 3.5], SLOW = 1.3, FAST = 0.07; // seconds per degree, inside and outside the band
function sunFor(s, now) {
  const want = s.sunOverride ? s.sun : s.simulate && params.get('sun') ? JSON.parse(params.get('sun')) : sunPosition(new Date(now), s.lat, s.lon);
  const key = s.sunOverride ?? 'live';
  if (sunMove?.key !== key) {
    const from = sunShown;
    let legs = [];
    if (from) {
      const a = from.altitude, b = want.altitude, dir = Math.sign(b - a) || 1;
      const stops = [a, ...BAND.filter((x) => (x - a) * dir > 0 && (b - x) * dir > 0).sort((p, q) => (p - q) * dir), b];
      legs = stops.slice(1).map((to, i) => { const at = stops[i], mid = (at + to) / 2; return { at, to, secs: Math.abs(to - at) * (mid > BAND[0] && mid < BAND[1] ? SLOW : FAST) }; });
    }
    sunMove = { key, from, at: now, legs, total: legs.reduce((n, l) => n + l.secs, 0) };
  }
  const { from, legs, total } = sunMove;
  const k = total > 0 ? Math.min(1, (now - sunMove.at) / 1000 / total) : 1;
  if (k >= 1) return (sunShown = want);
  let left = k * k * (3 - 2 * k) * total, altitude = want.altitude;
  for (const l of legs) { if (left <= l.secs) { altitude = l.at + (l.to - l.at) * (l.secs ? left / l.secs : 1); break; } left -= l.secs; }
  const f = Math.abs(want.altitude - from.altitude) > 0.01 ? (altitude - from.altitude) / (want.altitude - from.altitude) : k;
  const turn = ((want.azimuth - from.azimuth + 540) % 360) - 180;
  return (sunShown = { altitude, azimuth: (from.azimuth + turn * f + 360) % 360 });
}

let moon = { at: 0 };
function conditions(s, now) {
  const sun = sunFor(s, now);
  if (now - moon.at > 60000) moon = { at: now, pos: moonPosition(new Date(now), s.lat, s.lon) };
  return { ...s.conditions, sun, moon: moon.pos };
}

function compFor(s, v, now) {
  return compose(conditions(s, now), {
    width: canvas.width, height: canvas.height, lat: s.lat, lon: s.lon,
    date: now + s.dayAhead * 86400000, style: v.style ?? params.get('style') ?? s.style,
    dark: v.dark, visitors: s.visitors, welcome: v.welcome, time: now / 1000,
    heroes: v.starts ? [...v.starts].map(([id, at]) => ({ id, reveal: revealAt((now - at) / 1000), e: (now - at) / 1000 })) : v.hero ? [{ id: v.hero, reveal: 1 }] : [],
    departing: [...leaving].map(([id, d]) => ({ id, name: d.name, visits: d.visits, p: Math.min(1, (now - d.start) / EXIT_MS), age: (now - d.start) / 1000 })),
  });
}

// About 30 frames a second, evenly spaced (every other refresh of a 60 Hz screen, every fourth at
// 120 Hz); slower computers (a Raspberry Pi behind a TV) drop to an even 15 by themselves.
let last = 0, cost = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const every = cost > 24 ? 1000 / 15 : 1000 / 30;
  if (!state || now - last < every - 6) return; // 6 ms slack: always the same number of refreshes apart
  last = now;
  const began = performance.now();
  draw();
  cost = cost * 0.9 + (performance.now() - began) * 0.1;
}

function draw() {
  const t = Date.now();
  for (const [id, d] of leaving) if (t - d.start > AFTER_MS) leaving.delete(id);

  // Play each welcome from the moment this screen hears about it, for at least 22 s. People who
  // arrive together join the same welcome: each star gets its own entrance, a beat apart, and the
  // ones already shining are not restarted.
  const w = state.welcome;
  if (w && w.until > t) {
    const members = w.group ?? [w];
    const fresh = !visit || t >= visit.until || !members.some((m) => visit.starts.has(m.id));
    if (fresh) visit = { start: t + TV_WAKE, until: 0, starts: new Map() };
    const from = Math.max(t, visit.start);
    let added = 0;
    for (const m of members) if (!visit.starts.has(m.id)) visit.starts.set(m.id, from + 900 * added++);
    if (added) { visit.until = Math.max(visit.until, from + 22000); setTimeout(arrivalSound, from - t); }
    visit.until = Math.max(visit.until, w.until);
    visit.w = w;
  }
  const playing = visit && t >= visit.start && t < visit.until ? visit : null;
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

  const dark = params.get('mode') === 'light' ? false : params.get('mode') === 'dark' ? true : sunFor(state, t).altitude < -2;
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
  // A surprise: the same on every screen in the house, grown from the Worker's random seed.
  const sp = state.surprise;
  const surprising = sp && t >= sp.at && t < sp.until;
  if (surprising) {
    if (surprise?.id !== sp.id) surprise = { id: sp.id, rec: recipe(sp.seed, sp.cx, sp.size, sp.force), started: false };
    const se = (t - sp.at) / 1000;
    drawSurprise(ctx, comp, surprise.rec, se);
    if (surprise.rec.size === 'big' && se < 6) band(ctx, comp, surprise.rec.title.es, surprise.rec.title.en, Math.min(1, se / 1.2) * Math.min(1, (6 - se) / 1.2));
    if (!surprise.started) {
      surprise.started = true;
      surpriseSound(surprise.rec, moments);
      fetch(`${API}/api/surprise/seen`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: sp.id }) }).catch(() => {});
    }
  }
  // Night: dim (or go dark) after midnight, unless something is happening in the room.
  const dim = display.night(t, !!(playing || touring || singing != null || surprising || (fw && fw.until > t)));
  if (dim > 0) { ctx.save(); ctx.globalAlpha = dim; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.restore(); }
  display.shift(t);
  if (missed && t >= missed.start && !playing) {
    const me = (t - missed.start) / 1000;
    if (me > 6) missed = null;
    else band(ctx, comp, missed.es, missed.en, Math.min(1, me / 1.2) * Math.min(1, (6 - me) / 1.2));
  }
  if (calib) calibration(t);
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

// ── The household TV ────────────────────────────────────────────────────────────────────────
// The Pi's agent (tv-agent.py) presses F14 when the TV leaves Atlántico and F13 when it comes
// back: whoever arrived meanwhile gets the welcome they missed, and whoever left is named once.
// F15 shows the marks its camera finds the screen by. Any other key is the TV remote reaching the
// wall after the agent handed the screen back: if the TV is still here, say where TV and apps are.
if (TV) addEventListener('keydown', (e) => {
  const t = Date.now();
  if (e.key === 'F14') { if (!away) away = { since: t, here: new Map((state?.visitors ?? []).filter((v) => v.here).map((v) => [v.id, v])) }; }
  else if (e.key === 'F13') { if (away && t - away.since > 15000) catchUp(away, t); away = null; }
  else if (e.key === 'F15') calib = { start: t };
  else note = { text: 'tele y apps: botón Home · TV & apps: press Home', until: t + 5000 };
});

function catchUp(gone, t) {
  const hereNow = (state?.visitors ?? []).filter((v) => v.here);
  const came = hereNow.filter((v) => !gone.here.has(v.id)).slice(0, 12);
  const left = [...gone.here.values()].filter((v) => v.name && !hereNow.some((x) => x.id === v.id)).map((v) => v.name);
  const list = (names, and) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} ${and} ${names[names.length - 1]}` : names[0]);
  if (came.length) {
    const first = came[0], group = came.map((v) => ({ id: v.id, name: v.name, visits: v.visits }));
    const greeting = came.length > 1 ? 'Bienvenidos' : first.visits > 1 ? 'Hola de nuevo' : 'Bienvenido';
    const w = { id: first.id, name: first.name, greeting, visits: first.visits, since: null, at: t, until: t + 22800, ...(came.length > 1 ? { group } : {}) };
    visit = { start: t + 800, until: t + 22800, w, starts: new Map(group.map((g, i) => [g.id, t + 800 + 900 * i])) };
    setTimeout(arrivalSound, 800);
  }
  if (left.length) missed = { es: `${list(left, 'y')} ${left.length > 1 ? 'se fueron' : 'se fue'}`, en: `${list(left, 'and')} left`, start: t + (came.length ? 23500 : 1000) };
}

// Black with a white square near each corner, then all black, then all white (the camera measures
// the screen's corners, its black and its white). The agent times its pictures to these steps.
function calibration(t) {
  const ce = t - calib.start, W = canvas.width, H = canvas.height, s = Math.min(W, H) * 0.08;
  if (ce > 6500) { calib = null; return; }
  ctx.save();
  ctx.fillStyle = ce < 4500 ? '#000' : '#fff';
  ctx.fillRect(0, 0, W, H);
  if (ce < 2500) {
    ctx.fillStyle = '#fff';
    for (const [x, y] of [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]) ctx.fillRect(x * W - s / 2, y * H - s / 2, s, s);
  }
  ctx.restore();
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
// Kiosk (a screen that only runs this): no cursor, and sound on if asked for (?kiosk&sound).
if (params.has('kiosk')) document.body.style.cursor = 'none';
if (params.has('sound') && !soundWanted()) enableSound(true);
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
