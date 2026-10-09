import type { Env } from './env';
import { json, cors, preflight } from './http';
import { requireOwner, signIn, sessionHash, SESSION_MS, body, setSetting, getSetting, now, logAlert, flag, setFlag } from './util';
import { wallState, wallVersion, panelImage, panelPoll, liveSVG, liveHTML, bumpWall, SUN_PRESETS } from './wall';
import { SCENARIOS } from './weather';
import { arrive, demoArrive, deleteVisitor, endVisit, listVisitors, guestInfo, cleanName, lastOneOut, type WifiSettings } from './guests';
import { applyScene, saveGovee, SCENES, autoState, adapterFor, spotlight, ZONES, type Zone } from './lights';
import { plantStatus, listPlants, ensureSeeded, simulatorTick, fastForward, recordReading, type Rules } from './plants';
import { createPairing, pairingStatus, pair, report, listDevices, updateDevice, removeDevice, offlineAlerts } from './devices';
import { dailyCheck, telegram } from './check';
import { firmwareCheck, firmwareImage } from './firmware';
import { tourInfo, tourStop, playStop, STOPS } from './tour';
import * as music from './music';
import * as screens from './screens';
import * as surprises from './surprises';
// @ts-ignore — shared plain-JS module
import { edition, STYLES } from '../../web/lib/art.js';
// @ts-ignore
import { ELEMENTS } from '../../web/lib/surprise.js';

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method === 'OPTIONS') return preflight(req, env);
    const url = new URL(req.url);
    let res: Response;
    try {
      res = await route(req, url, env, ctx);
    } catch (err) {
      console.error(err);
      res = json({ error: 'internal error' }, 500);
    }
    return cors(req, res, env);
  },

  async scheduled(ev: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runCron(ev.cron, env));
  },
};

async function runCron(cron: string, env: Env) {
  await ensureSeeded(env);
  if (cron === '30 7 * * *') { await dailyCheck(env); return; }
  await surprises.rollDice(env).catch((e) => console.error('surprise', e));
  if (env.SIMULATE === 'true') await simulatorTick(env);
  await wallState(env); // refreshes the live weather cache
  // A tour that ended without its last stop: put the lamps back (normally they return within 30 s).
  const lights = await env.STATE.get<{ spot?: string; at: number }>('lights:last', 'json');
  if (lights?.spot && Date.now() - lights.at > 120000) await spotlight(env, null);
  else if (((await flag(env, 'scene')) ?? 'auto') === 'auto') await applyScene(env, 'auto');
  await offlineAlerts(env);
  await lastOneOut(env); // stays that simply ran out (six hours)
  // Keep a little over a year of readings.
  await env.DB.prepare('DELETE FROM readings WHERE ts < ?').bind(now() - 400 * 86400000).run();
}

type Handler = (req: Request, env: Env, ctx: ExecutionContext, m: RegExpMatchArray, url: URL) => Promise<Response> | Response;
const routes: [string, RegExp, Handler, 'public' | 'owner' | 'device'][] = [];
const on = (method: string, path: string, h: Handler, access: 'public' | 'owner' | 'device' = 'public') =>
  routes.push([method, new RegExp(`^${path.replace(/:(\w+)/g, '([^/]+)')}$`), h, access]);

