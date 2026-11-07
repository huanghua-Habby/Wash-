import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Simulation } from './fixtures/Simulation.js';
import { SOLID_RADIUS, STATION_SOLID } from '../shared/sim/ToolModels.js';

/** Horizontal gap from a player to the station box (truck-local), negative inside. */
function gap(sim: any, player: any) {
  const truck = sim.trucks[0], solid = truck.solids[0];
  const x = Math.abs(player.pos.x - truck.pos.x - solid.x) - solid.hx, z = Math.abs(player.pos.z - truck.pos.z - solid.z) - solid.hz;
  return x > 0 || z > 0 ? Math.hypot(Math.max(0, x), Math.max(0, z)) : Math.max(x, z);
}

test('players cannot walk through the wash station, slide along it and can still wash a towel there', () => {
  const sim: any = new Simulation();
  try {
    sim.occupy(0, true);
    const player = sim.players[0], truck = sim.trucks[0], solid = truck.solids[0];
    assert.equal(solid.active, true, 'the station is shown and solid in practice');
    assert.deepEqual([solid.hx, solid.hz], [STATION_SOLID.hx, STATION_SOLID.hz]);
    for (let i = 0; i < 90; i++) sim.tick();
    assert.equal(player.state, 'ground');
    let seq = 0, closest = Infinity;
    // Walk straight at the station centre for three seconds, from wherever the slot spawns.
    for (let i = 0; i < 180; i++) {
      const tx = truck.pos.x + solid.x - player.pos.x, tz = truck.pos.z + solid.z - player.pos.z, d = Math.hypot(tx, tz) || 1;
      sim.input(0, { seq: ++seq, move: [tx / d, tz / d], axis: [0, 0], down: [], hits: [] });
      sim.tick(); closest = Math.min(closest, gap(sim, player));
    }
    assert.ok(closest > SOLID_RADIUS - 0.02, `body never enters the cabinet (closest gap ${closest.toFixed(3)})`);
    assert.equal(player.state, 'ground', 'pushing against it never knocks the player off the roof');
    assert.ok(sim.game.nearStation(player), 'standing against the counter is still within washing range');
    // Walking diagonally into a face slides along it instead of stopping dead.
    const start = player.pos.clone();
    for (let i = 0; i < 30; i++) { sim.input(0, { seq: ++seq, move: [0.7 * Math.sign(truck.pos.x + solid.x - player.pos.x), 0.7], axis: [0, 0], down: [], hits: [] }); sim.tick(); }
    assert.ok(Math.abs(player.pos.z - start.z) > 0.5, 'slides along the side');
    assert.ok(gap(sim, player) > SOLID_RADIUS - 0.02);
  } finally { sim.dispose(); }
});

test('the station is not solid while hidden, and a jump above its top passes over', () => {
  const sim: any = new Simulation();
  try {
    sim.occupy(0, true); for (let i = 0; i < 90; i++) sim.tick();
    const player = sim.players[0], truck = sim.trucks[0], solid = truck.solids[0];
    sim.game.station.visible = false;
    assert.equal(solid.active, false);
    const inside = new THREE.Vector3(truck.pos.x + solid.x, truck.topY, truck.pos.z + solid.z);
    player.pos.copy(inside); player.resolveSolids(sim.trucks);
    assert.ok(player.pos.distanceTo(inside) < 1e-9, 'hidden station does not push');
    sim.game.station.visible = true;
    player.pos.set(inside.x, truck.topY + STATION_SOLID.height + 0.05, inside.z); player.state = 'air'; player.ground = null;
    const above = player.pos.clone(); player.resolveSolids(sim.trucks);
    assert.ok(player.pos.distanceTo(above) < 1e-9, 'above the tap height nothing pushes');
    player.pos.set(inside.x + 0.1, truck.topY + 0.3, inside.z); player.resolveSolids(sim.trucks);
    assert.ok(gap(sim, player) > SOLID_RADIUS - 1e-6, 'a body inside leaves by the nearest face');
  } finally { sim.dispose(); }
});
