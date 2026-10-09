// Plants: per-plant rules, readings, watering decisions, and the simulator.
import type { Env } from './env';
import { now, logAlert } from './util';

export interface Rules {
  waterBelow: number;        // % soil moisture that triggers watering
  doseMl: number;            // one watering
  minIntervalH: number;      // never water more often than this
  maxDailyMl: number;        // hard daily cap (protects floors from a stuck sensor)
  tempMin: number; tempMax: number;
  fallbackEveryDays: number; // offline + sensor fault: water this often anyway
  reservoirMl: number;       // reservoir size, for the % estimate
  pumpMlPerSec: number;      // calibrate once with a measuring jug
}

export interface Plant { id: string; name: string; species: string; device_id: string | null; rules: Rules; last_check: string | null; sort: number }

// Sensible starting points for the four plants. Edit per plant in the control page.
export const DEFAULT_PLANTS: Omit<Plant, 'device_id' | 'last_check'>[] = [
  { id: 'olivo', name: 'Olivo', species: 'Olive tree (Olea europaea)', sort: 0,
    rules: { waterBelow: 22, doseMl: 450, minIntervalH: 72, maxDailyMl: 900, tempMin: 2, tempMax: 42, fallbackEveryDays: 5, reservoirMl: 5000, pumpMlPerSec: 25 } },
  { id: 'strelitzia', name: 'Strelitzia', species: 'Giant white bird of paradise (Strelitzia nicolai)', sort: 1,
    rules: { waterBelow: 35, doseMl: 500, minIntervalH: 48, maxDailyMl: 1000, tempMin: 10, tempMax: 35, fallbackEveryDays: 4, reservoirMl: 5000, pumpMlPerSec: 25 } },
  { id: 'sansevieria', name: 'Sansevieria', species: 'Snake plant (Dracaena trifasciata)', sort: 2,
    rules: { waterBelow: 12, doseMl: 200, minIntervalH: 240, maxDailyMl: 300, tempMin: 10, tempMax: 35, fallbackEveryDays: 18, reservoirMl: 3000, pumpMlPerSec: 25 } },
  { id: 'zamioculca', name: 'Zamioculca', species: 'ZZ plant (Zamioculcas zamiifolia)', sort: 3,
    rules: { waterBelow: 15, doseMl: 220, minIntervalH: 168, maxDailyMl: 300, tempMin: 12, tempMax: 35, fallbackEveryDays: 14, reservoirMl: 3000, pumpMlPerSec: 25 } },
];

export async function listPlants(env: Env): Promise<Plant[]> {
  const r = await env.DB.prepare('SELECT * FROM plants ORDER BY sort').all<any>();
  return r.results.map((p) => ({ ...p, rules: JSON.parse(p.rules) }));
}

export async function lastWatering(env: Env, plantId: string) {
  return env.DB.prepare('SELECT ts, ml, source FROM waterings WHERE plant_id = ? ORDER BY ts DESC LIMIT 1')
    .bind(plantId).first<{ ts: number; ml: number; source: string }>();
}

async function wateredToday(env: Env, plantId: string): Promise<number> {
  const r = await env.DB.prepare('SELECT COALESCE(SUM(ml), 0) AS ml FROM waterings WHERE plant_id = ? AND ts > ?')
    .bind(plantId, now() - 86400000).first<{ ml: number }>();
  return r?.ml ?? 0;
}

/** Server-side rule: should this plant get water now? Returns ml or 0. */
export async function decideWatering(env: Env, p: Plant, moisture: number | null, reservoir: number | null): Promise<number> {
  const owner = Number((await env.STATE.get(`cmd:water:${p.id}`)) ?? 0);
  if (owner) { await env.STATE.delete(`cmd:water:${p.id}`); return owner; }
  if (moisture == null || moisture >= p.rules.waterBelow) return 0;
  if (reservoir != null && reservoir < 5) return 0;
  const last = await lastWatering(env, p.id);
  if (last && now() - last.ts < p.rules.minIntervalH * 3600000) return 0;
  if ((await wateredToday(env, p.id)) + p.rules.doseMl > p.rules.maxDailyMl) return 0;
  return p.rules.doseMl;
}

