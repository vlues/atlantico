// Draws a surprise over the wall (screens only). Everything here is grown from the recipe's seeds, so
// every screen in the house plays exactly the same moment. Line-art like the wall: paper and ink,
// with the recipe's own colours.
import { rng, ELEMENTS } from '../lib/surprise.js';
import { PALETTE } from '../lib/art.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (v) => { const x = clamp(v, 0, 1); return x * x * (3 - 2 * x); };
const between = (r, a, b) => a + (b - a) * r();

/** When things happen inside a layer, so the sounds can be timed to them. */
export function moments(L) {
  const r = rng(L.seed ^ 0x51ed27);
  const n = L.kind === 'fireworks' ? L.count : L.kind === 'meteors' ? Math.min(L.count, 12) : L.kind === 'dolphins' ? Math.min(L.count, 4) : 1;
  return Array.from({ length: n }, (_, i) => clamp((i / Math.max(1, n)) * (L.dur - 2.5) + r() * 1.2, 0, L.dur - 1));
}

/** Draw the whole surprise at `e` seconds since it began. */
export function drawSurprise(ctx, comp, rec, e) {
  const W = comp.width, H = comp.height, S = Math.min(W, H);
  const mx = comp.margin ?? W * 0.085, fw = W - 2 * mx, horizon = comp.horizon, bottom = H * 0.84;
  const p = comp.palette ?? (comp.dark ? PALETTE.dark : PALETTE.light);
  const C = {
    W, H, S, mx, fw, horizon, bottom, dark: comp.dark, p, comp,
    sw: Math.max(0.7, S / 1100),
    seaY: (s) => horizon + (bottom - horizon) * (0.5 * s + 0.5 * Math.pow(clamp(s, 0, 1), 1.5)),
    tint: (L, a = 1, dl = 0) => `hsla(${L.hue.toFixed(0)}, ${clamp(L.sat, 20, 90).toFixed(0)}%, ${(comp.dark ? 70 : 40) + dl}%, ${a})`,
    ink: (a = 1) => withAlpha(p.fg, a),
    paper: (a = 1) => withAlpha(p.bg, a),
  };
  const fadeAll = ease(e / 0.8) * ease((rec.dur - e) / 1.2);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (rec.sky !== 'none') sky(ctx, C, rec, e, fadeAll);
  if (rec.sea !== 'none') sea(ctx, C, rec, e, fadeAll);
  for (const L of rec.layers) {
    const le = e - L.delay;
    if (le < 0 || le > L.dur) continue;
    const env = ease(le / 1.2) * ease((L.dur - le) / 1.6);
    ctx.save();
    try { DRAW[L.kind]?.(ctx, C, L, le, env); } finally { ctx.restore(); }
  }
  ctx.restore();
}

function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
function poly(ctx, pts, close = true) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1]);
  if (close) ctx.closePath();
}
function local(ctx, x, y, sx, sy, rot, fn) { ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sx, sy); fn(); ctx.restore(); }
function ripple(ctx, C, x, y, k, size, color) {
  if (k <= 0 || k >= 1) return;
  ctx.strokeStyle = color;
  ctx.globalAlpha = (1 - k) * (1 - k) * 0.7;
  ctx.lineWidth = C.sw;
  ctx.beginPath(); ctx.ellipse(x, y, size * (0.3 + 1.6 * k), size * (0.08 + 0.4 * k), 0, 0, TAU); ctx.stroke();
}
function clipSea(ctx, C) { ctx.beginPath(); ctx.rect(C.mx, C.horizon, C.fw, C.H); ctx.clip(); }
function clipSky(ctx, C) { ctx.beginPath(); ctx.rect(C.mx, 0, C.fw, C.horizon); ctx.clip(); }
function clipFrame(ctx, C) { ctx.beginPath(); ctx.rect(C.mx, 0, C.fw, C.H); ctx.clip(); }

// ── The sea and the sky answering ─────────────────────────────────────────────
function sea(ctx, C, rec, e, a) {
  const r = rng(rec.layers[0].seed ^ 0xa5a5);
  const L = rec.layers[0];
  const seaLines = C.comp.lines.filter((l) => l.row != null && !l.accent);
  ctx.save();
  clipSea(ctx, C);
  if (rec.sea === 'gold' || rec.sea === 'shiver') {
    // A band of light running through the water (gold), or the whole sea catching it (shiver).
    const front = rec.sea === 'gold' ? (e / Math.min(rec.dur, 10)) * 1.3 - 0.15 : null;
    ctx.lineWidth = C.sw * 1.6;
    for (const l of seaLines) {
      const k = front == null ? 0.35 + 0.35 * Math.sin(e * 3 + l.row * 14) : 1 - Math.abs(l.row - front) / 0.07;
      if (k <= 0) continue;
      ctx.globalAlpha = a * k * (front == null ? 0.35 : 0.85);
      ctx.strokeStyle = rec.sea === 'gold' ? C.p.here : C.tint(L, 1, 10);
      poly(ctx, l.pts, false); ctx.stroke();
    }
  } else if (rec.sea === 'shimmer') {
    const tick = Math.floor(e * 6);
    const rr = rng((L.seed ^ tick) >>> 0);
    ctx.strokeStyle = C.tint(L, 1, 15);
    ctx.lineWidth = C.sw * 2;
    for (let k = 0; k < 40; k++) {
      const l = seaLines[Math.floor(rr() * seaLines.length)];
      if (!l) break;
      const q = 2 * Math.floor(rr() * (l.pts.length / 2 - 3));
      ctx.globalAlpha = a * 0.9;
      poly(ctx, l.pts.slice(q, q + 6), false); ctx.stroke();
    }
  } else if (rec.sea === 'rings') {
    for (let k = 0; k < 26; k++) {
      const s = r(), x = C.mx + C.fw * r(), ph = (e * 0.5 + r()) % 1;
      ripple(ctx, C, x, C.seaY(s), ph, C.S * (0.008 + 0.03 * s), C.tint(L, a));
    }
  }
  ctx.restore();
}