// ── Public ───────────────────────────────────────────────────────────────────
on('GET', '/', () => json({ name: 'Atlántico', ok: true }));
on('GET', '/api/wall', async (_r, env, _c, _m, url) => {
  const s = await wallState(env, url.searchParams.get('scenario'));
  return json({ ...s, simulate: env.SIMULATE === 'true' });
});
on('GET', '/api/wall/version', async (_r, env, ctx) => {
  ctx.waitUntil(music.tick(env).catch((e) => console.error('music', e))); // whose song is on (throttled)
  return new Response(await wallVersion(env, true), { headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
});
on('GET', '/api/music', (_r, env, _c, _m, url) => music.overview(env, url));
on('POST', '/api/surprise/seen', (r, env, ctx) => surprises.seen(r, env, ctx));
on('GET', '/api/music/search', (_r, env, _c, _m, url) => music.search(env, url));
on('GET', '/api/music/suggest', (_r, env, ctx, _m, url) => music.suggest(env, url, ctx));
on('POST', '/api/music/queue', (r, env, ctx) => music.queue(r, env, ctx));
on('GET', '/api/music/callback', (r, env, _c, _m, url) => music.callback(r, env, url));
on('GET', '/api/tour', (_r, env) => tourInfo(env));
on('POST', '/api/tour', (r, env, ctx) => tourStop(r, env, ctx));
on('GET', '/art/live', (_r, env, _c, _m, url) => liveHTML(url, env));
on('GET', '/art/live.svg', (_r, env, _c, _m, url) => liveSVG(url, env));
on('GET', '/art/panel.png', (r, env, _c, _m, url) => panelImage(r, url, env, 'png'));
on('GET', '/art/panel.bin', (r, env, _c, _m, url) => panelImage(r, url, env, 'bin'));
on('GET', '/api/guest', (_r, env) => guestInfo(env));
on('POST', '/api/session', (r, env) => signIn(r, env));
on('POST', '/api/arrive', (r, env, ctx) => arrive(r, env, ctx));
on('DELETE', '/api/visitors/:id', (r, env, _c, m) => deleteVisitor(m[1], r, env));

// ── Devices ──────────────────────────────────────────────────────────────────
on('POST', '/api/pair', (r, env) => pair(r, env));
on('POST', '/api/screen/hello', (r, env) => screens.hello(r, env));
on('GET', '/api/screen/hello', (_r, env, _c, _m, url) => screens.waiting(env, url));
on('POST', '/api/screen/beat', (r, env) => screens.beat(r, env));
on('POST', '/api/device/report', (r, env) => report(r, env));
on('GET', '/api/panel/poll', (r, env) => panelPoll(r, env));
on('GET', '/api/device/firmware', (r, env, _c, _m, url) => firmwareCheck(r, env, url));
on('GET', '/api/device/firmware/([\\w-]+)\\.bin', (r, env, _c, m) => firmwareImage(r, env, m[1]));

// ── Owner ────────────────────────────────────────────────────────────────────
on('GET', '/api/overview', async (_r, env) => overview(env), 'owner');
on('POST', '/api/scene', async (r, env) => {
  const { scene } = await body<{ scene: string }>(r);
  if (!SCENES[scene]) return json({ error: 'unknown scene' }, 400);
  await setFlag(env, 'scene:by', 'owner');
  const state = await applyScene(env, scene, { force: true });
  await bumpWall(env);
  return json({ scene, state });
}, 'owner');
on('POST', '/api/plants/:id/water', async (r, env, _c, m) => {
  const p = (await listPlants(env)).find((x) => x.id === m[1]);
  if (!p) return json({ error: 'unknown plant' }, 404);
  const { ml } = await body<{ ml?: number }>(r);
  const dose = Math.max(50, Math.min(p.rules.maxDailyMl, Number(ml) || p.rules.doseMl));
  await env.STATE.put(`cmd:water:${p.id}`, String(dose), { expirationTtl: 86400 });
  const sim = p.device_id?.startsWith('sim-');
  if (sim) await simulatorTick(env, now() + 15 * 60000);
  return json({ queued: !sim, ml: dose, note: sim ? 'Watered (simulated).' : 'Queued. The node waters on its next wake, within 20 minutes.' });
}, 'owner');
on('PUT', '/api/plants/:id', async (r, env, _c, m) => {
  const p = (await listPlants(env)).find((x) => x.id === m[1]);
  if (!p) return json({ error: 'unknown plant' }, 404);
  const b = await body<{ name?: string; rules?: Partial<Rules> }>(r);
  const rules = { ...p.rules };
  for (const [k, v] of Object.entries(b.rules ?? {})) if (k in rules && typeof v === 'number' && isFinite(v) && v >= 0) (rules as any)[k] = v;
  await env.DB.prepare('UPDATE plants SET name = ?, rules = ? WHERE id = ?').bind((b.name ?? p.name).slice(0, 40), JSON.stringify(rules), p.id).run();
  return json({ ok: true, rules });
}, 'owner');
on('POST', '/api/pairing', (r, env) => createPairing(r, env), 'owner');
on('POST', '/api/screen/claim', (r, env) => screens.claim(r, env), 'owner');
on('GET', '/api/pairing/:code', (_r, env, _c, m) => pairingStatus(m[1], env), 'owner');
on('PATCH', '/api/devices/:id', (r, env, _c, m) => updateDevice(m[1], r, env), 'owner');
on('DELETE', '/api/devices/:id', (_r, env, _c, m) => removeDevice(m[1], env), 'owner');
on('GET', '/api/visitors', async (_r, env) => json(await listVisitors(env)), 'owner');
on('DELETE', '/api/owner/visitors/:id', (r, env, _c, m) => deleteVisitor(m[1], r, env, true), 'owner');
on('POST', '/api/owner/visitors/:id/leave', (_r, env, _c, m) => endVisit(m[1], env), 'owner');
on('PUT', '/api/settings', async (r, env) => {
  const b = await body<{ wifi?: WifiSettings | null; greeting?: string }>(r);
  if (b.wifi !== undefined) {
    if (b.wifi && (typeof b.wifi.ssid !== 'string' || !b.wifi.ssid.trim())) return json({ error: 'Wi-Fi name is required' }, 400);
    await setSetting(env, 'wifi', b.wifi && { ssid: b.wifi.ssid.trim().slice(0, 32), password: String(b.wifi.password ?? '').slice(0, 63), security: ['WPA', 'WEP', 'nopass'].includes(b.wifi.security) ? b.wifi.security : 'WPA', hidden: !!b.wifi.hidden });
  }
  if (typeof b.greeting === 'string') await setSetting(env, 'greeting', b.greeting.trim().slice(0, 30) || 'Bienvenido');
  return json({ ok: true });
}, 'owner');
on('GET', '/api/settings/wifi', async (_r, env) => json(await getSetting(env, 'wifi', null)), 'owner');
on('POST', '/api/lights/govee', async (r, env) => {
  const b = await body<{ apiKey?: string; bulbs?: string[] }>(r);
  if (!b.apiKey) return json({ error: 'paste your Govee API key' }, 400);
  try {
    const res = await saveGovee(env, b.apiKey.trim(), b.bulbs ?? null);
    if (res.saved) await applyScene(env, (await flag(env, 'scene')) ?? 'auto', { force: true });
    return json(res);
  } catch (err) {
    return json({ error: `Govee said no: ${String(err).slice(0, 160)}` }, 400);
  }
}, 'owner');
on('PUT', '/api/lights/zones', async (r, env) => {
  const b = await body<Record<string, Zone>>(r);
  const zones = Object.fromEntries(Object.entries(b).filter(([, z]) => (ZONES as readonly string[]).includes(z)).slice(0, 50));
  await setSetting(env, 'light:zones', zones);
  return json({ ok: true, zones });
}, 'owner');
on('DELETE', '/api/lights/govee', async (_r, env) => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM settings WHERE key = 'govee'"),
    env.DB.prepare("DELETE FROM devices WHERE id = 'govee'"),
  ]);
  return json({ ok: true });
}, 'owner');
on('POST', '/api/check', async (_r, env) => json(await dailyCheck(env)), 'owner');
on('POST', '/api/telegram/test', async (_r, env) =>
  json({ sent: await telegram(env, 'Atlántico: test message. Alerts will arrive here.') }), 'owner');
