// Guest arrival: first name only, rate limited, deletable by the guest.
// A returning guest is recognised by the key their phone kept, or (if the phone forgot, as Safari
// does after a week) by confirming they are the same person as an earlier guest with that name.
import type { Env } from './env';
import { json } from './http';
import { now, randomId, rateLimit, getSetting, setSetting, body } from './util';
import { applyScene } from './lights';
import { bumpWall, isHere, type Welcome } from './wall';

export const WELCOME_MS = 30000;

export interface WifiSettings { ssid: string; password: string; security: 'WPA' | 'WEP' | 'nopass'; hidden?: boolean }

interface VisitorRow {
  id: string; first_name: string; delete_token: string; created_at: number;
  visits: number; last_seen: number | null; left_at: number | null;
}

/** Letters (any language), spaces, hyphens, apostrophes. 1-24 chars. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!/^[\p{L}][\p{L}\p{M}' -]{0,23}$/u.test(s)) return null;
  return s.split(' ')[0].slice(0, 24); // first name only
}

const nameKey = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The most recent earlier guest with this first name (Lucia = Lucía). */
async function namesake(env: Env, name: string, includeDemo: boolean): Promise<VisitorRow | null> {
  const r = await env.DB.prepare(`SELECT * FROM visitors ${includeDemo ? '' : "WHERE delete_token != 'demo'"}
    ORDER BY COALESCE(last_seen, created_at) DESC LIMIT 500`).all<VisitorRow>();
  return r.results.find((v) => nameKey(v.first_name) === nameKey(name)) ?? null;
}

export async function guestInfo(env: Env) {
  const greeting = await getSetting(env, 'greeting', 'Bienvenido');
  return json({ greeting });
}

export async function arrive(req: Request, env: Env, ctx: ExecutionContext) {
  const b = await body<{ name?: string; website?: string; id?: string; token?: string; returning?: boolean }>(req);
  if (b.website) return json({ ok: true }); // honeypot: bots fill every field
  const name = cleanName(b.name);
  if (!name && !(b.id && b.token)) return json({ error: 'Solo tu nombre, por favor.' }, 400);
  const ip = req.headers.get('cf-connecting-ip') ?? 'local';
  if (!(await rateLimit(env, `arrive:${ip}`, 8, 600)) || !(await rateLimit(env, 'arrive:all', 60, 86400))) {
    return json({ error: 'Un momento, por favor. Inténtalo de nuevo más tarde.' }, 429);
  }

  // This phone has been here before and kept its key.
  let v = b.id && b.token ? await env.DB.prepare('SELECT * FROM visitors WHERE id = ?').bind(b.id).first<VisitorRow>() : null;
  if (v && (v.delete_token !== b.token || v.delete_token === 'demo')) v = null;
  const token = v ? v.delete_token : null;

  // A name someone already has: ask before joining them up. Nothing is written until they answer.
  if (!v && name) {
    const same = await namesake(env, name, false);
    if (same && b.returning === undefined) return json({ known: true, name: same.first_name });
    if (same && b.returning) v = same;
  }
  if (!v && !name) return json({ forgotten: true }, 404);
  return checkIn(env, ctx, v, name!, token);
}

/** Owner's demo button: a name that is already on the wall arrives as a returning guest. */
export async function demoArrive(env: Env, ctx: ExecutionContext, name: string) {
  return checkIn(env, ctx, await namesake(env, name, true), name, null);
}

async function checkIn(env: Env, ctx: ExecutionContext, v: VisitorRow | null, name: string, token: string | null) {
  const t = now();
  let id: string, visits = 1, since: number | null = null;
  if (v) {
    // Tapping in again during the same stay is not a new visit.
    const sameStay = isHere(v, t);
    id = v.id;
    name = v.first_name;
    visits = v.visits + (sameStay ? 0 : 1);
    since = sameStay ? null : t - (v.last_seen ?? v.created_at);
    await env.DB.prepare('UPDATE visitors SET visits = ?, last_seen = ?, left_at = NULL WHERE id = ?').bind(visits, t, id).run();
  } else {
    id = randomId(9);
    token = randomId(16);
    await env.DB.prepare('INSERT INTO visitors (id, first_name, delete_token, created_at, visits, last_seen) VALUES (?, ?, ?, ?, 1, ?)')
      .bind(id, name, token, t, t).run();
  }
  const greeting = v ? 'Hola de nuevo' : await getSetting(env, 'greeting', 'Bienvenido');
  const w: Welcome = { id, name, greeting, visits, since, at: t, until: t + WELCOME_MS };
  await setSetting(env, 'welcome', w);
  await bumpWall(env);
  ctx.waitUntil(applyScene(env, 'hosting').then(() => undefined, (e) => console.error(e)));
  const wifi = await getSetting<WifiSettings | null>(env, 'wifi', null);
  // deleteToken is null when they were recognised by name only: that is not proof enough to delete.
  return json({ id, deleteToken: token, name, greeting, visits, since, returning: !!v, wifi });
}

export async function deleteVisitor(id: string, req: Request, env: Env, owner = false) {
  const b = owner ? {} : await body<{ token?: string }>(req);
  const row = await env.DB.prepare('SELECT delete_token FROM visitors WHERE id = ?').bind(id).first<any>();
  if (!row) return json({ ok: true });
  if (!owner && row.delete_token !== (b as any).token) return json({ error: 'not allowed' }, 403);
  await env.DB.prepare('DELETE FROM visitors WHERE id = ?').bind(id).run();
  const w = await getSetting<Welcome | null>(env, 'welcome', null);
  if (w?.id === id) await env.DB.prepare("DELETE FROM settings WHERE key = 'welcome'").run();
  await bumpWall(env);
  return json({ ok: true });
}

/** Owner: the guest has gone; their star stops shining (it stays on the wall). */
export async function endVisit(id: string, env: Env) {
  await env.DB.prepare('UPDATE visitors SET left_at = ? WHERE id = ?').bind(now(), id).run();
  const w = await getSetting<Welcome | null>(env, 'welcome', null);
  if (w?.id === id) await env.DB.prepare("DELETE FROM settings WHERE key = 'welcome'").run();
  await bumpWall(env);
  return json({ ok: true });
}

export async function listVisitors(env: Env) {
  const r = await env.DB.prepare('SELECT id, first_name, created_at, visits, last_seen, left_at FROM visitors ORDER BY COALESCE(last_seen, created_at) DESC LIMIT 200').all<any>();
  const t = now();
  return r.results.map(({ left_at, ...v }) => ({ ...v, here: isHere({ last_seen: v.last_seen, left_at }, t) }));
}
