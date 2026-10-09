// Guest arrival: first name only, rate limited, deletable by the guest.
import type { Env } from './env';
import { json } from './http';
import { now, randomId, rateLimit, getSetting, body } from './util';
import { applyScene } from './lights';
import { bumpWall } from './wall';

export const WELCOME_MS = 30000;

export interface WifiSettings { ssid: string; password: string; security: 'WPA' | 'WEP' | 'nopass'; hidden?: boolean }

/** Letters (any language), spaces, hyphens, apostrophes. 1-24 chars. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!/^[\p{L}][\p{L}\p{M}' -]{0,23}$/u.test(s)) return null;
  return s.split(' ')[0].slice(0, 24); // first name only
}

export async function guestInfo(env: Env) {
  const greeting = await getSetting(env, 'greeting', 'Bienvenido');
  return json({ greeting });
}

export async function arrive(req: Request, env: Env, ctx: ExecutionContext, opts: { bypassLimits?: boolean } = {}) {
  const b = await body<{ name?: string; website?: string }>(req);
  if (b.website) return json({ ok: true }); // honeypot: bots fill every field
  const name = cleanName(b.name);
  if (!name) return json({ error: 'Solo tu nombre, por favor.' }, 400);
  if (!opts.bypassLimits) {
    const ip = req.headers.get('cf-connecting-ip') ?? 'local';
    if (!(await rateLimit(env, `arrive:${ip}`, 3, 600)) || !(await rateLimit(env, 'arrive:all', 40, 86400))) {
      return json({ error: 'Un momento, por favor. Inténtalo de nuevo más tarde.' }, 429);
    }
  }
  return welcome(env, ctx, name);
}

export async function welcome(env: Env, ctx: ExecutionContext, name: string) {
  const id = randomId(9);
  const deleteToken = randomId(16);
  await env.DB.prepare('INSERT INTO visitors (id, first_name, delete_token, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, name, deleteToken, now()).run();
  const greeting = await getSetting(env, 'greeting', 'Bienvenido');
  await env.STATE.put('welcome', JSON.stringify({ name, greeting, until: now() + WELCOME_MS }), { expirationTtl: 120 });
  await bumpWall(env);
  ctx.waitUntil(applyScene(env, 'hosting').then(() => undefined, (e) => console.error(e)));
  const wifi = await getSetting<WifiSettings | null>(env, 'wifi', null);
  return json({ id, deleteToken, name, greeting, wifi });
}

export async function deleteVisitor(id: string, req: Request, env: Env, owner = false) {
  const b = owner ? {} : await body<{ token?: string }>(req);
  const row = await env.DB.prepare('SELECT first_name, delete_token FROM visitors WHERE id = ?').bind(id).first<any>();
  if (!row) return json({ ok: true });
  if (!owner && row.delete_token !== (b as any).token) return json({ error: 'not allowed' }, 403);
  await env.DB.prepare('DELETE FROM visitors WHERE id = ?').bind(id).run();
  const w = await env.STATE.get<any>('welcome', 'json');
  if (w?.name === row.first_name) await env.STATE.delete('welcome');
  await bumpWall(env);
  return json({ ok: true });
}

export async function listVisitors(env: Env) {
  const r = await env.DB.prepare('SELECT id, first_name, created_at FROM visitors ORDER BY created_at DESC LIMIT 200').all();
  return r.results;
}
