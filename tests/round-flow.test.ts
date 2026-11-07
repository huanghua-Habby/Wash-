import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from './fixtures/Simulation.js';
import { ROUND_FLOW, roundCue } from '../shared/sim/roundFlow.js';
import { applyWorld } from '../shared/snapshot.js';
import { room } from './helpers/peerRoom.js';
import { ProgressStore } from '../client/js/save/ProgressStore.js';
import { confirmGuide } from './helpers/guide.js';

test('Ready locks all players, tools, orders and play time; pause freezes preparation and Go discards queued actions', () => {
  const sim = new Simulation();
  try {
    sim.occupy(0, true); sim.occupy(1, true); sim.command('start');
    while (sim.phase !== 'game') sim.tick();
    confirmGuide(sim);
    const g = sim.game, positions = sim.players.map(p => p.pos.clone());
    assert.equal(roundCue(g), 'ready-3'); assert.equal(g.remaining, 180);
    sim.command('pause', true); const before = g.roundStageTime;
    for (let i = 0; i < 60; i++) sim.tick();
    assert.equal(g.roundStageTime, before); sim.command('pause', false);
    let seq = 0;
    while (g.roundStage === 'ready') {
      for (const slot of [0, 1]) sim.input(slot, { seq: ++seq, move: [1,0], axis: [1,0], down: ['KeyJ','Space','KeyK'], hits: ['KeyJ','Space'] });
      sim.tick();
      assert.equal(g.orders.length, 0); assert.equal(g.score, 0);
      assert.ok(sim.players.every((p, i) => Math.hypot(p.pos.x - positions[i].x, p.pos.z - positions[i].z) < 1e-8));
      assert.ok(sim.players.every(p => !p.heldTool));
      if (g.roundStage === 'ready') { assert.equal(g.elapsed, 0); assert.equal(g.remaining, 180); }
    }
    assert.equal(roundCue(g), 'go'); assert.ok(g.elapsed > 0);
    sim.tick(); assert.ok(sim.players.every((p, i) => Math.hypot(p.pos.x - positions[i].x, p.pos.z - positions[i].z) < 1e-8), 'held Ready movement cannot leak past Go');
    sim.input(0, { seq: ++seq, move: [1,0], axis: [1,0], down: [], hits: [] }); sim.tick();
    assert.ok(sim.players[0].pos.distanceTo(positions[0]) > 0);
  } finally { sim.dispose(); }
});

test('Finish freezes interactions and awards while its authority clock advances to results; home/restart resets cues', () => {
  const sim = new Simulation();
  try {
    sim.occupy(0, true); sim.phase = 'game'; sim.game.start(sim.director.base);
    const g = sim.game; g.spawnOrder(); g.remaining = .001;
    let ends = 0; g.onEnd = () => ends++;
    sim.tick(); assert.equal(roundCue(g), 'finish'); assert.equal(g.remaining, 0);
    const order = g.order, score = g.score, elapsed = g.elapsed, frozen = sim.snapshot();
    order.stains.forEach((s: any) => { s.done = true; s.stage = s.steps.length; });
    g.completeOrder(order); assert.equal(g.score, score); assert.equal(order.paid, false);
    for (let i = 0; i < Math.round(ROUND_FLOW.finishSeconds * 60); i++) sim.tick();
    assert.equal(g.roundStage, 'results'); assert.equal(g.elapsed, elapsed); assert.equal(g.remaining, 0); assert.equal(ends, 1);
    assert.deepEqual(sim.snapshot().players, frozen.players);
    sim.command('home'); assert.equal(g.roundStage, 'idle'); assert.equal(roundCue(g), '');
    sim.command('start'); while (sim.phase !== 'game') sim.tick();
    confirmGuide(sim);
    assert.equal(roundCue(g), 'ready-3'); assert.equal(g.score, 0); assert.equal(g.remaining, 180);
  } finally { sim.dispose(); }
});

test('Ready/Go/Finish/results reach guests through urgent delta snapshots; one receipt uses the 0.5 save contract', async () => {
  const r = room(['guest']), viewer = new Simulation();
  try {
    r.host.command('start', {});
    while (r.host.sim.phase !== 'game') r.advance();
    while (r.host.sim.game.roundStage === 'guide') r.advance();
    let frame = r.guests[0].received.at(-1);
    assert.equal(frame.game.roundStage, 'ready'); assert.equal(frame.game.remaining, 180);
    applyWorld({game: viewer.game, trucks: viewer.trucks, players: viewer.players}, frame);
    assert.equal(roundCue(viewer.game), 'ready-3');
    while (r.host.sim.game.roundStage === 'ready') r.advance();
    frame = r.guests[0].received.at(-1); assert.equal(frame.game.roundStage, 'playing');
    r.host.sim.game.remaining = .001; r.advance();
    frame = r.guests[0].received.at(-1); assert.equal(frame.game.roundStage, 'finish'); assert.equal(frame.game.remaining, 0);
    const count = r.guests[0].results.length; assert.equal(count, 1);
    while (r.host.sim.game.roundStage === 'finish') r.advance();
    frame = r.guests[0].received.at(-1); assert.equal(frame.game.roundStage, 'results'); assert.equal(r.guests[0].results.length, 1);
    applyWorld({game: viewer.game, trucks: viewer.trucks, players: viewer.players}, frame);
    assert.equal(viewer.game.roundStage, 'results'); assert.equal(roundCue(viewer.game), '');
    const saved = new Map();
    const store = new ProgressStore({storage: () => ({ getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => saved.set(k, v) })});
    const receipt = {...r.guests[0].results[0],levelId:'highway-02'};
    await store.record(receipt); await store.record(receipt);
    assert.equal(store.data!.version, '0.5'); assert.equal(store.data!.levels['highway-02'].finishedRuns, 1);
  } finally { r.dispose(); viewer.dispose(); }
});