export async function recordReading(env: Env, plantId: string, deviceId: string | null, r: { moisture?: number; temp?: number; reservoir?: number }, ts = now()) {
  await env.DB.prepare('INSERT INTO readings (plant_id, device_id, ts, moisture, temp, reservoir) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(plantId, deviceId, ts, r.moisture ?? null, r.temp ?? null, r.reservoir ?? null).run();
}

export async function recordWatering(env: Env, plantId: string, ml: number, source: string, ts = now()) {
  await env.DB.prepare('INSERT INTO waterings (plant_id, ts, ml, source) VALUES (?, ?, ?, ?)').bind(plantId, ts, ml, source).run();
}

/** Plant status for the control page: latest values, 14-day series, last watering. */
export async function plantStatus(env: Env) {
  const plants = await listPlants(env);
  const since = now() - 14 * 86400000;
  return Promise.all(plants.map(async (p) => {
    const [latest, series, water, device] = await Promise.all([
      env.DB.prepare('SELECT ts, moisture, temp, reservoir FROM readings WHERE plant_id = ? ORDER BY ts DESC LIMIT 1').bind(p.id).first<any>(),
      env.DB.prepare(`SELECT (ts / 14400000) * 14400000 AS t, AVG(moisture) AS m FROM readings
        WHERE plant_id = ? AND ts > ? GROUP BY ts / 14400000 ORDER BY t`).bind(p.id, since).all<{ t: number; m: number }>(),
      lastWatering(env, p.id),
      p.device_id ? env.DB.prepare('SELECT id, name, simulated, last_seen FROM devices WHERE id = ?').bind(p.device_id).first<any>() : null,
    ]);
    const queued = Number((await env.STATE.get(`cmd:water:${p.id}`)) ?? 0);
    const flags: string[] = [];
    if (latest?.moisture != null && latest.moisture < p.rules.waterBelow) flags.push('dry');
    if (latest?.reservoir != null && latest.reservoir < 20) flags.push('reservoir low');
    if (latest?.temp != null && (latest.temp < p.rules.tempMin || latest.temp > p.rules.tempMax)) flags.push('temperature');
    return { ...p, latest, series: series.results, lastWatering: water, device, queuedMl: queued, flags };
  }));
}

// ── Simulator ────────────────────────────────────────────────────────────────
// Drying in %-points per day at 22 °C; the olive lives on the terrace in the Cádiz sun.
const DRY_RATE: Record<string, number> = { olivo: 4.2, strelitzia: 3.4, sansevieria: 1.1, zamioculca: 0.9 };
const OUTDOOR = new Set(['olivo']);

function simTemp(plantId: string, ts: number) {
  const h = (ts / 3600000 + 2) % 24; // ~local hour
  const day = Math.sin(((h - 9) / 24) * 2 * Math.PI);
  return OUTDOOR.has(plantId) ? 19 + 6 * day : 22.5 + 1.5 * day;
}

function wobble(seed: number) { return Math.sin(seed * 12.9898) * 43758.5453 % 1; }

/** Advance one simulated plant from its last reading to `to`, in steps. Returns rows written. */
async function simulatePlant(env: Env, p: Plant, to: number, stepMs = 15 * 60000, from?: number) {
  const last = await env.DB.prepare('SELECT ts, moisture, reservoir FROM readings WHERE plant_id = ? ORDER BY ts DESC LIMIT 1').bind(p.id).first<any>();
  let t = from ?? last?.ts ?? to - stepMs;
  let m: number = last?.moisture ?? p.rules.waterBelow + 20;
  let res: number = last?.reservoir ?? 85;
  let lastWater = (await lastWatering(env, p.id))?.ts ?? 0;
  const stmts: D1PreparedStatement[] = [];
  const insR = env.DB.prepare('INSERT INTO readings (plant_id, device_id, ts, moisture, temp, reservoir) VALUES (?, ?, ?, ?, ?, ?)');
  const insW = env.DB.prepare('INSERT INTO waterings (plant_id, ts, ml, source) VALUES (?, ?, ?, ?)');
  let owner = Number((await env.STATE.get(`cmd:water:${p.id}`)) ?? 0);
  if (owner) await env.STATE.delete(`cmd:water:${p.id}`);
  while (t + stepMs <= to) {
    t += stepMs;
    const temp = simTemp(p.id, t) + wobble(t / 1e6) * 0.6;
    m -= (DRY_RATE[p.id] ?? 2) * (stepMs / 86400000) * (1 + (temp - 22) * 0.04);
    m = Math.max(3, m);
    const due = m < p.rules.waterBelow && t - lastWater > p.rules.minIntervalH * 3600000 && res > 5;
    if (owner || due) {
      const ml = owner || p.rules.doseMl;
      owner = 0;
      m = Math.min(70, m + ml / (p.rules.doseMl / 28));
      res = Math.max(0, res - (ml / p.rules.reservoirMl) * 100);
      lastWater = t;
      stmts.push(insW.bind(p.id, t, ml, due && ml === p.rules.doseMl ? 'simulator' : 'owner'));
    }
    // Someone tops up a nearly empty reservoir after a while.
    if (res < 8 && wobble(t / 3.6e6) > 0.97) res = 100;
    stmts.push(insR.bind(p.id, p.device_id, t, round1(m + wobble(t) * 0.4), round1(temp), round1(res)));
  }
  for (let i = 0; i < stmts.length; i += 400) await env.DB.batch(stmts.slice(i, i + 400));
  return stmts.length;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export async function simulatorTick(env: Env, to = now()) {
  const plants = await listPlants(env);
  const sim = await env.DB.prepare("SELECT id FROM devices WHERE simulated = 1 AND type = 'plant'").all<{ id: string }>();
  const simIds = new Set(sim.results.map((d) => d.id));
  for (const p of plants) if (p.device_id && simIds.has(p.device_id)) await simulatePlant(env, p, to);
  await env.DB.prepare('UPDATE devices SET last_seen = ? WHERE simulated = 1 AND id NOT IN (SELECT value FROM json_each(?))')
    .bind(to, JSON.stringify(JSON.parse((await env.STATE.get('demo:offline')) ?? '[]'))).run();
}

/** Demo: run the plants forward by `hours` (history is shifted back so "now" stays now). */
export async function fastForward(env: Env, hours: number) {
  const shift = hours * 3600000;
  await env.DB.batch([
    env.DB.prepare('UPDATE readings SET ts = ts - ? WHERE device_id IN (SELECT id FROM devices WHERE simulated = 1)').bind(shift),
    env.DB.prepare("UPDATE waterings SET ts = ts - ? WHERE plant_id IN (SELECT id FROM plants WHERE device_id IN (SELECT id FROM devices WHERE simulated = 1))").bind(shift),
  ]);
  await simulatorTick(env);
}

/** First run: plants (always) and, in SIMULATE mode, simulated devices with three weeks of history. */
export async function ensureSeeded(env: Env) {
  const have = await env.DB.prepare('SELECT COUNT(*) AS n FROM plants').first<{ n: number }>();
  if (have && have.n > 0) return false;
  const t = now();
  const stmts = DEFAULT_PLANTS.map((p) => env.DB.prepare('INSERT INTO plants (id, name, species, device_id, rules, sort) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(p.id, p.name, p.species, env.SIMULATE === 'true' ? `sim-plant-${p.id}` : null, JSON.stringify(p.rules), p.sort));
  if (env.SIMULATE === 'true') {
    const dev = env.DB.prepare('INSERT OR IGNORE INTO devices (id, type, name, simulated, config, last_seen, created_at) VALUES (?, ?, ?, 1, ?, ?, ?)');
    stmts.push(dev.bind('sim-panel', 'panel', 'Wall panel (simulated)', JSON.stringify({ size: '800x480', colors: 2 }), t, t));
    stmts.push(dev.bind('sim-lights', 'lights', 'Lights (simulated)', '{}', t, t));
    for (const p of DEFAULT_PLANTS) stmts.push(dev.bind(`sim-plant-${p.id}`, 'plant', `${p.name} node (simulated)`, JSON.stringify({ plantId: p.id }), t, t));
    const v = env.DB.prepare('INSERT INTO visitors (id, first_name, delete_token, created_at) VALUES (?, ?, ?, ?)');
    ['Lucía', 'Marco', 'Inés', 'Tom', 'Carmen', 'Pablo', 'Ana'].forEach((n, i) =>
      stmts.push(v.bind(`demo-${i}-${n.toLowerCase()}`, n, 'demo', t - (40 - i * 5) * 86400000)));
  }
  await env.DB.batch(stmts);
  if (env.SIMULATE === 'true') {
    for (const p of await listPlants(env)) {
      // Start each plant at a different point in its cycle, then let three weeks play out.
      const start = t - 21 * 86400000;
      await recordReading(env, p.id, p.device_id, { moisture: p.rules.waterBelow + 8 + DEFAULT_PLANTS.findIndex((d) => d.id === p.id) * 6, temp: 22, reservoir: 90 }, start);
      await simulatePlant(env, p, t, 2 * 3600000, start);
    }
    await logAlert(env, 'system', null, 'Demo data created: simulated panel, lights, four plant nodes and a few visitors.', 1);
  }
  return true;
}

export { simulatePlant };
