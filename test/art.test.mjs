import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose, hashString, windName } from '../web/lib/art.js';
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
