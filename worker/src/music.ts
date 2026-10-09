// Music: guests add songs to the room from their phone, no sign-in. The owner connects Spotify
// once (Premium, any Spotify Connect speaker); a song link from Apple Music, Spotify or YouTube
// works too, matched to the same song on Spotify. When a guest's song comes on, the wall says whose
// it is and their star pulses, and the lamps by the wall breathe once.
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './env';
import { json } from './http';
import { body, getSetting, setSetting, rateLimit, randomId, now } from './util';
import { isHere } from './wall';
import { spotlight } from './lights';

const API = 'https://api.spotify.com/v1';
const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing';
const PENDING_MAX = 3;      // songs a guest can have waiting at once
const CHECK_EVERY_MS = 12000;

interface SpotifySettings { clientId: string; clientSecret: string; refreshToken?: string; deviceId?: string; deviceName?: string }
export interface Track { uri: string; title: string; artist: string; image?: string | null }
interface NowPlaying { uri: string; title: string; artist: string; by: { id: string; name: string } | null; at: number; next: { title: string; by: string } | null }

const redirect = (req: Request) => `${new URL(req.url).origin}/api/music/callback`;

// ── Owner: connect once ──────────────────────────────────────────────────────
/** PUT /api/music/spotify { clientId, clientSecret } → the Spotify page to approve. */
export async function connect(req: Request, env: Env) {
  const b = await body<{ clientId?: string; clientSecret?: string }>(req);
  const prev = await getSetting<SpotifySettings | null>(env, 'spotify', null);
  const clientId = b.clientId?.trim() || prev?.clientId, clientSecret = b.clientSecret?.trim() || prev?.clientSecret;
  if (!clientId || !clientSecret) return json({ error: 'Paste the Client ID and Client secret from your Spotify app.' }, 400);
  await setSetting(env, 'spotify', { ...prev, clientId, clientSecret });
  const state = randomId(16);
  await setSetting(env, 'spotify:state', { state, until: now() + 600000 });
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, scope: SCOPES, redirect_uri: redirect(req), state });
  return json({ url: `https://accounts.spotify.com/authorize?${q}`, redirectUri: redirect(req) });
}

/** GET /api/music/callback — Spotify sends the owner back here after they approve. */
export async function callback(req: Request, env: Env, url: URL) {
  const back = (msg: string) => Response.redirect(`${env.SITE_URL ?? env.PAGES_ORIGIN}/control?music=${encodeURIComponent(msg)}#music`, 302);
  const st = await getSetting<{ state: string; until: number } | null>(env, 'spotify:state', null);
  if (!st || st.state !== url.searchParams.get('state') || st.until < now()) return back('expired, try again');
  const code = url.searchParams.get('code');
  if (!code) return back(url.searchParams.get('error') ?? 'not approved');
  const s = await getSetting<SpotifySettings | null>(env, 'spotify', null);
  if (!s) return back('missing app details');
  const r = await tokenCall(s, { grant_type: 'authorization_code', code, redirect_uri: redirect(req) });
  if (!r.refresh_token) return back('Spotify did not return a token');
  await setSetting(env, 'spotify', { ...s, refreshToken: r.refresh_token });
  await env.STATE.put('spotify:token', JSON.stringify({ token: r.access_token, exp: now() + (r.expires_in - 60) * 1000 }));
  await env.DB.prepare("DELETE FROM settings WHERE key = 'spotify:state'").run();
  return back('connected');
}

