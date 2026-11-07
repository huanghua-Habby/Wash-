/** Browser-hosted authority over direct links, with an in-memory data channel pair (lossy and reordering on demand). */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HostAuthority } from '../client/js/online/HostAuthority.js';
import { quantize, SnapshotEncoder, SnapshotDecoder } from '../shared/delta.js';
import { STATE_CHANNEL, CONTROL_CHANNEL } from '../shared/protocol.js';
import { FakeLink, room, member, rosterOf } from './helpers/peerRoom.js';

const sample = (seq: number, axis = [0, 0], down: string[] = [], hits: string[] = []) => ({ seq, move: axis, axis, down, hits });

test('alone, the host simulates locally and sends nothing on any channel',() => {
  const events: any[] = [];
  const host = new HostAuthority({ emit: (type: string, detail: any) => events.push(type), signal() { throw new Error('no signaling for a solo room'); } });
  try {
    host.setRoster(rosterOf([member('host', 0)]));
    for (let i = 0; i < 120; i++) host.advance();
    assert.equal(host.connectedGuests().length, 0); assert.equal(host.state().mode, 'solo');
    assert.ok(events.filter((t) => t === 'snapshot').length >= 40, 'the page still gets local presentation snapshots');
  } finally { host.dispose(); }
});

test('a joining guest resets practice, opens a link and rebuilds the exact host world from keyframes and acknowledged deltas',() => {
  const r = room(['g1']);
  try {
    assert.equal(r.host.epoch, 2, 'arrival starts a fresh practice epoch');
    assert.equal(r.host.state().mode, 'multiplayer');
    const g = r.guests[0];
    for (let i = 1; i <= 60; i++) { g.guest.sendInput(sample(i, [0.5, 0.3])); r.advance(); }
    const last = g.received.at(-1);
    assert.ok(r.host.sim.tickCount - last.tick <= 1);
    assert.deepEqual(last, r.view(g, last.tick), 'the guest holds exactly the host state (its wire view) of the newest tick it received');
    // 30 Hz plus urgent sends; the opening keyframe(s) travel on the reliable control channel instead (HostAuthority.publish).
    assert.ok(g.hostLink.sent[STATE_CHANNEL] >= 27 && g.hostLink.sent[STATE_CHANNEL] <= 45, `30 Hz plus urgent sends (${g.hostLink.sent[STATE_CHANNEL]})`);
    assert.ok(r.host.sim.players[1].pos.distanceTo(new THREE.Vector3()) > 0 && r.host.sim.acks[1] === 60);
  } finally { r.dispose(); }
});

test('a guest link drives only its registry slot, and inputs from another epoch are ignored',() => {
  const r = room(['g1', 'g2']);
  try {
    for (let i = 0; i < 90; i++) r.host.advance();
    const onTruck = () => r.host.sim.players.map((p: any) => { const d = p.pos.clone().sub(r.host.sim.trucks[0].pos); d.y = 0; return d; });
    const before = onTruck();
    const [g1] = r.guests;
    // A guest cannot pick a slot: extra fields are not part of the input contract.
    g1.link.send(STATE_CHANNEL, { type: 'input', epoch: r.host.epoch, slot: 0, inputs: [{ ...sample(1, [1, 0]), slot: 2 }] });
    g1.link.send(STATE_CHANNEL, { type: 'input', epoch: r.host.epoch - 1, inputs: [sample(2, [0, 1])] });
    for (let i = 0; i < 20; i++) r.host.advance();
    const after = onTruck();
    assert.ok(after[1].distanceTo(before[1]) > 0.5, 'slot 1 moved');
    for (const slot of [0, 2]) assert.ok(after[slot].distanceTo(before[slot]) < 0.01, `slot ${slot} untouched`);
    assert.equal(r.host.sim.acks[1], 1, 'the stale-epoch sample was never applied');
  } finally { r.dispose(); }
});

test('with 30 % loss and reordering, button edges arrive through redundancy and snapshots never decode wrong',() => {
  const r = room(['g1']);
  try {
    const g = r.guests[0];
    g.link.loss = 0.3; g.link.reorder = true; g.hostLink.loss = 0.3; g.hostLink.reorder = true;
    for (let i = 0; i < 90; i++) r.host.advance();
    let jumped = false;
    for (let seq = 1; seq <= 40; seq++) {
      g.guest.sendInput(seq === 5 ? sample(seq, [0, 0], ['Space'], ['Space']) : sample(seq));
      r.host.advance(); jumped ||= r.host.sim.players[1].state === 'air';
    }
    assert.ok(jumped, 'the single Space press was applied despite losing messages');
    g.link.loss = g.hostLink.loss = 0; g.link.reorder = g.hostLink.reorder = false;
    for (let i = 0; i < 12; i++) { g.guest.sendInput(sample(41 + i)); r.advance(); }
    const last = g.received.at(-1);
    assert.ok(r.host.sim.tickCount - last.tick <= 1); assert.deepEqual(last, r.view(g, last.tick));
  } finally { r.dispose(); }
});

