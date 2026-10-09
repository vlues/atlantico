// The first-arrival tour. The guest's phone tells the story of the room as they scroll; each
// stop also plays on the wall (callouts, their star, the day's styles) and in the lamps nearest
// what is being described. Lamps go back to the scene on their own shortly after the last stop.
import type { Env } from './env';
import { json } from './http';
import { body, getSetting, setSetting, rateLimit, now } from './util';
import { isHere } from './wall';
import { spotlight, glowAll, type Zone } from './lights';
import { plantStatus } from './plants';

/** Stops in story order, and which part of the room each one lights. */
export const STOPS: Record<string, Zone | 'all' | null> = {
  sea: 'wall', star: 'wall', edition: 'wall', sky: 'wall', plants: 'plants', light: 'all', end: null,
};
export const STOP_MS = 40000;  // how long the wall holds a stop
const SETTLE_MS = 28000;       // lamps return to the scene this long after the latest stop

export interface Tour { id: string | null; name: string | null; visits: number; stop: string; at: number; until: number; showcase?: boolean }

/** What the guest's phone needs for the story, beyond /api/wall: the plants, kept brief. */
export async function tourInfo(env: Env) {
  const plants = (await plantStatus(env)).map((p: any) => ({
    name: p.name, species: p.species,
    moisture: p.latest?.moisture ?? null, watered: p.lastWatering?.ts ?? null, note: p.last_check ?? null,
  }));
  return json({ plants });
}

/** POST /api/tour { id, stop }: a guest who is here scrolled to a stop. */
export async function tourStop(req: Request, env: Env, ctx: ExecutionContext) {
  const b = await body<{ id?: string; stop?: string }>(req);
  if (!b.stop || !(b.stop in STOPS)) return json({ error: 'unknown stop' }, 400);
  const v = b.id ? await env.DB.prepare('SELECT id, first_name, visits, last_seen, left_at FROM visitors WHERE id = ?').bind(b.id).first<any>() : null;
  if (!v || !isHere(v)) return json({ error: 'only for guests who are here' }, 403);
  const ip = req.headers.get('cf-connecting-ip') ?? 'local';
  if (!(await rateLimit(env, `tour:${ip}`, 40, 600))) return json({ ok: true, throttled: true });
  // One guest leads at a time: with several touring at once, the wall and lamps follow whoever
  // started first until they pause; everyone else still has the whole story on their phone.
  const lead = await getSetting<Tour | null>(env, 'tour', null);
  if (lead?.id && lead.id !== v.id && lead.until > now() && now() - lead.at < 20000) return json({ ok: true, shared: true });
  await playStop(env, ctx, { id: v.id, name: v.first_name, visits: v.visits }, b.stop);
  return json({ ok: true });
}

/** Shared by guests and the owner's demo buttons. */
export async function playStop(env: Env, ctx: ExecutionContext, who: { id: string | null; name: string | null; visits: number }, stop: string, showcase = false) {
  const at = now();
  if (stop === 'end') {
    await env.DB.prepare("DELETE FROM settings WHERE key = 'tour'").run();
    ctx.waitUntil(spotlight(env, null).then(() => undefined, (e) => console.error(e)));
    return;
  }
  const tour: Tour = { ...who, stop, at, until: at + STOP_MS, showcase };
  await setSetting(env, 'tour', tour);

  // Lamps: change only when the part of the room changes (Govee allows a few calls a minute).
  const zone = STOPS[stop];
  const last = await env.STATE.get<{ spot?: string }>('lights:last', 'json');
  const lamps = async () => {
    if (stop === 'light') {
      // The light follows the sun: a bright cool noon, then it warms and settles like dusk.
      await glowAll(env, { on: true, brightness: 85, kelvin: 4500 });
      await new Promise((r) => setTimeout(r, 3500));
      await glowAll(env, { on: true, brightness: 35, kelvin: 2200 });
    } else if (zone && last?.spot !== zone) await spotlight(env, zone);
    // If nothing follows this stop, put the lamps back.
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const current = await getSetting<Tour | null>(env, 'tour', null);
    if (current?.at === at) await spotlight(env, null);
  };
  ctx.waitUntil(lamps().catch((e) => console.error(e)));
}
