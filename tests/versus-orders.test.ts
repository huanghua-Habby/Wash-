import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from './fixtures/Simulation.js';
import { packetInput } from '../shared/protocol.js';
import { quantize } from '../shared/delta.js';
import { applyWorld } from '../shared/snapshot.js';
import { advanceVehicle } from '../shared/sim/VehicleBehaviors.js';
import { chargingPortLocal } from '../shared/sim/chargingConfig.js';
import { teamForSide } from '../shared/sim/versusConfig.js';
import { onChargeCompleted } from '../shared/sim/ChargingRewards.js';

const dt = 1 / 60;
const keys = (down: string[] = [], hits: string[] = []) => packetInput({ seq: 1, move: [0, 0], axis: [0, 0], down, hits });
function ground(sim: Simulation, slot: number, truck: any, x: number, z: number) {
  const p = sim.players[slot]; p.state = 'ground'; p.ground = { truck, plat: truck.platformAt(truck.pos.x + x, truck.pos.z + z, 0) };
  p.pos.set(truck.pos.x + x, truck.topY, truck.pos.z + z); p.root.position.copy(p.pos);
  p.vel.set(0, 0, 0); p.externalVelocity.set(0, 0, 0); p.yaw = 0; p.yawG.rotation.y = 0;
  return p;
}
/** 2v2: slots 0/1 red, 2/3 blue; a red order arrives on the left, a blue one on the right. */
function versus(mode: 'coop' | 'versus' = 'versus') {
  const sim = new Simulation(undefined, mode);
  for (let slot = 0; slot < 4; slot++) { sim.occupy(slot, true); sim.setTeam(slot, slot < 2 ? 0 : 1); }
  sim.phase = 'game'; sim.game.start(30); sim.game.inputs = sim.players.map(() => keys());
  const red = sim.game.spawnOrder(0, { side: -1 }), blue = sim.game.spawnOrder(1, { side: 1 });
  sim.scene.updateMatrixWorld(true);
  return { sim, g: sim.game, red, blue };
}
const stainOf = (order: any, step: string) => order.stains.find((s: any) => !s.done && s.steps[s.stage] === step);

test('versus orders take the team of their arrival side; co-op orders and players have no team', () => {
  assert.equal(teamForSide(-1), 0); assert.equal(teamForSide(1), 1);
  const { sim, red, blue } = versus();
  try {
    assert.deepEqual([red.team, blue.team], [0, 1]);
    assert.deepEqual(sim.players.map((p: any) => p.team), [0, 0, 1, 1]);
  } finally { sim.dispose(); }
  const coop = versus('coop');
  try {
    assert.deepEqual([coop.red.team, coop.blue.team], [null, null]);
    assert.ok(coop.sim.players.every((p: any) => p.team === null), 'co-op ignores roster teams');
  } finally { coop.sim.dispose(); }
});

test('only the owning team cleans an order; an enemy jet only washes back rinse progress (HouJianNan)', () => {
  const { sim, g, red } = versus();
  try {
    const stain = stainOf(red, 'towel'), [x, z] = stain.position;
    for (const slot of [2, 0]) {
      const p = ground(sim, slot, red.truck, x, z); g.towels[slot === 2 ? 0 : 1].pickup(p); p.skipUse = false;
    }
    sim.scene.updateMatrixWorld(true);
    assert.equal(g.nearestStain(sim.players[2]), null, 'a blue towel finds no stain on a red order');
    assert.equal(g.nearestStain(sim.players[0]), stain);
    for (let i = 0; i < 20; i++) g.interact(sim.players[2], keys(['KeyJ']), dt);
    assert.equal(stain.progress, 0, 'blue wiping does nothing');
    for (let i = 0; i < 20; i++) g.interact(sim.players[0], keys(['KeyJ']), dt);
    assert.ok(stain.progress > 0, 'red wiping advances its own order');

    const water = stainOf(red, 'water');
    g.rinse(sim.players[2], water, 1); assert.equal(water.progress, 0, 'blue water on a fresh red stain adds nothing');
    g.rinse(sim.players[1], water, 0.2); const rinsed = water.progress; assert.ok(rinsed > 0);
    g.rinse(sim.players[2], water, 0.1); assert.ok(water.progress < rinsed, 'blue water washes back red rinse progress');
  } finally { sim.dispose(); }
});

