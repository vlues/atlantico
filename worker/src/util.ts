import type { Env } from './env';
import { json } from './http';

export const now = () => Date.now();

export function randomId(bytes = 12): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Short human code without look-alike characters. */
export function pairingCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.getRandomValues(new Uint8Array(6));
  return [...b].map((x) => A[x % A.length]).join('');
}

export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const bearer = (req: Request) => req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';

/** Owner check. Returns an error Response, or null when the caller is the owner. */
/** A session stays valid for this long after it was last used: sign in once, stay signed in. */
export const SESSION_MS = 400 * 86400000;

/**
 * Owner check: Bearer <session token> (what browsers keep) or the passcode itself (scripts, curl).
 * Ten wrong tries from one address lock it out for an hour.
 */
export async function requireOwner(req: Request, env: Env): Promise<Response | null> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'local';
  const failKey = `authfail:${ip}`;
  const fails = Number((await env.STATE.get(failKey)) ?? 0);
  if (fails >= 10) return json({ error: 'too many attempts, try again in an hour' }, 429);
  const token = bearer(req);
  if (token.startsWith('s1.')) {
    const h = await sha256(token);
    const row = await env.DB.prepare('SELECT last_used FROM sessions WHERE token_hash = ?').bind(h).first<{ last_used: number }>();
    if (row && row.last_used > now() - SESSION_MS) {
      if (now() - row.last_used > 86400000) await env.DB.prepare('UPDATE sessions SET last_used = ? WHERE token_hash = ?').bind(now(), h).run();
      return null;
    }
  } else if (env.OWNER_TOKEN && token && timingSafeEqual(await sha256(token), await sha256(env.OWNER_TOKEN))) return null;
  await env.STATE.put(failKey, String(fails + 1), { expirationTtl: 3600 });
  return json({ error: 'owner passcode required' }, 401);
}

/** Swap the passcode for a session token this browser keeps. The passcode itself is never stored. */
export async function signIn(req: Request, env: Env): Promise<Response> {
  const b = await body<{ passcode?: string; label?: string }>(req);
  const check = new Request(req.url, { headers: { authorization: `Bearer ${b.passcode ?? ''}`, 'cf-connecting-ip': req.headers.get('cf-connecting-ip') ?? 'local' } });
  if (!b.passcode || b.passcode.startsWith('s1.')) return json({ error: 'owner passcode required' }, 401);
  const denied = await requireOwner(check, env);
  if (denied) return denied;
  const token = `s1.${randomId(32)}`;
  await env.DB.prepare('INSERT INTO sessions (token_hash, label, created_at, last_used) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), String(b.label ?? 'browser').slice(0, 60), now(), now()).run();
  return json({ token });
}

export const sessionHash = async (req: Request) => sha256(bearer(req));

/** Device check: Bearer <device token>. Returns the device row or null. */
export async function deviceFromRequest(req: Request, env: Env): Promise<DeviceRow | null> {
  const token = bearer(req);
  if (!token) return null;
  const row = await env.DB.prepare('SELECT * FROM devices WHERE token_hash = ?').bind(await sha256(token)).first<DeviceRow>();
  if (row) await env.DB.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').bind(now(), row.id).run();
  return row ?? null;
}

export interface DeviceRow {
  id: string; type: 'panel' | 'plant' | 'lights'; name: string; token_hash: string | null;
  simulated: number; config: string; last_seen: number | null; created_at: number;
}

/** Fixed-window rate limit in KV. Returns true when allowed. */
export async function rateLimit(env: Env, key: string, limit: number, windowSec: number): Promise<boolean> {
  const k = `rl:${key}:${Math.floor(now() / 1000 / windowSec)}`;
  const n = Number((await env.STATE.get(k)) ?? 0);
  if (n >= limit) return false;
  await env.STATE.put(k, String(n + 1), { expirationTtl: Math.max(60, windowSec * 2) });
  return true;
}

export async function getSetting<T>(env: Env, key: string, fallback: T): Promise<T> {
  const r = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return r ? (JSON.parse(r.value) as T) : fallback;
}

export async function setSetting(env: Env, key: string, value: unknown) {
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, JSON.stringify(value)).run();
}

// Small switches the screens must see at once (demo overrides, the light scene) live in D1, not
// KV: KV can serve an old value for up to a minute after a change, so a press on the control page
// seemed to do nothing until the next full refresh.
export async function flag(env: Env, key: string): Promise<string | null> {
  return getSetting<string | null>(env, key, null);
}
export async function setFlag(env: Env, key: string, value: string | null) {
  if (value == null) await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(key).run();
  else await setSetting(env, key, value);
}
/** Several settings in one query. */
export async function settings(env: Env, keys: string[]): Promise<Record<string, any>> {
  const r = await env.DB.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`).bind(...keys).all<{ key: string; value: string }>();
  return Object.fromEntries(r.results.map((x) => [x.key, JSON.parse(x.value)]));
}

export async function body<T>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { return {} as T; }
}

export async function logAlert(env: Env, kind: string, subject: string | null, message: string, delivered = 0) {
  await env.DB.prepare('INSERT INTO alerts (ts, kind, subject, message, delivered) VALUES (?, ?, ?, ?, ?)')
    .bind(now(), kind, subject, message, delivered).run();
}