on('POST', '/api/demo', (r, env, ctx) => demo(r, env, ctx), 'owner');
on('PUT', '/api/music/spotify', (r, env) => music.connect(r, env), 'owner');
on('DELETE', '/api/music/spotify', (_r, env) => music.disconnect(env), 'owner');
on('GET', '/api/music/devices', (_r, env) => music.devices(env), 'owner');
on('PUT', '/api/music/device', (r, env) => music.chooseDevice(r, env), 'owner');
// Signed-in browsers: list them, sign this one out, or sign out everywhere.
on('GET', '/api/sessions', async (r, env) => {
  const mine = await sessionHash(r);
  const rows = await env.DB.prepare('SELECT token_hash, label, created_at, last_used FROM sessions WHERE last_used > ? ORDER BY last_used DESC')
    .bind(now() - SESSION_MS).all<any>();
  return json(rows.results.map(({ token_hash, ...s }) => ({ ...s, current: token_hash === mine })));
}, 'owner');
on('DELETE', '/api/session', async (r, env) => {
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sessionHash(r)).run();
  return json({ ok: true });
}, 'owner');
on('DELETE', '/api/sessions', async (_r, env) => {
  await env.DB.prepare('DELETE FROM sessions').run();
  return json({ ok: true });
}, 'owner');

