// Tiny client for the Worker API. The owner passcode lives only in this browser.
export const API = window.ATLANTICO?.api ?? '';
const KEY = 'atlantico-owner';

export const ownerToken = {
  get: () => { try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } },
  set: (v) => { try { localStorage.setItem(KEY, v); } catch { /* private mode */ } },
  clear: () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
};

export async function api(path, { method = 'GET', body, owner = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (owner) headers.authorization = `Bearer ${ownerToken.get()}`;
  const r = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error ?? `HTTP ${r.status}`), { status: r.status });
  return data;
}

export function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.append(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3600);
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** Slow drifting hairlines behind a page — the house style. */
export function drift(canvas, { lines = 14, alpha = 0.07 } = {}) {
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const draw = (t) => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (canvas.width !== innerWidth * dpr) { canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; }
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = `rgba(233,230,223,${alpha})`;
    ctx.lineWidth = dpr * 0.7;
    for (let i = 0; i < lines; i++) {
      const y0 = H * (0.55 + (i / lines) * 0.45);
      ctx.beginPath();
      for (let x = 0; x <= W; x += 8 * dpr) {
        const y = y0 + Math.sin(x / (W / 2.3) + t / 9000 + i * 0.42) * 6 * dpr * (1 + i / lines);
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    if (!reduce) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}
