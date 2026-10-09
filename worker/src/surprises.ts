// Surprises: the Worker decides when, with real randomness (crypto.getRandomValues), so nobody can
// predict them, me included. Every 15 minutes it rolls the dice; if one is coming it picks a moment in
// the next quarter of an hour and a random seed, and every screen grows the same surprise from that
// seed (web/lib/surprise.js). The first screen to play it tells the Worker, and the lamps answer.
import type { Env } from './env';
import { json } from './http';
import { body, getSetting, setSetting, rateLimit, now } from './util';
import { isHere } from './wall';
import { glowAll, spotlight } from './lights';
import { getConditions } from './weather';
// @ts-ignore — shared plain-JS modules
import { recipe, ELEMENTS } from '../../web/lib/surprise.js';
// @ts-ignore
import { sunPosition } from '../../web/lib/sun.js';
// @ts-ignore
import { moonPosition } from '../../web/lib/moon.js';
// @ts-ignore
import { windName } from '../../web/lib/art.js';

export interface Surprise { id: number; seed: number; at: number; until: number; size: 'big' | 'small'; force: string | null; cx: Record<string, unknown>; title: { es: string; en: string } }

const random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
const madridHour = (ms: number) => Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Madrid' }).format(new Date(ms)));

/** The moment a surprise will happen in: day or night, weather, who is here. */
async function context(env: Env, at: number) {
  const lat = Number(env.LAT), lon = Number(env.LON);
  const c = await getConditions(env, null);
  const rows = await env.DB.prepare('SELECT first_name, last_seen, left_at FROM visitors WHERE last_seen > ?').bind(now() - 7 * 3600000).all<any>();
  const sunAlt: number = sunPosition(new Date(at), lat, lon).altitude;
  return {
    day: sunAlt > -1, sunAlt, rain: (c.precipitation ?? 0) > 0.05, cloud: c.cloudCover ?? 0, wind: c.windSpeed ?? 0,
    windName: windName(c.windSpeed ?? 0, c.windDirection ?? 0), moon: moonPosition(new Date(at), lat, lon).fraction, hour: madridHour(at),
    here: rows.results.filter((r) => isHere(r)).map((r) => r.first_name).slice(0, 6),
  };
}

async function make(env: Env, at: number, size: 'big' | 'small', force: string | null): Promise<Surprise> {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const cx = await context(env, at);
  const rec = recipe(seed, cx, size, force);
  const n = ((await getSetting<number>(env, 'surprise:n', 0)) ?? 0) + 1;
  await setSetting(env, 'surprise:n', n);
  const s: Surprise = { id: n, seed, at, until: at + Math.round(rec.dur * 1000), size, force, cx, title: rec.title };
  await setSetting(env, 'surprise', s);
  return s;
}

/** Cron, every 15 minutes: maybe schedule one, somewhere in the next quarter of an hour. */
export async function rollDice(env: Env) {
  const t = now();
  const current = await getSetting<Surprise | null>(env, 'surprise', null);
  if (current && current.until > t) return; // one already coming or playing
  const hour = madridHour(t);
  if (hour < 8) return; // let the house sleep
  const cx = await context(env, t);
  const guests = cx.here.length > 0;
  const roll = random();
  // About five big ones a day while people are up (more with guests), and a small one most hours.
  const big = 0.055 * (guests ? 1.8 : 1), small = 0.24;
  const size = roll < big ? 'big' : roll < big + small ? 'small' : null;
  if (!size) return;
  await make(env, t + Math.floor(random() * 14.5 * 60000), size, null);
}

/** Demo panel: one now (random, small, or led by a chosen element). */
export async function demoSurprise(env: Env, value: string) {
  const size = value === 'small' ? 'small' : 'big';
  const force = value in ELEMENTS ? value : null;
  const s = await make(env, now() + 2500, size, force);
  return json({ ok: true, id: s.id, title: s.title, at: s.at });
}

export async function current(env: Env): Promise<Surprise | null> {
  const s = await getSetting<Surprise | null>(env, 'surprise', null);
  return s && s.until > now() ? s : null;
}

/** POST /api/surprise/seen { id } — a screen started playing it: the lamps answer, once. */
export async function seen(req: Request, env: Env, ctx: ExecutionContext) {
  const b = await body<{ id?: number }>(req);
  const ip = req.headers.get('cf-connecting-ip') ?? 'local';
  if (!(await rateLimit(env, `surprise:${ip}`, 20, 600))) return json({ ok: true });
  const s = await current(env);
  if (!s || s.id !== b.id || s.at > now() + 5000) return json({ ok: true });
  if ((await getSetting<number>(env, 'surprise:lit', 0)) === s.id) return json({ ok: true });
  await setSetting(env, 'surprise:lit', s.id);
  const rec = recipe(s.seed, s.cx, s.size, s.force);
  ctx.waitUntil(lamps(env, rec.lights, Math.min(rec.dur, 24)).catch((e) => console.error(e)));
  return json({ ok: true });
}

// The house answering: a few gentle changes at most (Govee allows a handful a minute), then back.
async function lamps(env: Env, pattern: string, seconds: number) {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  switch (pattern) {
    case 'pulse': await glowAll(env, { on: true, brightness: 100, kelvin: 4000 }); await wait(2500); break;
    case 'flash': await glowAll(env, { on: true, brightness: 100, kelvin: 6000 }); await wait(1200); break;
    case 'breathe': await glowAll(env, { on: true, brightness: 75, kelvin: 2700 }); await wait(4000); await glowAll(env, { on: true, brightness: 25, kelvin: 2200 }); await wait(4000); break;
    case 'dusk': await glowAll(env, { on: true, brightness: 22, kelvin: 2000 }); await wait(seconds * 1000); break;
    case 'glow': await glowAll(env, { on: true, brightness: 60, kelvin: 3000 }); await wait((seconds * 1000) / 2); break;
    default: return;
  }
  await spotlight(env, null);
}