async function route(req: Request, url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  for (const [method, re, h, access] of routes) {
    if (method !== req.method) continue;
    const raw = url.pathname.match(re);
    if (!raw) continue;
    // Path parameters arrive percent-encoded ("luc%C3%ADa"): decode them before use.
    const m = raw.map((x, i) => { if (!i) return x; try { return decodeURIComponent(x); } catch { return x; } }) as unknown as RegExpMatchArray;
    if (access === 'owner') {
      const denied = await requireOwner(req, env);
      if (denied) return denied;
    }
    return h(req, env, ctx, m, url);
  }
  return json({ error: 'not found' }, 404);
}

async function overview(env: Env) {
  await ensureSeeded(env);
  const [wall, plants, devices, alerts, visitors, lightsLast, checkLast, demoScenario, wifi, greeting, govee, lamps] = await Promise.all([
    wallState(env), plantStatus(env), listDevices(env),
    env.DB.prepare('SELECT * FROM alerts ORDER BY ts DESC LIMIT 60').all().then((r) => r.results),
    listVisitors(env),
    env.STATE.get('lights:last', 'json'), env.STATE.get('check:last', 'json'),
    flag(env, 'demo:scenario'),
    getSetting<WifiSettings | null>(env, 'wifi', null), getSetting(env, 'greeting', 'Bienvenido'),
    getSetting<any>(env, 'govee', null),
    adapterFor(env),
  ]);
  const today = edition(wall.editionDate, wall.style);
  const coming = Array.from({ length: 8 }, (_, d) => { const e = edition(Date.now() + d * 86400000); return { day: d, n: e.n, style: e.style, palette: e.palette.name, label: e.label }; });
  return json({
    wall: { ...wall, visitors: wall.visitors.length, edition: { n: today.n, label: today.label, style: today.style, palette: today.palette.name } },
    scenes: Object.entries(SCENES).map(([id, s]) => ({ id, label: s.label })),
    autoState: autoState(env),
    lights: lightsLast,
    bulbs: lamps.bulbs.map((b) => ({ id: b.id, name: b.name, zone: b.zone })),
    music: await music.musicStatus(env),
    zones: ZONES,
    plants, devices, alerts, visitors,
    check: checkLast,
    settings: {
      wifi: wifi ? { ssid: wifi.ssid, security: wifi.security, hidden: wifi.hidden, hasPassword: !!wifi.password } : null,
      greeting,
      govee: govee ? { bulbs: govee.bulbs.map((b: any) => ({ id: b.id, name: b.name })) } : null,
      claude: !!env.ANTHROPIC_API_KEY, telegram: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
    },
    demo: {
      simulate: env.SIMULATE === 'true',
      scenario: demoScenario ?? 'live',
      scenarios: ['live', ...Object.keys(SCENARIOS)],
      sun: wall.sunOverride ?? 'live',
      suns: ['live', ...Object.keys(SUN_PRESETS)],
      style: wall.style ?? 'today',
      styles: ['today', ...STYLES],
      day: Math.round((wall.editionDate - Date.now()) / 86400000),
      coming,
      stops: Object.keys(STOPS),
      elements: Object.entries(ELEMENTS).map(([id, e]: [string, any]) => ({ id, es: e.es, en: e.en, when: e.when })),
      surprise: await surprises.current(env),
      offline: JSON.parse((await flag(env, 'demo:offline')) ?? '[]'),
    },
  });
}

