import test from 'node:test';
import assert from 'node:assert/strict';
import { CFG, LOOK } from '../client/js/core/config.js';
import { applyTimeOfDay, timeWeights, SUNSET, NIGHT, DAY_SUN, TIME_PREVIEW } from '../client/js/render/TimeOfDay.js';

test('level progress drives day, sunset at 50% and night from 75%, without overwriting the saved day values', () => {
  const saved = JSON.stringify(CFG);
  applyTimeOfDay(0);
  assert.equal(LOOK.post.bloom, CFG.post.bloom); assert.equal(LOOK.light.sky, CFG.light.sky.toLowerCase());
  assert.deepEqual(LOOK.sunOffset, DAY_SUN);
  assert.equal(LOOK.post.tonemap, CFG.post.tonemap, 'unblended keys read the live day config');
  assert.deepEqual(timeWeights(0.2), { sunset: 0, night: 0 });
  applyTimeOfDay(0.5);
  assert.equal(LOOK.light.sunColor, SUNSET.light.sunColor); assert.deepEqual(LOOK.sunOffset, SUNSET.sun);
  const mid = applyTimeOfDay(0.62);
  assert.ok(mid.night > 0 && mid.night < 1, 'gradual sunset → night');
  for (const p of [0.75, 0.9, 1]) {
    applyTimeOfDay(p);
    for (const group of ['light', 'post', 'glow'] as const)
      for (const [key, value] of Object.entries(NIGHT[group])) assert.equal((LOOK as any)[group][key], value, `${group}.${key} at ${p}`);
    assert.deepEqual(LOOK.sunOffset, NIGHT.sun);
  }
  assert.equal(JSON.stringify(CFG), saved, 'debug-panel day config is never mutated');
  TIME_PREVIEW.enabled = true; TIME_PREVIEW.progress = 0.8;
  try { assert.equal(applyTimeOfDay(0).night, 1, 'preview overrides the round clock'); }
  finally { TIME_PREVIEW.enabled = false; applyTimeOfDay(0); }
});