test('either team may plug any order (HouJianNan); the ×1.5 stays on the charged truck', () => {
  const { sim, g, red, blue } = versus();
  try {
    const head = g.chargers[0], [x, , z] = chargingPortLocal(red.truck);
    const enemy = ground(sim, 2, red.truck, x, z); head.pickup(enemy); enemy.skipUse = false;
    assert.equal(g.charging.nearPort(enemy), red);
    g.interact(enemy, keys(['KeyJ'], ['KeyJ']), dt);
    assert.equal(head.connectedSerial, red.serial, 'blue may charge the red order (it only helps red)');
    red.chargeProgress = 1; red.charged = true;
    // Complete the charge through the authority's own hook.
    onChargeCompleted(g, red);
    assert.equal(red.rewardMultiplier, 1.5); assert.equal(blue.rewardMultiplier, 1, 'only the charged truck is boosted');
  } finally { sim.dispose(); }
});

test('a washed versus truck counts for its team without whole-order pay; a missed order hurts only its team', () => {
  const { sim, g, red, blue } = versus();
  try {
    const signature = sim.urgentSignature();
    for (const order of [red, blue]) for (const stain of order.stains) stain.done = true;
    g.completeOrder(red); g.completeOrder(blue);
    assert.equal(g.score, 0, 'versus never touches the shared co-op score');
    // Points are earned per stain as each is finished (pvp.test.ts); completing the truck pays nothing more uncharged.
    assert.deepEqual(g.teamScores, [0, 0]); assert.deepEqual(g.teamCompleted, [1, 1]);
    assert.deepEqual([red.mode, blue.mode], ['leaving', 'leaving']);
    assert.notEqual(sim.urgentSignature(), signature, 'team scores are sent at once');

  } finally { sim.dispose(); }
  const late = versus();
  try {
    const { g: lg, red: lateRed, blue: lateBlue } = late;
    for (const stain of lateRed.stains) stain.done = true;
    lg.completeOrder(lateRed); lg.teamCombos = [2, 2];
    lateBlue.remaining = 0; advanceVehicle(lg, lateBlue, dt);
    assert.deepEqual(lg.teamMissed, [0, 1]); assert.deepEqual(lg.teamCombos, [2, 0], 'only blue loses its combo');
    assert.equal(lg.missed, 0); assert.equal(lateBlue.mode, 'leaving');
  } finally { late.sim.dispose(); }
});

test('order teams and both tallies survive the host-to-guest snapshot', () => {
  const { sim, g, red, blue } = versus();
  try {
    for (const stain of red.stains) stain.done = true;
    g.completeOrder(red);
    const peer = new Simulation(undefined, 'versus');
    try {
      applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, quantize(sim.snapshot()));
      assert.equal(peer.game.mode, 'versus');
      const peerBlue = peer.game.orders.find((o: any) => o.serial === blue.serial);
      assert.equal(peerBlue.team, 1);
      assert.deepEqual(peer.game.teamScores, g.teamScores); assert.deepEqual(peer.game.teamCompleted, [1, 0]);
    } finally { peer.dispose(); }
  } finally { sim.dispose(); }
});

test('co-op scoring is unchanged', () => {
  const { sim, g, red } = versus('coop');
  try {
    for (const stain of red.stains) stain.done = true;
    g.completeOrder(red);
    assert.ok(g.score > 0); assert.equal(g.completed, 1); assert.deepEqual(g.teamScores, [0, 0]);
  } finally { sim.dispose(); }
});
