// Local own-state screen grade (StatusGrade): respawn-wait desaturation, shock rim, a short death flash.
import test from 'node:test';
import assert from 'node:assert/strict';
import { StatusGrade } from '../client/js/render/StatusGrade.js';

test('dying flashes the rim once and drains colour while waiting; respawning brings colour back; shocks shimmer', () => {
  const grade = new StatusGrade(), dt = 1 / 60, step = (player: any, seconds: number, live = true) => { for (let i = 0; i < seconds * 60; i++) grade.update(dt, player, live); };
  const p: any = { state: 'ground', stunRemaining: 0 };
  step(p, 0.5); assert.equal(grade.desat, 0); assert.equal(grade.death, 0);
  p.state = 'fallen'; grade.update(dt, p, true); step(p, 0.05);
  assert.ok(grade.death > 0.5, 'a short red flash at the moment of death');
  step(p, 1.5); assert.equal(grade.death, 0, 'the flash is short'); assert.ok(grade.desat > 0.9, 'colour drains while waiting');
  p.state = 'ground'; step(p, 1); assert.equal(grade.desat, 0, 'colour returns on respawn');
  p.downRemaining = 2; step(p, 0.5); assert.ok(grade.down > 0.9, 'a knockdown rims the screen white'); p.downRemaining = 0; step(p, 1); assert.equal(grade.down, 0);
  p.stunRemaining = 2; step(p, 0.5); assert.ok(grade.shock > 0.9); p.stunRemaining = 0; step(p, 1); assert.equal(grade.shock, 0);
  const fresh = new StatusGrade(); fresh.update(dt, { state: 'fallen' }, true); assert.equal(fresh.death, 0, 'joining already fallen is no new death');
  p.state = 'fallen'; step(p, 1, false); assert.equal(grade.desat, 0, 'nothing outside a running world');
});
