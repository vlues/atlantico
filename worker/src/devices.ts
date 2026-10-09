// Devices: one-time pairing codes, device tokens, reports, and online/offline state.
import type { Env } from './env';
import { json } from './http';
import { now, randomId, pairingCode, sha256, body, deviceFromRequest, logAlert, type DeviceRow } from './util';
import { listPlants, decideWatering, recordReading, recordWatering } from './plants';
import { telegram } from './check';
import { screenChanged } from './screens';

// How often each kind checks in; offline after 3 missed check-ins.
export const EXPECTED_S: Record<string, number> = { panel: 900, plant: 1200, lights: 86400, screen: 300 };

export async function createPairing(req: Request, env: Env) {
  const b = await body<{ type: string; name?: string; config?: Record<string, unknown> }>(req);
  if (!['panel', 'plant'].includes(b.type)) return json({ error: 'type must be panel or plant' }, 400);
  if (b.type === 'plant') {
    const plants = await listPlants(env);
    if (!plants.some((p) => p.id === b.config?.plantId)) return json({ error: 'choose which plant this node waters' }, 400);
  }
  const code = pairingCode();
  await env.DB.prepare('INSERT INTO pairing_codes (code, type, config, expires_at) VALUES (?, ?, ?, ?)')
    .bind(code, b.type, JSON.stringify({ ...(b.config ?? {}), name: b.name ?? null }), now() + 30 * 60000).run();
  return json({ code, expiresInMin: 30 });
}

export async function pairingStatus(code: string, env: Env) {
  const done = await env.STATE.get(`pair:done:${code}`);
  if (done) return json({ paired: true, deviceId: done });
  const open = await env.DB.prepare('SELECT expires_at FROM pairing_codes WHERE code = ?').bind(code).first<{ expires_at: number }>();
  return json({ paired: false, expired: !open || open.expires_at < now() });
}

/** Called by the device itself, once, after it has Wi-Fi. */
export async function pair(req: Request, env: Env) {
  const b = await body<{ code?: string; mac?: string; fw?: string; chip?: string }>(req);
  const code = (b.code ?? '').toUpperCase().trim();
  const row = await env.DB.prepare('SELECT * FROM pairing_codes WHERE code = ?').bind(code).first<any>();
  if (!row || row.expires_at < now()) return json({ error: 'unknown or expired pairing code' }, 403);
  const cfg = JSON.parse(row.config);
  const mac = (b.mac ?? randomId(3)).replace(/[^0-9a-f]/gi, '').toLowerCase().slice(-6);
  const id = `${row.type}-${mac}`;
  const token = randomId(32);
  const t = now();
  const stmts = [
    env.DB.prepare('DELETE FROM pairing_codes WHERE code = ?').bind(code),
    env.DB.prepare(`INSERT OR REPLACE INTO devices (id, type, name, token_hash, simulated, config, last_seen, created_at)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?)`).bind(id, row.type, cfg.name || defaultName(row.type, cfg), await sha256(token),
      JSON.stringify({ ...cfg, fw: b.fw, chip: b.chip }), t, t),
  ];
  // The real device takes over from its simulated stand-in.
  if (row.type === 'panel') stmts.push(env.DB.prepare("DELETE FROM devices WHERE id = 'sim-panel'"));
  if (row.type === 'plant') {
    stmts.push(env.DB.prepare('UPDATE plants SET device_id = ? WHERE id = ?').bind(id, cfg.plantId));
    stmts.push(env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(`sim-plant-${cfg.plantId}`));
  }
  await env.DB.batch(stmts);
  await env.STATE.put(`pair:done:${code}`, id, { expirationTtl: 3600 });
  await logAlert(env, 'device', id, `Paired ${defaultName(row.type, cfg)} (${id}).`, 1);
  return json({ deviceId: id, token, type: row.type, config: await deviceConfig(env, id, row.type, cfg) });
}

function defaultName(type: string, cfg: any) {
  return type === 'panel' ? 'Wall panel' : `Plant node · ${cfg.plantId}`;
}

