// Hidden wobble, knockdown, the shock stun, the get-up guard and the head stomp (docs/domains/wash/WOBBLE.md).
// Identity checks use assert.ok(x === y): a failing equal() on players or tools would print the whole scene graph.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { getLevel } from '../shared/levels.js';
import { packetInput, VERSION } from '../shared/protocol.js';
import { applyPlayer } from '../shared/snapshot.js';
import { quantize } from '../shared/delta.js';
import { SLAP, SLAP_DEFAULT, ANIMAL_SLAP } from '../shared/sim/Slap.js';
import { TOOL_MASS } from '../shared/sim/Mass.js';
import { WOBBLE, hit, shock, tickWobble } from '../shared/sim/Wobble.js';
import { PLAYER_BODY, resolvePlayerContacts } from '../shared/sim/PlayerContacts.js';
import { MOTION } from '../shared/sim/PlayerMotion.js';
import { Simulation } from './fixtures/Simulation.js';
import { enterPlaying } from './helpers/guide.js';

const keys = (down: string[] = [], hits: string[] = down) => packetInput({ seq: 1, move: [0, 0], axis: [0, 0], down, hits });
const DT = 1 / 60;

/** Two players face to face on one deck of the home roof, nothing to pick up in reach. */
function duel() {
  const sim = new Simulation(getLevel('versus-01') as any);
  sim.occupy(0, true); sim.occupy(1, true); sim.setTeam(0, 0); sim.setTeam(1, 1);
  sim.command('start'); enterPlaying(sim);
  const g: any = sim.game, [a, b] = sim.players, home = g.homeTruck;
  for (const tool of g.tools) if (tool.holder) g.drop(tool.holder);
  const place = (p: any, x: number, z: number, yaw: number) => {
    const wx = home.pos.x + x, wz = home.pos.z + z;
    p.pos.set(wx, home.topYAt(wx, wz), wz); p.yaw = yaw; p.externalVelocity.set(0, 0, 0); p.vel.set(0, 0, 0);
    p.state = 'ground'; p.ground = { truck: home, plat: home.platformAt(wx, wz, 0), solid: -1 };
  };
  let found = false;
  for (const x of [-1, 0, 1, -2, -3, -5]) for (const z of [-1.5, -0.5, 0.5, 1.5]) {
    if (found) continue;
    place(a, x, z, 0); place(b, x + 0.8, z, Math.PI);
    if (a.pos.y === b.pos.y && !g.emptyHandTarget(a).tool && !g.nearSoapBox(a)) found = true;
  }
  assert.ok(found, 'a clear spot on the roof');
  return { sim, g, a, b, home };
}
const swing = (g: any, a: any) => { a.slapCooldown = 0; a.slapArmed = true; g.interact(a, keys(['KeyK']), DT); };

test('slap wobble follows the slapper: 16 by default, 14 goose and squirrel, 20 kangaroo; wobble never syncs', () => {
  assert.equal(SLAP_DEFAULT.wobble, 16);
  assert.deepEqual([ANIMAL_SLAP.goose.wobble, ANIMAL_SLAP.squirrel.wobble, ANIMAL_SLAP.kangaroo.wobble], [14, 14, 20]);
  const { sim, g, a, b } = duel();
  try {
    g.random = () => 0.999; // no drop rolls
    swing(g, a); assert.equal(b.wobble, 16);
    a.animal = 'kangaroo'; swing(g, a); assert.equal(b.wobble, 36);
    const data = quantize(sim.snapshot()).players[1];
    assert.equal('wobble' in data, false, 'the wobble value stays on the host');
    assert.equal(VERSION, 42);
  } finally { sim.dispose(); }
});

test('item drop chance equals the wobble after the hit', () => {
  const { sim, g, a, b } = duel();
  try {
    const towel = g.towels[0]; assert.ok(towel.pickup(b));
    g.random = () => 0.17; swing(g, a); // 17 >= 16: kept
    assert.ok(b.heldTool === towel, 'a 16% roll above the bar keeps the item');
    g.random = () => 0.31; swing(g, a); // 31 < 32: dropped
    assert.ok(b.heldTool === null, 'a roll under 32% drops it');
  } finally { sim.dispose(); }
});

test('a full bar knocks down: harder finisher shove, item drops, 2 s without control, half knockback, then a 2 s guard', () => {
  const { sim, g, a, b, home } = duel();
  try {
    g.random = () => 0.999;
    const towel = g.towels[0]; assert.ok(towel.pickup(b));
    b.wobble = 90; swing(g, a);
    assert.equal(b.downRemaining, WOBBLE.knockdownSeconds); assert.equal(b.wobble, 0);
    assert.ok(b.heldTool === null, 'a knockdown always drops the item');
    assert.ok(Math.abs(b.externalVelocity.x - SLAP.speed * 0.8 * WOBBLE.finisherPush / (1 + TOOL_MASS.towel)) < 1e-6, 'finisher shove ×1.5 (the towel was still held)');
    // Knocked down: slaps add no wobble and shove at half.
    b.externalVelocity.set(0, 0, 0); swing(g, a);
    assert.equal(b.wobble, 0); assert.ok(Math.abs(b.externalVelocity.length() - SLAP.speed * 0.8 * WOBBLE.downedPush) < 1e-6);
    // No control: walking and jumping do nothing; J/K is locked.
    b.externalVelocity.set(0, 0, 0); const x = b.pos.x - home.pos.x;
    b.update(DT, 0, { axis: () => ({ x: 1, y: 0 }), worldAxis: () => ({ x: 1, z: 0 }), hit: (k: string) => k === 'Space', down: () => false } as any, g.activeTrucks(), sim.camera, g.base);
    assert.ok(Math.abs(b.pos.x - home.pos.x - x) < 1e-6, 'no walking'); assert.equal(b.state, 'ground', 'no jump');
    g.interact(b, keys(['KeyK']), DT); assert.equal(b.slapSerial, 0);
    for (let i = 0; i < 130; i++) tickWobble(b, DT);
    assert.equal(b.downRemaining, 0); assert.ok(b.guardRemaining > 1.5, 'guard after getting up');
    swing(g, a); assert.equal(b.wobble, 8, 'guard halves wobble');
  } finally { sim.dispose(); }
});