async function tokenCall(s: SpotifySettings, form: Record<string, string>) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${btoa(`${s.clientId}:${s.clientSecret}`)}` },
    body: new URLSearchParams(form),
  });
  if (!r.ok) throw new Error(`Spotify token ${r.status}`);
  return r.json<any>();
}

async function token(env: Env): Promise<string | null> {
  const cached = await env.STATE.get<{ token: string; exp: number }>('spotify:token', 'json');
  if (cached && cached.exp > now()) return cached.token;
  const s = await getSetting<SpotifySettings | null>(env, 'spotify', null);
  if (!s?.refreshToken) return null;
  const r = await tokenCall(s, { grant_type: 'refresh_token', refresh_token: s.refreshToken });
  if (r.refresh_token && r.refresh_token !== s.refreshToken) await setSetting(env, 'spotify', { ...s, refreshToken: r.refresh_token });
  await env.STATE.put('spotify:token', JSON.stringify({ token: r.access_token, exp: now() + (r.expires_in - 60) * 1000 }));
  return r.access_token;
}

async function spotify(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const t = await token(env);
  if (!t) return new Response(null, { status: 401 });
  return fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
}

/** Owner: speakers Spotify can see right now, and which one plays guests' songs when nothing is on. */
export async function devices(env: Env) {
  const r = await spotify(env, '/me/player/devices');
  if (!r.ok) return json({ error: 'Spotify is not connected' }, 400);
  const d = await r.json<any>();
  return json((d.devices ?? []).map((x: any) => ({ id: x.id, name: x.name, type: x.type, active: x.is_active })));
}
export async function chooseDevice(req: Request, env: Env) {
  const b = await body<{ id?: string; name?: string }>(req);
  const s = await getSetting<SpotifySettings | null>(env, 'spotify', null);
  if (!s) return json({ error: 'Spotify is not connected' }, 400);
  await setSetting(env, 'spotify', { ...s, deviceId: b.id, deviceName: b.name });
  return json({ ok: true });
}
export async function disconnect(env: Env) {
  await env.DB.prepare("DELETE FROM settings WHERE key IN ('spotify', 'spotify:state', 'music:now')").run();
  await env.STATE.delete('spotify:token');
  return json({ ok: true });
}
export async function musicStatus(env: Env) {
  const s = await getSetting<SpotifySettings | null>(env, 'spotify', null);
  return { connected: !!s?.refreshToken, app: !!s?.clientId, device: s?.deviceName ?? null, now: await getSetting<NowPlaying | null>(env, 'music:now', null) };
}

// ── Guests ───────────────────────────────────────────────────────────────────
async function guest(env: Env, id: unknown) {
  const v = typeof id === 'string' ? await env.DB.prepare('SELECT id, first_name, last_seen, left_at FROM visitors WHERE id = ?').bind(id).first<any>() : null;
  return v && isHere(v) ? v : null;
}

const trackOf = (t: any): Track => ({
  uri: t.uri, title: t.name, artist: (t.artists ?? []).map((a: any) => a.name).join(', '), image: t.album?.images?.at(-1)?.url ?? null,
});

/** Whatever was pasted or typed, as a Spotify search (links from Apple Music and YouTube included). */
async function understand(q: string): Promise<{ uri?: string; query?: string }> {
  const s = q.trim();
  const sp = s.match(/open\.spotify\.com\/(?:intl-\w+\/)?track\/([A-Za-z0-9]+)/) ?? s.match(/^spotify:track:([A-Za-z0-9]+)$/);
  if (sp) return { uri: `spotify:track:${sp[1]}` };
  if (/music\.apple\.com\//.test(s)) {
    const id = new URL(s).searchParams.get('i') ?? s.match(/\/song\/[^/]+\/(\d+)/)?.[1];
    if (id) {
      const r = await fetch(`https://itunes.apple.com/lookup?id=${id}`).then((x) => x.json<any>()).catch(() => null);
      const t = r?.results?.[0];
      if (t?.trackName) return { query: `track:${t.trackName} artist:${t.artistName}` };
    }
  }
  if (/(youtube\.com|youtu\.be)\//.test(s)) {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(s)}`).then((x) => x.json<any>()).catch(() => null);
    if (r?.title) return { query: String(r.title).replace(/\((official|lyric|audio)[^)]*\)|\[[^\]]*\]|official (music )?video/gi, '').trim() };
  }
  return { query: s.slice(0, 120) };
}

/** GET /api/music/search?id=…&q=… → up to five songs. */
export async function search(env: Env, url: URL) {
  if (!(await guest(env, url.searchParams.get('id')))) return json({ error: 'only for guests who are here' }, 403);
  const q = url.searchParams.get('q') ?? '';
  if (!q.trim()) return json([]);
  const u = await understand(q);
  if (u.uri) {
    const r = await spotify(env, `/tracks/${u.uri.split(':')[2]}`);
    return json(r.ok ? [trackOf(await r.json())] : []);
  }
  const r = await spotify(env, `/search?type=track&limit=5&q=${encodeURIComponent(u.query!)}`);
  if (!r.ok) return json({ error: r.status === 401 ? 'Music is not set up yet.' : 'Spotify did not answer.' }, 502);
  return json(((await r.json<any>()).tracks?.items ?? []).map(trackOf));
}

