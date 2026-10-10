// Screens: any TV, tablet or monitor showing the live wall. A new screen shows a 4-digit code
// (and a QR for the owner's phone); the owner types or scans it on Add device, and the screen
// becomes a device with its own settings (night dimming, OLED care) and online status. A Pi set up
// for the household TV (kiosk.sh shared) says so when it asks for its code, and is added as 'shared'.
import type { Env } from './env';
import { json } from './http';
import { now, randomId, sha256, body, rateLimit, deviceFromRequest, logAlert } from './util';
import { bumpWall } from './wall';

const CODE_MIN = 20;

export interface ScreenConfig { kind: string; night: 'dim' | 'off' | 'on'; oled: boolean }

/** POST /api/screen/hello — a browser that isn't a screen yet asks for a code to show. */
export async function hello(req: Request, env: Env) {
  const ip = req.headers.get('cf-connecting-ip') ?? 'local';
  if (!(await rateLimit(env, `screen:${ip}`, 12, 3600))) return json({ error: 'later' }, 429);
  const claim = randomId(16);
  const tv = !!(await body<{ tv?: boolean }>(req)).tv;
  for (let i = 0; i < 8; i++) {
    const code = String(1000 + Math.floor(Math.random() * 9000));
    const r = await env.DB.prepare(`INSERT INTO pairing_codes (code, type, config, expires_at) VALUES (?, 'screen-wait', ?, ?)
      ON CONFLICT(code) DO UPDATE SET type = excluded.type, config = excluded.config, expires_at = excluded.expires_at
      WHERE pairing_codes.expires_at < ?`).bind(code, JSON.stringify({ claim, tv }), now() + CODE_MIN * 60000, now()).run();
    if (r.meta.changes) return json({ code, claim, expiresInMin: CODE_MIN });
  }
  return json({ error: 'busy, try again' }, 503);
}

/** GET /api/screen/hello?code=&claim= — the screen waits here until the owner adds it. */
export async function waiting(env: Env, url: URL) {
  const code = url.searchParams.get('code') ?? '', claim = url.searchParams.get('claim') ?? '';
  const row = await env.DB.prepare('SELECT type, config, expires_at FROM pairing_codes WHERE code = ?').bind(code).first<any>();
  const cfg = row ? JSON.parse(row.config) : null;
  if (!row || cfg.claim !== claim) return json({ expired: true });
  if (row.type === 'screen-ready') {
    await env.DB.prepare('DELETE FROM pairing_codes WHERE code = ?').bind(code).run();
    return json({ token: cfg.token, deviceId: cfg.deviceId, name: cfg.name, config: cfg.config });
  }
  return json(row.expires_at < now() ? { expired: true } : { waiting: true });
}

/** POST /api/screen/claim { code, name, config } — the owner adds the screen showing that code. */
export async function claim(req: Request, env: Env) {
  const b = await body<{ code?: string; name?: string; config?: Partial<ScreenConfig> }>(req);
  const code = String(b.code ?? '').replace(/\D/g, '');
  const row = await env.DB.prepare("SELECT config, expires_at FROM pairing_codes WHERE code = ? AND type = 'screen-wait'").bind(code).first<any>();
  if (!row || row.expires_at < now()) return json({ error: 'No screen is showing that code. Open the wall on it and use the code it shows now.' }, 404);
  const c = b.config ?? {};
  const config: ScreenConfig = {
    kind: JSON.parse(row.config).tv ? 'shared' : String(c.kind ?? 'screen').slice(0, 20),
    night: c.night === 'off' || c.night === 'on' ? c.night : 'dim',
    oled: !!c.oled,
  };
  const name = String(b.name ?? '').trim().slice(0, 40) || 'Screen';
  const id = `screen-${randomId(3)}`, token = randomId(32), t = now();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO devices (id, type, name, token_hash, simulated, config, last_seen, created_at) VALUES (?, 'screen', ?, ?, 0, ?, ?, ?)`)
      .bind(id, name, await sha256(token), JSON.stringify(config), t, t),
    // The token waits here for the screen to collect (once), then the row is deleted.
    env.DB.prepare("UPDATE pairing_codes SET type = 'screen-ready', config = ? WHERE code = ?")
      .bind(JSON.stringify({ ...JSON.parse(row.config), token, deviceId: id, name, config }), code),
  ]);
  await logAlert(env, 'device', id, `Added screen "${name}".`, 1);
  return json({ deviceId: id, name });
}

/** POST /api/screen/beat — a screen checks in (every few minutes) and gets its current settings. */
export async function beat(req: Request, env: Env) {
  const dev = await deviceFromRequest(req, env);
  if (!dev || dev.type !== 'screen') return json({ error: 'unknown screen' }, 401);
  const b = await body<{ w?: number; h?: number; ua?: string }>(req);
  await env.STATE.put(`dev:${dev.id}:status`, JSON.stringify({ size: b.w && b.h ? `${b.w}×${b.h}` : null, at: now() }));
  return json({ name: dev.name, config: JSON.parse(dev.config) });
}

/** Settings changed on the control page: screens fetch them on their next look at the wall. */
export const screenChanged = (env: Env) => bumpWall(env);
