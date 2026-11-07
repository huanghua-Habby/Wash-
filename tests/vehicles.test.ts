import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { getLevel } from '../shared/levels.js';
import { order as authorOrder } from '../shared/levels/authoring.js';
import { packetInput, VERSION } from '../shared/protocol.js';
import { applyWorld } from '../shared/snapshot.js';
import { quantize } from '../shared/delta.js';
import { VEHICLES } from '../shared/sim/vehicles.js';
import { SOLID_RADIUS } from '../shared/sim/ToolModels.js';
import { Simulation } from './fixtures/Simulation.js';
import { enterPlaying } from './helpers/guide.js';

const DT = 1 / 60;
const walk = (x: number, z = 0) => packetInput({ seq: 1, move: [x, z], axis: [x, z], down: [], hits: [] });
const idle = walk(0);

/** The shipped home vehicle is the single-level placeholder washer again (2026-10-20 user); the multi-level rules
 * (platform heights, ladders, cargo solids) stay supported, so these tests run on a level that uses washer2 + flatbed. */
function multiLevel(): any {
  const level: any = getLevel('highway-02');
  return { ...level, home: { ...level.home, vehicles: level.home.vehicles.map((v: any, i: number) => i ? v : { ...v, type: 'washer2' }) },
    orders: { ...level.orders, vehicles: [...level.orders.vehicles, { capacity: 2, type: 'flatbed', palette: 'orderHauler' }] } };
}
function world() {
  const sim = new Simulation(multiLevel());
  sim.occupy(0, true); sim.command('start'); enterPlaying(sim);
  return sim;
}
/** Stand `p` on the home truck at truck-local (x, z), on the platform level there. */
function standAt(sim: any, p: any, x: number, z: number) {
  const home = sim.game.homeTruck, wx = home.pos.x + x, wz = home.pos.z + z;
  p.state = 'ground'; p.wall = null; p.vel.set(0, 0, 0); p.externalVelocity.set(0, 0, 0);
  p.ground = { truck: home, plat: home.platformAt(wx, wz, 0), solid: -1 };
  p.pos.set(wx, home.topYAt(wx, wz), wz);
}
const step = (sim: any, p: any, input: any, n: number) => { for (let i = 0; i < n; i++) p.update(DT, 0, input, sim.game.activeTrucks(), sim.camera, sim.game.base); };

test('shipped levels use the placeholder washer; the multi-level washer2 (1 m rear deck, 3 m box roof, cab, one ladder) stays in the catalogue', () => {
  const level: any = getLevel('highway-02');
  assert.equal(level.home.vehicles[0].type, 'washer');
  assert.ok(!level.orders.vehicles.some((entry: any) => entry.type === 'flatbed'));
  const spec: any = VEHICLES.washer2;
  assert.deepEqual(spec.platforms.map((p: any) => [p.name, p.y ?? spec.top]), [['low-deck', 1], ['box-roof', 3], ['cab', 3]]);
  assert.ok(spec.x0 <= -7.4);
  assert.ok(spec.platforms.find((p: any) => p.name === 'low-deck').x0 <= -7.1);
  assert.equal(spec.ladders.length, 1);
  const sim = world();
  try {
    const g: any = sim.game, home = g.homeTruck; sim.scene.updateMatrixWorld(true);
    const station = g.station.getWorldPosition(new THREE.Vector3());
    assert.ok(Math.abs(station.y - home.topYAt(station.x, station.z)) < 0.15, 'the wash station sits on the deck under it (the low deck)');
    assert.ok(home.topYAt(station.x, station.z) < home.topY - 1.5);
  } finally { sim.dispose(); }
});

