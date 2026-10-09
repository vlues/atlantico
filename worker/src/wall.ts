// Wall piece state and render endpoints (live view, SVG, PNG, raw e-ink bytes).
import type { Env } from './env';
import { getConditions, type Conditions } from './weather';
import { json } from './http';
import { deviceFromRequest, setSetting, settings } from './util';
// @ts-ignore — shared plain-JS modules, also served to the browser
import { compose, toSVG } from '../../web/lib/art.js';
// @ts-ignore
import { rasterize, encodePNG, packRaw } from '../../web/lib/raster.js';
// @ts-ignore
import { sunPosition } from '../../web/lib/sun.js';
// @ts-ignore
import { moonPosition } from '../../web/lib/moon.js';

/** How long the screens hold a welcome after the latest arrival. */
export const WELCOME_MS = 30000;

/**
 * The arrival moment every screen plays: whose star, which visit, how long since the last.
 * When several people arrive close together, `group` lists them all (in order of arrival).
 */
export interface Welcome {
  id: string; name: string; greeting: string; visits: number; since: number | null; at: number; until: number;
  group?: { id: string; name: string; visits: number }[];
}
/** One star per guest. Name only while they are here (they asked to be on the wall). */
export interface Star { id: string; visits: number; here?: boolean; name?: string }
export interface WallState {
  conditions: Conditions;
  sun: { altitude: number; azimuth: number };
  moon: { altitude: number; azimuth: number; fraction: number; phase: number; waxing: boolean; name: string; nameEn: string };
  sunOverride: string | null;
  style: string | null;   // demo: preview one of the daily styles instead of today's
  editionDate: number;    // which day's edition to draw (today, or a day ahead from the demo strip)
  tour: { id: string | null; name: string | null; visits: number; stop: string; at: number; until: number; showcase?: boolean } | null;
  farewell: { id: string; name: string; at: number; until: number } | null;   // a guest tapping out
  music: { title: string; artist: string; by: { id: string; name: string } | null; at: number; next: { title: string; by: string } | null } | null;
  surprise: { id: number; seed: number; at: number; until: number; size: string; force: string | null; cx: Record<string, unknown> } | null;
  scene: string;
  dark: boolean;
  visitors: Star[];
  welcome: Welcome | null;
  lat: number; lon: number;
}

/** A guest counts as here for this long after tapping in (or until the owner ends the visit). */
export const PRESENT_MS = 6 * 3600000;
export const isHere = (v: { last_seen: number | null; left_at: number | null }, t = Date.now()) =>
  v.last_seen != null && v.last_seen > t - PRESENT_MS && !(v.left_at != null && v.left_at >= v.last_seen);


// Demo: fixed sun positions (as seen from Fuentebravía) to preview times of day.
export const SUN_PRESETS: Record<string, { altitude: number; azimuth: number }> = {
  sunrise: { altitude: 2, azimuth: 100 },
  morning: { altitude: 25, azimuth: 120 },
  noon: { altitude: 48, azimuth: 180 },
  'golden hour': { altitude: 6, azimuth: 250 },
  sunset: { altitude: 0.5, azimuth: 258 },
  dusk: { altitude: -3.5, azimuth: 262 },
  night: { altitude: -25, azimuth: 320 },
};

