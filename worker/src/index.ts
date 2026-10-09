import type { Env } from './env';
import { json, cors, preflight } from './http';
import { requireOwner, body, setSetting, getSetting, now, logAlert } from './util';
import { wallState, panelImage, panelPoll, liveSVG, liveHTML, bumpWall, SUN_PRESETS } from './wall';
import { SCENARIOS } from './weather';
import { arrive, welcome, deleteVisitor, listVisitors, guestInfo, cleanName, type WifiSettings } from './guests';
import { applyScene, saveGovee, SCENES, autoState } from './lights';
import { plantStatus, listPlants, ensureSeeded, simulatorTick, fastForward, recordReading, type Rules } from './plants';
import { createPairing, pairingStatus, pair, report, listDevices, updateDevice, removeDevice, offlineAlerts } from './devices';
import { dailyCheck, telegram } from './check';

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
  if (env.SIMULATE === 'true') await simulatorTick(env);
  await wallState(env); // refreshes the live weather cache
  if (((await env.STATE.get('scene')) ?? 'auto') === 'auto') await applyScene(env, 'auto');
  await offlineAlerts(env);
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
on('GET', '/art/live', (_r, env, _c, _m, url) => liveHTML(url, env));
on('GET', '/art/live.svg', (_r, env, _c, _m, url) => liveSVG(url, env));
on('GET', '/art/panel.png', (r, env, _c, _m, url) => panelImage(r, url, env, 'png'));
on('GET', '/art/panel.bin', (r, env, _c, _m, url) => panelImage(r, url, env, 'bin'));
on('GET', '/api/guest', (_r, env) => guestInfo(env));
on('POST', '/api/arrive', (r, env, ctx) => arrive(r, env, ctx));
on('DELETE', '/api/visitors/:id', (r, env, _c, m) => deleteVisitor(m[1], r, env));

// ── Devices ──────────────────────────────────────────────────────────────────
on('POST', '/api/pair', (r, env) => pair(r, env));
on('POST', '/api/device/report', (r, env) => report(r, env));
on('GET', '/api/panel/poll', (r, env) => panelPoll(r, env));

// ── Owner ────────────────────────────────────────────────────────────────────
on('GET', '/api/overview', async (_r, env) => overview(env), 'owner');
on('POST', '/api/scene', async (r, env) => {
  const { scene } = await body<{ scene: string }>(r);
  if (!SCENES[scene]) return json({ error: 'unknown scene' }, 400);
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
on('GET', '/api/pairing/:code', (_r, env, _c, m) => pairingStatus(m[1], env), 'owner');
on('PATCH', '/api/devices/:id', (r, env, _c, m) => updateDevice(m[1], r, env), 'owner');
on('DELETE', '/api/devices/:id', (_r, env, _c, m) => removeDevice(m[1], env), 'owner');
on('GET', '/api/visitors', async (_r, env) => json(await listVisitors(env)), 'owner');
on('DELETE', '/api/owner/visitors/:id', (r, env, _c, m) => deleteVisitor(m[1], r, env, true), 'owner');
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
    if (res.saved) await applyScene(env, (await env.STATE.get('scene')) ?? 'auto', { force: true });
    return json(res);
  } catch (err) {
    return json({ error: `Govee said no: ${String(err).slice(0, 160)}` }, 400);
  }
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

async function route(req: Request, url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  for (const [method, re, h, access] of routes) {
    if (method !== req.method) continue;
    const m = url.pathname.match(re);
    if (!m) continue;
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
  const [wall, plants, devices, alerts, visitors, lightsLast, checkLast, demoScenario, wifi, greeting, govee] = await Promise.all([
    wallState(env), plantStatus(env), listDevices(env),
    env.DB.prepare('SELECT * FROM alerts ORDER BY ts DESC LIMIT 60').all().then((r) => r.results),
    listVisitors(env),
    env.STATE.get('lights:last', 'json'), env.STATE.get('check:last', 'json'),
    env.STATE.get('demo:scenario'),
    getSetting<WifiSettings | null>(env, 'wifi', null), getSetting(env, 'greeting', 'Bienvenido'),
    getSetting<any>(env, 'govee', null),
  ]);
  return json({
    wall: { ...wall, visitors: wall.visitors.length },
    scenes: Object.entries(SCENES).map(([id, s]) => ({ id, label: s.label })),
    autoState: autoState(env),
    lights: lightsLast,
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
      offline: JSON.parse((await env.STATE.get('demo:offline')) ?? '[]'),
    },
  });
}

// ── Demo controls ────────────────────────────────────────────────────────────
async function demo(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const b = await body<{ action: string; value?: any }>(req);
  switch (b.action) {
    case 'scenario':
      if (b.value === 'live' || !b.value) await env.STATE.delete('demo:scenario');
      else if (SCENARIOS[b.value]) await env.STATE.put('demo:scenario', b.value);
      await bumpWall(env);
      return json({ ok: true });
    case 'sun':
      if (b.value === 'live' || !SUN_PRESETS[b.value]) await env.STATE.delete('demo:sun');
      else await env.STATE.put('demo:sun', b.value);
      await bumpWall(env);
      return json({ ok: true });
    case 'arrive': {
      const name = cleanName(b.value) ?? 'Lucía';
      return welcome(env, ctx, name);
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
      const list: string[] = JSON.parse((await env.STATE.get('demo:offline')) ?? '[]');
      const id = String(b.value);
      const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      await env.STATE.put('demo:offline', JSON.stringify(next));
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
