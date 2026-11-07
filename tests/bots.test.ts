import test from 'node:test';
import assert from 'node:assert/strict';
import { planBotSeats, botLook } from '../shared/sim/bots/BotSeats.js';
import { versusStartCheck } from '../shared/protocol.js';
import { quantize } from '../shared/delta.js';
import { applyWorld } from '../shared/snapshot.js';
import { getLevel } from '../shared/levels.js';
import { Simulation } from './fixtures/Simulation.js';
import { BOT_DIFFICULTY } from '../shared/sim/bots/BotDifficulty.js';
import { room, rosterOf } from './helpers/peerRoom.js';

const fill = (aiFill: string, aiDifficulty = 'normal') => ({ scoreTarget: 250, timeLimit: 300, aiFill, aiDifficulty });

test('bot seats: fill brings both teams to four, balance tops up the smaller team, off adds none', () => {
  assert.deepEqual(planBotSeats([{ slot: 0, team: 0 }], 8, 'fill'),
    [{ slot: 1, team: 0 }, { slot: 2, team: 0 }, { slot: 3, team: 0 }, { slot: 4, team: 1 }, { slot: 5, team: 1 }, { slot: 6, team: 1 }, { slot: 7, team: 1 }]);
  assert.deepEqual(planBotSeats([{ slot: 0, team: 0 }, { slot: 3, team: 0 }, { slot: 5, team: 1 }], 8, 'balance'), [{ slot: 1, team: 1 }]);
  assert.deepEqual(planBotSeats([{ slot: 0, team: 0 }], 8, 'balance'), [{ slot: 1, team: 1 }], 'a lone player still gets one opponent');
  assert.deepEqual(planBotSeats([{ slot: 0, team: 0 }], 8, 'off'), []);
  assert.deepEqual(planBotSeats([{ slot: 0, team: 0 }], 4, 'fill').length, 3, 'never more bots than the world has slots');
  const used = new Set([4, 5]), looks = [0, 1, 2, 3, 4].map(i => botLook(i, used));
  assert.deepEqual(looks.map(l => l.name), ['AI 1', 'AI 2', 'AI 3', 'AI 4', 'AI 5']);
  assert.deepEqual(looks.map(l => l.appearance.animal), ['cat', 'dog', 'pelican', 'elephant', 'cat']);
  assert.equal(new Set(looks.map(l => l.appearance.color)).size, 5, 'each bot gets its own colour');
  assert.ok(looks.every(l => ![4, 5].includes(l.appearance.color)), 'colours already worn by players are skipped');
});

test('with AI fill on, one real player may start versus; bots fill the seats and never count as online players', () => {
  assert.equal(versusStartCheck({ hostId: 'host', members: [{ id: 'host', slot: 0, team: 0, connected: true }], settings: fill('fill') }).ok, true);
  assert.equal(versusStartCheck({ hostId: 'host', members: [{ id: 'host', slot: 0, team: 0, connected: true }], settings: fill('off') }).ok, false);
  const r = room([]);
  try {
    const { host, members } = r;
    host.setRoster({ ...rosterOf(members.map(m => ({ ...m, team: 0 }))), mode: 'versus', settings: fill('fill', 'hard') });
    assert.equal(host.command('start', {}), null);
    const sim = host.sim;
    assert.equal(sim.bots.profile, BOT_DIFFICULTY.hard, "the room's AI difficulty drives the match's bots");
    assert.deepEqual([...sim.botSlots], [1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(sim.game.bots.map((b: any) => [b.slot, b.name, b.team]), [[1, 'AI 1', 0], [2, 'AI 2', 0], [3, 'AI 3', 0], [4, 'AI 4', 1], [5, 'AI 5', 1], [6, 'AI 6', 1], [7, 'AI 7', 1]]);
    assert.ok(sim.players.every((p: any) => p.occupied), 'all eight characters are on the field');
    assert.deepEqual(sim.players.map((p: any) => p.team), [0, 0, 0, 0, 1, 1, 1, 1]);
    assert.deepEqual(sim.onlineSlots(), [0], 'bots are not online players (votes, readiness)');
    // A roster refresh must not remove bots the registry knows nothing about.
    host.setRoster({ ...rosterOf(members.map(m => ({ ...m, team: 0 }))), mode: 'versus', settings: fill('fill'), phase: 'game' });
    assert.equal(sim.botSlots.size, 7);
    for (let i = 0; i < 240; i++) r.advance();
    assert.equal(sim.phase, 'game'); assert.ok(sim.players.slice(1).every((p: any) => p.state !== 'fallen'), 'idle bots land on the truck');
    const peer = new Simulation(getLevel('versus-01') as any);
    try {
      applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, quantize(sim.snapshot()));
      assert.deepEqual(peer.game.bots.map((b: any) => b.name), ['AI 1', 'AI 2', 'AI 3', 'AI 4', 'AI 5', 'AI 6', 'AI 7']);
    } finally { peer.dispose(); }
    assert.equal(host.command('home'), null);
    assert.equal(host.sim.botSlots.size, 0); assert.deepEqual(host.sim.game.bots, []);
    assert.ok(host.sim.players.slice(1).every((p: any) => !p.occupied), 'returning home removes every bot');
    assert.equal(host.sim.bots.profile, BOT_DIFFICULTY.normal, 'between matches (and for co-op stand-ins) bots are back to normal');
  } finally { r.dispose(); }
});
