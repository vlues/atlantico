// Canvas painter for compositions, plus the arrival moment: a shooting star crosses the sky,
// lands where the guest's own star lives, and the star ignites. Shared by the wall and the
// guest's phone so both play the same scene.
import { PALETTE, STYLE_NAMES, compass } from '../lib/art.js';
import { COPY } from '../lib/tour.js';

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
    if (t.arc) {
      ctx.globalAlpha = alpha * t.alpha;
      arcText(ctx, t);
      continue;
    }
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

/**
 * Text set on a circle around a point. Over the top of the circle it reads clockwise with the
 * letters standing outward; underneath it reads the other way, so it is never upside down.
 */
export function arcText(ctx, t) {
  const { x, y, r, a } = t.arc;
  const chars = [...t.text];
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((n, w) => n + w, 0);
  const over = Math.sin(a) <= 0.25;
  const rr = over ? r : r + t.size;
  const span = total / rr;
  ctx.textAlign = 'left';
  let acc = 0;
  chars.forEach((ch, i) => {
    const mid = acc + widths[i] / 2;
    acc += widths[i];
    const phi = over ? a - span / 2 + mid / rr : a + span / 2 - mid / rr;
    ctx.save();
    ctx.translate(x + rr * Math.cos(phi), y + rr * Math.sin(phi));
    ctx.rotate(over ? phi + Math.PI / 2 : phi - Math.PI / 2);
    ctx.fillText(ch, -widths[i] / 2, 0);
    ctx.restore();
  });
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
export function arrival(ctx, comp, e, seed = 0, target = comp.hero) {
  const h = target;
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

// ── The guest tour on the wall ───────────────────────────────────────────────
// While a guest scrolls the story on their phone, the wall shows the same stop: its title in the
// sky and a few hairline callouts pointing at what the phone is describing.

function callout(ctx, comp, at, to, text, sub, e, p) {
  const S = Math.min(comp.width, comp.height), sw = Math.max(0.7, S / 1100);
  const grow = ease(e / 0.9), fade = ease((e - 0.6) / 0.8);
  ctx.strokeStyle = ctx.fillStyle = p.here;
  ctx.lineWidth = sw;
  ctx.globalAlpha = 0.9;
  ctx.beginPath(); ctx.arc(at.x, at.y, S * 0.006, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(at.x, at.y);
  ctx.lineTo(at.x + (to.x - at.x) * grow, at.y + (to.y - at.y) * grow);
  ctx.stroke();
  if (fade <= 0) return;
  const size = S * 0.022, left = to.x >= at.x;
  ctx.globalAlpha = fade;
  ctx.textAlign = left ? 'left' : 'right';
  ctx.font = `italic 300 ${size * 1.5}px 'Cormorant Garamond', Georgia, serif`;
  ctx.fillText(text, to.x + (left ? 1 : -1) * S * 0.01, to.y + size * 0.4);
  if (sub) {
    ctx.globalAlpha = fade * 0.7;
    ctx.font = `300 ${size * 1.05}px 'Cormorant Garamond', Georgia, serif`;
    ctx.fillText(sub, to.x + (left ? 1 : -1) * S * 0.01, to.y + size * 1.9);
  }
}

/**
 * Draw one tour stop over the wall. `e` = seconds since the stop began; `c` = conditions;
 * `extra` = { style } for the editions stop.
 */
export function tourOverlay(ctx, comp, tour, e, c = {}, extra = {}) {
  const W = comp.width, H = comp.height, S = Math.min(W, H);
  const p = comp.palette ?? (comp.dark ? PALETTE.dark : PALETTE.light);
  const copy = COPY[tour.stop];
  if (!copy) return;
  ctx.save();
  ctx.letterSpacing = '0px';
  // The title, as on the phone, in a band the sea opens at its foot (the sky stays for the stars).
  const tA = ease(e / 1.2) * (tour.until && Date.now() > tour.until - 1500 ? ease((tour.until - Date.now()) / 1500) : 1);
  const ty = H * 0.84 - S * 0.075, ts = S * 0.042;
  ctx.font = `italic 300 ${ts * 1.5}px 'Cormorant Garamond', Georgia, serif`;
  const tw = Math.max(ctx.measureText(copy.es).width, S * 0.3) + S * 0.12;
  ctx.globalAlpha = 0.94 * tA;
  ctx.fillStyle = p.bg;
  ctx.fillRect(W / 2 - tw / 2, ty - ts * 1.6, tw, ts * 3.2);
  ctx.fillStyle = p.fg;
  ctx.textAlign = 'center';
  ctx.globalAlpha = 0.92 * tA;
  ctx.fillText(copy.es, W / 2, ty);
  ctx.globalAlpha = 0.6 * tA;
  ctx.font = `300 ${S * 0.017 * 1.5}px 'Cormorant Garamond', Georgia, serif`;
  ctx.fillText(copy.en, W / 2, ty + ts * 1.1);

  const seaY = (f) => comp.horizon + (H * 0.84 - comp.horizon) * f;
  ctx.globalAlpha = 1;
  if (tour.stop === 'sea') {
    callout(ctx, comp, { x: W * 0.3, y: seaY(0.5) }, { x: W * 0.42, y: seaY(0.28) },
      `olas ${(c.waveHeight ?? 0).toFixed(1)} m, cada ${Math.round(c.wavePeriod ?? 0)} s`, `waves ${(c.waveHeight ?? 0).toFixed(1)} m, every ${Math.round(c.wavePeriod ?? 0)} s, from the ${compass(c.waveDirection ?? 0)}`, e, p);
    callout(ctx, comp, { x: W * 0.72, y: comp.horizon }, { x: W * 0.62, y: comp.horizon - S * 0.07 },
      'el horizonte sigue la marea', `the horizon follows the tide: ${(c.tide ?? 0) >= 0 ? '+' : ''}${(c.tide ?? 0).toFixed(2)} m${c.tideTrend ? `, ${c.tideTrend}` : ''}`, Math.max(0, e - 0.8), p);
  } else if (tour.stop === 'star' && comp.hero) {
    // Their star calls out: rings keep opening from it.
    for (let i = 0; i < 3; i++) {
      const k = ((e + i * 0.55) % 1.65) / 1.65;
      ctx.globalAlpha = (1 - k) * 0.7;
      ctx.strokeStyle = p.here;
      ctx.lineWidth = Math.max(0.7, S / 1100) * 1.2;
      ctx.beginPath(); ctx.arc(comp.hero.x, comp.hero.y, S * (0.015 + 0.09 * k), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const right = comp.hero.x < W * 0.6;
    callout(ctx, comp, comp.hero, { x: comp.hero.x + (right ? 1 : -1) * S * 0.12, y: comp.hero.y + S * 0.08 },
      tour.name ? `${tour.name}` : 'tu estrella', tour.visits > 1 ? `${tour.visits} visitas · ${tour.visits} visits` : 'desde hoy · since today', e, p);
  } else if (tour.stop === 'edition' && extra.style) {
    ctx.fillStyle = p.here;
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.95;
    ctx.font = `300 ${S * 0.032 * 1.5}px 'Cormorant Garamond', Georgia, serif`;
    ctx.fillText(STYLE_NAMES[extra.style] ?? extra.style, W / 2, H * 0.84 - S * 0.17);
  } else if (tour.stop === 'sky') {
    const body = comp.moon ?? comp.sun;
    if (body) {
      ctx.strokeStyle = p.here;
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(e * 3);
      ctx.lineWidth = Math.max(0.7, S / 1100) * 1.2;
      ctx.beginPath(); ctx.arc(body.x, body.y, body.r * 2.2, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      const right = body.x < W * 0.6;
      const m = c.moon;
      callout(ctx, comp, { x: body.x + (right ? 1 : -1) * body.r * 2.2, y: body.y }, { x: body.x + (right ? 1 : -1) * S * 0.14, y: body.y + S * 0.05 },
        comp.moon ? m?.name ?? 'la luna' : 'el sol', comp.moon && m ? `${m.nameEn ?? 'moon'}, ${Math.round(m.fraction * 100)} % lit` : `the sun, ${Math.round(c.sun?.altitude ?? 0)}° high`, e, p);
    }
    if (c.seaTemp != null) {
      callout(ctx, comp, { x: W * 0.36, y: seaY(0.45) }, { x: W * 0.44, y: seaY(0.25) }, `el agua, ${Math.round(c.seaTemp)} °C`, 'the sea temperature', Math.max(0, e - 0.9), p);
    }
  }
  ctx.restore();
}

/** A guest tapping out: their goodbye in the band at the foot of the sea, for a few seconds. */
export function farewellOverlay(ctx, comp, fw, e) {
  band(ctx, comp, `Hasta pronto, ${fw.name}`, 'See you soon', ease(e / 1.2) * ease((fw.until - Date.now()) / 1500));
}

/**
 * A guest's song comes on: whose it is, in the band (and who is next, if it's someone's too),
 * while their star calls out with opening rings. Afterwards a small line keeps saying whose it is.
 */
export function musicOverlay(ctx, comp, m, e) {
  const W = comp.width, S = Math.min(W, comp.height);
  const p = comp.palette ?? (comp.dark ? PALETTE.dark : PALETTE.light);
  const a = ease(e / 1.2) * ease((25 - e) / 1.5);
  if (a > 0) {
    band(ctx, comp, `♪ La canción de ${m.by.name}`, `${m.by.name}'s song · ${m.title} — ${m.artist}${m.next ? ` · next: ${m.next.by}'s` : ''}`, a);
    if (comp.hero) {
      ctx.save();
      for (let i = 0; i < 3; i++) {
        const k = ((e + i * 0.55) % 1.65) / 1.65;
        ctx.globalAlpha = (1 - k) * 0.7 * a;
        ctx.strokeStyle = p.here;
        ctx.lineWidth = Math.max(0.7, S / 1100) * 1.2;
        ctx.beginPath(); ctx.arc(comp.hero.x, comp.hero.y, S * (0.015 + 0.09 * k), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
  }
  // For the rest of the song: a quiet line under the edition.
  ctx.save();
  ctx.globalAlpha = 0.75 * ease((e - 20) / 2);
  ctx.fillStyle = p.here;
  ctx.textAlign = 'right';
  ctx.font = `italic 300 ${Math.max(9, S * 0.017) * 1.5}px 'Cormorant Garamond', Georgia, serif`;
  ctx.fillText(`♪ ${m.title} · de ${m.by.name}`, W - (comp.margin ?? W * 0.085), comp.height * 0.075 + S * 0.035);
  ctx.restore();
}

function band(ctx, comp, title, sub, a) {
  if (a <= 0) return;
  const W = comp.width, H = comp.height, S = Math.min(W, H);
  const p = comp.palette ?? (comp.dark ? PALETTE.dark : PALETTE.light);
  const ty = H * 0.84 - S * 0.075, ts = S * 0.042, text = title;
  ctx.save();
  ctx.letterSpacing = '0px';
  ctx.font = `300 ${S * 0.017 * 1.5}px 'Cormorant Garamond', Georgia, serif`;
  const subW = ctx.measureText(sub).width;
  ctx.font = `italic 300 ${ts * 1.5}px 'Cormorant Garamond', Georgia, serif`;
  const tw = Math.max(ctx.measureText(text).width, subW) + S * 0.12;
  ctx.globalAlpha = 0.94 * a;
  ctx.fillStyle = p.bg;
  ctx.fillRect(W / 2 - tw / 2, ty - ts * 1.6, tw, ts * 3.2);
  ctx.fillStyle = p.here;
  ctx.textAlign = 'center';
  ctx.fillText(text, W / 2, ty);
  ctx.globalAlpha = 0.6 * a;
  ctx.fillStyle = p.fg;
  ctx.font = `300 ${S * 0.017 * 1.5}px 'Cormorant Garamond', Georgia, serif`;
  ctx.fillText(sub, W / 2, ty + ts * 1.1);
  ctx.restore();
}
