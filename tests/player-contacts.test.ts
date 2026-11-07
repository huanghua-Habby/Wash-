import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from './fixtures/Simulation.js';
import { PLAYER_BODY, resolvePlayerContacts } from '../shared/sim/PlayerContacts.js';
import { NetworkGame } from '../client/js/online/NetworkGame.js';
import { applyWorld, applyPlayer } from '../shared/snapshot.js';
import { quantize, diff, patch } from '../shared/delta.js';
import { TICK_SECONDS, VERSION } from '../shared/protocol.js';
import { SAVE_VERSION } from '../shared/levels.js';
import { getLevel } from '../shared/levels.js';

const diameter = PLAYER_BODY.radius * 2;
function setup(count = 2, level?: any) {
  const sim = new Simulation(level);
  for (let slot = 0; slot < count; slot++) sim.occupy(slot, true);
  const truck = sim.trucks[0];
  const place = (slot: number, x: number, z = 0, y = truck.topY) => {
    const p = sim.players[slot]; p.state = 'ground'; p.pos.set(truck.pos.x + x, y, truck.pos.z + z);
    p.ground = { truck, plat: truck.platformAt(p.pos.x, p.pos.z, 0.3) };
    p.vel.set(0, 0, 0); p.externalVelocity.set(0, 0, 0); p.root.position.copy(p.pos);
    return p;
  };
  for (let slot = 0; slot < count; slot++) place(slot, -3 + slot * diameter);
  let seq = 0;
  const tick = (moves: number[][] = []) => {
    seq++;
    for (let slot = 0; slot < count; slot++) sim.input(slot, { seq, move: moves[slot] || [0, 0], axis: [0, 0], down: [], hits: [] });
    sim.tick();
  };
  return { sim, truck, place, tick };
}

test('walking into a teammate pushes both solid bodies; stopping does not create a bounce', () => {
  const { sim, tick } = setup();
  try {
    const [a, b] = sim.players, start = b.pos.x, signature = sim.urgentSignature();
    tick([[1, 0]]);
    assert.ok(b.pos.x > start); assert.ok(b.pos.x - a.pos.x >= diameter - 1e-6);
    assert.notEqual(sim.urgentSignature(), signature, 'first contact sends an urgent snapshot');
    for (let i = 0; i < 20; i++) tick([[1, 0]]);
    assert.ok(b.pos.x - start > 0.5, 'holding movement keeps pushing the teammate'); // walk is 0.64 of the old speed
    const gap = b.pos.x - a.pos.x;
    for (let i = 0; i < 20; i++) tick();
    assert.ok(Math.abs((b.pos.x - a.pos.x) - gap) < 1e-6);
    assert.equal(a.externalVelocity.lengthSq() + b.externalVelocity.lengthSq(), 0);
  } finally { sim.dispose(); }
});

test('equal head-on movement blocks penetration; an elephant resists and wins the same contest', () => {
  const displacement = (animal: string) => {
    const { sim, tick, truck } = setup();
    try {
      sim.setAnimal(0, animal);
      const a = sim.players[0], start = a.pos.x - truck.pos.x;
      for (let i = 0; i < 30; i++) {
        tick([[1, 0], [-1, 0]]);
        assert.ok(sim.players[1].pos.x - a.pos.x >= diameter - 1e-6);
      }
      return a.pos.x - truck.pos.x - start;
    } finally { sim.dispose(); }
  };
  assert.ok(Math.abs(displacement('cat')) < 1e-6);
  assert.ok(displacement('elephant') > 0.35, 'body contacts reuse existing animal mass');
});

test('four coincident bodies separate deterministically without explosive impulses', () => {
  const run = () => {
    const { sim, place } = setup(4);
    try {
      for (let i = 0; i < 4; i++) place(i, -2);
      const before = sim.players.map((p: any) => p.pos.clone());
      resolvePlayerContacts(sim.players, before, TICK_SECONDS);
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++)
        assert.ok(sim.players[i].pos.distanceTo(sim.players[j].pos) >= diameter - 0.002);
      assert.ok(sim.players.every((p: any) => p.state === 'ground' && p.vel.lengthSq() === 0 && p.externalVelocity.lengthSq() === 0));
      return sim.players.map((p: any) => p.pos.toArray());
    } finally { sim.dispose(); }
  };
  assert.deepEqual(run(), run());
});

