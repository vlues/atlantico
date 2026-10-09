// Sea and wind conditions: live from Open-Meteo (free, no key) or simulated.
// Sources (verified 2026-10):
//   https://marine-api.open-meteo.com/v1/marine  current=wave_height,wave_period,wave_direction,sea_level_height_msl,
//                                                 sea_surface_temperature; hourly=sea_level_height_msl (tide curve)
//   https://api.open-meteo.com/v1/forecast       current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,
//                                                 cloud_cover,precipitation
import type { Env } from './env';

/** The next high or low water, from the hourly sea-level forecast. */
export interface TideTurn { type: 'high' | 'low'; at: string; height: number }

export interface Conditions {
  waveHeight: number; wavePeriod: number; waveDirection: number;
  windSpeed: number; windDirection: number; windGusts: number;
  tide: number; airTemp: number;
  seaTemp: number | null;
  tideTrend: 'rising' | 'falling' | null;
  nextTide: TideTurn | null;
  cloudCover: number;      // %
  precipitation: number;   // mm in the last 15 min
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
    getJSON(`https://marine-api.open-meteo.com/v1/marine?${q}&current=wave_height,wave_period,wave_direction,sea_level_height_msl,sea_surface_temperature&hourly=sea_level_height_msl&forecast_days=2`),
    getJSON(`https://api.open-meteo.com/v1/forecast?${q}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,cloud_cover,precipitation`),
  ]);
  const m = marine.current, w = wx.current;
  const tides = tideTurns(marine.hourly?.time ?? [], marine.hourly?.sea_level_height_msl ?? [], Date.now());
  return {
    waveHeight: m.wave_height ?? 0.3, wavePeriod: m.wave_period ?? 6, waveDirection: m.wave_direction ?? 270,
    windSpeed: w.wind_speed_10m ?? 0, windDirection: w.wind_direction_10m ?? 270, windGusts: w.wind_gusts_10m ?? 0,
    tide: m.sea_level_height_msl ?? 0, airTemp: w.temperature_2m ?? 20,
    seaTemp: m.sea_surface_temperature ?? null,
    ...tides,
    cloudCover: w.cloud_cover ?? 0, precipitation: w.precipitation ?? 0,
    source: 'open-meteo', observedAt: `${m.time}Z`, fetchedAt: new Date().toISOString(),
  };
}

/** Rising or falling now, and the next turn of the tide (parabola through the hourly extreme). */
export function tideTurns(times: string[], levels: (number | null)[], now: number): Pick<Conditions, 'tideTrend' | 'nextTide'> {
  const pts = times.map((t, i) => ({ t: Date.parse(`${t}Z`), h: levels[i] })).filter((p): p is { t: number; h: number } => p.h != null);
  let trend: Conditions['tideTrend'] = null;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].t < now) continue;
    if (trend === null) trend = pts[i].h >= pts[i - 1].h ? 'rising' : 'falling';
    if (i + 1 >= pts.length) break;
    const [a, b, c] = [pts[i - 1].h, pts[i].h, pts[i + 1].h];
    if ((b >= a && b > c) || (b <= a && b < c)) {
      const denom = a - 2 * b + c;
      const off = denom ? (0.5 * (a - c)) / denom : 0; // hours from the middle sample
      const at = pts[i].t + off * 3600000;
      if (at < now) continue;
      return { tideTrend: trend, nextTide: { type: b > a ? 'high' : 'low', at: new Date(at).toISOString(), height: b - 0.25 * (a - c) * off } };
    }
  }
  return { tideTrend: trend, nextTide: null };
}

async function getJSON(url: string): Promise<any> {
  const r = await fetch(url, { headers: { 'user-agent': 'atlantico-home/1.0' } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

// ── Simulator ────────────────────────────────────────────────────────────────
// Weather regimes typical for the Bay of Cádiz, blended smoothly over a ~5-day cycle.
type Regime = Omit<Conditions, 'tide' | 'seaTemp' | 'tideTrend' | 'nextTide' | 'source' | 'observedAt' | 'fetchedAt' | 'scenario'>;
export const SCENARIOS: Record<string, Regime> = {
  calm:     { waveHeight: 0.3, wavePeriod: 6,  waveDirection: 265, windSpeed: 6,  windDirection: 200, windGusts: 12, airTemp: 22, cloudCover: 5,  precipitation: 0 },
  poniente: { waveHeight: 1.3, wavePeriod: 10, waveDirection: 280, windSpeed: 28, windDirection: 275, windGusts: 40, airTemp: 21, cloudCover: 55, precipitation: 0 },
  levante:  { waveHeight: 0.9, wavePeriod: 4,  waveDirection: 95,  windSpeed: 52, windDirection: 92,  windGusts: 78, airTemp: 27, cloudCover: 10, precipitation: 0 },
  storm:    { waveHeight: 3.4, wavePeriod: 13, waveDirection: 235, windSpeed: 48, windDirection: 225, windGusts: 80, airTemp: 16, cloudCover: 95, precipitation: 2.4 },
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
  // Semidiurnal tide, ~2.2 m range like Cádiz.
  const P = 12.42, w = (2 * Math.PI) / P;
  const phase = (hours / P) % 1;
  const nextTurnH = ((phase < 0.5 ? 0.5 : 1) - phase) * P;
  return {
    ...base,
    waveHeight: Math.max(0.1, base.waveHeight * (1 + 0.12 * wobble)),
    windSpeed: Math.max(0, base.windSpeed * (1 + 0.15 * wobble)),
    windDirection: (base.windDirection + 8 * wobble + 360) % 360,
    tide: 1.1 * Math.cos(hours * w),
    seaTemp: 21 + 2 * Math.sin(hours / 24 / 58),
    tideTrend: phase < 0.5 ? 'falling' : 'rising',
    nextTide: { type: phase < 0.5 ? 'low' : 'high', at: new Date(now.getTime() + nextTurnH * 3600000).toISOString(), height: phase < 0.5 ? -1.1 : 1.1 },
    cloudCover: base.cloudCover, precipitation: base.precipitation,
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
