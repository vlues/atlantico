// Firmware updates for paired devices. CI publishes app images and ota.json next to the site;
// devices ask here once a day and download through the Worker (one TLS chain, device auth).
import type { Env } from './env';
import { json } from './http';
import { deviceFromRequest } from './util';

interface Ota { build: number; files: Record<string, { path: string; size: number; md5: string }> }

async function manifest(env: Env): Promise<Ota | null> {
  if (!env.SITE_URL) return null;
  const r = await fetch(`${env.SITE_URL}/firmware/ota.json`, { cf: { cacheTtl: 300 } } as RequestInit);
  return r.ok ? ((await r.json()) as Ota) : null;
}

/** GET /api/device/firmware?env=panel-xiao75&build=12 → 204 (current) or where the newer image is. */
export async function firmwareCheck(req: Request, env: Env, url: URL): Promise<Response> {
  if (!(await deviceFromRequest(req, env))) return json({ error: 'unknown device' }, 401);
  const name = url.searchParams.get('env') ?? '';
  const build = Number(url.searchParams.get('build')) || 0;
  const ota = await manifest(env).catch(() => null);
  const f = ota?.files[name];
  if (!ota || !f || ota.build <= build) return new Response(null, { status: 204 });
  return json({ build: ota.build, size: f.size, md5: f.md5, path: `/api/device/firmware/${encodeURIComponent(name)}.bin` });
}

/** The image itself, buffered so it goes out with an exact Content-Length (devices stream it to flash). */
export async function firmwareImage(req: Request, env: Env, name: string): Promise<Response> {
  if (!(await deviceFromRequest(req, env))) return json({ error: 'unknown device' }, 401);
  const f = (await manifest(env).catch(() => null))?.files[name];
  if (!f) return json({ error: 'no such firmware' }, 404);
  const r = await fetch(`${env.SITE_URL}/firmware/${f.path}`);
  if (!r.ok) return json({ error: 'firmware unavailable' }, 502);
  const bytes = await r.arrayBuffer();
  if (bytes.byteLength !== f.size) return json({ error: 'firmware size mismatch' }, 502);
  return new Response(bytes, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' } });
}
