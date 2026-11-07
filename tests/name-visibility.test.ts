import test from 'node:test';
import assert from 'node:assert/strict';
import { NameVisibility } from '../client/js/ui/NameVisibility.js';
import { Simulation } from './fixtures/Simulation.js';
const game = { phase: 'game', active: true, ended: false, elapsed: 0, dt: 0 };

test('motion disabled switches ID visibility immediately while preserving authority and manual display timing', () => {
  const names = new NameVisibility(), state = { ...game, motionEnabled: false };
  assert.equal(names.update({ ...state, phase: 'home' }), 1);
  assert.equal(names.update({ ...state, phase: 'transition' }), 0);
  assert.equal(names.update({ ...state, elapsed: 2.4 }), 1);
  assert.equal(names.update({ ...state, elapsed: 2.6 }), 0);
  names.showTemporarily();
  assert.equal(names.update({ ...state, elapsed: 40, dt: 2.6 }), 1);
  assert.equal(names.update({ ...state, elapsed: 40, dt: 0.3 }), 0);
});

test('names fade at entry, wait for authority countdown, then show once for 2.5 seconds', () => {
  const names = new NameVisibility();
  assert.equal(names.update({ ...game, phase: 'home', active: false }), 1);
  assert.ok(names.update({ ...game, phase: 'transition', active: false, dt: 0.1 }) < 1);
  assert.equal(names.update({ ...game, phase: 'transition', active: false, dt: 0.2 }), 0);
  for (let i = 0; i < 100; i++) assert.equal(names.update({ ...game, dt: 0.1 }), 0, 'Ready without countdown never shows names');
  assert.equal(names.update({ ...game, elapsed: 0.02 }), 1);
  assert.equal(names.update({ ...game, elapsed: 2.4 }), 1);
  assert.ok(names.update({ ...game, elapsed: 2.65 }) < 1);
  assert.equal(names.update({ ...game, elapsed: 3 }), 0);
  assert.equal(names.update({ ...game, elapsed: 40 }), 0);
  assert.equal(names.update({ ...game, elapsed: 0.1, ended: true }), 0, 'TimeUp never starts an automatic intro');
  assert.equal(names.update({ ...game, phase: 'home', active: false }), 1);
});

test('Tab shows names temporarily, refreshes its duration and expires while gameplay is paused', () => {
  const names = new NameVisibility(), state = { ...game, elapsed: 40 };
  names.update(state); names.showTemporarily();
  assert.equal(names.update({ ...state, dt: 2 }), 1);
  names.showTemporarily(); assert.equal(names.update({ ...state, dt: 2 }), 1);
  assert.ok(names.update({ ...state, dt: 0.65 }) < 1);
  assert.equal(names.update({ ...state, dt: 0.25 }), 0);
  names.showTemporarily(); names.update({ ...state, phase: 'home', active: false });
  assert.equal(names.update(state), 0, 'manual request cannot leak into another round');
});

test('authority play time is frozen before start and during pause/end, and shared in snapshots', () => {
  const sim = new Simulation();
  try {
    for (let i = 0; i < 60; i++) sim.tick(); assert.equal(sim.snapshot().game.elapsed, 0);
    sim.command('start'); for (let i = 0; i < 60; i++) sim.tick(); assert.equal(sim.snapshot().game.elapsed, 0);
    for (let i = 0; i < 340; i++) sim.tick(); assert.ok(sim.game.elapsed > 0);
    sim.command('pause', true); const elapsed = sim.game.elapsed;
    for (let i = 0; i < 60; i++) sim.tick(); assert.equal(sim.snapshot().game.elapsed, elapsed);
    sim.command('pause', false); sim.tick(); assert.ok(sim.game.elapsed > elapsed);
    sim.game.remaining = 0.01; sim.tick(); const finished = sim.game.elapsed;
    sim.tick(); assert.equal(sim.snapshot().game.elapsed, finished);
  } finally { sim.dispose(); }
});

test('finishing cancels a pending Tab reveal in both motion modes', () => {
  for (const motionEnabled of [true, false]) {
    const names = new NameVisibility();
    names.showTemporarily();
    assert.equal(names.update({ ...game, elapsed: 40, ended: true, motionEnabled }), 0);
    assert.equal(names.manualRemaining, 0);
    assert.equal(names.update({ ...game, elapsed: 40, motionEnabled }), 0);
  }
});
