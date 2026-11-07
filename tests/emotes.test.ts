import test from 'node:test';
import assert from 'node:assert/strict';
import { EMOTES, EMOTE_SECONDS, emoteDirection, validEmote } from '../shared/emotes.js';
import { applyPlayer } from '../shared/snapshot.js';
import { quantize } from '../shared/delta.js';
import { VERSION } from '../shared/protocol.js';
import { SAVE_VERSION } from '../shared/levels.js';
import { Simulation } from './fixtures/Simulation.js';
import { room } from './helpers/peerRoom.js';
import { EmoteWheel } from '../client/js/ui/EmoteWheel.js';

test('eight wheel directions map W, W+A, A, A+S, S, S+D, D, D+W to the eight emotes; no direction picks none', () => {
  const keys: [number, number][] = [[0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1]];
  assert.deepEqual(keys.map(([x, y]) => EMOTES[emoteDirection(x, y)]), ['nice', 'hi', 'help', 'here', 'sad', 'laugh', 'angry', 'wow']);
  assert.equal(emoteDirection(0, 0), -1); assert.equal(emoteDirection(0.2, 0.1), -1, 'a stick inside the dead zone');
  assert.equal(emoteDirection(NaN, 1), -1);
  assert.ok(validEmote({ type: 'emote', epoch: 3, id: 'wow' }));
  assert.ok(!validEmote({ type: 'emote', epoch: 3, id: 'dance' }) && !validEmote({ type: 'emote', id: 'wow' }));
  assert.equal(VERSION, 42); assert.equal(SAVE_VERSION, '0.5', 'emotes are never saved');
});

test('the host applies an emote with a one-second cooldown, clears it after 2.5 s even while paused, and signs it urgently', () => {
  const sim = new Simulation();
  try {
    sim.occupy(0, true); sim.tick();
    const p = sim.players[0], before = sim.urgentSignature();
    assert.equal(sim.emote(0, 'dance'), false, 'unknown id');
    assert.equal(sim.emote(1, 'hi'), false, 'empty seat');
    assert.equal(sim.emote(0, 'hi'), true);
    assert.deepEqual([p.emoteId, p.emoteSerial], ['hi', 1]);
    assert.notEqual(sim.urgentSignature(), before, 'the emote goes out the tick it happens');
    assert.equal(sim.emote(0, 'wow'), false, 'cooldown');
    for (let i = 0; i < 60; i++) sim.tick();
    assert.equal(sim.emote(0, 'wow'), true, 'cooldown over after 1 s'); assert.equal(p.emoteSerial, 2);
    sim.command('start'); sim.command('pause', true);
    for (let i = 0; i < EMOTE_SECONDS * 60 - 1; i++) sim.tick();
    assert.equal(p.emoteId, 'wow');
    sim.tick(); assert.equal(p.emoteId, '', 'a paused world does not hold the bubble');
    sim.emote(0, 'sad'); sim.occupy(0, false); assert.equal(p.emoteId, '', 'leaving clears it');
  } finally { sim.dispose(); }
});

test('a guest emote acts only for its own link slot and reaches other pages through the snapshot', () => {
  const r = room(['a', 'b']);
  try {
    const { host } = r, [a] = r.guests;
    for (let i = 0; i < 30; i++) r.advance();
    a.guest.sendControl({ type: 'emote', epoch: host.epoch, id: 'help', slot: 2 });
    assert.equal(host.sim.players[1].emoteId, 'help', 'guest a emoted from its own slot');
    assert.equal(host.sim.players[2].emoteId, '', 'a slot field in the frame is ignored');
    r.guests[1].guest.sendControl({ type: 'emote', epoch: host.epoch - 1, id: 'sad' });
    r.guests[1].guest.sendControl({ type: 'emote', epoch: host.epoch, id: 'dance' });
    assert.equal(host.sim.players[2].emoteId, '', 'stale epochs and unknown ids are ignored');
    assert.equal(host.emote(host.slot, 'laugh'), true, 'the host page uses the same entry');
    const peer = new Simulation();
    try {
      const data = quantize(host.sim.snapshot());
      data.players.forEach((state: any, i: number) => applyPlayer(peer.players[i], state, peer.trucks));
      assert.deepEqual([peer.players[0].emoteId, peer.players[1].emoteId], ['laugh', 'help']);
      assert.ok(peer.players[1].emoteRemaining > 0 && peer.players[1].emoteRemaining <= EMOTE_SECONDS);
      assert.equal(peer.players[1].emoteSerial, 1);
    } finally { peer.dispose(); }
  } finally { r.dispose(); }
});

