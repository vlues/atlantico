import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose as composeAny, hashString, windName, welcomeLine, welcomeText, edition, liveLine, STYLES } from '../web/lib/art.js';
import { moonPosition } from '../web/lib/moon.js';

// Geometry tests use the classic style; each daily style gets its own tests below.
const compose = (c, o = {}) => composeAny(c, { style: 'lineas', ...o });
import { rasterize, encodePNG, packRaw } from '../web/lib/raster.js';
import { sunPosition, sunTimes } from '../web/lib/sun.js';

const calm = { waveHeight: 0.3, wavePeriod: 6, waveDirection: 270, windSpeed: 4, windDirection: 200, tide: 0, sun: { altitude: 20, azimuth: 220 } };
const levante = { ...calm, waveHeight: 0.9, wavePeriod: 4, waveDirection: 95, windSpeed: 55, windDirection: 90 };

test('composition is deterministic', () => {
  const a = compose(calm, { width: 800, height: 480, visitors: [{ id: 'x' }], time: 10 });
  const b = compose(calm, { width: 800, height: 480, visitors: [{ id: 'x' }], time: 10 });
  assert.deepEqual(a, b);
});

test('visitor dots are placed by id, not by order', () => {
  const one = compose(calm, { visitors: [{ id: 'ana' }, { id: 'tom' }] }).circles.filter((c) => c.accent === 'visitor');
  const two = compose(calm, { visitors: [{ id: 'tom' }, { id: 'ana' }] }).circles.filter((c) => c.accent === 'visitor');
  assert.deepEqual(new Set(one.map((c) => `${c.x},${c.y}`)), new Set(two.map((c) => `${c.x},${c.y}`)));
});

test('levante bends the lines more than a calm day', () => {
  const spread = (c) => {
    const l = compose(c, { width: 800, height: 480, print: true }).lines.at(-5).pts;
    const ys = l.filter((_, i) => i % 2);
    return Math.max(...ys) - Math.min(...ys);
  };
  assert.ok(spread(levante) > spread(calm) * 2);
});

test('lines never cross (calm and storm)', () => {
  const night = { altitude: -20, azimuth: 0 }; // no glitter gaps, so points line up by index
  for (const c of [calm, levante, { ...calm, waveHeight: 3.5, wavePeriod: 14, windSpeed: 50, windDirection: 225 }]) {
    const lines = compose({ ...c, sun: night }, { width: 800, height: 480, print: true }).lines.filter((l) => !l.dotted && l.pts.length > 300);
    for (let i = 1; i < lines.length; i++) {
      let crossings = 0;
      for (let k = 1; k < Math.min(lines[i].pts.length, lines[i - 1].pts.length); k += 2) if (lines[i].pts[k] < lines[i - 1].pts[k] - 1.5) crossings++;
      assert.ok(crossings < lines[i].pts.length * 0.02, `line ${i} crosses ${crossings} times`);
    }
  }
});