/** What the device needs to know: rules for local fallback, panel size, intervals. */
async function deviceConfig(env: Env, id: string, type: string, cfg: any) {
  if (type === 'plant') {
    const p = (await listPlants(env)).find((x) => x.id === cfg.plantId);
    return { plantId: cfg.plantId, rules: p?.rules, sleep: EXPECTED_S.plant };
  }
  return { size: cfg.size ?? '800x480', colors: Number(cfg.colors ?? 2), power: cfg.power ?? 'usb', sleep: EXPECTED_S.panel };
}

/** Plant nodes post readings here on every wake; the reply carries commands and current rules. */
export async function report(req: Request, env: Env) {
  const dev = await deviceFromRequest(req, env);
  if (!dev) return json({ error: 'unknown device' }, 401);
  const b = await body<any>(req);
  await env.STATE.put(`dev:${dev.id}:status`, JSON.stringify({ battery: b.battery ?? null, rssi: b.rssi ?? null, fw: b.fw ?? null, at: now() }));
  if (dev.type !== 'plant') return json({ ok: true });
  const cfg = JSON.parse(dev.config);
  const plant = (await listPlants(env)).find((p) => p.id === cfg.plantId);
  if (!plant) return json({ error: 'node is not assigned to a plant' }, 409);
  for (const w of b.watered ?? []) {
    await recordWatering(env, plant.id, Number(w.ml) || 0, w.source ?? 'local-fallback', now() - (Number(w.ago_s) || 0) * 1000);
  }
  const clamp = (v: any, a: number, z: number) => (typeof v === 'number' && isFinite(v) ? Math.max(a, Math.min(z, v)) : undefined);
  const r = { moisture: clamp(b.moisture, 0, 100), temp: clamp(b.temp, -20, 70), reservoir: clamp(b.reservoir, 0, 100) };
  await recordReading(env, plant.id, dev.id, r);
  const water = await decideWatering(env, plant, r.moisture ?? null, r.reservoir ?? null);
  if (water) await recordWatering(env, plant.id, water, 'rule');
  return json({ water_ml: water, sleep: EXPECTED_S.plant, rules: plant.rules });
}

export async function listDevices(env: Env) {
  const rows = await env.DB.prepare('SELECT id, type, name, simulated, config, last_seen, created_at FROM devices ORDER BY type, name').all<DeviceRow>();
  return Promise.all(rows.results.map(async (d) => {
    const status = await env.STATE.get<any>(`dev:${d.id}:status`, 'json');
    const age = d.last_seen ? (now() - d.last_seen) / 1000 : Infinity;
    return { ...d, config: JSON.parse(d.config), status, online: age < (EXPECTED_S[d.type] ?? 900) * 3, lastSeenS: isFinite(age) ? Math.round(age) : null };
  }));
}

export async function updateDevice(id: string, req: Request, env: Env) {
  const b = await body<{ name?: string; config?: Record<string, unknown> }>(req);
  const d = await env.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(id).first<DeviceRow>();
  if (!d) return json({ error: 'not found' }, 404);
  const config = { ...JSON.parse(d.config), ...(b.config ?? {}) };
  await env.DB.prepare('UPDATE devices SET name = ?, config = ? WHERE id = ?').bind(b.name ?? d.name, JSON.stringify(config), id).run();
  if (d.type === 'screen') await screenChanged(env); // screens pick up new settings within seconds
  return json({ ok: true });
}

export async function removeDevice(id: string, env: Env) {
  await env.DB.batch([
    env.DB.prepare('UPDATE plants SET device_id = NULL WHERE device_id = ?').bind(id),
    env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}

/** Cron: tell the owner once when a real device stops checking in. */
export async function offlineAlerts(env: Env) {
  for (const d of await listDevices(env)) {
    // TVs and tablets get switched off; only alert for devices that are meant to stay on.
    if (d.simulated || d.type === 'lights' || d.type === 'screen') continue;
    const key = `offline-alerted:${d.id}`;
    if (!d.online && !(await env.STATE.get(key))) {
      const msg = `${d.name} has been offline since ${d.last_seen ? new Date(d.last_seen).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'pairing'}.`;
      await logAlert(env, 'device', d.id, msg, (await telegram(env, `Atlántico · ${msg}`)) ? 1 : 0);
      await env.STATE.put(key, '1');
    } else if (d.online) await env.STATE.delete(key);
  }
}