/** POST /api/music/queue { id, uri, title, artist } — the song plays next (or now, if nothing is on). */
export async function queue(req: Request, env: Env, ctx: ExecutionContext) {
  const b = await body<{ id?: string } & Partial<Track>>(req);
  const v = await guest(env, b.id);
  if (!v) return json({ error: 'only for guests who are here' }, 403);
  if (!b.uri?.startsWith('spotify:track:') || !b.title) return json({ error: 'pick a song' }, 400);
  if (!(await rateLimit(env, `song:${v.id}`, 6, 600))) return json({ error: 'Un momento · One moment, please.' }, 429);
  const pending = await env.DB.prepare('SELECT COUNT(*) AS n FROM song_requests WHERE visitor_id = ? AND played_at IS NULL AND queued_at > ?')
    .bind(v.id, now() - 3 * 3600000).first<{ n: number }>();
  if ((pending?.n ?? 0) >= PENDING_MAX) return json({ error: `Ya tienes ${PENDING_MAX} en cola · You have ${PENDING_MAX} waiting.` }, 429);

  const s = await getSetting<SpotifySettings | null>(env, 'spotify', null);
  let r = await spotify(env, `/me/player/queue?uri=${encodeURIComponent(b.uri)}`, { method: 'POST' });
  // Nothing playing: start it on the room's speaker.
  if (r.status === 404 && s?.deviceId) {
    r = await spotify(env, `/me/player/play?device_id=${encodeURIComponent(s.deviceId)}`, { method: 'PUT', body: JSON.stringify({ uris: [b.uri] }) });
  }
  if (!r.ok) {
    return json({ error: r.status === 404 ? 'No hay música sonando · Nothing is playing in the room right now.' : r.status === 401 ? 'Music is not set up yet.' : 'Spotify did not take it.' }, 502);
  }
  await env.DB.prepare('INSERT INTO song_requests (visitor_id, uri, title, artist, queued_at) VALUES (?, ?, ?, ?, ?)')
    .bind(v.id, b.uri, String(b.title).slice(0, 120), String(b.artist ?? '').slice(0, 120), now()).run();
  ctx.waitUntil(tick(env, true).catch(() => undefined));
  return json({ ok: true });
}

/** GET /api/music?id=… → what's on, what's next (with whose it is), and this guest's songs. */
export async function overview(env: Env, url: URL) {
  const st = await musicStatus(env);
  const id = url.searchParams.get('id');
  const mine = id ? (await env.DB.prepare('SELECT title, artist, played_at FROM song_requests WHERE visitor_id = ? AND queued_at > ? ORDER BY queued_at DESC LIMIT 6')
    .bind(id, now() - 6 * 3600000).all<any>()).results : [];
  return json({ connected: st.connected, now: st.now, mine });
}

// ── Suggestions ──────────────────────────────────────────────────────────────
const SUGGEST = {
  type: 'object',
  properties: { songs: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, artist: { type: 'string' } }, required: ['title', 'artist'], additionalProperties: false } } },
  required: ['songs'], additionalProperties: false,
};

