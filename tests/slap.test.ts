import test from 'node:test';
import assert from 'node:assert/strict';
import { getLevel } from '../shared/levels.js';
import { packetInput, VERSION } from '../shared/protocol.js';
import { applyPlayer } from '../shared/snapshot.js';
import { quantize } from '../shared/delta.js';
import { SLAP, SLAP_DEFAULT, ANIMAL_SLAP, slapProfile, slapTarget } from '../shared/sim/Slap.js';
import { Simulation } from './fixtures/Simulation.js';
import { enterPlaying } from './helpers/guide.js';

const keys = (down: string[] = [], hits: string[] = down) => packetInput({ seq: 1, move: [0, 0], axis: [0, 0], down, hits });
const DT = 1 / 60;

/** Two players face to face on the home roof, far from tools and the soap box unless a test moves them. */
function duel(level = 'versus-01') {
  const sim = new Simulation(getLevel(level) as any);
  sim.occupy(0, true); sim.occupy(1, true);
  if (sim.mode === 'versus') { sim.setTeam(0, 0); sim.setTeam(1, 0); }
  sim.command('start'); enterPlaying(sim);
  const g: any = sim.game, [a, b] = sim.players, home = g.homeTruck;
  for (const tool of g.tools) if (tool.holder) g.drop(tool.holder);
  const spot = (x: number, z: number) => ({ x: home.pos.x + x, y: home.topYAt(home.pos.x + x, home.pos.z + z), z: home.pos.z + z });
  const place = (p: any, x: number, z: number, yaw: number) => { const s = spot(x, z); p.pos.set(s.x, s.y, s.z); p.yaw = yaw; p.externalVelocity.set(0, 0, 0);
    p.state = 'ground'; p.ground = { truck: home, plat: home.platformAt(s.x, s.z, 0), solid: -1 }; };
  // Find a clear spot: nothing to pick up in reach of A, so J is free to slap.
  let found = false;
  for (const x of [-1, 0, 1, -2, -3, -5]) for (const z of [-1.5, -0.5, 0.5, 1.5]) {
    if (found) continue;
    place(a, x, z, 0); place(b, x + 0.8, z, Math.PI);
    // Both on one deck level (the new washer has a low rear deck), nothing to pick up in reach.
    if (a.pos.y === b.pos.y && !g.emptyHandTarget(a).tool && !g.nearSoapBox(a)) found = true;
  }
  assert.ok(found, 'a clear spot on the roof');
  return { sim, g, a, b, place };
}

test('empty-handed K slaps the nearest body in front, shoving it about 1.44 m and the slapper back 0.32 m (character scale); teammates are hit too', () => {
  const { sim, g, a, b } = duel();
  try {
    assert.equal(a.team, b.team, 'same team');
    const start = b.pos.clone();
    g.interact(a, keys(['KeyK']), DT);
    assert.equal(a.slapSerial, 1); assert.equal(b.slappedSerial, 1);
    // Base shove 1.8 m at full size (×1.2 of 1.5 m, 2026-10-20), × character scale 0.8 = 1.44 m; recoil 0.4 × 0.8 = 0.32 m.
    assert.ok(b.externalVelocity.x > 14.3, 'shoved away from the slapper');
    // Let the shove play out without other actors: the decay integrates to v/10.
    assert.ok(Math.abs(b.externalVelocity.length() / 10 - 1.8 * 0.8) < 0.02, 'about 1.44 m between equal weights');
    assert.ok(a.externalVelocity.x < -3.1 && Math.abs(a.externalVelocity.length() / 10 - 0.4 * 0.8) < 0.02, 'the slapper bounces back about 0.32 m');
    assert.ok(b.pos.equals(start));
  } finally { sim.dispose(); }
});

test('held K repeats only after the 0.5 s cooldown; misses count as swings', () => {
  const { sim, g, a, b } = duel();
  try {
    g.interact(a, keys(['KeyK']), DT);
    for (let i = 0; i < 29; i++) g.interact(a, keys(['KeyK'], []), DT);
    assert.equal(a.slapSerial, 1, 'still cooling down');
    g.interact(a, keys(['KeyK'], []), DT); g.interact(a, keys(['KeyK'], []), DT);
    assert.equal(a.slapSerial, 2, 'repeats after 0.5 s');
    b.pos.x += 5;
    for (let i = 0; i < 31; i++) g.interact(a, keys(['KeyK'], []), DT);
    assert.equal(a.slapSerial, 3); assert.equal(b.slappedSerial, 2, 'a miss swings at the air');
  } finally { sim.dispose(); }
});

