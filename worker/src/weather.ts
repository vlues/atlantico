// Sea and wind conditions: live from Open-Meteo (free, no key) or simulated.
// Sources (verified 2026-10):
//   https://marine-api.open-meteo.com/v1/marine  current=wave_height,wave_period,wave_direction,sea_level_height_msl
//   https://api.open-meteo.com/v1/forecast       current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m
import type { Env } from './env';

export interface Conditions {
  waveHeight: number; wavePeriod: number; waveDirection: number;
  windSpeed: number; windDirection: number; windGusts: number;
  tide: number; airTemp: number;
  source: 'open-meteo' | 'simulator';
  observedAt: string; fetchedAt: string;
  scenario?: string;
}

const CACHE_KEY = 'conditions:live';
const MAX_AGE_MS = 20 * 60 * 1000;

export async function getConditions(env: Env, scenario?: string | null): Promise<Conditions> {
  // Weather is always live unless the demo controls pick a sea state (SIMULATE only fakes devices).
  if (scenario && scenario !== 'live') return simulated(new Date(), scenario);
  const cached = await env.STATE.get<Conditions>(CACHE_KEY, 'json');
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < MAX_AGE_MS) return cached;
  try {
    const fresh = await fetchLive(env);
    await env.STATE.put(CACHE_KEY, JSON.stringify(fresh));
    return fresh;
  } catch (err) {
    console.error('open-meteo failed', err);
    return cached ?? { ...simulated(new Date(), 'calm'), scenario: 'offline fallback' };
  }
}

export async function fetchLive(env: Env): Promise<Conditions> {
  const q = `latitude=${env.LAT}&longitude=${env.LON}&timezone=UTC`;
  const [marine, wx] = await Promise.all([
    getJSON(`https://marine-api.open-meteo.com/v1/marine?${q}&current=wave_height,wave_period,wave_direction,sea_level_height_msl`),
    getJSON(`https://api.open-meteo.com/v1/forecast?${q}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m`),
  ]);
  const m = marine.current, w = wx.current;
  return {
    waveHeight: m.wave_height ?? 0.3, wavePeriod: m.wave_period ?? 6, waveDirection: m.wave_direction ?? 270,
    windSpeed: w.wind_speed_10m ?? 0, windDirection: w.wind_direction_10m ?? 270, windGusts: w.wind_gusts_10m ?? 0,
    tide: m.sea_level_height_msl ?? 0, airTemp: w.temperature_2m ?? 20,
    source: 'open-meteo', observedAt: `${m.time}Z`, fetchedAt: new Date().toISOString(),
  };
}

async function getJSON(url: string): Promise<any> {
  const r = await fetch(url, { headers: { 'user-agent': 'atlantico-home/1.0' } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

// ── Simulator ────────────────────────────────────────────────────────────────
// Weather regimes typical for the Bay of Cádiz, blended smoothly over a ~5-day cycle.
type Regime = Omit<Conditions, 'tide' | 'source' | 'observedAt' | 'fetchedAt' | 'scenario'>;
export const SCENARIOS: Record<string, Regime> = {
  calm:     { waveHeight: 0.3, wavePeriod: 6,  waveDirection: 265, windSpeed: 6,  windDirection: 200, windGusts: 12, airTemp: 22 },
  poniente: { waveHeight: 1.3, wavePeriod: 10, waveDirection: 280, windSpeed: 28, windDirection: 275, windGusts: 40, airTemp: 21 },
  levante:  { waveHeight: 0.9, wavePeriod: 4,  waveDirection: 95,  windSpeed: 52, windDirection: 92,  windGusts: 78, airTemp: 27 },
  storm:    { waveHeight: 3.4, wavePeriod: 13, waveDirection: 235, windSpeed: 48, windDirection: 225, windGusts: 80, airTemp: 16 },
};
const CYCLE = ['calm', 'poniente', 'calm', 'levante', 'levante', 'calm', 'storm', 'poniente'];

export function simulated(now: Date, scenario: string): Conditions {
  const hours = now.getTime() / 3.6e6;
  let base: Regime;
  if (SCENARIOS[scenario]) base = SCENARIOS[scenario];
  else {
    const pos = (hours / 15) % CYCLE.length; // each regime ~15 h
    const a = SCENARIOS[CYCLE[Math.floor(pos)]], b = SCENARIOS[CYCLE[(Math.floor(pos) + 1) % CYCLE.length]];
    const f = smooth(Math.min(1, Math.max(0, (pos % 1 - 0.6) / 0.4)));
    base = blend(a, b, f);
  }
  const wobble = Math.sin(hours * 1.7) * 0.5 + Math.sin(hours * 0.43) * 0.5;
  return {
    ...base,
    waveHeight: Math.max(0.1, base.waveHeight * (1 + 0.12 * wobble)),
    windSpeed: Math.max(0, base.windSpeed * (1 + 0.15 * wobble)),
    windDirection: (base.windDirection + 8 * wobble + 360) % 360,
    tide: 1.1 * Math.cos((hours / 12.42) * 2 * Math.PI), // semidiurnal, ~2.2 m range like Cádiz
    source: 'simulator', observedAt: now.toISOString(), fetchedAt: now.toISOString(),
    scenario,
  };
}

const smooth = (x: number) => x * x * (3 - 2 * x);
function blend(a: Regime, b: Regime, f: number): Regime {
  const out: any = {};
  for (const k of Object.keys(a) as (keyof Regime)[]) {
    if (k.endsWith('Direction')) {
      const d = ((b[k] - a[k] + 540) % 360) - 180;
      out[k] = (a[k] + d * f + 360) % 360;
    } else out[k] = a[k] + (b[k] - a[k]) * f;
  }
  return out;
}