test('ladder (squirrel-cling system, any animal): walk into it to grab, W climbs onto the box roof, no sideways, Space lets go, S climbs down', () => {
  const sim = world();
  try {
    const home: any = sim.game.homeTruck, p: any = sim.players[0];
    const press = (x: number, y: number, keys: string[] = []) => packetInput({ seq: 1, move: [x, 0], axis: [x, y], down: keys, hits: keys });
    // Beside the ladder the 2 m face is just a wall.
    standAt(sim, p, -3.2, 1.2); step(sim, p, walk(1), 60);
    assert.equal(p.state, 'ground'); assert.equal(p.ground.plat.name, 'low-deck'); assert.ok(p.pos.x - home.pos.x < -2.3);
    // In the ladder lane: walking into the face grabs the ladder (the cling state, flagged as a ladder).
    standAt(sim, p, -3.2, 0); step(sim, p, walk(1), 40);
    assert.equal(p.state, 'air'); assert.equal(p.wall?.ladder, 0, 'on the ladder');
    const y0 = p.pos.y, z0 = p.pos.z;
    step(sim, p, press(0, 0), 30); assert.ok(Math.abs(p.pos.y - y0) < 1e-6, 'hangs still without W/S');
    step(sim, p, packetInput({ seq: 1, move: [0, 1], axis: [1, -1], down: [], hits: [] }), 10);
    assert.ok(p.pos.y > y0 + 0.2, 'W climbs'); assert.ok(Math.abs(p.pos.z - z0) < 1e-6, 'no sideways movement');
    // Space mid-climb kicks off.
    step(sim, p, press(0, 0, ['Space']), 1); assert.equal(p.wall, null, 'jumped off the ladder');
    // Grab again and climb all the way: onto the box roof.
    standAt(sim, p, -3.2, 0); step(sim, p, walk(1), 40);
    for (let i = 0; i < 120 && p.state === 'air'; i++) step(sim, p, press(0, -1), 1);
    assert.equal(p.state, 'ground'); assert.equal(p.ground.plat.name, 'box-roof'); assert.ok(Math.abs(p.pos.y - home.topY) < 1e-6);
    // From the top, stepping toward the ladder grabs it; S climbs down onto the low deck.
    standAt(sim, p, -2.2, 0); step(sim, p, walk(-1), 20);
    assert.equal(p.wall?.ladder, 0, 'grabbed the ladder from the top');
    for (let i = 0; i < 120 && p.state === 'air'; i++) step(sim, p, press(0, 1), 1);
    assert.equal(p.state, 'ground'); assert.equal(p.ground.plat.name, 'low-deck');
    // Off the rear edge away from the ladder: a plain fall onto the low deck.
    standAt(sim, p, -2.2, 1.2);
    for (let i = 0; i < 60 && p.state === 'ground'; i++) step(sim, p, walk(-1), 1);
    step(sim, p, idle, 60);
    assert.equal(p.state, 'ground'); assert.equal(p.ground.plat.name, 'low-deck');
  } finally { sim.dispose(); }
});

test('the box face stops the body at its surface, not half inside, and a fall past the edge is pushed clear', () => {
  const sim = world();
  try {
    const home: any = sim.game.homeTruck, p: any = sim.players[0], face = home.pos.x - 2.45, r = SOLID_RADIUS;
    standAt(sim, p, -3.4, 1.2); step(sim, p, walk(1), 60);
    assert.ok(p.pos.x <= face - r + 1e-6 && p.pos.x > face - r - 0.05, `stops at the surface (${(p.pos.x - face).toFixed(3)})`);
    step(sim, p, walk(1, 1), 10); assert.ok(p.pos.z > home.pos.z + 1.2, 'slides along the face');
    // Off the box roof's rear edge with the body still over it: pushed out as it drops, never landing inside.
    standAt(sim, p, -2.3, 1.2);
    for (let i = 0; i < 60 && p.state === 'ground'; i++) step(sim, p, walk(-1), 1);
    step(sim, p, idle, 60);
    assert.equal(p.ground?.plat?.name, 'low-deck'); assert.ok(p.pos.x <= face - r + 1e-6);
    // Space on the ladder is a small hop back that stays on the deck (not the squirrel's wall kick).
    standAt(sim, p, -3.2, 0); step(sim, p, walk(1), 40); assert.equal(p.wall?.ladder, 0);
    step(sim, p, packetInput({ seq: 1, move: [0, 0], axis: [0, 0], down: ['Space'], hits: ['Space'] }), 1); step(sim, p, idle, 90);
    assert.equal(p.state, 'ground'); assert.equal(p.ground.truck, home, 'still on the vehicle');
  } finally { sim.dispose(); }
});