export async function wallState(env: Env, scenario?: string | null): Promise<WallState> {
  const lat = Number(env.LAT), lon = Number(env.LON);
  const t = Date.now();
  const [set, rows] = await Promise.all([
    settings(env, ['demo:scenario', 'demo:sun', 'demo:style', 'demo:day', 'scene', 'welcome', 'tour', 'farewell', 'music:now', 'surprise']),
    env.DB.prepare('SELECT id, first_name, visits, last_seen, left_at FROM visitors ORDER BY created_at').all<any>()
      .then((r) => r.results).catch(() => []),
  ]);
  const demoScenario: string | null = set['demo:scenario'] ?? null, sunOverride: string | null = set['demo:sun'] ?? null;
  const style: string | null = set['demo:style'] ?? null, dayAhead = set['demo:day'], scene: string | null = set.scene ?? null;
  const welcome: Welcome | null = set.welcome ?? null, tour: WallState['tour'] = set.tour ?? null;
  // Arrivals chain into one welcome while each comes within WELCOME_MS of the next. Read from the
  // visitors themselves (one row each), so simultaneous arrivals can't overwrite one another.
  const recent = rows.filter((r: any) => r.last_seen && t - r.last_seen < 10 * 60000 && !(r.left_at != null && r.left_at >= r.last_seen))
    .sort((a: any, b: any) => b.last_seen - a.last_seen);
  const group: any[] = [];
  for (const r of recent) {
    const newer = group[group.length - 1];
    if (!newer ? t - r.last_seen > WELCOME_MS : newer.last_seen - r.last_seen > WELCOME_MS) break;
    if (group.length < 24) group.push(r);
  }
  const visitors: Star[] = rows.map((r: any) =>
    isHere(r, t) ? { id: r.id, visits: r.visits, here: true, name: r.first_name } : { id: r.id, visits: r.visits });
  const conditions = await getConditions(env, scenario || demoScenario);
  const sun = (sunOverride && SUN_PRESETS[sunOverride]) || sunPosition(new Date(), lat, lon);
  let active: Welcome | null = null;
  if (group.length === 1) {
    const g = group[0];
    active = welcome && welcome.id === g.id ? { ...welcome, until: g.last_seen + WELCOME_MS }
      : { id: g.id, name: g.first_name, greeting: g.visits > 1 ? 'Hola de nuevo' : 'Bienvenido', visits: g.visits, since: null, at: g.last_seen, until: g.last_seen + WELCOME_MS };
  } else if (group.length > 1) {
    const g = group[0];
    active = {
      id: g.id, name: g.first_name, greeting: 'Bienvenidos', visits: g.visits, since: null, at: g.last_seen, until: g.last_seen + WELCOME_MS,
      group: group.slice().reverse().map((r) => ({ id: r.id, name: r.first_name, visits: r.visits })),
    };
  }
  const s = scene ?? 'auto';
  return {
    conditions, sun, moon: moonPosition(new Date(t), lat, lon), style,
    editionDate: t + (Number(dayAhead) || 0) * 86400000,
    tour: tour && tour.until > t ? tour : null,
    farewell: set.farewell && set.farewell.until > t ? set.farewell : null,
    music: set['music:now'] ?? null,
    surprise: set.surprise && set.surprise.until > t ? set.surprise : null,
    sunOverride: sunOverride && SUN_PRESETS[sunOverride] ? sunOverride : null,
    scene: s, lat, lon, visitors, welcome: active,
    // The wall follows the real sky: paper by day, night after sunset (whatever the lights do).
    dark: sun.altitude < -2,
  };
}

// Revision and welcome live in D1, not KV: KV can take up to a minute to show a write in other
// locations, and an arrival has to reach every screen within seconds.
/** Any change that should redraw the screens bumps this. */
export async function bumpWall(env: Env) {
  await setSetting(env, 'wall:rev', Date.now());
}

/**
 * Cheap version string (one small query); screens poll it and only fetch more when it changes.
 * Browser walls also follow the guest tour; e-ink panels don't (they would redraw for every stop).
 */
export async function wallVersion(env: Env, withTour = false): Promise<string> {
  const r = await env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('wall:rev', 'welcome', 'tour', 'farewell', 'music:now', 'surprise')").all<{ key: string; value: string }>();
  const get = (k: string) => { const row = r.results.find((x) => x.key === k); return row ? JSON.parse(row.value) : null; };
  const w: Welcome | null = get('welcome'), t = Date.now();
  const v = `${get('wall:rev') ?? 0}.${Math.floor(t / 900000)}${w && w.until > t ? `w${w.at}` : ''}`;
  if (!withTour) return v;
  const tour = get('tour'), fw = get('farewell'), m = get('music:now'), sp = get('surprise');
  return `${v}${tour && tour.until > t ? `t${tour.at}` : ''}${fw && fw.until > t ? `f${fw.at}` : ''}${m?.by ? `m${m.at}` : ''}${sp && sp.until > t ? `s${sp.id}` : ''}`;
}

function composeFor(state: WallState, width: number, height: number, overrides: { dark?: boolean } = {}, print = false) {
  return compose({ ...state.conditions, sun: state.sun, moon: state.moon }, {
    width, height, print, lat: state.lat, lon: state.lon, date: state.editionDate, style: state.style,
    dark: overrides.dark ?? state.dark,
    visitors: state.visitors,
    welcome: state.welcome,
    heroes: (state.welcome?.group ?? (state.welcome ? [state.welcome] : [])).map((g) => ({ id: g.id, reveal: 1 })),
    time: Date.now() / 1000,
  });
}

