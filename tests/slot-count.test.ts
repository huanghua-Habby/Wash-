import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from './fixtures/Simulation.js';
import { FIRST_LEVEL_ID, getLevel } from '../shared/levels.js';
import { quantize } from '../shared/delta.js';
import { applyWorld, applyPlayer } from '../shared/snapshot.js';
import { CAPACITY } from '../shared/protocol.js';

/** Test-only level: the first level with four extra home slots, as a versus world will have. */
function eightSlotLevel() {
  const level: any = getLevel(FIRST_LEVEL_ID);
  const extra = [[-1.8, 0.65], [-3, -0.55], [-0.3, -0.55], [1, 0.65]];
  return { ...level, home: { ...level.home, playerSlots: [...level.home.playerSlots, ...extra] } };
}

let seq = 0;
const move = (sim: Simulation, slot: number, x = 0) => sim.input(slot, { seq: ++seq, move: [x, 0], axis: [x, 0], down: [], hits: [] });

test('co-op worlds keep exactly four slots and the room capacity stays four', () => {
  const sim = new Simulation();
  try {
    assert.equal(sim.slotCount, 4); assert.equal(CAPACITY, 4);
    for (const list of [sim.acks, sim.ackTicks, sim.queues, sim.inputs, sim.lastInput, sim.connected]) assert.equal(list.length, 4);
  } finally { sim.dispose(); }
});

test('an eight-slot level sizes every per-slot list, simulates slot 7 and survives a snapshot round trip', () => {
  seq = 0;
  const level = eightSlotLevel(), sim = new Simulation(level as any);
  try {
    assert.equal(sim.slotCount, 8);
    for (const list of [sim.acks, sim.ackTicks, sim.queues, sim.inputs, sim.lastInput, sim.connected]) assert.equal(list.length, 8);
    for (let slot = 0; slot < 8; slot++) sim.occupy(slot, true);
    assert.equal(sim.game.levelScript.zeroPerSlot().length, 8);
    for (let i = 0; i < 120; i++) { for (let slot = 0; slot < 8; slot++) move(sim, slot); sim.tick(); }
    const last = sim.players[7], start = last.pos.clone();
    for (let i = 0; i < 30; i++) { for (let slot = 0; slot < 7; slot++) move(sim, slot); move(sim, 7, 1); sim.tick(); }
    assert.ok(last.pos.distanceTo(start) > 0.5, 'the eighth slot is driven by its own input');
    assert.ok(sim.acks[7] > 0, 'the eighth slot acknowledges its input');

    const snap = quantize(sim.snapshot());
    assert.equal(snap.players.length, 8);
    const peer = new Simulation(level as any);
    try {
      applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, snap);
      snap.players.forEach((state: any, i: number) => applyPlayer(peer.players[i], state, peer.trucks));
      for (let slot = 0; slot < 8; slot++) {
        assert.equal(peer.players[slot].occupied, true);
        assert.ok(peer.players[slot].pos.distanceTo(sim.players[slot].pos) < 0.01, `slot ${slot} matches the authority`);
      }
    } finally { peer.dispose(); }

    // The entry transition places all eight on their own home points and the round starts.
    sim.command('start');
    for (let i = 0; i < Math.ceil(3.7 * 60); i++) { for (let slot = 0; slot < 8; slot++) move(sim, slot); sim.tick(); }
    assert.equal(sim.phase, 'game');
    const truck = sim.trucks[0];
    level.home.playerSlots.forEach(([x, z]: number[], slot: number) => {
      assert.ok(Math.hypot(sim.players[slot].pos.x - truck.pos.x - x, sim.players[slot].pos.z - truck.pos.z - z) < 0.6, `slot ${slot} lands on its home point`);
    });
    sim.resetInputs(); assert.equal(sim.queues.length, 8); assert.equal(sim.inputs.length, 8);
  } finally { sim.dispose(); }
});