test('a jump from the low deck into the box side is stopped by its face, not tunnelled', () => {
  const sim = world();
  try {
    const home: any = sim.game.homeTruck, p: any = sim.players[0];
    standAt(sim, p, -3.2, 1.2);
    p.update(DT, 0, packetInput({ seq: 1, move: [1, 0], axis: [1, 0], down: ['Space'], hits: ['Space'] }), sim.game.activeTrucks(), sim.camera, sim.game.base);
    step(sim, p, walk(1), 90);
    assert.equal(p.ground?.plat?.name, 'low-deck'); assert.ok(p.pos.x - home.pos.x < -2.3, 'still behind the box face');
  } finally { sim.dispose(); }
});

test('flatbed cargo is a box solid: blocked from the side, standable on top, rebuilt from the snapshot, cleared with the order', () => {
  const sim = world();
  try {
    const g: any = sim.game;
    const definition: any = authorOrder('cargo-test', 0, 1, 'flatbed', ['dust', 'mud', 'grease']);
    definition.cargo = [{ id: 'crate-1', kind: 'wood-crate', position: [-2.4, 0], size: [0.75, 0.75], height: 0.725 }];
    const slot = g.orderTrucks.findIndex((t: any) => t.type === 'flatbed');
    const order = g.spawnOrder(50, { side: 1, definition, vehicleSlot: slot }), truck = order.truck;
    assert.equal(truck.solids.length, 1);
    assert.equal(g.dockLevel(truck), 1, 'a low flatbed docks to the low deck');
    const p: any = sim.players[0];
    p.state = 'air'; p.ground = null; p.wall = null; p.vel.set(truck.vel.x, 0, truck.vel.z); p.airBase.set(truck.vel.x, truck.vel.z);
    p.pos.set(truck.pos.x - 2.4, truck.topY + 1.5, truck.pos.z);
    for (let i = 0; i < 90 && p.state === 'air'; i++) p.update(DT, 0, idle, [truck], sim.camera, g.base);
    assert.equal(p.ground?.solid, 0, 'stands on the crate'); assert.ok(Math.abs(p.pos.y - (truck.topY + 0.725)) < 1e-6);
    const peer = new Simulation(multiLevel());
    try {
      applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, quantize(sim.snapshot()));
      const copy = peer.game.orders.find((o: any) => o.serial === 50);
      assert.deepEqual(copy.truck.solids.map((s: any) => s.id), ['crate-1'], 'cargo comes back from the order definition');
    } finally { peer.dispose(); }
    g.clearStains(order);
    assert.equal(truck.solids.length, 0);
    assert.equal(VERSION, 42);
  } finally { sim.dispose(); }
});

test('roof wetness draws one decal layer per standing level, and a mark goes to the layer under it', async () => {
  const { LevelDecalPools } = await import('../client/js/fx/WetSurfaces.js');
  const parent = new THREE.Group(), uniforms: any = { uTime: { value: 0 } };
  const washer: any = { spec: VEHICLES.washer2 }, flatbed: any = { spec: VEHICLES.flatbed };
  const a = new LevelDecalPools(parent, 8, uniforms, washer), b = new LevelDecalPools(parent, 8, uniforms, flatbed);
  const heights = (pools: any) => pools.layers.map((layer: any) => +(layer.pool.meshes[0].material.uniforms.uY.value).toFixed(3));
  assert.deepEqual(heights(a), [1.055, 3.055], 'washer2: low deck, then box roof + cab in one layer');
  assert.deepEqual(heights(b), [1.055, 2.305], 'flatbed: bed and cab at their own heights');
  a.write(0, -4, 0, 0, 1, 0.5, 1, 9, 0, 0); a.write(1, 0, 0, 0, 1, 0.5, 1, 9, 0, 0); a.write(2, 4, 0, 0, 1, 0.5, 1, 9, 0, 0);
  assert.deepEqual([...a.slotLayer.slice(0, 3)], [0, 1, 1], 'low deck, box roof and cab marks');
  a.write(0, 1, 0, 0, 1, 0.5, 1, 9, 0, 0);
  assert.equal(a.layers[0].pool.records[0].radius, 0, 'a slot that moves level leaves its old layer');
  a.update(0.1);
  assert.equal(a.layers[0].pool.geometry.instanceCount, 0, 'an empty layer submits nothing');
});