test('panel bytes have the exact size the firmware expects', async () => {
  const comp = compose(calm, { width: 800, height: 480, print: true, welcome: { name: 'José' } });
  assert.equal(packRaw(rasterize(comp, 2)).length, 800 * 480 / 8);
  assert.equal(packRaw(rasterize(comp, 6)).length, 800 * 480 / 2);
  const png = await encodePNG(rasterize(comp, 2));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('six-colour output only uses the six inks', () => {
  const r = rasterize(compose(calm, { width: 400, height: 240, print: true, visitors: [{ id: 'a' }] }), 6);
  assert.ok([...new Set(r.px)].every((v) => v >= 0 && v <= 5));
});

test('sun: noon is south and high, midnight is below the horizon (Cádiz, June)', () => {
  const noon = sunPosition(new Date('2026-06-21T12:25:00Z'), 36.6, -6.28);
  assert.ok(noon.altitude > 70 && Math.abs(noon.azimuth - 180) < 15, JSON.stringify(noon));
  assert.ok(sunPosition(new Date('2026-06-21T23:30:00Z'), 36.6, -6.28).altitude < -10);
  const t = sunTimes(new Date('2026-06-21T12:00:00Z'), 36.6, -6.28);
  assert.ok(t.sunrise.getUTCHours() === 5 && t.sunset.getUTCHours() === 19, `${t.sunrise.toISOString()} ${t.sunset.toISOString()}`);
});

test('local wind names', () => {
  assert.equal(windName(40, 90), 'levante');
  assert.equal(windName(25, 280), 'poniente');
  assert.equal(windName(3, 90), 'calma');
  assert.ok(hashString('a') !== hashString('b'));
});

const night = { ...calm, sun: { altitude: -20, azimuth: 300 } };

test('guests who are here sparkle and carry their name; the rest stay quiet dots', () => {
  const comp = compose(night, { width: 800, height: 480, visitors: [{ id: 'ana', visits: 2, here: true, name: 'Ana' }, { id: 'tom', visits: 1 }] });
  assert.ok(comp.lines.filter((l) => l.accent === 'here').length >= 8, 'four-point sparkle');
  assert.deepEqual(comp.texts.filter((t) => t.role === 'label').map((t) => t.text), ['Ana']);
  assert.equal(comp.circles.filter((c) => c.accent === 'visitor').length, 1);
  assert.ok(!comp.lines.some((l) => l.dotted && l.accent), 'no constellation lines into a guest who is here');
});

test('the welcomed star appears with its entrance and reflects on the water', () => {
  const visitors = [{ id: 'lu', visits: 3, here: true, name: 'Lucía' }];
  const welcome = { id: 'lu', name: 'Lucía', greeting: 'Hola de nuevo', visits: 3, since: 12 * 86400000 };
  const before = compose(night, { width: 800, height: 480, visitors, welcome, hero: 'lu', reveal: 0 });
  assert.ok(before.hero, 'screens know where it will land');
  assert.ok(!before.lines.some((l) => l.accent === 'here'), 'not drawn before it arrives');
  const after = compose(night, { width: 800, height: 480, visitors, welcome, hero: 'lu', reveal: 1, print: true });
  const glints = after.lines.filter((l) => l.accent === 'here' && l.pts[1] > after.horizon);
  assert.ok(glints.length > 10 && glints.every((l) => Math.abs(l.pts[0] - after.hero.x) < 40), 'a column of glints below the star');
  assert.deepEqual(after.texts.filter((t) => ['greeting', 'name', 'line'].includes(t.role)).map((t) => t.text),
    ['Hola de nuevo', 'Welcome back', 'Lucía', 'tercera visita · la anterior, hace 12 días', 'third visit · the last one 12 days ago']);
});

test('the welcome words step aside rather than cover the guest\'s own star', () => {
  let id = null;
  for (let i = 0; i < 4000 && !id; i++) {
    const c = compose(night, { width: 800, height: 480, visitors: [{ id: `g${i}`, here: true }], hero: `g${i}` });
    if (c.hero && Math.abs(c.hero.x - 400) < 40 && c.hero.y > 90 && c.hero.y < 140) id = `g${i}`;
  }
  assert.ok(id, 'found a star under the middle of the sky');
  const comp = compose(night, { width: 800, height: 480, visitors: [{ id, here: true }], hero: id, welcome: { id, name: 'Maximiliano', visits: 1 } });
  const name = comp.texts.find((t) => t.role === 'name');
  assert.ok(Math.abs(name.x - comp.hero.x) > 120, `name at ${name.x}, star at ${comp.hero.x}`);
});

test('the personal line, in both languages', () => {
  const levante = { windSpeed: 40, windDirection: 90 };
  assert.equal(welcomeLine({ visits: 1 }, levante), 'tu estrella, desde hoy · llegas con levante');
  assert.equal(welcomeLine({ visits: 1 }, levante, 'en'), 'your star, from today · arriving with the levante');
  assert.equal(welcomeLine({ visits: 2, since: 30 * 3600000 }, levante), 'segunda visita · la anterior, ayer');
  assert.equal(welcomeLine({ visits: 14, since: 400 * 86400000 }, {}, 'en'), 'visit 14 · the last one 13 months ago');
});

test('on a six-colour panel only guests who are here get the accent ink', () => {
  const v = [{ id: 'a', here: true, name: 'A' }, { id: 'b' }];
  assert.ok(new Set(rasterize(compose(night, { width: 400, height: 240, print: true, dark: true, visitors: v }), 6).px).has(2), 'yellow on a dark wall');
  assert.ok(new Set(rasterize(compose(night, { width: 400, height: 240, print: true, visitors: v }), 6).px).has(4), 'blue on a light wall');
  const quiet = new Set(rasterize(compose(night, { width: 400, height: 240, print: true, visitors: [{ id: 'b' }] }), 6).px);
  assert.ok(!quiet.has(2) && !quiet.has(4));
});

test('a new edition every day: style and palette never repeat on consecutive days', () => {
  let prev = null;
  const seen = new Set();
  for (let d = 0; d < 90; d++) {
    const e = edition(Date.UTC(2026, 9, 8, 12) + d * 86400000);
    assert.equal(e.n, d + 1);
    if (prev) {
      assert.notEqual(e.style, prev.style, `day ${e.n}`);
      assert.notEqual(e.palette.name, prev.palette.name, `day ${e.n}`);
    }
    seen.add(e.style);
    prev = e;
  }
  assert.equal(seen.size, STYLES.length);
  assert.match(edition(Date.UTC(2026, 9, 9, 12)).label, /^Nº 2 · \S+ · viernes 9 de octubre$/);
  assert.equal(edition(Date.UTC(2026, 9, 9, 22, 30)).n, 3, 'the day turns at midnight in Cádiz, not UTC');
});

test('every daily style draws the same sea differently, on screen and on e-ink', () => {
  const px = STYLES.map((style) => {
    const comp = composeAny(calm, { width: 400, height: 240, print: true, style, date: Date.UTC(2026, 9, 9, 12) });
    assert.equal(comp.edition.style, style);
    const r = rasterize(comp, 2);
    const ink = r.px.reduce((n, v) => n + v, 0);
    assert.ok(ink > 2000, `${style} draws something (${ink} px)`);
    return r.px;
  });
  for (let a = 0; a < px.length; a++) for (let b = a + 1; b < px.length; b++) {
    let diff = 0;
    for (let i = 0; i < px[a].length; i++) diff += px[a][i] !== px[b][i];
    assert.ok(diff > 1500, `${STYLES[a]} vs ${STYLES[b]} differ by ${diff} px`);
  }
});

test('the moon: lit by its real phase, and its light on the water at night', () => {
  const full = moonPosition(new Date('2024-04-23T23:49:00Z'), 36.6, -6.28);
  assert.ok(full.fraction > 0.99 && full.altitude > 0);
  const night = { ...calm, sun: { altitude: -30, azimuth: 0 }, moon: full };
  const comp = compose(night, { width: 800, height: 480, dark: true });
  assert.equal(comp.shapes.length, 1);
  assert.ok(comp.lines.filter((l) => l.accent === 'moon').length > 8, 'moonlight glints');
  const fresh = moonPosition(new Date('2024-04-08T18:21:00Z'), 36.6, -6.28);
  assert.equal(compose({ ...night, moon: fresh }, { width: 800, height: 480, dark: true }).shapes.length, 0, 'no new moon');
});

test('clouds and rain come from the live weather', () => {
  const clear = compose(calm, { width: 800, height: 480 }).lines.length;
  const grey = compose({ ...calm, cloudCover: 90 }, { width: 800, height: 480 }).lines.length;
  const wet = compose({ ...calm, cloudCover: 90, precipitation: 3 }, { width: 800, height: 480 }).lines.length;
  assert.ok(grey > clear && wet > grey + 50, `${clear} ${grey} ${wet}`);
});

test('the live caption: sea temperature, tide and moon', () => {
  const line = liveLine({ seaTemp: 22.6, tideTrend: 'rising', nextTide: { type: 'high', at: '2026-10-09T12:37:00Z' }, moon: { fraction: 0.38, waxing: true } });
  assert.equal(line, 'sea 23 °C · tide rising, high at 14:37 · moon 38 % waxing');
});

test('several guests arriving together get one welcome: all their names, new and returning counted', () => {
  const group = [{ id: 'a', name: 'Ana', visits: 1 }, { id: 'b', name: 'Tom', visits: 1 }, { id: 'c', name: 'Lucía', visits: 3 }];
  const w = welcomeText({ group });
  assert.equal(w.greeting, 'Bienvenidos');
  assert.equal(w.title, 'Ana · Tom · Lucía');
  assert.equal(w.line, 'dos estrellas nuevas · una que vuelve');
  assert.equal(w.lineEn, 'two new stars · one returning');
  const crowd = welcomeText({ group: Array.from({ length: 9 }, (_, i) => ({ id: `g${i}`, name: `N${i}`, visits: 2 })) });
  assert.equal(crowd.title, 'N0 · N1 · N2 · N3 · +5');
  assert.equal(crowd.line, 'nueve que vuelven');
  // Each of them gets an entrance on the wall; their names sit in a clearing the sea opens for them,
  // leaving every arriving star in plain view.
  const visitors = group.map((g) => ({ ...g, here: true }));
  const comp = compose(night, { width: 800, height: 480, print: true, visitors, welcome: { group }, heroes: group.map((g) => ({ id: g.id, reveal: 1 })) });
  assert.equal(comp.heroes.length, 3);
  const name = comp.texts.find((t) => t.role === 'name');
  assert.ok(name.y > comp.horizon, 'names in the sea');
  const half = [...name.text].length * name.size * 0.31;
  const inside = comp.lines.filter((l) => !l.accent).some((l) => l.pts.some((v, q) => q % 2 === 0 && Math.abs(v - name.x) < half && Math.abs(l.pts[q + 1] - (name.y - name.size / 2)) < name.size / 2));
  assert.ok(!inside, 'the sea parts around them');
});

test('names float around their stars, each in its own way, and still on e-ink', () => {
  const visitors = [{ id: 'ana', here: true, name: 'Ana' }, { id: 'tom', here: true, name: 'Tom' }];
  const at = (time, print = false) => compose(night, { width: 800, height: 480, visitors, time, print }).texts.filter((t) => t.role === 'label');
  const [a1, a2] = [at(0), at(20)];
  assert.ok(a1.every((t) => t.arc), 'names are set on a curve');
  assert.ok(Math.abs(a1[0].arc.a - a2[0].arc.a) > 0.01, 'they sway over time');
  assert.notEqual((a2[0].arc.a - a1[0].arc.a).toFixed(3), (a2[1].arc.a - a1[1].arc.a).toFixed(3), 'each at its own pace');
  assert.deepEqual(at(0, true).map((t) => t.arc.a), at(99, true).map((t) => t.arc.a), 'still on e-ink');
});
