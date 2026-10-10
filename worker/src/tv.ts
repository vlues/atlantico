// The household TV: a Raspberry Pi on one of its spare HDMI inputs shows the wall, and a small
// agent on the Pi (web/tv-agent.py) hands the TV back at any remote button, wakes it onto
// Atlántico when a guest walks in (only if it's off, so nobody's film is ever interrupted), when
// someone asks for it or when they finish watching, and lets it sleep when nobody is staying. The
// agent polls GET /api/tv every few seconds; it needs no login, and the answer is three numbers.
import type { Env } from './env';
import { json } from './http';
import { body, now, rateLimit, requireOwner, setSetting, getSetting, deviceFromRequest, flag } from './util';
import { isHere, PRESENT_MS, type Welcome } from './wall';
import { adapterFor, applyScene, autoState, SCENES, TV_SIDES, type TvLink, type TvSide } from './lights';

/** The Pi on the household TV signs in with its screen's key (kiosk.sh shares it with the agent). */
async function sharedTv(req: Request, env: Env) {
  const dev = await deviceFromRequest(req, env);
  return dev && dev.type === 'screen' && JSON.parse(dev.config).kind === 'shared' ? dev : null;
}

/**
 * GET /api/tv — what the agent needs: show-on-TV requests, the current welcome, how many guests are
 * staying (it lets the TV sleep when nobody is), the lamps beside the TV, and how they should glow.
 */
export async function tvState(req: Request, env: Env) {
  if (!(await sharedTv(req, env))) return json({ error: 'unknown TV' }, 401);
  const t = now();
  const [r, here] = await env.DB.batch([
    env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('tv:show', 'welcome', 'tour', 'light:tvside')"),
    env.DB.prepare('SELECT COUNT(*) AS n FROM visitors WHERE last_seen > ? AND (left_at IS NULL OR left_at < last_seen)').bind(t - PRESENT_MS),
  ]);
  const rows = r.results as { key: string; value: string }[];
  const get = (k: string) => { const row = rows.find((x) => x.key === k); return row ? JSON.parse(row.value) : null; };
  const show: { at: number } | null = get('tv:show'), w: Welcome | null = get('welcome'), tour = get('tour');
  const sides: Record<string, TvSide> = get('light:tvside') ?? {};
  const scene = (await flag(env, 'scene')) ?? 'auto';
  const { bulbs } = await adapterFor(env);
  return json({
    show: show?.at ?? 0,
    welcome: w && w.until > t ? w.at : 0,
    here: (here.results[0] as { n: number } | undefined)?.n ?? 0,
    scene,
    // While the guest tour is lighting part of the room, the lamps are the tour's.
    hold: tour && tour.until > t ? tour.until : 0,
    // How bright the room should be on its own right now (the agent keeps Atlántico's glow near it).
    ambient: SCENES[scene]?.state ?? autoState(env),
    lamps: bulbs.filter((b) => (sides[b.id] ?? 'none') !== 'none')
      .map((b) => ({ id: b.id, device: (b as { device?: string }).device ?? null, name: b.name, sku: (b as { sku?: string }).sku ?? null, side: sides[b.id] })),
  });
}

/**
 * POST /api/tv/state { screen, sync, lamps } — the agent says what the TV shows and which lamps it
 * is driving. On a change the other lamps follow (a low glow while someone watches; the scene again
 * after), and lamps it lets go of get the scene back.
 */
export async function tvReport(req: Request, env: Env, ctx: ExecutionContext) {
  if (!(await sharedTv(req, env))) return json({ error: 'unknown TV' }, 401);
  const b = await body<Partial<TvLink>>(req);
  const screens = ['art', 'away', 'off', 'unknown'] as const;
  const next: TvLink = {
    screen: screens.includes(b.screen as any) ? b.screen! : 'unknown',
    sync: !!b.sync,
    lamps: Array.isArray(b.lamps) ? b.lamps.map(String).slice(0, 20) : [],
    at: now(),
  };
  const prev = await getSetting<TvLink | null>(env, 'tv:state', null);
  await setSetting(env, 'tv:state', next);
  const changed = !prev || prev.at < now() - 90000 || prev.screen !== next.screen || prev.sync !== next.sync || prev.lamps.join() !== next.lamps.join();
  if (changed) ctx.waitUntil(applyScene(env, (await flag(env, 'scene')) ?? 'auto', { force: true }).then(() => undefined, (e) => console.error(e)));
  return json({ ok: true });
}

/** PUT /api/lights/tvside { bulbId: side } — the owner says where each lamp is next to the TV. */
export async function saveTvSides(req: Request, env: Env) {
  const b = await body<Record<string, TvSide>>(req);
  const sides = Object.fromEntries(Object.entries(b).filter(([, s]) => (TV_SIDES as readonly string[]).includes(s)).slice(0, 50));
  await setSetting(env, 'light:tvside', sides);
  return json({ ok: true, sides });
}

/** POST /api/tv/show { id? } — put the wall on the TV: the owner, or a guest who is here. */
export async function showOnTv(req: Request, env: Env) {
  const b = await body<{ id?: string }>(req);
  let by = 'owner';
  if (b.id) {
    const v = await env.DB.prepare('SELECT first_name, last_seen, left_at FROM visitors WHERE id = ?').bind(b.id).first<any>();
    if (!v || !isHere(v)) return json({ error: 'only for guests who are here' }, 403);
    const ip = req.headers.get('cf-connecting-ip') ?? 'local';
    if (!(await rateLimit(env, `tv:${ip}`, 6, 600))) return json({ error: 'a moment, please' }, 429);
    by = v.first_name;
  } else {
    const denied = await requireOwner(req, env);
    if (denied) return denied;
  }
  await setSetting(env, 'tv:show', { at: now(), by });
  return json({ ok: true });
}
