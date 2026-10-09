import type { Env } from './env';

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

function allowedOrigin(req: Request, env: Env): string | null {
  const origin = req.headers.get('origin');
  if (!origin) return null;
  const allowed = env.PAGES_ORIGIN.split(',').map((s) => s.trim());
  if (allowed.includes(origin)) return origin;
  if (env.SIMULATE === 'true' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

export function cors(req: Request, res: Response, env: Env): Response {
  const origin = allowedOrigin(req, env);
  if (!origin) return res;
  const out = new Response(res.body, res);
  out.headers.set('access-control-allow-origin', origin);
  out.headers.set('vary', 'origin');
  out.headers.set('access-control-expose-headers', 'x-sleep-seconds, x-width, x-height, x-colors');
  return out;
}

export function preflight(req: Request, env: Env): Response {
  const origin = allowedOrigin(req, env);
  return new Response(null, {
    status: 204,
    headers: origin
      ? {
          'access-control-allow-origin': origin,
          'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'access-control-allow-headers': 'content-type, authorization',
          'access-control-max-age': '86400',
          vary: 'origin',
        }
      : {},
  });
}
