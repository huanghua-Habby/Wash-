import test from 'node:test';
import assert from 'node:assert/strict';
import { VehicleLoad, loadTarget, riderWeight, PLAYER_MASS, TOOL_MASS } from '../shared/sim/VehicleLoad.js';
import { VEHICLES } from '../shared/sim/vehicles.js';

const settle = (load: any, riders: any[], seconds = 6) => { for (let i = 0; i < seconds * 60; i++) load.step(1 / 60, riders); return load; };

test('every vehicle has a suspension mass and the small cars are the lightest', () => {
  for (const [type, spec] of Object.entries(VEHICLES) as any) assert.ok(spec.suspension?.mass > 0, type);
  assert.ok(VEHICLES.pod.suspension.mass < VEHICLES.cargo.suspension.mass);
  assert.ok(VEHICLES.sedan.suspension.mass < VEHICLES.bus.suspension.mass);
});

test('a rider on one side rolls that side down; in front pitches the nose down; weight sinks the hull', () => {
  const spec = VEHICLES.pod, cx = (spec.x0 + spec.x1) / 2;
  const right = loadTarget(spec, [{ x: cx, z: 0.8, w: 1 }]);
  assert.ok(right.roll > 0, 'positive roll lowers +z');
  assert.ok(loadTarget(spec, [{ x: cx, z: -0.8, w: 1 }]).roll < 0);
  assert.ok(loadTarget(spec, [{ x: cx + 1, z: 0, w: 1 }]).pitch < 0, 'front rider lowers the nose');
  assert.ok(right.sink > 0);
  assert.deepEqual(loadTarget(spec, []), { roll: 0, pitch: 0, sink: 0, weight: 0 });
  const balanced = loadTarget(spec, [{ x: cx, z: 0.8, w: 1 }, { x: cx, z: -0.8, w: 1 }]);
  assert.ok(Math.abs(balanced.roll) < 1e-9 && balanced.sink > right.sink, 'balanced cats only sink it');
});

test('stacked riders add up until the travel limit; the same cats barely move a heavy vehicle', () => {
  const pod = VEHICLES.pod, cx = (pod.x0 + pod.x1) / 2;
  const one = loadTarget(pod, [{ x: cx, z: 0.5, w: 1 }]).roll;
  const two = loadTarget(pod, [{ x: cx, z: 0.5, w: 1 }, { x: cx + 0.4, z: 0.5, w: 1 }]).roll;
  assert.ok(two > one * 1.9, 'two cats on one side lean about twice as far');
  const four = loadTarget(pod, Array.from({ length: 4 }, () => ({ x: cx, z: 1, w: 1.3 })));
  assert.ok(four.roll <= 0.2 + 1e-9 && four.sink <= 0.32 + 1e-9, 'clamped to travel');
  const washer = VEHICLES.washer;
  const heavy = loadTarget(washer, [{ x: (washer.x0 + washer.x1) / 2, z: 0.5, w: 1 }]).roll;
  assert.ok(heavy < one / 5, 'large vehicles stay nearly level');
});

test('the spring settles on the static lean, overshooting a little, and is frame-rate independent', () => {
  const riders = [{ x: 0, z: 0.9, w: 1 }];
  const load: any = new VehicleLoad('pod');
  let peak = 0;
  for (let i = 0; i < 360; i++) { load.step(1 / 60, riders); peak = Math.max(peak, load.roll); }
  assert.ok(Math.abs(load.roll - load.target.roll) < 1e-3, 'settles');
  assert.ok(peak > load.target.roll * 1.05, 'underdamped bounce');
  const coarse: any = new VehicleLoad('pod'), fine: any = new VehicleLoad('pod');
  for (let i = 0; i < 30; i++) coarse.step(1 / 30, riders);
  for (let i = 0; i < 120; i++) fine.step(1 / 120, riders);
  assert.ok(Math.abs(coarse.roll - fine.roll) < 1e-9, 'fixed sub-steps');
});

test('a landing kicks the hull and then returns to rest; tools add weight to their holder', () => {
  const load: any = new VehicleLoad('sedan');
  load.impulse(0, 1, 1, 12);
  load.step(1 / 30, []);
  assert.ok(load.sink > 0 && load.roll > 0, 'pushed down on the landing side');
  settle(load, []);
  assert.ok(Math.abs(load.roll) < 1e-3 && Math.abs(load.sink) < 1e-3);
  assert.equal(riderWeight({}), PLAYER_MASS);
  assert.equal(riderWeight({ heldTool: { kind: 'water' } }), PLAYER_MASS + TOOL_MASS.water);
});
