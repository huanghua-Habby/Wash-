import test from 'node:test';
import assert from 'node:assert/strict';
import { getLevel } from '../shared/levels.js';
import { quantize } from '../shared/delta.js';
import { guestView, restoreView, OWN_ONLY } from '../shared/wire.js';
import { Simulation } from './fixtures/Simulation.js';

function state() {
  const sim = new Simulation(getLevel('versus-01') as any);
  sim.occupy(0, true); sim.occupy(1, true);
  for (let i = 0; i < 30; i++) sim.tick();
  const s = quantize(sim.snapshot()); sim.dispose(); return s;
}

test('a guest gets prediction-only fields for its own character only, and never the derivable local position', () => {
  const s = state(), view = guestView(s, 1);
  for (const key of OWN_ONLY) if (key in s.players[1]) assert.ok(key in view.players[1], `own ${key} kept`);
  for (const key of OWN_ONLY) assert.ok(!(key in view.players[0]), `other ${key} dropped`);
  assert.ok(view.players.every((p: any) => !('local' in p)));
  for (const key of ['pos', 'vel', 'externalVelocity', 'airBase', 'state', 'slipRemaining', 'fallTimer', 'throwWasDown', 'wallTime', 'dashDirection'])
    assert.ok(key in view.players[0], `${key} still drawn for others`);
  assert.ok('local' in s.players[0] || s.players[0].parent < 0, 'the shared state itself is not mutated');
});

test('restoring a view derives local from the same snapshot vehicle, and positions round to millimetres', () => {
  const s = state(), restored = restoreView(structuredClone(guestView(s, 1)));
  for (const [i, p] of restored.players.entries()) {
    assert.ok(p.pos.every((v: number) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6), 'millimetre positions');
    if (p.parent < 0) continue;
    const truck = restored.trucks[p.parent].pos;
    assert.deepEqual(p.local, [p.pos[0] - truck[0], p.pos[1] - truck[1], p.pos[2] - truck[2]]);
    assert.ok(Math.hypot(...p.local.map((v: number, k: number) => v - s.players[i].local[k])) < 2e-3, 'within rounding of the host value');
  }
});

test('ever-growing phases wrap without changing what they mean', () => {
  const s = state();
  // walk away from a step boundary (rounding to 0.01 may shift a boundary by 0.005 rad)
  s.players[0].walk = 200.123; s.players[0].lean = [0.0044, 0, 60.2731]; s.players[1].lean = [0, 0, -0.06];
  const view = guestView(s, 1);
  assert.ok(view.players[0].walk >= 0 && view.players[0].walk < Math.PI * 2);
  assert.equal(Math.floor(view.players[0].walk / Math.PI) % 2, Math.floor(200.123 / Math.PI) % 2, 'step parity holds');
  assert.ok(Math.abs(Math.sin(view.players[0].lean[2]) - Math.sin(60.2731)) < 2e-3 && Math.abs(view.players[0].lean[2]) <= Math.PI);
  assert.equal(view.players[1].lean[2], -0.06, 'a small negative tilt stays small');
});
