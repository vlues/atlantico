// Surprises: never the same twice, never on a schedule. The Worker picks the moment and a truly random
// seed (crypto.getRandomValues); every screen grows the same surprise from that seed, so the whole
// house sees it at once. A recipe is one to three elements, each with its own random choreography
// (how many, which way, how deep, how fast, how big, which colour, when), plus how the sea and the
// sky answer, a melody, a light pattern and a name. Pure: no DOM, no I/O.

/** Small fast PRNG (mulberry32): the same seed grows the same surprise on every screen. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];
const between = (r, a, b) => a + (b - a) * r();
const int = (r, a, b) => Math.floor(between(r, a, b + 1));

/**
 * Elements. when: day | night | any. w: how often it comes up. small: can be a little surprise on its own.
 * needs(cx): extra conditions. count: [min, max]. dur: seconds.
 */
export const ELEMENTS = {
  dolphins:   { when: 'any', w: 3, small: true, count: [1, 9], dur: [12, 20], es: 'delfines', en: 'dolphins', one: ['un delfín', 'a dolphin'] },
  whale:      { when: 'any', w: 1.6, count: [1, 2], dur: [13, 19], es: 'una ballena', en: 'a whale', many: ['dos ballenas', 'two whales'] },
  tallship:   { when: 'day', w: 1.1, count: [1, 1], dur: [24, 34], es: 'un velero de cuatro palos', en: 'a four-masted ship' },
  regatta:    { when: 'day', w: 1.4, count: [3, 9], dur: [16, 26], es: 'una regata', en: 'a regatta' },
  flock:      { when: 'day', w: 1.8, count: [60, 240], dur: [14, 22], es: 'estorninos', en: 'starlings' },
  dive:       { when: 'day', w: 2, small: true, count: [1, 3], dur: [7, 11], es: 'una gaviota se lanza', en: 'a gull dives' },
  flyingfish: { when: 'day', w: 1.4, small: true, count: [3, 14], dur: [7, 12], es: 'peces voladores', en: 'flying fish' },
  kites:      { when: 'day', w: 1, count: [1, 4], dur: [16, 26], needs: (cx) => cx.wind > 8, es: 'cometas', en: 'kites', one: ['una cometa', 'a kite'] },
  balloon:    { when: 'day', w: 0.8, count: [1, 3], dur: [22, 32], needs: (cx) => cx.wind < 30 && !cx.rain, es: 'globos', en: 'balloons', one: ['un globo', 'a balloon'] },
  sunpillar:  { when: 'day', w: 0.8, count: [1, 1], dur: [14, 22], needs: (cx) => cx.sunAlt < 14, es: 'un pilar de sol', en: 'a sun pillar' },
  rainbow:    { when: 'day', w: 1.2, count: [1, 2], dur: [18, 28], needs: (cx) => cx.rain || cx.cloud > 30, es: 'un arcoíris', en: 'a rainbow', many: ['un arcoíris doble', 'a double rainbow'] },
  meteors:    { when: 'night', w: 3, small: true, count: [1, 44], dur: [10, 18], es: 'una lluvia de estrellas', en: 'a meteor shower', one: ['una estrella fugaz', 'a shooting star'] },
  comet:      { when: 'night', w: 1, count: [1, 1], dur: [18, 28], es: 'un cometa', en: 'a comet' },
  fireworks:  { when: 'night', w: 2, count: [3, 14], dur: [14, 24], es: 'fuegos sobre la bahía', en: 'fireworks over the bay' },
  lanterns:   { when: 'night', w: 1.4, count: [5, 34], dur: [18, 30], needs: (cx) => cx.wind < 35 && !cx.rain, es: 'farolillos', en: 'sky lanterns' },
  lighthouse: { when: 'night', w: 1.1, count: [1, 1], dur: [12, 20], es: 'el faro', en: 'the lighthouse' },
  aurora:     { when: 'night', w: 0.5, count: [1, 1], dur: [16, 26], es: 'una aurora (imposible aquí)', en: 'an aurora (impossible here)' },
  jellyfish:  { when: 'night', w: 1, count: [3, 14], dur: [14, 22], es: 'medusas de luz', en: 'glowing jellyfish' },
  bioglow:    { when: 'night', w: 1.4, small: true, count: [1, 1], dur: [12, 20], es: 'el mar brilla', en: 'the sea glows' },
  moonbow:    { when: 'night', w: 0.6, count: [1, 1], dur: [16, 24], needs: (cx) => cx.moon > 0.6, es: 'un arco de luna', en: 'a moonbow' },
  constellation: { when: 'night', w: 1.3, count: [5, 11], dur: [16, 24], es: 'una constelación nueva', en: 'a new constellation' },
  bottle:     { when: 'any', w: 0.8, small: true, count: [1, 1], dur: [16, 26], es: 'un mensaje en una botella', en: 'a message in a bottle' },
  goldwave:   { when: 'any', w: 1.4, small: true, count: [1, 3], dur: [7, 12], es: 'una ola dorada', en: 'a golden wave', many: ['olas doradas', 'golden waves'] },
};

// Colours for screens (e-ink doesn't play surprises): a few hues that sit well on paper and night.
const HUES = [[40, 70], [8, 60], [175, 45], [265, 45], [20, 75], [220, 55], [330, 45], [140, 35], [55, 80]];
const SEA = ['none', 'none', 'shimmer', 'rings', 'gold', 'shiver'];
const SKY = ['none', 'none', 'twinkle', 'flash', 'glow'];
const MODES = { major: [0, 2, 4, 7, 9], minor: [0, 3, 5, 7, 10], dorian: [0, 2, 3, 7, 9], lydian: [0, 2, 4, 6, 9], phrygian: [0, 1, 5, 7, 8], whole: [0, 2, 4, 6, 8] };
const TIMBRES = ['bell', 'pluck', 'glass', 'pad'];
const LIGHTS = ['pulse', 'breathe', 'dusk', 'flash', 'glow', 'none'];

