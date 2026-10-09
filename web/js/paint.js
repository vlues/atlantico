// Canvas painter for compositions, plus the arrival moment: a shooting star crosses the sky,
// lands where the guest's own star lives, and the star ignites. Shared by the wall and the
// guest's phone so both play the same scene.
import { PALETTE } from '../lib/art.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ease = (v) => { const x = clamp01(v); return x * x * (3 - 2 * x); };

export const LAND_S = 1.85;   // seconds until the shooting star lands
/** How far the star's own entrance (rays, reflection) has got at `e` seconds. */
export const revealAt = (e) => (e == null ? 1 : clamp01((e - LAND_S) / 2.4));

// Welcome words come in after the star lands: greeting, then the name letter by letter, then the line.
function wordsAlpha(t, e, i = 0) {
  if (e == null) return 1;
  if (t.role === 'greeting') return ease((e - 2.1) / 1.2);
  if (t.role === 'name') return ease((e - 2.6 - i * 0.09) / 0.7);
  if (t.role === 'line') return ease((e - 3.4 - t.after * 0.09) / 1.4);
  return 1;
}

/** Draw a composition. `e` = seconds into an arrival (null when there is none). */
export function paint(ctx, comp, alpha = 1, e = null) {
  const p = comp.palette ?? (comp.dark ? PALETTE.dark : PALETTE.light);
  const col = (a) => (a && p[a]) || p.fg;
  const sw = Math.max(0.7, Math.min(comp.width, comp.height) / 1100);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, comp.width, comp.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Strokes that look alike are drawn as one path: thousands of short strokes stay smooth.
  const groups = new Map();
  for (const l of comp.lines) {
    const key = `${l.alpha.toFixed(2)}|${l.weight ?? 1}|${l.accent ?? ''}|${l.dash ? l.dash.map((v) => v.toFixed(1)).join(',') : l.dotted ? 'dot' : ''}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { l, list: [] }));
    g.list.push(l.pts);
  }
  for (const { l, list } of groups.values()) {
    ctx.globalAlpha = alpha * l.alpha;
    ctx.strokeStyle = col(l.accent);
    ctx.lineWidth = sw * (l.weight ?? 1);
    ctx.setLineDash(l.dash ? [Math.max(0.01, l.dash[0]), l.dash[1]] : l.dotted ? [sw, sw * 5] : []);
    ctx.beginPath();
    for (const pts of list) {
      ctx.moveTo(pts[0], pts[1]);
      for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1]);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const sh of comp.shapes ?? []) {
    ctx.globalAlpha = alpha * sh.alpha;
    ctx.fillStyle = col(sh.accent);
    ctx.beginPath();
    ctx.moveTo(sh.pts[0], sh.pts[1]);
    for (let k = 2; k < sh.pts.length; k += 2) ctx.lineTo(sh.pts[k], sh.pts[k + 1]);
    ctx.closePath();
    ctx.fill();
  }
  ctx.lineWidth = sw;
  for (const c of comp.circles) {
    ctx.globalAlpha = alpha * c.alpha;
    ctx.fillStyle = ctx.strokeStyle = col(c.accent);
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    c.fill ? ctx.fill() : ctx.stroke();
  }
  const nameLen = [...(comp.texts.find((t) => t.role === 'name')?.text ?? '')].length;
  for (const t of comp.texts) {
    ctx.font = `${t.italic ? 'italic ' : ''}300 ${t.size * 1.5}px 'Cormorant Garamond', Georgia, serif`;
    ctx.letterSpacing = `${(t.size * 0.06).toFixed(1)}px`;
    ctx.fillStyle = col(t.accent);
    if (t.role === 'name' && e != null) {
      // Letter by letter, each rising a touch as it appears.
      const chars = [...t.text];
      const full = ctx.measureText(t.text).width;
      const x0 = t.align === 'center' ? t.x - full / 2 : t.align === 'right' ? t.x - full : t.x;
      ctx.textAlign = 'left';
      chars.forEach((ch, i) => {
        const a = wordsAlpha(t, e, i);
        if (a <= 0) return;
        ctx.globalAlpha = alpha * t.alpha * a;
        ctx.fillText(ch, x0 + ctx.measureText(chars.slice(0, i).join('')).width, t.y + (1 - a) * t.size * 0.18);
      });
      continue;
    }
    const a = wordsAlpha({ ...t, after: nameLen }, e);
    if (a <= 0) continue;
    ctx.globalAlpha = alpha * t.alpha * a;
    ctx.textAlign = t.align;
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.restore();
}

// A small deterministic random, so each arrival (seeded by when it happened) flies its own path.
const rnd = (seed, k) => {
  let h = Math.imul((seed | 0) ^ Math.imul(k, 0x9e3779b1), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * The shooting star and the ignition, drawn over a composition that has a `hero`.
 * `seed` makes every arrival its own: where the meteor comes from, how it curves, how many rings.
 */
export function arrival(ctx, comp, e, seed = 0) {
  const h = comp.hero;
  if (!h || e == null || e > LAND_S + 3.4) return;
  const W = comp.width, H = comp.height, S = Math.min(W, H);
  const gold = (comp.palette ?? (comp.dark ? PALETTE.dark : PALETTE.light)).here;
  const sw = Math.max(0.7, S / 1100);
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = ctx.shadowColor = gold;

  // A meteor from the far side of the sky, slowing as it arrives.
  const t0 = 0.25;
  if (e > t0 && e < LAND_S + 0.05) {
    const dir = rnd(seed, 1) < 0.75 ? (h.x < W / 2 ? 1 : -1) : (h.x < W / 2 ? -1 : 1);
    const reach = 0.25 + 0.3 * rnd(seed, 2), rise = 0.18 + 0.2 * rnd(seed, 3), bow = (rnd(seed, 4) - 0.3) * 0.2;
    const P0 = { x: h.x + dir * W * reach, y: h.y - H * rise };
    const C = { x: (P0.x + h.x) / 2 + dir * S * bow, y: (P0.y + h.y) / 2 - S * (0.03 + 0.08 * rnd(seed, 5)) };
    const at = (u) => ({
      x: (1 - u) * (1 - u) * P0.x + 2 * u * (1 - u) * C.x + u * u * h.x,
      y: (1 - u) * (1 - u) * P0.y + 2 * u * (1 - u) * C.y + u * u * h.y,
    });
    const p = clamp01((e - t0) / (LAND_S - t0));
    const u = 1 - (1 - p) * (1 - p);
    const tail = 0.3 * (1 - 0.6 * p);
    const n = 28;
    let prev = at(Math.max(0, u - tail));
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      const q = at(Math.max(0, u - tail + tail * f));
      ctx.globalAlpha = f * f * 0.9;
      ctx.lineWidth = sw * (0.4 + 2.6 * f);
      ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      prev = q;
    }
    const head = at(u);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = S * 0.025;
    ctx.beginPath(); ctx.arc(head.x, head.y, S * 0.0045, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Landing: a soft flash, then rings opening out like a stone dropped in still water.
  const k0 = e - LAND_S;
  if (k0 > 0) {
    const fk = clamp01(k0 / 0.9);
    if (fk < 1) {
      const r = S * 0.08 * (0.5 + 0.5 * fk);
      const g = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, r);
      g.addColorStop(0, gold);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = (1 - fk) * (1 - fk) * 0.6;
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, Math.PI * 2); ctx.fill();
    }
    const rings = 2 + Math.floor(rnd(seed, 6) * 3);
    for (let i = 0; i < rings; i++) {
      const k = clamp01((k0 - i * 0.35) / 2.6);
      if (k <= 0 || k >= 1) continue;
      ctx.globalAlpha = (1 - k) * (1 - k) * 0.6;
      ctx.lineWidth = sw * (1.4 - k * 0.8);
      ctx.beginPath(); ctx.arc(h.x, h.y, S * (0.012 + 0.2 * Math.pow(k, 0.7)), 0, Math.PI * 2); ctx.stroke();
    }
  }
  ctx.restore();
}