test('the wheel holds movement while open, keeps a diagonal through key release, sends on U release and cancels without a pick', () => {
  const previous = (globalThis as any).document;
  const node = (): any => ({ hidden: false, dataset: {}, style: {}, classList: { toggle() {} }, attrs: {} as any,
    setAttribute(k: string, v: string) { this.attrs[k] = v; }, getAttribute(k: string) { return this.attrs[k] ?? null; },
    append() {}, appendChild() {}, replaceChildren() {}, remove() {} });
  (globalThis as any).document = { createElement: node, createElementNS: node, getElementById: node };
  try {
    const sent: string[] = [];
    let clock = 0;
    const wheel = new EmoteWheel({ hide() {}, place() {} }, (id: string) => sent.push(id), () => clock);
    const input = { u: false, axis: { x: 0, y: 0 }, holdMovement: false, emoteHeld() { return this.u; }, rawAxis() { return this.axis; } };
    const frame = (u: boolean, x: number, y: number, allowed = true) => { clock += 16; input.u = u; input.axis = { x, y }; wheel.handle(input, allowed); };
    frame(true, 0, 0); assert.equal(wheel.open, true); assert.equal(input.holdMovement, true);
    frame(true, -1, -1); assert.equal(wheel.selected, 1, 'W+A');
    frame(true, -1, 0); frame(true, -1, 0); frame(true, 0, 0); assert.equal(wheel.selected, 1, 'W lifted a moment before A keeps W+A');
    frame(true, -1, -1); for (let i = 0; i < 9; i++) frame(true, -1, 0); assert.equal(wheel.selected, 2, 'holding A alone past the grace picks A');
    frame(true, 1, 0); assert.equal(wheel.selected, 6, 'a fresh press applies at once');
    frame(true, 1, -1); frame(true, 0, -1); frame(true, 0, 0); assert.equal(wheel.selected, 7, 'D+W kept through release');
    frame(true, -1, -1);
    frame(false, 0, 0); assert.deepEqual(sent, ['hi']); assert.equal(wheel.open, false); assert.equal(input.holdMovement, false);
    frame(true, 0, 0); frame(false, 0, 0); assert.deepEqual(sent, ['hi'], 'no pick cancels');
    frame(true, 1, 0); frame(true, 1, 0, false); assert.equal(wheel.open, false, 'a modal closes the wheel');
    assert.equal(input.holdMovement, false); assert.deepEqual(sent, ['hi'], 'and sends nothing');
  } finally { (globalThis as any).document = previous; }
});

test('a fallen or swallowed player can still emote: the host applies it and peers receive it for the countdown bubble', () => {
  const sim = new Simulation(), peer = new Simulation();
  try {
    sim.occupy(0, true); sim.occupy(1, true); sim.tick();
    const [p, q] = sim.players;
    p.state = 'fallen'; p.fallTimer = 2;
    assert.equal(sim.emote(0, 'help'), true, 'fallen');
    q.state = 'swallowed';
    assert.equal(sim.emote(1, 'sad'), true, 'swallowed');
    const data = quantize(sim.snapshot());
    data.players.forEach((state: any, i: number) => applyPlayer(peer.players[i], state, peer.trucks));
    assert.deepEqual([peer.players[0].emoteId, peer.players[1].emoteId], ['help', 'sad']);
    assert.ok(peer.players[0].emoteRemaining > 0);
  } finally { sim.dispose(); peer.dispose(); }
});