/** GET /api/music/suggest?id=… → a few songs that would follow what's playing well. */
export async function suggest(env: Env, url: URL, ctx: ExecutionContext) {
  if (!(await guest(env, url.searchParams.get('id')))) return json({ error: 'only for guests who are here' }, 403);
  const np = await playing(env);
  const key = `music:suggest:${np?.uri ?? 'none'}`;
  const cached = await env.STATE.get<Track[]>(key, 'json');
  if (cached) return json(cached);
  let picks: { title: string; artist: string }[] = [];
  if (env.ANTHROPIC_API_KEY && np) {
    try {
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
      const hour = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Madrid' }).format(new Date());
      const res: any = await client.beta.messages.create({
        model: 'claude-opus-5-5', max_tokens: 1000,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SUGGEST } },
        betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
        system: 'You choose music for a small gathering in a flat by the sea in Cádiz. Suggest five real, well-known-enough songs (available on Spotify) that would follow the current one naturally: similar mood and energy, a mix of artists, not the same artist twice, nothing jarring. It is ' + hour + ':00 local time.',
        messages: [{ role: 'user', content: `Now playing: "${np.title}" by ${np.artist}.` }],
      } as any);
      const text = res.content?.find((x: any) => x.type === 'text')?.text ?? '{}';
      picks = (JSON.parse(text).songs ?? []).slice(0, 5);
    } catch (e) { console.error('suggest', e); }
  }
  // Without Claude (or with nothing playing), more from the same artist, or quiet favourites by the sea.
  const queries = picks.length ? picks.map((p) => `track:${p.title} artist:${p.artist}`) : [np ? `artist:${np.artist.split(',')[0]}` : 'mediterranean summer chill'];
  const found: Track[] = [];
  for (const q of queries) {
    const r = await spotify(env, `/search?type=track&limit=${picks.length ? 1 : 5}&q=${encodeURIComponent(q)}`);
    if (r.ok) for (const t of (await r.json<any>()).tracks?.items ?? []) if (t.uri !== np?.uri && !found.some((f) => f.uri === t.uri)) found.push(trackOf(t));
  }
  ctx.waitUntil(env.STATE.put(key, JSON.stringify(found.slice(0, 5)), { expirationTtl: 900 }));
  return json(found.slice(0, 5));
}

// ── Whose song is on ─────────────────────────────────────────────────────────
async function playing(env: Env): Promise<Track | null> {
  const r = await spotify(env, '/me/player/currently-playing');
  if (r.status !== 200) return null;
  const d = await r.json<any>();
  return d?.item?.uri ? trackOf(d.item) : null;
}

/**
 * Called as screens poll (at most every 12 s): when a guest's song comes on, remember whose it is,
 * redraw the screens, and let the lamps by the wall breathe once.
 */
let checkedHere = 0; // per isolate: most polls stop here without touching storage
export async function tick(env: Env, force = false) {
  if (!force && now() - checkedHere < CHECK_EVERY_MS) return;
  checkedHere = now();
  const last = Number((await env.STATE.get('music:checked')) ?? 0);
  if (!force && now() - last < CHECK_EVERY_MS) return;
  await env.STATE.put('music:checked', String(now()));
  const s = await getSetting<SpotifySettings | null>(env, 'spotify', null);
  if (!s?.refreshToken) return;
  const r = await spotify(env, '/me/player/queue');
  if (!r.ok) return;
  const q = await r.json<any>();
  const cur = q.currently_playing?.uri ? trackOf(q.currently_playing) : null;
  const prev = await getSetting<NowPlaying | null>(env, 'music:now', null);
  const nextUri = q.queue?.[0]?.uri;
  const recent = (await env.DB.prepare(`SELECT r.id, r.uri, r.visitor_id, r.played_at, v.first_name FROM song_requests r
    JOIN visitors v ON v.id = r.visitor_id WHERE r.queued_at > ? ORDER BY r.queued_at`).bind(now() - 3 * 3600000).all<any>()).results;
  const nextReq = nextUri ? recent.find((x) => x.uri === nextUri && !x.played_at) : null;
  const next = nextReq ? { title: q.queue[0].name, by: nextReq.first_name } : null;
  if (!cur) {
    if (prev) await env.DB.prepare("DELETE FROM settings WHERE key = 'music:now'").run();
    return;
  }
  if (prev?.uri === cur.uri) {
    if (prev.next?.by !== next?.by) await setSetting(env, 'music:now', { ...prev, next });
    return;
  }
  const req = recent.find((x) => x.uri === cur.uri && !x.played_at);
  if (req) await env.DB.prepare('UPDATE song_requests SET played_at = ? WHERE id = ?').bind(now(), req.id).run();
  const np: NowPlaying = { ...cur, by: req ? { id: req.visitor_id, name: req.first_name } : null, at: now(), next };
  await setSetting(env, 'music:now', np);
  if (req) {
    // Browser walls see it through their version string; e-ink panels don't redraw for music.
    // The lamps by the wall breathe once for a guest's song.
    await spotlight(env, 'wall');
    await new Promise((r) => setTimeout(r, 4000));
    await spotlight(env, null);
  }
}
