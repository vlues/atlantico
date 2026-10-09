// Lights: one small adapter interface, a simulator, and Govee's cloud API.
// Adding a brand = one object implementing LightAdapter, plus a case in adapterFor().
import type { Env } from './env';
import { getSetting, setSetting, logAlert, flag, setFlag } from './util';
// @ts-ignore
import { sunPosition } from '../../web/lib/sun.js';

export interface Bulb { id: string; name: string; model?: string; kelvin?: [number, number]; rgb?: boolean }
export interface LightState { on: boolean; brightness: number; kelvin: number }
export interface LightAdapter {
  kind: string;
  list(): Promise<Bulb[]>;
  /** `prev` is the bulb's last known state: only what changed needs sending. */
  set(bulb: Bulb, s: LightState, prev?: LightState): Promise<void>;
}

/** Where each bulb is in the flat, so the guest tour can light the part of the room it is talking about. */
export const ZONES = ['wall', 'plants', 'sofa', 'none'] as const;
export type Zone = (typeof ZONES)[number];

export const SCENES: Record<string, { label: string; state: LightState | null }> = {
  auto: { label: 'Auto', state: null }, // follows the sun, see autoState()
  hosting: { label: 'Hosting', state: { on: true, brightness: 55, kelvin: 2400 } },
  evening: { label: 'Evening', state: { on: true, brightness: 28, kelvin: 2200 } },
  focus: { label: 'Focus', state: { on: true, brightness: 90, kelvin: 4300 } },
  off: { label: 'Off', state: { on: false, brightness: 0, kelvin: 2700 } },
};

/** Sunrise/sunset warmth: off in bright daylight, warm as the sun drops, dim and amber at night. */
export function autoState(env: Env, date = new Date()): LightState {
  const alt: number = sunPosition(date, Number(env.LAT), Number(env.LON)).altitude;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Madrid' }).format(date));
  if (alt > 10) return { on: false, brightness: 0, kelvin: 4000 };
  if (alt > 0) return { on: true, brightness: Math.round(40 + (10 - alt) * 2), kelvin: Math.round(2700 + alt * 80) };
  if (hour >= 0 && hour < 6) return { on: false, brightness: 0, kelvin: 2000 };
  if (hour >= 23) return { on: true, brightness: 18, kelvin: 2000 };
  return { on: true, brightness: alt > -6 ? 55 : 40, kelvin: alt > -6 ? 2500 : 2200 };
}

// ── Simulator ────────────────────────────────────────────────────────────────
const SIM_BULBS: Bulb[] = [
  { id: 'sim-salon', name: 'Salón', kelvin: [2000, 6500] },
  { id: 'sim-lampara', name: 'Lámpara de pie', kelvin: [2000, 6500] },
  { id: 'sim-dormitorio', name: 'Dormitorio', kelvin: [2000, 6500] },
];
const SIM_ZONES: Record<string, Zone> = { 'sim-salon': 'wall', 'sim-lampara': 'plants', 'sim-dormitorio': 'none' };
const simAdapter = (env: Env): LightAdapter => ({
  kind: 'simulator',
  async list() { return SIM_BULBS; },
  async set(bulb, s) {
    const all = (await env.STATE.get<Record<string, LightState>>('lights:sim', 'json')) ?? {};
    all[bulb.id] = s;
    await env.STATE.put('lights:sim', JSON.stringify(all));
  },
});

// ── Govee (https://developer.govee.com) ─────────────────────────────────────
const GOVEE = 'https://openapi.api.govee.com/router/api/v1';
export interface GoveeSettings { apiKey: string; bulbs: (Bulb & { sku: string; device: string })[] }