function sky(ctx, C, rec, e, a) {
  const L = rec.layers[0];
  if (rec.sky === 'flash') {
    ctx.globalAlpha = 0.22 * Math.exp(-e * 2.2) * (e > 0 ? 1 : 0);
    ctx.fillStyle = C.dark ? '#ffffff' : C.tint(L, 1, 30);
    ctx.fillRect(0, 0, C.W, C.H);
  } else if (rec.sky === 'glow') {
    const g = ctx.createRadialGradient(C.W / 2, C.horizon, 0, C.W / 2, C.horizon, C.W * 0.6);
    g.addColorStop(0, C.tint(L, 0.22 * a, 10));
    g.addColorStop(1, C.tint(L, 0));
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, C.W, C.horizon);
  } else if (rec.sky === 'twinkle') {
    // Every star on the wall flares together, once, then again.
    const k = Math.max(0, Math.sin(Math.min(1, e / 6) * Math.PI * 2));
    ctx.fillStyle = C.p.here;
    for (const c of C.comp.circles) {
      if (c.accent !== 'visitor' || !c.fill) continue;
      ctx.globalAlpha = a * k * 0.8;
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r * (1.5 + 2 * k), 0, TAU); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

// ── Elements ──────────────────────────────────────────────────────────────────
const DOLPHIN = [0.52, 0.01, 0.42, -0.06, 0.2, -0.11, 0, -0.12, -0.25, -0.09, -0.45, -0.03, -0.5, 0, -0.62, -0.08, -0.57, 0, -0.62, 0.08, -0.5, 0.01, -0.3, 0.05, 0, 0.08, 0.25, 0.07, 0.42, 0.04, 0.5, 0.03];
const DORSAL = [0.02, -0.11, -0.1, -0.25, -0.15, -0.1];

const DRAW = {
  dolphins(ctx, C, L, e, env) {
    const r = rng(L.seed);
    clipFrame(ctx, C);
    for (let i = 0; i < L.count; i++) {
      const s = clamp(0.12 + 0.5 * L.depth + (r() - 0.5) * 0.14, 0.05, 0.85);
      const size = C.S * (0.024 + 0.05 * s) * L.scale * between(r, 0.8, 1.2);
      const start = r() * 1.5 + i * between(r, 0.3, 0.8);
      const span = Math.max(4, L.dur - start - 1);
      const x0 = L.dir > 0 ? C.mx + C.fw * L.x * 0.35 : C.W - C.mx - C.fw * L.x * 0.35;
      const travel = C.fw * between(r, 0.5, 0.85);
      const cycle = between(r, 1.3, 2.1) / L.speed, hop = between(r, 0.9, 1.6);
      const lt = e - start;
      if (lt < 0 || lt > span) continue;
      const x = x0 + L.dir * travel * (lt / span), wy = C.seaY(s);
      const ph = (lt % cycle) / cycle, air = 0.48;
      ripple(ctx, C, x - L.dir * size * 0.6, wy, (ph - air) / (1 - air), size * 0.8, C.ink(1));
      if (ph < air) {
        const u = ph / air;
        const y = wy - Math.sin(Math.PI * u) * size * hop;
        ctx.globalAlpha = env * 0.92;
        ctx.fillStyle = C.ink(1);
        local(ctx, x, y, L.dir * size, size, L.dir * (u - 0.5) * 1.7, () => { poly(ctx, DOLPHIN); ctx.fill(); poly(ctx, DORSAL); ctx.fill(); });
        if (u < 0.15 || u > 0.85) { // spray as it leaves or meets the water
          ctx.strokeStyle = C.ink(0.6); ctx.lineWidth = C.sw;
          for (let k = 0; k < 4; k++) { const a = -Math.PI / 2 + (k - 1.5) * 0.35; ctx.beginPath(); ctx.moveTo(x, wy); ctx.lineTo(x + Math.cos(a) * size * 0.35, wy + Math.sin(a) * size * 0.35); ctx.stroke(); }
        }
      }
    }
  },

  whale(ctx, C, L, e, env) {
    const r = rng(L.seed);
    for (let i = 0; i < L.count; i++) {
      const s = clamp(0.08 + 0.4 * L.depth + i * 0.1, 0.05, 0.7);
      const x = C.mx + C.fw * clamp(L.x + i * 0.18 * L.dir, 0.1, 0.9), wy = C.seaY(s);
      const z = C.S * (0.05 + 0.1 * s) * L.scale, q = (e - i * 2.5) / (L.dur - i * 2.5);
      if (q < 0 || q > 1) continue;
      ctx.save(); clipFrame(ctx, C);
      // The blow: a fountain of spray.
      const blow = clamp(q / 0.28, 0, 1);
      if (blow > 0 && blow < 1) {
        ctx.strokeStyle = C.ink(1); ctx.lineWidth = C.sw;
        for (let k = 0; k < 28; k++) {
          const a = -Math.PI / 2 + (r() - 0.5) * 0.7, v = z * between(r, 1.2, 2.4), tt = blow * 1.4;
          const px = x + Math.cos(a) * v * tt, py = wy - z * 0.05 + Math.sin(a) * v * tt + z * 1.6 * tt * tt;
          ctx.globalAlpha = env * (1 - blow) * 0.8;
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * z * 0.05, py + Math.sin(a) * z * 0.05); ctx.stroke();
        }
      }
      // The back rolling, then the tail rising and slipping under.
      ctx.beginPath(); ctx.rect(0, 0, C.W, wy); ctx.clip();
      ctx.fillStyle = C.ink(1);
      const back = clamp((q - 0.22) / 0.34, 0, 1);
      if (back > 0 && back < 1) {
        ctx.globalAlpha = env;
        ctx.beginPath(); ctx.ellipse(x + L.dir * z * (back - 0.5) * 0.8, wy, z * 0.8, z * 0.2 * Math.sin(Math.PI * back), 0, Math.PI, TAU); ctx.fill();
      }
      const tail = clamp((q - 0.5) / 0.42, 0, 1);
      if (tail > 0 && tail < 1) {
        const lift = Math.sin(Math.PI * tail) * z * 0.75, tx = x + L.dir * z * 0.5;
        ctx.globalAlpha = env;
        ctx.beginPath(); ctx.moveTo(tx - z * 0.05, wy); ctx.lineTo(tx - z * 0.03, wy - lift); ctx.lineTo(tx + z * 0.03, wy - lift); ctx.lineTo(tx + z * 0.05, wy); ctx.fill();
        local(ctx, tx, wy - lift, z, z, L.dir * 0.08, () => {
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-0.22, -0.12, -0.36, -0.02); ctx.quadraticCurveTo(-0.18, 0.02, 0, 0.05);
          ctx.quadraticCurveTo(0.18, 0.02, 0.36, -0.02); ctx.quadraticCurveTo(0.22, -0.12, 0, 0); ctx.fill();
        });
        ctx.strokeStyle = C.ink(0.5); ctx.lineWidth = C.sw;
        for (let k = 0; k < 6; k++) { const dx = (k / 5 - 0.5) * z * 0.6; ctx.beginPath(); ctx.moveTo(tx + dx, wy - lift + z * 0.02); ctx.lineTo(tx + dx, wy - lift + z * 0.02 + lift * 0.4 * (0.5 + 0.5 * Math.sin(k * 7))); ctx.stroke(); }
      }
      ctx.restore();
      ripple(ctx, C, x, wy, (q * 2.2) % 1, z * 0.7, C.ink(1));
    }
  },

  tallship(ctx, C, L, e, env) {
    // A four-masted topsail schooner (the Juan Sebastián de Elcano sails from Cádiz).
    const s = 0.02 + 0.06 * L.depth, wy = C.seaY(s), len = C.S * 0.22 * L.scale;
    const q = e / L.dur, x = (L.dir > 0 ? C.mx - len * 0.7 : C.W - C.mx + len * 0.7) + L.dir * (C.fw + len * 1.4) * q;
    clipFrame(ctx, C);
    ctx.globalAlpha = env;
    local(ctx, x, wy, L.dir * len, len, 0, () => {
      const lw = C.sw / len;
      ctx.lineWidth = lw;
      ctx.strokeStyle = C.ink(1);
      ctx.fillStyle = C.ink(1);
      poly(ctx, [-0.5, -0.06, 0.46, -0.07, 0.4, 0, -0.44, 0]); ctx.fill();          // hull
      ctx.beginPath(); ctx.moveTo(0.46, -0.065); ctx.lineTo(0.68, -0.11); ctx.stroke(); // bowsprit
      const masts = [[0.3, 0.62], [0.1, 0.66], [-0.1, 0.62], [-0.3, 0.56]];
      for (const [m, h] of masts) { ctx.beginPath(); ctx.moveTo(m, -0.06); ctx.lineTo(m, -0.06 - h); ctx.stroke(); }
      const sailPaint = (pts) => { ctx.fillStyle = C.paper(1); poly(ctx, pts); ctx.fill(); ctx.strokeStyle = C.ink(1); ctx.stroke(); };
      // Square sails stacked on the foremast, a little bellied by the wind.
      for (let k = 0; k < 4; k++) {
        const top = -0.14 - k * 0.12, w = 0.1 - k * 0.012, m = masts[0][0];
        sailPaint([m - w, top, m + w, top, m + w * 0.95 + 0.012, top + 0.1, m - w * 0.95 + 0.012, top + 0.1]);
      }
      // Gaff sails on the other masts, topsails above.
      for (const [m, h] of masts.slice(1)) {
        sailPaint([m, -0.1, m, -0.06 - h * 0.6, m - 0.16, -0.06 - h * 0.48, m - 0.17, -0.1]);
        sailPaint([m, -0.06 - h * 0.62, m, -0.06 - h * 0.95, m - 0.11, -0.06 - h * 0.64]);
      }
      // Jibs to the bowsprit.
      for (let k = 0; k < 3; k++) sailPaint([masts[0][0] + 0.01, -0.12 - k * 0.12, 0.62 - k * 0.07, -0.1 - k * 0.003, masts[0][0] + 0.02, -0.08 - k * 0.04]);
      // Pennants.
      ctx.fillStyle = C.tint(L, 1);
      for (const [m, h] of masts) poly(ctx, [m, -0.06 - h, m - 0.07, -0.05 - h + 0.012 * Math.sin(e * 6 + m * 9), m, -0.04 - h]), ctx.fill();
    });
  },

  regatta(ctx, C, L, e, env) {
    const r = rng(L.seed);
    clipFrame(ctx, C);
    for (let i = 0; i < L.count; i++) {
      const s = clamp(0.1 + 0.35 * L.depth + (r() - 0.5) * 0.12, 0.04, 0.6), z = C.S * (0.025 + 0.05 * s) * L.scale;
      const pace = between(r, 0.85, 1.15) * L.speed, lag = i * between(r, 0.4, 1.2);
      const q = clamp((e - lag) / (L.dur - lag), 0, 1) * pace;
      const x = (L.dir > 0 ? C.mx - z : C.W - C.mx + z) + L.dir * (C.fw + 2 * z) * q, wy = C.seaY(s) + Math.sin(e * 1.3 + i) * z * 0.05;
      const spin = r() < 0.45;
      ctx.globalAlpha = env;
      local(ctx, x, wy, L.dir * z, z, -0.08 * L.dir, () => {
        ctx.lineWidth = C.sw / z;
        ctx.fillStyle = C.ink(1); poly(ctx, [-0.5, -0.06, 0.55, -0.07, 0.42, 0.02, -0.42, 0.02]); ctx.fill();
        ctx.strokeStyle = C.ink(1); ctx.beginPath(); ctx.moveTo(0, -0.06); ctx.lineTo(0, -1); ctx.stroke();
        ctx.fillStyle = C.paper(1); poly(ctx, [-0.02, -0.98, -0.02, -0.12, -0.46, -0.12]); ctx.fill(); ctx.stroke();
        if (spin) { // a coloured spinnaker billowing ahead
          ctx.fillStyle = C.tint({ ...L, hue: (L.hue + i * 47) % 360 }, 0.95);
          ctx.beginPath(); ctx.moveTo(0.02, -0.9); ctx.quadraticCurveTo(0.75, -0.6, 0.5, -0.14); ctx.lineTo(0.06, -0.14); ctx.closePath(); ctx.fill();
        } else { ctx.fillStyle = C.paper(1); poly(ctx, [0.02, -0.82, 0.42, -0.12, 0.03, -0.12]); ctx.fill(); ctx.stroke(); }
      });
    }
  },

  flock(ctx, C, L, e, env) {
    // A murmuration: a cloud of starlings folding over itself as it crosses.
    const r = rng(L.seed);
    const u = e / L.dur, skyTop = C.H * 0.1, skyH = C.horizon - skyTop;
    const cx = C.mx + C.fw * (L.dir > 0 ? -0.1 + 1.2 * u : 1.1 - 1.2 * u), cy = skyTop + skyH * (0.3 + 0.35 * L.depth) + Math.sin(u * TAU) * skyH * 0.12;
    const rx = C.S * (0.08 + 0.05 * Math.sin(e * 0.7)) * L.scale, ry = C.S * (0.035 + 0.025 * Math.sin(e * 0.9 + 1)) * L.scale;
    ctx.strokeStyle = C.ink(1); ctx.lineWidth = C.sw * 0.9;
    clipSky(ctx, C);
    const w = C.S * 0.004;
    for (let i = 0; i < L.count; i++) {
      const a = r() * TAU, b = r() * TAU, rho = Math.sqrt(r());
      const x = cx + Math.cos(a + e * 0.8 + Math.sin(b + e) * 0.6) * rx * rho;
      const y = cy + Math.sin(a * 2 + e * 0.6) * ry * rho + Math.sin(b + e * 2) * C.S * 0.004;
      const f = Math.sin(e * 12 + b) * 0.4;
      ctx.globalAlpha = env * 0.85;
      ctx.beginPath(); ctx.moveTo(x - w, y - w * f); ctx.lineTo(x, y); ctx.lineTo(x + w, y - w * f); ctx.stroke();
    }
  },

  dive(ctx, C, L, e, env) {
    const r = rng(L.seed);
    for (let i = 0; i < L.count; i++) {
      const lag = i * between(r, 1, 2.5), q = (e - lag) / (L.dur - lag - 0.5);
      if (q < 0 || q > 1) continue;
      const s = 0.1 + 0.5 * r(), wy = C.seaY(s), tx = C.mx + C.fw * between(r, 0.15, 0.85), w = C.S * (0.012 + 0.016 * s) * L.scale;
      const fly = 0.55, sx = tx - L.dir * C.fw * 0.25, sy = C.H * 0.14 + r() * (C.horizon - C.H * 0.25) * 0.5;
      ctx.strokeStyle = C.ink(1); ctx.lineWidth = C.sw * 1.1; ctx.globalAlpha = env;
      if (q < fly) { // gliding in, wings beating now and then
        const k = q / fly, x = sx + (tx - sx) * k, y = sy + Math.sin(k * Math.PI) * w * 2;
        const flap = Math.sin(e * 9 + i) * 0.5 * (k < 0.7 ? 1 : 0.3);
        ctx.beginPath(); ctx.moveTo(x - w, y - w * (0.4 + flap)); ctx.quadraticCurveTo(x - w * 0.45, y - w * 0.6, x, y); ctx.quadraticCurveTo(x + w * 0.45, y - w * 0.6, x + w, y - w * (0.4 + flap)); ctx.stroke();
      } else if (q < fly + 0.12) { // wings folded, straight down
        const k = (q - fly) / 0.12, y = sy + (wy - sy) * k * k;
        ctx.beginPath(); ctx.moveTo(tx, y - w * 0.9); ctx.lineTo(tx - w * 0.25, y - w * 1.4); ctx.moveTo(tx, y - w * 0.9); ctx.lineTo(tx + w * 0.25, y - w * 1.4); ctx.moveTo(tx, y - w * 0.9); ctx.lineTo(tx, y); ctx.stroke();
      } else { // splash, then rings
        const k = (q - fly - 0.12) / (1 - fly - 0.12);
        for (let d = 0; d < 7; d++) { const a = -Math.PI / 2 + (d - 3) * 0.28, h = w * 2 * Math.sin(Math.PI * Math.min(1, k * 3)); ctx.globalAlpha = env * (1 - k); ctx.beginPath(); ctx.moveTo(tx, wy); ctx.lineTo(tx + Math.cos(a) * h, wy + Math.sin(a) * h); ctx.stroke(); }
        ripple(ctx, C, tx, wy, k, w * 2, C.ink(1));
      }
    }
  },

  flyingfish(ctx, C, L, e, env) {
    const r = rng(L.seed);
    for (let i = 0; i < L.count; i++) {
      const s = clamp(0.15 + 0.6 * L.depth + (r() - 0.5) * 0.1, 0.05, 0.9), z = C.S * (0.008 + 0.014 * s) * L.scale;
      const lag = i * between(r, 0.15, 0.5) + r(), dur = between(r, 1.2, 2.2) / L.speed, q = (e - lag) / dur;
      if (q < 0 || q > 1) continue;
      const x0 = C.mx + C.fw * clamp(L.x + (r() - 0.5) * 0.3, 0.05, 0.95), x = x0 + L.dir * C.fw * 0.2 * q, wy = C.seaY(s);
      const y = wy - Math.sin(Math.PI * q) * z * 3;
      ctx.globalAlpha = env; ctx.fillStyle = C.tint(L, 1, 8); ctx.strokeStyle = C.ink(0.8); ctx.lineWidth = C.sw * 0.8;
      local(ctx, x, y, L.dir * z, z, L.dir * (q - 0.5) * 0.4, () => {
        ctx.beginPath(); ctx.ellipse(0, 0, 1, 0.22, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.moveTo(0.2, 0); ctx.lineTo(-0.4, -0.9); ctx.moveTo(0.2, 0); ctx.lineTo(-0.3, 0.7); ctx.stroke();
      });
      if (q > 0.9) ripple(ctx, C, x, wy, (q - 0.9) * 10 * 0.5, z * 2, C.ink(1));
    }
  },

  kites(ctx, C, L, e, env) {
    const r = rng(L.seed);
    clipFrame(ctx, C);
    for (let i = 0; i < L.count; i++) {
      const ax = C.mx + C.fw * clamp(L.x + (i - L.count / 2) * 0.12, 0.05, 0.95), ay = C.H * 0.97;
      const rise = ease(e / 4), z = C.S * 0.03 * L.scale * between(r, 0.8, 1.2);
      const kx = ax + L.dir * C.S * (0.08 + 0.05 * Math.sin(e * 0.6 + i)), ky = C.H * (0.18 + 0.12 * r()) + (1 - rise) * C.H * 0.5 + Math.sin(e * 1.1 + i) * C.S * 0.012;
      ctx.globalAlpha = env;
      ctx.strokeStyle = C.ink(0.6); ctx.lineWidth = C.sw * 0.7;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo((ax + kx) / 2 - L.dir * C.S * 0.05, (ay + ky) / 2 + C.S * 0.08, kx, ky + z * 0.6); ctx.stroke();
      const sway = Math.sin(e * 2 + i) * 0.12;
      local(ctx, kx, ky, z, z, sway, () => {
        ctx.fillStyle = C.tint({ ...L, hue: (L.hue + i * 63) % 360 }, 0.95);
        poly(ctx, [0, -0.6, 0.42, 0, 0, 0.8, -0.42, 0]); ctx.fill();
        ctx.strokeStyle = C.ink(0.8); ctx.lineWidth = C.sw / z; ctx.beginPath(); ctx.moveTo(0, -0.6); ctx.lineTo(0, 0.8); ctx.moveTo(-0.42, 0); ctx.lineTo(0.42, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, 0.8);
        for (let k = 1; k <= 12; k++) ctx.lineTo(Math.sin(e * 4 + k * 0.7) * 0.18, 0.8 + k * 0.16);
        ctx.stroke();
      });
    }
  },

  balloon(ctx, C, L, e, env) {
    const r = rng(L.seed);
    clipSky(ctx, C);
    for (let i = 0; i < L.count; i++) {
      const z = C.S * (0.035 + 0.03 * r()) * L.scale, q = e / L.dur;
      const x = (L.dir > 0 ? C.mx - z : C.W - C.mx + z) + L.dir * (C.fw + 2 * z) * clamp(q * between(r, 0.7, 1) + i * 0.15, 0, 1.2);
      const y = C.H * 0.12 + (C.horizon - C.H * 0.25) * (0.2 + 0.6 * r()) + Math.sin(e * 0.5 + i) * z * 0.15;
      ctx.globalAlpha = env;
      local(ctx, x, y, z, z, Math.sin(e * 0.4 + i) * 0.04, () => {
        const gores = 6 + Math.floor(r() * 4);
        for (let g = 0; g < gores; g++) {
          const a0 = -0.5 + g / gores, a1 = -0.5 + (g + 1) / gores;
          ctx.fillStyle = g % 2 ? C.paper(1) : C.tint({ ...L, hue: (L.hue + i * 90) % 360 }, 1);
          ctx.beginPath(); ctx.moveTo(a0 * 0.3, 0.55);
          ctx.bezierCurveTo(a0 * 2.4, 0.1, a0 * 1.9, -0.75, 0, -0.8); ctx.bezierCurveTo(a1 * 1.9, -0.75, a1 * 2.4, 0.1, a1 * 0.3, 0.55); ctx.closePath(); ctx.fill();
        }
        ctx.strokeStyle = C.ink(0.9); ctx.lineWidth = C.sw / z;
        ctx.beginPath(); ctx.moveTo(-0.15, 0.55); ctx.lineTo(-0.1, 0.8); ctx.moveTo(0.15, 0.55); ctx.lineTo(0.1, 0.8); ctx.stroke();
        ctx.fillStyle = C.ink(1); ctx.fillRect(-0.11, 0.8, 0.22, 0.13);
      });
    }
  },

  sunpillar(ctx, C, L, e, env) {
    const sun = C.comp.sun;
    if (!sun) return;
    L = { ...L, hue: 32 + 12 * L.depth, sat: 75 }; // always sunlight-warm
    const g = ctx.createLinearGradient(0, sun.y - C.S * 0.3, 0, C.bottom);
    g.addColorStop(0, C.tint(L, 0)); g.addColorStop(0.35, C.tint(L, 0.35 * env, 10)); g.addColorStop(1, C.tint(L, 0));
    ctx.fillStyle = g;
    ctx.fillRect(sun.x - sun.r * 0.9, sun.y - C.S * 0.3, sun.r * 1.8, C.bottom - sun.y + C.S * 0.3);
    const tick = Math.floor(e * 8), rr = rng((L.seed ^ tick) >>> 0);
    ctx.strokeStyle = C.tint(L, 1, 20); ctx.lineWidth = C.sw * 2;
    for (let k = 0; k < 30; k++) { const s = rr(), y = C.seaY(s), half = sun.r * (0.5 + 3 * s) * rr(); ctx.globalAlpha = env * 0.8; ctx.beginPath(); ctx.moveTo(sun.x - half, y); ctx.lineTo(sun.x + half * 0.4, y); ctx.stroke(); }
  },

  rainbow(ctx, C, L, e, env) {
    // Sized to the sky: the top of the bow stays in the picture.
    const R = Math.min(C.fw * (0.3 + 0.12 * L.depth) * L.scale, (C.horizon - C.H * 0.1) / 0.78), cx = C.mx + C.fw * L.x, cy = C.horizon + R * 0.25;
    const bands = ['#d65a4a', '#e39a43', '#e6cf55', '#79b46a', '#5a8ec8', '#6c5fb0', '#9a62a8'];
    ctx.save(); clipSky(ctx, C);
    for (let twin = 0; twin < L.count; twin++) {
      const RR = R * (twin ? 1.22 : 1), order = twin ? [...bands].reverse() : bands;
      order.forEach((col, k) => {
        ctx.strokeStyle = col; ctx.globalAlpha = env * (twin ? 0.18 : 0.32) * (C.dark ? 0.8 : 1); ctx.lineWidth = C.S * 0.006;
        ctx.beginPath(); ctx.arc(cx, cy, RR - k * C.S * 0.006, Math.PI, TAU); ctx.stroke();
      });
    }
    ctx.restore();
  },

  moonbow(ctx, C, L, e, env) {
    const R = Math.min(C.fw * 0.36, (C.horizon - C.H * 0.1) / 0.78), cx = C.mx + C.fw * L.x, cy = C.horizon + R * 0.25;
    ctx.save(); clipSky(ctx, C);
    for (let k = 0; k < 5; k++) { ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = env * 0.1; ctx.lineWidth = C.S * 0.006; ctx.beginPath(); ctx.arc(cx, cy, R - k * C.S * 0.006, Math.PI, TAU); ctx.stroke(); }
    ctx.restore();
  },

  meteors(ctx, C, L, e, env) {
    const r = rng(L.seed);
    const rx = C.mx + C.fw * L.x, ry = C.H * (0.04 + 0.12 * L.depth);
    clipSky(ctx, C);
    for (let i = 0; i < L.count; i++) {
      const t0 = r() * Math.max(1, L.dur - 2), life = between(r, 0.5, 1.2) / L.speed, k = (e - t0) / life;
      const a = Math.PI / 2 + L.dir * between(r, 0.25, 1.2) + (r() - 0.5) * 0.5, d0 = C.S * between(r, 0.02, 0.2), len = C.S * between(r, 0.08, 0.22) * L.scale;
      if (k < 0 || k > 1) continue;
      const hx = rx + Math.cos(a) * (d0 + len * k), hy = ry + Math.sin(a) * (d0 + len * k);
      const tx = rx + Math.cos(a) * (d0 + len * Math.max(0, k - 0.35)), ty = ry + Math.sin(a) * (d0 + len * Math.max(0, k - 0.35));
      const g = ctx.createLinearGradient(tx, ty, hx, hy);
      const col = r() < 0.3 ? C.tint(L, 1, 15) : C.dark ? '#ffffff' : C.p.fg;
      g.addColorStop(0, withAlpha(C.dark ? '#ffffff' : C.p.fg, 0)); g.addColorStop(1, col);
      ctx.globalAlpha = env * Math.sin(Math.PI * k);
      ctx.strokeStyle = g; ctx.lineWidth = C.sw * between(r, 1, 2.4);
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
    }
  },

  comet(ctx, C, L, e, env) {
    const q = e / L.dur, hx = C.mx + C.fw * (L.dir > 0 ? 0.1 + 0.8 * q : 0.9 - 0.8 * q), hy = C.H * (0.12 + 0.12 * L.depth) + Math.sin(q * Math.PI) * C.H * 0.04;
    const away = -Math.PI / 2 - L.dir * 0.9;
    clipSky(ctx, C);
    for (let k = 0; k < 6; k++) {
      const len = C.S * (0.12 + 0.05 * k) * L.scale, curve = (k - 2.5) * 0.08;
      ctx.globalAlpha = env * (0.5 - k * 0.06);
      ctx.strokeStyle = k < 2 ? C.tint(L, 1, 15) : C.dark ? '#ffffff' : C.p.fg;
      ctx.lineWidth = C.sw * (2.2 - k * 0.3);
      ctx.beginPath(); ctx.moveTo(hx, hy);
      ctx.quadraticCurveTo(hx + Math.cos(away + curve) * len * 0.5, hy + Math.sin(away + curve) * len * 0.5, hx + Math.cos(away + curve * 2) * len, hy + Math.sin(away + curve * 2) * len);
      ctx.stroke();
    }
    ctx.globalAlpha = env; ctx.fillStyle = C.dark ? '#ffffff' : C.p.fg; ctx.shadowColor = C.tint(L, 1, 20); ctx.shadowBlur = C.S * 0.02;
    ctx.beginPath(); ctx.arc(hx, hy, C.S * 0.004, 0, TAU); ctx.fill();
  },

  fireworks(ctx, C, L, e, env) {
    const r = rng(L.seed);
    const bursts = moments(L);
    const kinds = ['peony', 'willow', 'ring', 'crossette', 'palm'];
    clipFrame(ctx, C);
    bursts.forEach((t0, i) => {
      const bx = C.mx + C.fw * clamp(L.x + (r() - 0.5) * 0.7, 0.08, 0.92), by = C.H * (0.14 + 0.18 * r());
      const kind = kinds[Math.floor(r() * kinds.length)], n = 36 + Math.floor(r() * 50), v = C.S * between(r, 0.1, 0.18) * L.scale;
      const hue = (L.hue + between(r, -60, 60) + 360) % 360, col = `hsl(${hue.toFixed(0)}, ${C.dark ? 85 : 70}%, ${C.dark ? 68 : 45}%)`;
      const rise = 0.7, tt = e - t0;
      if (tt < 0 || tt > rise + 2.6) return;
      ctx.strokeStyle = col; ctx.fillStyle = col;
      if (tt < rise) { // the rocket going up
        const k = tt / rise, y = C.horizon + (by - C.horizon) * (1 - (1 - k) * (1 - k));
        ctx.globalAlpha = env; ctx.lineWidth = C.sw * 1.2; ctx.beginPath(); ctx.moveTo(bx, y); ctx.lineTo(bx, y + C.S * 0.03); ctx.stroke();
        return;
      }
      const k = (tt - rise) / 2.6;
      const drawSpark = (x0, y0, x1, y1, mirror) => {
        if (mirror) { y0 = C.horizon + (C.horizon - y0) * 0.35; y1 = C.horizon + (C.horizon - y1) * 0.35; if (y0 < C.horizon) return; }
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      };
      for (const mirror of [false, true]) {
        ctx.globalAlpha = env * (1 - k) * (mirror ? 0.25 : 1);
        ctx.lineWidth = C.sw * (mirror ? 0.8 : 1.3);
        for (let j = 0; j < n; j++) {
          let a = (j / n) * TAU + (kind === 'ring' ? 0 : (r() - 0.5) * 0.15), sp = v * (kind === 'ring' ? 1 : 0.6 + 0.4 * Math.sin(j * 12.9898) ** 2);
          const T = k * 2.6, drag = 1 - Math.exp(-T * 1.6), g = C.S * (kind === 'willow' ? 0.09 : kind === 'palm' ? 0.03 : 0.05) * T * T;
          const px = bx + Math.cos(a) * sp * drag / 1.6 * 1.6, py = by + Math.sin(a) * sp * drag + g;
          const tail = kind === 'willow' ? 0.3 : 0.12;
          const ox = bx + Math.cos(a) * sp * Math.max(0, drag - tail), oy = by + Math.sin(a) * sp * Math.max(0, drag - tail) + g * 0.8;
          drawSpark(ox, oy, px, py, mirror);
          if (kind === 'crossette' && k > 0.35 && !mirror) for (const da of [-0.5, 0.5]) drawSpark(px, py, px + Math.cos(a + da) * v * 0.15 * (k - 0.35), py + Math.sin(a + da) * v * 0.15 * (k - 0.35), false);
        }
      }
    });
  },

  lanterns(ctx, C, L, e, env) {
    const r = rng(L.seed);
    clipFrame(ctx, C);
    for (let i = 0; i < L.count; i++) {
      const t0 = r() * (L.dur * 0.5), life = L.dur - t0, q = (e - t0) / life;
      if (q < 0 || q > 1) continue;
      const z = C.S * (0.008 + 0.012 * r()) * L.scale;
      const x = C.mx + C.fw * clamp(L.x + (r() - 0.5) * 0.6, 0.03, 0.97) + L.dir * C.S * 0.12 * q + Math.sin(e * 0.8 + i) * z;
      const y = C.bottom - (C.bottom - C.H * 0.06) * q * between(r, 0.8, 1.1);
      const flick = 0.85 + 0.15 * Math.sin(e * 13 + i * 3);
      ctx.globalAlpha = env * (1 - q * 0.6) * flick;
      const g = ctx.createRadialGradient(x, y, 0, x, y, z * 4);
      g.addColorStop(0, 'rgba(255, 196, 120, 0.55)'); g.addColorStop(1, 'rgba(255, 196, 120, 0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, z * 4, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255, 214, 150, 0.95)';
      poly(ctx, [x - z * 0.55, y - z, x + z * 0.55, y - z, x + z * 0.4, y + z * 0.6, x - z * 0.4, y + z * 0.6]); ctx.fill();
    }
  },

  lighthouse(ctx, C, L, e, env) {
    const lx = L.dir > 0 ? C.mx + C.S * 0.01 : C.W - C.mx - C.S * 0.01, ly = C.horizon - C.S * 0.012;
    const a = (L.dir > 0 ? 0 : Math.PI) + L.dir * (Math.sin(e * 0.9 * L.speed) * 0.5 + 0.1), spread = 0.09, reach = C.fw * 0.9;
    ctx.save(); clipFrame(ctx, C);
    const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, reach);
    g.addColorStop(0, `rgba(255, 236, 190, ${0.4 * env})`); g.addColorStop(1, 'rgba(255, 236, 190, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + Math.cos(a - spread) * reach, ly + Math.sin(a - spread) * reach); ctx.lineTo(lx + Math.cos(a + spread) * reach, ly + Math.sin(a + spread) * reach); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = env; ctx.fillStyle = C.ink(1); ctx.fillRect(lx - C.S * 0.003, ly, C.S * 0.006, C.S * 0.014);
    const flash = Math.pow(Math.max(0, Math.sin(e * 2.6)), 8);
    ctx.fillStyle = `rgba(255, 236, 190, ${env * (0.4 + 0.6 * flash)})`; ctx.beginPath(); ctx.arc(lx, ly, C.S * (0.004 + 0.006 * flash), 0, TAU); ctx.fill();
    ctx.restore();
  },

  aurora(ctx, C, L, e, env) {
    ctx.save(); clipSky(ctx, C);
    const step = Math.max(3, C.S / 220), top = C.H * 0.06;
    for (let x = C.mx; x < C.W - C.mx; x += step) {
      const u = (x - C.mx) / C.fw;
      const h = (C.horizon - top) * (0.35 + 0.25 * Math.sin(u * 7 + e * 0.6) + 0.15 * Math.sin(u * 17 - e * 1.1));
      const y0 = top + (C.horizon - top) * (0.1 + 0.15 * Math.sin(u * 3 + e * 0.3));
      const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
      g.addColorStop(0, 'rgba(160, 110, 220, 0)'); g.addColorStop(0.5, `rgba(120, 220, 170, ${0.28 * env})`); g.addColorStop(1, 'rgba(120, 220, 170, 0)');
      ctx.strokeStyle = g; ctx.lineWidth = step * 0.7;
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x + Math.sin(e + u * 9) * step * 2, y0 + h); ctx.stroke();
    }
    ctx.restore();
  },

  jellyfish(ctx, C, L, e, env) {
    const r = rng(L.seed);
    ctx.save(); clipSea(ctx, C);
    for (let i = 0; i < L.count; i++) {
      const s = 0.15 + 0.75 * r(), z = C.S * (0.01 + 0.025 * s) * L.scale;
      const x = C.mx + C.fw * clamp(L.x + (r() - 0.5) * 0.8, 0.03, 0.97) + Math.sin(e * 0.3 + i) * z * 2;
      const y = C.seaY(s) - e * z * 0.15, pulse = 1 + 0.15 * Math.sin(e * 2.5 + i);
      ctx.globalAlpha = env * 0.85;
      const g = ctx.createRadialGradient(x, y, 0, x, y, z * 2);
      g.addColorStop(0, C.tint(L, 0.5, 15)); g.addColorStop(1, C.tint(L, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, z * 2, 0, TAU); ctx.fill();
      ctx.strokeStyle = C.tint(L, 1, 15); ctx.lineWidth = C.sw;
      ctx.beginPath(); ctx.ellipse(x, y, z * pulse, z * 0.7 / pulse, 0, Math.PI, TAU); ctx.stroke();
      for (let k = 0; k < 4; k++) {
        const tx = x + (k - 1.5) * z * 0.4;
        ctx.beginPath(); ctx.moveTo(tx, y);
        for (let j = 1; j <= 6; j++) ctx.lineTo(tx + Math.sin(e * 2 + j + k) * z * 0.2, y + j * z * 0.35);
        ctx.stroke();
      }
    }
    ctx.restore();
  },

  bioglow(ctx, C, L, e, env) {
    const ox = C.mx + C.fw * L.x, front = C.fw * clamp(e / (L.dur * 0.6), 0, 1.2);
    const tick = Math.floor(e * 5);
    ctx.save(); clipSea(ctx, C);
    for (const salt of [tick, tick - 1]) {
      const rr = rng((L.seed ^ salt) >>> 0);
      for (let k = 0; k < 160; k++) {
        const s = rr(), x = C.mx + C.fw * rr();
        if (Math.abs(x - ox) > front) continue;
        const y = C.seaY(s), z = C.S * (0.001 + 0.004 * s);
        ctx.globalAlpha = env * (salt === tick ? 0.9 : 0.4);
        ctx.fillStyle = 'rgba(120, 235, 225, 1)';
        ctx.shadowColor = 'rgba(120, 235, 225, 1)'; ctx.shadowBlur = z * 4;
        ctx.beginPath(); ctx.arc(x, y, z, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  },

  constellation(ctx, C, L, e, env) {
    // New stars join up, one line at a time, into a figure nobody has seen before.
    const r = rng(L.seed);
    const pts = Array.from({ length: L.count }, () => [C.mx + C.fw * clamp(L.x + (r() - 0.5) * 0.45, 0.05, 0.95), C.H * 0.1 + (C.horizon - C.H * 0.18) * r()]);
    const order = [pts.shift()];
    while (pts.length) { const last = order[order.length - 1]; pts.sort((a, b) => Math.hypot(a[0] - last[0], a[1] - last[1]) - Math.hypot(b[0] - last[0], b[1] - last[1])); order.push(pts.shift()); }
    if (r() < 0.5) order.push(order[1]);
    ctx.strokeStyle = C.p.here; ctx.fillStyle = C.p.here; ctx.lineWidth = C.sw;
    for (let i = 0; i < order.length; i++) {
      const [x, y] = order[i], appear = clamp((e - i * 0.7) / 0.6, 0, 1);
      ctx.globalAlpha = env * appear;
      ctx.beginPath(); ctx.arc(x, y, C.S * 0.0035, 0, TAU); ctx.fill();
      if (i > 0 && appear > 0) { const [px, py] = order[i - 1]; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + (x - px) * appear, py + (y - py) * appear); ctx.stroke(); }
    }
  },

  bottle(ctx, C, L, e, env) {
    const s = 0.55 + 0.35 * L.depth, z = C.S * 0.04 * L.scale, q = e / L.dur;
    const x = (L.dir > 0 ? C.mx : C.W - C.mx) + L.dir * C.fw * q * 0.9, y = C.seaY(s) + Math.sin(e * 1.6) * z * 0.15;
    clipFrame(ctx, C);
    ctx.globalAlpha = env;
    local(ctx, x, y, z, z, 0.35 * Math.sin(e * 1.1) - 0.2, () => {
      ctx.fillStyle = 'rgba(120, 170, 150, 0.55)'; ctx.strokeStyle = C.ink(0.9); ctx.lineWidth = C.sw / z;
      ctx.beginPath(); ctx.roundRect(-0.9, -0.28, 1.2, 0.56, 0.22); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.roundRect(0.3, -0.13, 0.4, 0.26, 0.08); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(160, 110, 70, 1)'; ctx.fillRect(0.68, -0.11, 0.14, 0.22);
      ctx.fillStyle = C.paper(1); ctx.beginPath(); ctx.roundRect(-0.65, -0.12, 0.7, 0.24, 0.1); ctx.fill();
    });
    ripple(ctx, C, x, C.seaY(s), (e * 0.6) % 1, z, C.ink(1));
  },

  goldwave(ctx, C, L, e, env) {
    const seaLines = C.comp.lines.filter((l) => l.row != null && !l.accent);
    ctx.save(); clipSea(ctx, C);
    ctx.lineWidth = C.sw * 1.8; ctx.strokeStyle = C.p.here;
    for (let w = 0; w < L.count; w++) {
      const f = ((e - w * 1.8) / (L.dur * 0.7)) * 1.3 - 0.15, front = L.dir > 0 ? f : 1 - f;
      for (const l of seaLines) {
        const k = 1 - Math.abs(l.row - front) / 0.06;
        if (k <= 0) continue;
        ctx.globalAlpha = env * k * 0.9;
        poly(ctx, l.pts, false); ctx.stroke();
      }
    }
    ctx.restore();
  },
};

export const ELEMENT_NAMES = Object.keys(ELEMENTS);