test('a jump clears another body; absent, swallowed, fallen and returning players do not block', () => {
  const { sim, place } = setup();
  try {
    const a = place(0, -2), b = place(1, -2);
    b.state = 'air'; b.ground = null; b.pos.y = a.pos.y + PLAYER_BODY.height + 0.01;
    const run = () => resolvePlayerContacts(sim.players, sim.players.map((p: any) => p.pos.clone()), TICK_SECONDS);
    assert.equal(run(), 0);
    for (const state of ['fallen', 'returning', 'swallowed']) {
      b.state = state; b.pos.copy(a.pos); assert.equal(run(), 0, state);
    }
    b.state = 'ground'; b.occupied = false; assert.equal(run(), 0);
    b.occupied = true; b.sceneReady = false; assert.equal(run(), 0);
    b.sceneReady = true; b.swallowedBy = a; assert.equal(run(), 0);
    b.swallowedBy = null; b.ground = a.ground; b.pos.y = a.pos.y + 0.4; b.state = 'air';
    assert.notEqual(run(), 0, 'a low jump still contacts the other body');
  } finally { sim.dispose(); }
});

test('a body shove over the edge detaches immediately and the fall reaches peers via existing snapshot deltas', () => {
  const { sim, place, tick, truck } = setup(), peer = new Simulation();
  try {
    place(1, -2, truck.halfWidth + 0.3 - 0.01);
    place(0, -2, truck.halfWidth + 0.3 - 0.01 - diameter);
    const before = quantize(sim.snapshot()); tick([[0, 1]]);
    const pushed = sim.players[1];
    assert.equal(pushed.state, 'air'); assert.equal(pushed.ground, null);
    assert.ok(pushed.vel.z > 0, 'the shove carries horizontal momentum off the edge');
    const state = patch(before, diff(before, quantize(sim.snapshot())));
    applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, state);
    state.players.forEach((p: any, slot: number) => applyPlayer(peer.players[slot], p, peer.trucks));
    assert.equal(peer.players[1].state, 'air'); assert.equal(peer.players[1].ground, null);
    assert.ok(peer.players[1].pos.distanceTo(pushed.pos) < 0.001);
    for (let i = 0; i < 90 && pushed.state !== 'fallen'; i++) tick();
    assert.equal(pushed.state, 'fallen');
    assert.equal(VERSION, 42); assert.equal(SAVE_VERSION, '0.5');
  } finally { sim.dispose(); peer.dispose(); }
});

test('local prediction uses the shared contact solver without changing a remote body or ownership', () => {
  const { sim: host } = setup(), client = new Simulation();
  const connection: any = new EventTarget(); connection.room = { slot: 0 }; connection.connected = true; connection.playing = true;
  const network = new NetworkGame({ connection, players: client.players, trucks: client.trucks, game: client.game, camera: client.camera,
    input: { clear() {}, hit() { return false; }, down() { return false; }, axis() { return { x: 0, y: 0 }; } }, onPhase() {} });
  try {
    network.receive(host.snapshot());
    const p = client.players[0], remote = client.players[1], before = remote.pos.clone(), start = p.pos.clone();
    network.predictTick(p, { seq: 1, move: [1, 0], axis: [0, 0], down: [], hits: [] }, host.time);
    assert.ok(p.pos.x > start.x && p.pos.x - start.x < 5.5 * TICK_SECONDS * 0.8, 'predict the local contact slowdown');
    assert.deepEqual(remote.pos.toArray(), before.toArray(), 'a guest never confirms another player being pushed');
    assert.equal(remote.heldTool, null);
    // A delayed drawn position cannot make the newest authority body disappear from prediction.
    remote.pos.z += 30;
    p.pos.copy(start); p.root.position.copy(start);
    network.predictTick(p, { seq: 1, move: [1, 0], axis: [0, 0], down: [], hits: [] }, host.time);
    assert.ok(p.pos.x - start.x < 5.5 * TICK_SECONDS * 0.8);
  } finally { host.dispose(); client.dispose(); }
});

test('eight-player contact flags give every pair its own bit (no 32-bit shift wrap)', () => {
  const { sim, place } = setup(8, getLevel('versus-01'));
  try {
    const touching = (pairs: number[][]) => {
      for (let slot = 0; slot < 8; slot++) place(slot, -3 + (slot % 4) * 2, slot < 4 ? -1.5 : 1.5);
      for (const [a, b] of pairs) { const p = sim.players[a]; place(b, p.pos.x - sim.trucks[0].pos.x + diameter * 0.9, p.pos.z - sim.trucks[0].pos.z); }
      return resolvePlayerContacts(sim.players, sim.players.map((p: any) => p.pos.clone()), TICK_SECONDS);
    };
    const seen = new Set<number>();
    for (const pair of [[0, 1], [0, 5], [4, 5], [6, 7], [2, 7]]) {
      const mask = touching([pair]);
      assert.ok(mask > 0, `${pair} touches`); assert.ok(!seen.has(mask), `${pair} has a distinct flag`); seen.add(mask);
    }
    assert.equal(touching([[0, 1], [6, 7]]), touching([[0, 1]]) + touching([[6, 7]]));
  } finally { sim.dispose(); }
});