const MOODS_ES = { sunset: 'al atardecer', rain: 'bajo la lluvia', levante: 'con levante', poniente: 'con poniente', calm: 'en calma', night: 'de madrugada' };
const MOODS_EN = { sunset: 'at sunset', rain: 'in the rain', levante: 'in the levante', poniente: 'in the poniente', calm: 'on a calm sea', night: 'in the small hours' };

/**
 * @param {number} seed a truly random 32-bit number from the Worker
 * @param {object} cx the moment: { day, sunAlt, rain, cloud, wind, windName, moon, hour, here: [names] }
 * @param {'big'|'small'} size
 * @param {string} [force] an element to lead with (the Demo panel), whatever the hour or weather
 */
export function recipe(seed, cx, size = 'big', force = null) {
  const r = rng(seed);
  const ok = (e) => (e.when === 'any' || (e.when === 'day') === !!cx.day) && (!e.needs || e.needs(cx)) && (size === 'big' || e.small);
  const pool = Object.entries(ELEMENTS).filter(([, e]) => ok(e));
  const weighted = (list) => { const total = list.reduce((n, [, e]) => n + e.w, 0); let x = r() * total; for (const item of list) { x -= item[1].w; if (x <= 0) return item; } return list[list.length - 1]; };
  const nLayers = size === 'small' ? 1 : 1 + (r() < 0.4 ? 1 : 0) + (r() < 0.12 ? 1 : 0);
  const layers = [];
  let left = [...pool];
  for (let i = 0; i < nLayers && (left.length || (i === 0 && force)); i++) {
    const [kind, e] = i === 0 && ELEMENTS[force] ? [force, ELEMENTS[force]] : weighted(left);
    left = left.filter(([k]) => k !== kind);
    const [lo, hi] = e.count;
    const count = size === 'small' ? Math.max(lo, Math.min(hi, int(r, lo, Math.max(lo, Math.ceil(lo + (hi - lo) * 0.25))))) : int(r, lo, hi);
    const [hue, sat] = pick(r, HUES);
    layers.push({
      kind, count,
      seed: Math.floor(r() * 2 ** 32),
      dir: r() < 0.5 ? -1 : 1,
      depth: r(),                 // how far out (sea) or how high (sky), 0..1
      x: between(r, 0.12, 0.88),  // where across, 0..1
      delay: i === 0 ? between(r, 0, 1) : between(r, 1.5, 6),
      speed: between(r, 0.75, 1.35),
      scale: between(r, 0.75, 1.35) * (size === 'small' ? 0.85 : 1),
      hue: (hue + between(r, -12, 12) + 360) % 360, sat: sat + between(r, -10, 10),
      dur: between(r, e.dur[0], e.dur[1]) * (size === 'small' ? 0.8 : 1),
    });
  }
  const dur = Math.max(6, ...layers.map((l) => l.delay + l.dur)) + 1.5;
  const mood = cx.rain ? 'rain' : cx.day && cx.sunAlt < 8 ? 'sunset' : cx.windName === 'levante' ? 'levante' : cx.windName === 'poniente' ? 'poniente' : !cx.day && cx.hour < 6 ? 'night' : cx.wind < 6 ? 'calm' : null;
  return {
    size, layers, dur,
    sea: size === 'small' ? 'none' : pick(r, SEA),
    sky: size === 'small' ? 'none' : pick(r, SKY),
    sound: { mode: pick(r, Object.keys(MODES)), root: between(r, 196, 392), tempo: between(r, 0.18, 0.42), timbre: pick(r, TIMBRES), notes: int(r, 4, size === 'small' ? 5 : 11), steps: Array.from({ length: 12 }, () => int(r, 0, 9)) },
    lights: size === 'small' ? 'none' : pick(r, LIGHTS),
    title: title(layers, mood, r, cx),
  };
}

export const scaleOf = (mode) => MODES[mode] ?? MODES.major;

function title(layers, mood, r, cx) {
  const words = layers.map((l) => {
    const e = ELEMENTS[l.kind];
    if (l.kind === 'constellation' && cx.here?.length) {
      const who = cx.here[Math.floor(r() * cx.here.length)];
      const noun = pick(r, [['La Barca de', 'The Boat of'], ['La Gaviota de', 'The Gull of'], ['El Ancla de', 'The Anchor of'], ['La Ola de', 'The Wave of'], ['El Faro de', 'The Lighthouse of']]);
      return [`${noun[0]} ${who}`, `${noun[1]} ${who}`];
    }
    if (l.count === 1 && e.one) return e.one;
    if (l.count === 2 && e.many) return e.many;
    return [e.es, e.en];
  });
  const join = (i) => words.length === 1 ? words[0][i] : `${words.slice(0, -1).map((w) => w[i]).join(', ')} ${i ? 'and' : 'y'} ${words[words.length - 1][i]}`;
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const withMood = mood && r() < 0.6;
  return { es: cap(`${join(0)}${withMood ? ` ${MOODS_ES[mood]}` : ''}`), en: cap(`${join(1)}${withMood ? ` ${MOODS_EN[mood]}` : ''}`) };
}