test('two guests grabbing the same towel in one tick: one owner, and every browser agrees',() => {
  const r = room(['g1', 'g2']);
  try {
    for (let i = 0; i < 90; i++) r.host.advance();
    const sim = r.host.sim, towel = sim.game.towels[0], spot = towel.mesh.getWorldPosition(new THREE.Vector3()), truck = sim.trucks[0];
    for (const slot of [1, 2]) { const p = sim.players[slot]; p.state = 'ground'; p.ground = { truck, plat: truck.platforms[0] }; p.pos.set(spot.x, truck.topY, spot.z); p.vel.set(0, 0, 0); }
    for (const g of r.guests) g.guest.sendInput(sample(1, [0, 0], ['KeyJ'], ['KeyJ']));
    r.host.advance();
    for (let i = 0; i < 6; i++) { for (const g of r.guests) g.guest.sendInput(sample(2 + i)); r.host.advance(); }
    const holders = sim.players.filter((p: any) => p.heldTool === towel);
    assert.equal(holders.length, 1, 'exactly one owner');
    const holder = sim.players.indexOf(holders[0]);
    for (const g of r.guests) assert.equal(g.received.at(-1).game.towels[0].holder, holder);
  } finally { r.dispose(); }
});

test('round results come only from the host, reach every participant and are re-sent until acknowledged',() => {
  const r = room(['g1']);
  try {
    const g = r.guests[0];
    assert.equal(r.host.command('start', {}), null);
    // A forged result for a round the host never started is ignored by the guest.
    g.hostLink.send(CONTROL_CHANNEL, { type: 'round_result', saveVersion: '0.3', roundId: 'forged', levelId: r.host.levelId, score: 999, completedOrders: 9 });
    assert.equal(g.results.length, 0);
    r.host.sim.game.score = 40; r.host.sim.game.completed = 2; r.host.sim.game.finish('time_up'); r.host.advance(); r.host.advance();
    assert.equal(r.events.filter((e) => e.type === 'round_result').length, 1, 'issued once to the host page');
    assert.equal(g.results.length, 1); assert.equal(g.results[0].score, 40); assert.equal(g.results[0].roundId, r.host.roundId);
    assert.equal(r.host.receipts.get('g1')?.size, 1);
    g.guest.sendControl({ type: 'result_ack', roundId: r.host.roundId });
    assert.equal(r.host.receipts.get('g1')?.size, 0);
    assert.equal(r.host.command('start', {}), '当前关卡已经出发');
  } finally { r.dispose(); }
});

test('a host waits for teammates\' links before starting, and turns away a guest who slips in after departure',() => {
  const r = room(['g1']);
  try {
    r.guests[0].link.close('gone');
    assert.match(String(r.host.command('start', {})), /队友/);
    r.host.setRoster(rosterOf(r.members.slice(0, 1)));
    assert.equal(r.host.command('start', {}), null);
    const epoch = r.host.epoch;
    r.host.setRoster(rosterOf([...r.members.slice(0, 1), member('late', 1)]));
    assert.ok(r.events.some((e) => e.type === 'turn_away' && e.detail === 'late'));
    assert.equal(r.host.epoch, epoch, 'the running round was not reset'); assert.equal(r.host.sim.phase, 'transition');
  } finally { r.dispose(); }
});

test('acknowledged deltas: an unacknowledged guest keeps getting keyframes; deltas only build on what it holds',() => {
  const encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder();
  const state = (tick: number, x: number) => quantize({ tick, players: [{ pos: [x, 0, 0], held: null }], game: { score: tick } });
  const f1 = encoder.encode(state(1, 1), 'R:1'), f2 = encoder.encode(state(2, 2), 'R:1');
  assert.ok(f1.data && f2.data, 'no ack yet');
  assert.deepEqual(decoder.decode(f2), state(2, 2)); assert.equal(decoder.decode(f1), null, 'older than held: obsolete');
  encoder.ack(2);
  const f3 = encoder.encode(state(3, 3), 'R:1'); assert.equal(f3.base, 2); assert.ok(!('data' in f3));
  assert.deepEqual(decoder.decode(f3), state(3, 3));
  assert.ok(encoder.encode(state(1, 0), 'R:2').data, 'a new epoch scope starts from a keyframe');
});

test('a congested state channel skips snapshots instead of queueing them, then resumes at the newest state',() => {
  const r = room(['g1']);
  try {
    const g = r.guests[0];
    for (let i = 0; i < 12; i++) r.advance();
    const sent = g.hostLink.sent[STATE_CHANNEL];
    g.hostLink.buffered = () => 1 << 20;
    for (let i = 0; i < 30; i++) r.advance();
    assert.equal(g.hostLink.sent[STATE_CHANNEL], sent, 'nothing is queued behind a backed-up channel');
    g.hostLink.buffered = () => 0;
    for (let i = 0; i < 3; i++) r.advance();
    const last = g.received.at(-1);
    assert.ok(r.host.sim.tickCount - last.tick <= 2); assert.deepEqual(last, r.view(g, last.tick));
  } finally { r.dispose(); }
});