test('wobble drains 20/s after 2 s without a hit', () => {
  const p: any = { wobble: 50, wobbleIdle: 0, downRemaining: 0, stunRemaining: 0, guardRemaining: 0 };
  for (let i = 0; i < 120; i++) tickWobble(p, DT);
  assert.equal(p.wobble, 50, 'no drain inside 2 s');
  for (let i = 0; i < 60; i++) tickWobble(p, DT);
  assert.ok(Math.abs(p.wobble - 30) < 0.5, 'then 20 per second');
});

test('shock is the upper state: it starts over a knockdown (timer reset once) and blocks every hit while it lasts', () => {
  const p: any = { state: 'ground', wobble: 0, downRemaining: 1, stunRemaining: 0, guardRemaining: 0, externalVelocity: new THREE.Vector3(), emit() {} };
  assert.equal(shock(p, 0), true, 'a shock while knocked down stuns at once');
  assert.equal(p.stunRemaining, WOBBLE.shockSeconds); assert.equal(p.downRemaining, WOBBLE.knockdownSeconds);
  assert.equal(hit(p, 50, new THREE.Vector3(1, 0, 0)), null, 'nothing applies while shock-stunned');
  assert.equal(shock(p, 1), false, 'no re-stun while stunned');
});

test('head stomp: a normal landing bounces with the own jump, adds 30 (not again within 1 s) and shoves a little; gliders settle', () => {
  const { sim, g, a, b } = duel();
  try {
    g.random = () => 0.999;
    const drop = () => {
      a.state = 'air'; a.ground = null; a.vel.set(0.5, -2, 0); a.gliding = false;
      a.pos.set(b.pos.x + 0.05, b.pos.y + PLAYER_BODY.height - 0.02, b.pos.z);
      return [new THREE.Vector3(a.pos.x, b.pos.y + PLAYER_BODY.height + 0.05, a.pos.z), b.pos.clone()];
    };
    resolvePlayerContacts([a, b], drop(), DT, null, g.random);
    assert.equal(a.state, 'air'); assert.ok(Math.abs(a.vel.y - MOTION.jump) < 1e-6, 'bounced with a normal jump');
    assert.equal(a.stompSerial, 1); assert.equal(b.stompedSerial, 1); assert.equal(b.slappedBy, 0);
    assert.equal(b.wobble, WOBBLE.stomp);
    assert.ok(Math.abs(b.externalVelocity.length() - SLAP.speed * 0.8 * WOBBLE.stompPush) < 1e-6, 'a small shove');
    resolvePlayerContacts([a, b], drop(), DT, null, g.random);
    assert.equal(a.stompSerial, 2, 'still bounces'); assert.equal(b.wobble, WOBBLE.stomp, 'no wobble again within 1 s');
    for (let i = 0; i < 61; i++) tickWobble(a, DT);
    resolvePlayerContacts([a, b], drop(), DT, null, g.random); assert.equal(b.wobble, 2 * WOBBLE.stomp, 'after 1 s it counts again');
    // A glider lands softly on the head: no bounce, no hit.
    const before = b.stompedSerial; const prev = drop(); a.gliding = true;
    resolvePlayerContacts([a, b], prev, DT, null, g.random);
    assert.equal(a.state, 'ground'); assert.equal(a.ground.stand, 1); assert.equal(b.stompedSerial, before);
    // Prediction (onlyPlayer) bounces its own body but never lands a hit.
    a.state = 'air'; a.ground = null; const w = b.wobble; const p2 = drop(); for (let i = 0; i < 61; i++) tickWobble(a, DT);
    resolvePlayerContacts([a, b], p2, DT, a, null); assert.ok(a.vel.y > 0); assert.equal(b.wobble, w);
  } finally { sim.dispose(); }
});

test('knockdown, guard and stomp serials survive the snapshot; the hidden wobble does not', () => {
  const { sim, g, a, b } = duel();
  const peer = new Simulation(getLevel('versus-01') as any);
  try {
    g.random = () => 0.999; b.wobble = 95; swing(g, a);
    const data = quantize(sim.snapshot());
    data.players.forEach((state: any, i: number) => applyPlayer(peer.players[i], state, peer.trucks));
    assert.ok(peer.players[1].downRemaining > 1.9); assert.equal(peer.players[1].downSerial, 1);
    assert.equal(peer.players[1].wobble || 0, 0);
  } finally { sim.dispose(); peer.dispose(); }
});