test('a miss never recoils; a hit that rolls a drop knocks the held item loose along the shove, and the victim cannot snatch it back at once', () => {
  const { sim, g, a, b } = duel();
  try {
    a.yaw = Math.PI; g.interact(a, keys(['KeyK']), DT);
    assert.equal(a.slapSerial, 1); assert.equal(b.slappedSerial, 0, 'facing away: a miss');
    assert.equal(a.externalVelocity.lengthSq(), 0, 'no recoil on a miss');
    a.yaw = 0; a.slapCooldown = 0;
    const towel = g.towels[0];
    assert.ok(towel.pickup(b)); assert.equal(b.heldTool, towel);
    b.throwWasDown = true; towel.charge = 0.4;
    g.random = () => 0; // the drop roll (chance = wobble %, WOBBLE.md) succeeds
    g.interact(a, keys(['KeyK']), DT);
    assert.equal(b.slappedSerial, 1);
    // Identity checks with ok(): a failing equal() on scene objects would print the whole scene graph.
    assert.ok(b.heldTool === null, 'the hit knocked the towel loose');
    assert.ok(towel.flight && towel.velocity.y > 4 && towel.velocity.x > 2.9, 'it hops off along the shove');
    assert.equal(towel.charge, 0); assert.equal(towel.thrower, b);
    assert.ok(towel.ownerGrace > 0, 'the victim\'s own grace keeps it from catching it straight back');
    assert.equal(b.throwWasDown, false); assert.equal(b.throwCancelled, true, 'a held K must be let go first');
  } finally { sim.dispose(); }
});

test('per-character profile: the default is 2 a second at full push; the goose pecks 3 a second at 75% push', () => {
  assert.deepEqual(SLAP_DEFAULT, { cooldown: 0.5, push: 1, wobble: 16 });
  assert.deepEqual(slapProfile({ animal: 'cat' }), SLAP_DEFAULT);
  assert.deepEqual(ANIMAL_SLAP.goose, { cooldown: 1 / 3, push: 0.75, wobble: 14 });
  const { sim, g, a, b } = duel();
  try {
    a.animal = 'goose'; // the profile is read from the animal; the goose model itself is not in the game yet
    g.interact(a, keys(['KeyK']), DT);
    assert.ok(Math.abs(b.externalVelocity.x - SLAP.speed * 0.8 * 0.75) < 1e-6, '25% shorter shove');
    for (let i = 0; i < 20; i++) g.interact(a, keys(['KeyK'], []), DT);
    assert.equal(a.slapSerial, 2, 'next swing after 1/3 s');
  } finally { sim.dispose(); }
});

test('reach, angle and height: only bodies within the ±75° aim-assist cone, 1.25 m and one body height', () => {
  const { sim, a, b } = duel();
  try {
    assert.equal(slapTarget(a, sim.players), b);
    a.yaw = Math.PI / 2; assert.equal(slapTarget(a, sim.players), null, '90° to the side');
    a.yaw = 0; b.pos.x = a.pos.x + SLAP.reach + 0.05; assert.equal(slapTarget(a, sim.players), null, 'out of reach');
    b.pos.x = a.pos.x + 0.8; b.pos.y = a.pos.y + 1.2; assert.equal(slapTarget(a, sim.players), null, 'too high');
    b.pos.y = a.pos.y; b.state = 'fallen'; assert.equal(slapTarget(a, sim.players), null, 'never a fallen body');
  } finally { sim.dispose(); }
});

test('aim assist: a swing at a body 70° off the facing still hits and turns the slapper to face it', () => {
  const { sim, g, a, b } = duel();
  try {
    const angle = 70 * Math.PI / 180;
    b.pos.set(a.pos.x + Math.cos(angle) * 0.8, a.pos.y, a.pos.z - Math.sin(angle) * 0.8);
    assert.equal(slapTarget(a, sim.players), b, 'inside the cone');
    g.interact(a, keys(['KeyK']), DT);
    assert.equal(b.slappedSerial, 1, 'hit');
    assert.ok(Math.abs(a.yaw - angle) < 1e-6, 'facing snapped onto the target');
  } finally { sim.dispose(); }
});

test('aim assist prefers the body on the centre line over a slightly nearer one at the cone edge', () => {
  const { sim, a, b } = duel();
  try {
    // A stand-in third body ~69° off the facing, a little nearer than B.
    const c = { state: 'ground', pos: a.pos.clone().add({ x: Math.cos(1.2) * 0.75, y: 0, z: -Math.sin(1.2) * 0.75 } as any) };
    b.pos.set(a.pos.x + 0.85, a.pos.y, a.pos.z);
    assert.equal(slapTarget(a, [a, c, b]), b);
  } finally { sim.dispose(); }
});

test('a drop or throw press never slaps, K must be let go first; holding anything blocks the slap', () => {
  const { sim, g, a, b } = duel();
  try {
    const towel = g.towels[0]; towel.holder && g.drop(towel.holder); towel.pickup(a);
    g.interact(a, keys(['KeyK']), DT); g.interact(a, keys([], []), DT);
    assert.equal(a.heldTool, null, 'tapped K dropped the towel'); assert.equal(a.slapSerial, 0);
    towel.pickup(a);
    g.interact(a, keys(['KeyK']), DT); g.interact(a, keys([], []), DT); a.skipUse = false;
    assert.equal(a.slapSerial, 0);
    // Long throw: K still held after the item leaves, so no slap until K is released and pressed again.
    towel.pickup(a);
    for (let i = 0; i < 40; i++) g.interact(a, keys(['KeyK'], i ? [] : ['KeyK']), DT);
    g.interact(a, keys([], []), DT);
    assert.equal(a.heldTool, null); assert.equal(a.slapSerial, 0);
    a.slapArmed = false; g.interact(a, keys(['KeyK'], []), DT); assert.equal(a.slapSerial, 0, 'not armed while K stays down');
    g.interact(a, keys([], []), DT); g.interact(a, keys(['KeyK']), DT);
    assert.equal(a.slapSerial, 1, 'a fresh K slaps'); assert.equal(b.slappedSerial, 1);
  } finally { sim.dispose(); }
});