export function goveeAdapter(apiKey: string, chosen: GoveeSettings['bulbs'] = []): LightAdapter & { list(): Promise<GoveeSettings['bulbs']> } {
  const call = async (path: string, init: RequestInit = {}) => {
    const r = await fetch(`${GOVEE}${path}`, {
      ...init, headers: { 'Govee-API-Key': apiKey, 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
    if (!r.ok) throw new Error(`Govee ${path} → ${r.status} ${await r.text()}`);
    return r.json<any>();
  };
  const control = (b: { sku: string; device: string }, type: string, instance: string, value: number) =>
    call('/device/control', { method: 'POST', body: JSON.stringify({
      requestId: crypto.randomUUID(), payload: { sku: b.sku, device: b.device, capability: { type, instance, value } },
    }) });
  return {
    kind: 'govee',
    async list() {
      const data = await call('/user/devices');
      return (data.data ?? [])
        .filter((d: any) => (d.capabilities ?? []).some((c: any) => c.instance === 'powerSwitch'))
        .map((d: any) => {
          const ct = (d.capabilities ?? []).find((c: any) => c.instance === 'colorTemperatureK');
          const range = ct?.parameters?.range;
          return {
            id: `${d.sku}:${d.device}`, sku: d.sku, device: d.device, name: d.deviceName || d.sku, model: d.sku,
            kelvin: range ? [range.min, range.max] : undefined,
            rgb: (d.capabilities ?? []).some((c: any) => c.instance === 'colorRgb'),
          };
        });
    },
    async set(bulb, s, prev) {
      // Govee allows only a few requests per bulb per minute, so send just what changed.
      const b = chosen.find((c) => c.id === bulb.id) ?? (bulb as any);
      const pause = () => new Promise((r) => setTimeout(r, 600)); // Govee: 2 req/s per device
      let sent = false;
      const send = async (type: string, instance: string, value: number) => { if (sent) await pause(); await control(b, type, instance, value); sent = true; };
      if (!prev || prev.on !== s.on) await send('devices.capabilities.on_off', 'powerSwitch', s.on ? 1 : 0);
      if (!s.on) return;
      if (!prev || !prev.on || Math.abs(prev.brightness - s.brightness) >= 3) {
        await send('devices.capabilities.range', 'brightness', Math.max(1, Math.min(100, Math.round(s.brightness))));
      }
      if (b.kelvin && (!prev || !prev.on || Math.abs(prev.kelvin - s.kelvin) >= 100)) {
        await send('devices.capabilities.color_setting', 'colorTemperatureK', Math.max(b.kelvin[0], Math.min(b.kelvin[1], Math.round(s.kelvin / 100) * 100)));
      }
    },
  };
}

export async function adapterFor(env: Env): Promise<{ adapter: LightAdapter; bulbs: (Bulb & { zone: Zone })[] }> {
  const [g, zones] = await Promise.all([
    getSetting<GoveeSettings | null>(env, 'govee', null),
    getSetting<Record<string, Zone>>(env, 'light:zones', {}),
  ]);
  const apiKey = g?.apiKey || env.GOVEE_API_KEY;
  if (apiKey && g?.bulbs?.length) return { adapter: goveeAdapter(apiKey, g.bulbs), bulbs: g.bulbs.map((b) => ({ ...b, zone: zones[b.id] ?? 'none' })) };
  return { adapter: simAdapter(env), bulbs: SIM_BULBS.map((b) => ({ ...b, zone: zones[b.id] ?? SIM_ZONES[b.id] })) };
}

/** Push a state per bulb, sending each only what changed since its last known state. */
async function push(env: Env, adapter: LightAdapter, targets: [Bulb, LightState][]) {
  const known = (await env.STATE.get<Record<string, LightState>>('lights:bulbs', 'json')) ?? {};
  const one = async ([b, s]: [Bulb, LightState]) => { await adapter.set(b, s, known[b.id]); known[b.id] = s; };
  // Real bulbs in parallel; the simulator keeps them in one KV entry, so one at a time.
  const results = adapter.kind === 'simulator'
    ? await targets.reduce<Promise<PromiseSettledResult<void>[]>>(async (acc, t) => [...(await acc), ...(await Promise.allSettled([one(t)]))], Promise.resolve([]))
    : await Promise.allSettled(targets.map(one));
  await env.STATE.put('lights:bulbs', JSON.stringify(known));
  const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  if (failed.length) await logAlert(env, 'device', 'lights', `Lights: ${failed.length} bulb(s) did not respond (${String(failed[0].reason).slice(0, 120)})`);
}

/** Set a scene and push it to the bulbs. */
export async function applyScene(env: Env, scene: string, opts: { force?: boolean } = {}) {
  if (!SCENES[scene]) throw new Error(`unknown scene ${scene}`);
  await setFlag(env, 'scene', scene);
  const target = SCENES[scene].state ?? autoState(env);
  const last = await env.STATE.get<{ scene: string; state: LightState; spot?: string }>('lights:last', 'json');
  const same = last && !last.spot && last.scene === scene && last.state.on === target.on &&
    Math.abs(last.state.brightness - target.brightness) < 5 && Math.abs(last.state.kelvin - target.kelvin) < 150;
  if (same && !opts.force) return target;
  const { adapter, bulbs } = await adapterFor(env);
  await push(env, adapter, bulbs.map((b) => [b, target]));
  await env.STATE.put('lights:last', JSON.stringify({ scene, state: target, at: Date.now(), adapter: adapter.kind }));
  return target;
}

/** Every lamp to one state for a moment, without changing the saved scene (the tour's light stop). */
export async function glowAll(env: Env, state: LightState) {
  const { adapter, bulbs } = await adapterFor(env);
  await push(env, adapter, bulbs.map((b) => [b, state]));
  const last = await env.STATE.get<any>('lights:last', 'json');
  await env.STATE.put('lights:last', JSON.stringify({ ...last, spot: 'all', at: Date.now() }));
}

/**
 * The guest tour: brighten the lamps near what is being described and soften the rest.
 * `null` puts the current scene back.
 */
export async function spotlight(env: Env, zone: Zone | 'all' | null) {
  const scene = (await flag(env, 'scene')) ?? 'auto';
  if (!zone) return applyScene(env, scene, { force: true });
  const base = SCENES[scene]?.state ?? autoState(env);
  const { adapter, bulbs } = await adapterFor(env);
  const lit = (b: { zone: Zone }) => zone === 'all' || b.zone === zone;
  const glow: LightState = { on: true, brightness: 100, kelvin: 3000 };
  const soft: LightState = { on: true, brightness: Math.max(8, Math.min(20, base.on ? base.brightness / 3 : 10)), kelvin: 2200 };
  await push(env, adapter, bulbs.filter((b) => b.zone !== 'none' || zone === 'all').map((b) => [b, lit(b) ? glow : soft]));
  await env.STATE.put('lights:last', JSON.stringify({ scene, state: base, spot: zone, at: Date.now(), adapter: adapter.kind }));
}

export async function saveGovee(env: Env, apiKey: string, bulbIds: string[] | null) {
  const all = await goveeAdapter(apiKey).list(); // also validates the key
  if (bulbIds === null) return { bulbs: all, saved: false };
  const bulbs = all.filter((b) => bulbIds.includes(b.id));
  await setSetting(env, 'govee', { apiKey, bulbs });
  // Real lights replace the simulated ones.
  await env.DB.prepare("DELETE FROM devices WHERE type = 'lights' AND simulated = 1").run();
  await env.DB.prepare(`INSERT OR REPLACE INTO devices (id, type, name, simulated, config, last_seen, created_at)
    VALUES ('govee', 'lights', ?, 0, ?, ?, ?)`).bind(`Govee · ${bulbs.length} bulb${bulbs.length === 1 ? '' : 's'}`,
    JSON.stringify({ bulbs: bulbs.map((b) => b.name) }), Date.now(), Date.now()).run();
  return { bulbs, saved: true };
}