function parseSize(size: string, env: Env): [number, number] | null {
  const allowed = env.PANEL_SIZES.split(',').map((s) => s.trim());
  if (!allowed.includes(size)) return null;
  const [w, h] = size.split('x').map(Number);
  return [w, h];
}

function modeFrom(url: URL): { dark?: boolean } {
  const m = url.searchParams.get('mode');
  return m === 'dark' ? { dark: true } : m === 'light' ? { dark: false } : {};
}

/**
 * PNG or raw bytes for e-ink panels. ?size=800x480&colors=2|6&mode=auto|light|dark&rotate=1
 * A paired panel sends its device token and gets its own configured size/colours.
 */
export async function panelImage(req: Request, url: URL, env: Env, format: 'png' | 'bin'): Promise<Response> {
  const dev = req.headers.get('authorization') ? await deviceFromRequest(req, env) : null;
  const cfg = dev ? JSON.parse(dev.config) : {};
  if (dev && req.headers.get('x-battery')) {
    await env.STATE.put(`dev:${dev.id}:status`, JSON.stringify({
      battery: Number(req.headers.get('x-battery')), rssi: Number(req.headers.get('x-rssi')) || null,
      fw: req.headers.get('x-fw'), at: Date.now(),
    }));
  }
  const sizeStr = url.searchParams.get('size') ?? cfg.size ?? env.PANEL_SIZES.split(',')[0].trim();
  let size = parseSize(sizeStr, env);
  if (!size) return new Response(`size must be one of ${env.PANEL_SIZES}`, { status: 400 });
  if ((url.searchParams.get('rotate') ?? (cfg.rotate ? '1' : '0')) === '1') size = [size[1], size[0]];
  const colors = (url.searchParams.get('colors') ?? String(cfg.colors ?? 2)) === '6' ? 6 : 2;
  const scenario = url.searchParams.get('scenario');
  const mode = url.searchParams.get('mode') ?? 'auto';
  const version = await wallVersion(env);

  // Rendering costs a few ms of CPU; identical requests within a version are served from KV.
  const key = `panel:${size.join('x')}:${colors}:${mode}:${format}:${version}`;
  let bytes = scenario ? null : await env.STATE.get(key, 'arrayBuffer');
  if (!bytes) {
    const state = await wallState(env, scenario);
    const r = rasterize(composeFor(state, size[0], size[1], modeFrom(url), true), colors);
    const out: Uint8Array = format === 'png' ? await encodePNG(r) : packRaw(r);
    bytes = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
    if (!scenario) await env.STATE.put(key, bytes, { expirationTtl: 3600 });
  }

  const sleep = (cfg.power ?? 'usb') === 'battery' ? 900 : 20;
  return new Response(bytes, {
    headers: {
      'content-type': format === 'png' ? 'image/png' : 'application/octet-stream',
      'cache-control': 'no-store',
      'x-version': version,
      'x-sleep-seconds': String(sleep),
      'x-width': String(size[0]), 'x-height': String(size[1]), 'x-colors': String(colors),
    },
  });
}

/** Panels on USB power poll this every ~20 s (one KV read) and fetch the image only on change. */
export async function panelPoll(req: Request, env: Env): Promise<Response> {
  const dev = await deviceFromRequest(req, env);
  if (!dev) return json({ error: 'unknown device' }, 401);
  return new Response(await wallVersion(env), { headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
}

export async function liveSVG(url: URL, env: Env): Promise<Response> {
  const state = await wallState(env, url.searchParams.get('scenario'));
  const w = Number(url.searchParams.get('w')) || 1600, h = Number(url.searchParams.get('h')) || 1000;
  return new Response(toSVG(composeFor(state, Math.min(w, 4000), Math.min(h, 4000), modeFrom(url))), {
    headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** A no-JavaScript live view straight from the Worker (refreshes every minute). */
export async function liveHTML(url: URL, env: Env): Promise<Response> {
  const state = await wallState(env, url.searchParams.get('scenario'));
  const svg = toSVG(composeFor(state, 1600, 1000, modeFrom(url)));
  const bg = state.dark ? '#0a0a0b' : '#f2f0eb';
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="60">
<title>Atlántico</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&display=swap" rel="stylesheet">
<style>html,body{margin:0;height:100%;background:${bg}}svg{display:block;width:100vw;height:100vh}</style>
</head><body>${svg}</body></html>`, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