// ── Demo controls ────────────────────────────────────────────────────────────
async function demo(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const b = await body<{ action: string; value?: any }>(req);
  switch (b.action) {
    case 'scenario':
      if (b.value === 'live' || !b.value) await setFlag(env, 'demo:scenario', null);
      else if (SCENARIOS[b.value]) await setFlag(env, 'demo:scenario', b.value);
      await bumpWall(env);
      return json({ ok: true });
    case 'sun':
      if (b.value === 'live' || !SUN_PRESETS[b.value]) await setFlag(env, 'demo:sun', null);
      else await setFlag(env, 'demo:sun', b.value);
      await bumpWall(env);
      return json({ ok: true });
    case 'style':
      await setFlag(env, 'demo:day', null);
      if (!STYLES.includes(b.value)) await setFlag(env, 'demo:style', null);
      else await setFlag(env, 'demo:style', b.value);
      await bumpWall(env);
      return json({ ok: true });
    case 'day': {
      // Preview a coming day's edition (its style, palette and horizon), or 0 for today.
      const n = Math.max(0, Math.min(30, Math.round(Number(b.value) || 0)));
      await setFlag(env, 'demo:style', null);
      if (n) await setFlag(env, 'demo:day', String(n)); else await setFlag(env, 'demo:day', null);
      await bumpWall(env);
      return json({ ok: true });
    }
    case 'tour': {
      // One stop of the guest tour, as the most recent guest (the owner's button plays them in turn).
      if (!(String(b.value) in STOPS)) return json({ error: 'unknown stop' }, 400);
      const v = await env.DB.prepare('SELECT id, first_name, visits FROM visitors ORDER BY COALESCE(last_seen, created_at) DESC LIMIT 1').first<any>();
      await playStop(env, ctx, { id: v?.id ?? null, name: v?.first_name ?? null, visits: v?.visits ?? 1 }, String(b.value));
      return json({ ok: true });
    }
    case 'surprise':
      // A surprise now: 'random', 'small', or led by one element (see web/lib/surprise.js).
      return surprises.demoSurprise(env, String(b.value ?? 'random'));
    case 'showcase':
      // Every daily style in turn on the wall, for 40 seconds.
      await playStop(env, ctx, { id: null, name: null, visits: 0 }, 'edition', true);
      return json({ ok: true });
    case 'arrive': {
      const name = cleanName(b.value) ?? 'Lucía';
      return demoArrive(env, ctx, name);
    }
    case 'fastforward':
      await fastForward(env, Math.max(1, Math.min(240, Number(b.value) || 24)));
      return json({ ok: true });
    case 'dry': {
      const p = (await listPlants(env)).find((x) => x.id === b.value);
      if (!p?.device_id?.startsWith('sim-')) return json({ error: 'only for simulated plants' }, 400);
      const last = await env.DB.prepare('SELECT temp, reservoir FROM readings WHERE plant_id = ? ORDER BY ts DESC LIMIT 1').bind(p.id).first<any>();
      await recordReading(env, p.id, p.device_id, { moisture: Math.max(4, p.rules.waterBelow - 6), temp: last?.temp ?? 22, reservoir: last?.reservoir ?? 60 });
      return json({ ok: true });
    }
    case 'empty':
    case 'refill': {
      const p = (await listPlants(env)).find((x) => x.id === b.value);
      if (!p?.device_id?.startsWith('sim-')) return json({ error: 'only for simulated plants' }, 400);
      const last = await env.DB.prepare('SELECT moisture, temp FROM readings WHERE plant_id = ? ORDER BY ts DESC LIMIT 1').bind(p.id).first<any>();
      await recordReading(env, p.id, p.device_id, { moisture: last?.moisture ?? 30, temp: last?.temp ?? 22, reservoir: b.action === 'refill' ? 100 : 6 });
      return json({ ok: true });
    }
    case 'offline': {
      const list: string[] = JSON.parse((await flag(env, 'demo:offline')) ?? '[]');
      const id = String(b.value);
      const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      await setFlag(env, 'demo:offline', JSON.stringify(next));
      if (!list.includes(id)) await env.DB.prepare('UPDATE devices SET last_seen = ? WHERE id = ? AND simulated = 1').bind(now() - 6 * 3600000, id).run();
      else await env.DB.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').bind(now(), id).run();
      return json({ ok: true, offline: next });
    }
    case 'check':
      return json(await dailyCheck(env));
    case 'clear-demo-visitors':
      await env.DB.prepare("DELETE FROM visitors WHERE delete_token = 'demo'").run();
      await bumpWall(env);
      return json({ ok: true });
    case 'note':
      await logAlert(env, 'system', null, String(b.value ?? 'Test alert from the demo panel.').slice(0, 200));
      return json({ ok: true });
    default:
      return json({ error: 'unknown demo action' }, 400);
  }
}