test('J slaps only with nothing to pick up; with a tool in reach J picks it up and that press never slaps', () => {
  const { sim, g, a, b } = duel();
  try {
    g.interact(a, keys(['KeyJ']), DT);
    assert.equal(a.slapSerial, 1, 'J slaps with nothing in reach');
    a.slapCooldown = 0;
    // Stand right on a loose towel: J now picks it up instead of slapping.
    const towel = g.towels.find((t: any) => !t.holder && t.active !== false)!;
    a.pos.copy(towel.worldPosition()); a.state = 'ground';
    assert.ok(g.emptyHandTarget(a).tool, 'a tool is in reach');
    g.interact(a, keys(['KeyJ']), DT);
    assert.ok(a.heldTool, 'J picked up'); assert.equal(a.slapSerial, 1, 'the pickup press does not slap');
    g.drop(a); a.skipUse = true;
    g.interact(a, keys(['KeyJ'], []), DT); assert.equal(a.slapSerial, 1, 'holding J next to a tool never slaps');
  } finally { sim.dispose(); }
});

test('through real ticks (motion first, then actions) an empty-handed J tap slaps like K', () => {
  const { sim, a, b } = duel();
  try {
    let seq = 100;
    const send = (down: string[], hits: string[] = down) => { sim.input(0, { seq: ++seq, move: [0, 0], axis: [0, 0], down, hits }); sim.tick(); };
    // Keep B in reach between ticks: other bodies and the roof keep moving.
    // Pin both bodies: the hit's shove and the slapper's recoil would otherwise walk them apart (and A toward a tool).
    const home = a.pos.clone();
    const hold = () => { a.pos.copy(home); a.externalVelocity.set(0, 0, 0); b.pos.set(a.pos.x + 0.8, a.pos.y, a.pos.z); b.externalVelocity.set(0, 0, 0); a.yaw = 0; };
    hold(); send(['KeyJ']); send([], []);
    assert.equal(a.slapSerial, 1, 'J tap slapped'); assert.equal(b.slappedSerial, 1);
    for (let i = 0; i < 40; i++) send([], []);
    hold(); send(['KeyK']); send([], []);
    assert.equal(a.slapSerial, 2, 'K tap slapped'); assert.equal(b.slappedSerial, 2);
  } finally { sim.dispose(); }
});

test('holding J or K keeps punching once per cooldown, no button mashing', () => {
  const { sim, a, b } = duel();
  try {
    let seq = 200;
    // Pin both bodies: the hit's shove and the slapper's recoil would otherwise walk them apart (and A toward a tool).
    const home = a.pos.clone();
    const hold = () => { a.pos.copy(home); a.externalVelocity.set(0, 0, 0); b.pos.set(a.pos.x + 0.8, a.pos.y, a.pos.z); b.externalVelocity.set(0, 0, 0); a.yaw = 0; };
    for (const key of ['KeyJ', 'KeyK']) {
      const start = a.slapSerial;
      for (let i = 0; i < 60; i++) { hold(); sim.input(0, { seq: ++seq, move: [0, 0], axis: [0, 0], down: [key], hits: i ? [] : [key] }); sim.tick(); }
      assert.equal(a.slapSerial - start, 2, `${key} held for 1 s throws two punches`);
      for (let i = 0; i < 40; i++) { sim.input(0, { seq: ++seq, move: [0, 0], axis: [0, 0], down: [], hits: [] }); sim.tick(); }
    }
  } finally { sim.dispose(); }
});

test('co-op slaps the same way (universal); the slap state is snapshotted and signed urgently', () => {
  const coop = duel('highway-02');
  try {
    coop.g.interact(coop.a, keys(['KeyK']), DT);
    assert.equal(coop.a.slapSerial, 1); assert.equal(coop.b.slappedSerial, 1);
    assert.ok(coop.b.externalVelocity.length() > 14.3, 'same shove as versus');
  } finally { coop.sim.dispose(); }
  const { sim, g, a } = duel();
  try {
    const before = sim.urgentSignature();
    g.interact(a, keys(['KeyK']), DT);
    assert.notEqual(sim.urgentSignature(), before);
    const peer = new Simulation(getLevel('versus-01') as any);
    try {
      const data = quantize(sim.snapshot());
      data.players.forEach((state: any, i: number) => applyPlayer(peer.players[i], state, peer.trucks));
      assert.deepEqual([peer.players[0].slapSerial, peer.players[1].slappedSerial], [1, 1]);
      assert.ok(peer.players[0].slapCooldown > 0);
    } finally { peer.dispose(); }
    assert.equal(VERSION, 42);
  } finally { sim.dispose(); }
});
