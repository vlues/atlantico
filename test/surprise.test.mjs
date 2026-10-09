import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recipe, ELEMENTS, rng } from '../web/lib/surprise.js';

const day = { day: true, sunAlt: 30, rain: false, cloud: 40, wind: 15, windName: 'poniente', moon: 0.7, hour: 14, here: ['Ana'] };
const night = { ...day, day: false, sunAlt: -20, hour: 23 };

test('every seed grows its own surprise', () => {
  const seen = new Set();
  for (let i = 0; i < 3000; i++) {
    const r = recipe((Math.random() * 2 ** 32) >>> 0, i % 2 ? day : night, i % 3 ? 'big' : 'small');
    seen.add(JSON.stringify([r.layers.map((l) => [l.kind, l.count, l.dir, l.depth.toFixed(3), l.hue.toFixed(1)]), r.sea, r.sky, r.sound]));
  }
  assert.equal(seen.size, 3000);
});

test('the same seed grows the same surprise on every screen', () => {
  assert.deepEqual(recipe(123456, night), recipe(123456, night));
  const a = rng(42), b = rng(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('day things by day, night things at night; small ones stay small', () => {
  for (let i = 0; i < 500; i++) {
    for (const [cx, not] of [[day, 'night'], [night, 'day']]) {
      const r = recipe(i * 7919, cx);
      assert.ok(r.layers.every((l) => ELEMENTS[l.kind].when !== not), `${l => l.kind} at the wrong time`);
    }
    const s = recipe(i * 104729, night, 'small');
    assert.equal(s.layers.length, 1);
    assert.ok(ELEMENTS[s.layers[0].kind].small);
    assert.equal(s.lights, 'none');
  }
});

test('the Demo panel can call up any element, whatever the hour', () => {
  for (const kind of Object.keys(ELEMENTS)) {
    const r = recipe(99, day, 'big', kind);
    assert.equal(r.layers[0].kind, kind);
    assert.ok(r.title.es && r.title.en);
    assert.ok(r.dur > 5 && r.dur < 50, `${kind}: ${r.dur}`);
  }
});

test('a new constellation is named after someone who is here', () => {
  const r = recipe(7, { ...night, here: ['Lucía'] }, 'big', 'constellation');
  assert.match(r.title.es, /Lucía/);
});
