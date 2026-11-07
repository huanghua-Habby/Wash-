import test from 'node:test';
import assert from 'node:assert/strict';
import { getLevel } from '../shared/levels.js';
import { applyWorld } from '../shared/snapshot.js';
import { quantize } from '../shared/delta.js';
import { Simulation } from './fixtures/Simulation.js';
import { enterPlaying } from './helpers/guide.js';

const look = { name: 'Mia', appearance: { animal: 'cat', breed: 'tabby', color: 2 } };

test('a stand-in keeps the dropped character as it is, is synced as a bot entry, and hands back in place', () => {
  const sim = new Simulation();
  try {
    sim.occupy(0, true); sim.occupy(1, true); sim.command('start'); enterPlaying(sim);
    const p = sim.players[1], towel = sim.game.towels[0];
    towel.pickup(p);
    const before = sim.urgentSignature(), serial = p.departure.serial;
    assert.equal(sim.standIn(1, look), true);
    assert.equal(p.occupied, true); assert.equal(p.heldTool, towel, 'the held tool stays with the character');
    assert.equal(p.departure.serial, serial, 'no departure');
    assert.equal(sim.connected[1], false); assert.ok(!sim.onlineSlots().includes(1), 'a stand-in is not an online player');
    assert.notEqual(sim.urgentSignature(), before, 'the hand-over goes out at once');
    assert.equal(sim.standIn(1, look), false, 'one stand-in per slot');
    const peer = new Simulation();
    try {
      applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, quantize(sim.snapshot()));
      assert.deepEqual(peer.game.bots, [{ slot: 1, name: 'Mia', team: null, appearance: look.appearance, standIn: true }]);
    } finally { peer.dispose(); }
    for (let i = 0; i < 120; i++) sim.tick();
    assert.equal(p.occupied, true);
    const pos = p.pos.clone();
    assert.equal(sim.resume(1), true);
    assert.ok(p.pos.equals(pos), 'no respawn'); assert.equal(sim.connected[1], true); assert.deepEqual(sim.game.bots, []);
    assert.equal(sim.bots.controller(1), null, 'the bot controller is gone');
    assert.equal(sim.resume(1), false);
  } finally { sim.dispose(); }
});

test('the main menu never stands in: a drop there departs as before', () => {
  const sim = new Simulation();
  try {
    sim.occupy(1, true); sim.tick();
    assert.equal(sim.standIn(1, look), false);
  } finally { sim.dispose(); }
});

test('returning home or placing a new versus line-up clears stand-ins with the match', () => {
  const sim = new Simulation(getLevel('versus-01') as any);
  try {
    sim.occupy(0, true); sim.occupy(1, true); sim.setTeam(0, 0); sim.setTeam(1, 1);
    sim.placeBots([{ slot: 2, team: 0 }]); sim.command('start');
    while (sim.phase !== 'game') sim.tick();
    assert.equal(sim.standIn(1, look), true);
    assert.equal(sim.game.bots.find((bot: any) => bot.slot === 1).team, 1, 'a versus stand-in keeps the team');
    assert.deepEqual([...sim.botControlled()].sort(), [1, 2]);
    sim.command('home');
    assert.equal(sim.players[1].occupied, false); assert.equal(sim.standIns.size, 0); assert.deepEqual(sim.game.bots, []);
  } finally { sim.dispose(); }
});

test('a co-op stand-in bot washes team-less orders to completion while the human seat stays idle', () => {
  // highway-01 is the tutorial (orders wait for the players' own moves); highway-02 runs on its script clock.
  const sim = new Simulation(getLevel('highway-02') as any);
  try {
    sim.occupy(0, true); sim.occupy(1, true); sim.command('start'); enterPlaying(sim);
    sim.standIn(1, look);
    for (let i = 0; i < 60 * 120 && !sim.game.completed; i++) sim.tick(); // the scaled walk is slower: allow two minutes
    assert.ok(sim.game.completed >= 1, 'the stand-in finished an order on its own');
  } finally { sim.dispose(); }
});
