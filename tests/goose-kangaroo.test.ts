import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from './fixtures/Simulation.js';
import { WASH_CONFIG as C } from '../shared/sim/washConfig.js';
import { MOTION } from '../shared/sim/PlayerMotion.js';
import { VERSION, packetInput } from '../shared/protocol.js';
import { SAVE_VERSION } from '../shared/levels.js';
import { quantize } from '../shared/delta.js';
import { applyPlayer } from '../shared/snapshot.js';
import { validAvatar, GOOSE_BREEDS, KANGAROO_BREEDS, ANIMALS } from '../shared/avatar.js';
import { SLAP, ANIMAL_SLAP, slapProfile } from '../shared/sim/Slap.js';
import { ANIMAL_DESCRIPTIONS } from '../client/js/ui/animalDescriptions.js';

let seq = 0;
const send = (sim: any, slot: number, down: string[] = [], hits: string[] = []) => sim.input(slot, { seq: ++seq, move: [0, 0], axis: [0, 0], down, hits });

/** Practice scene: slot 0 plays `animal`, slot 1 a cat; both standing on the home vehicle. */
function setup(animal: string) {
  const sim: any = new Simulation(); seq = 0;
  sim.occupy(0, true); sim.occupy(1, true); sim.setAnimal(0, animal);
  sim.connected = [true, true, false, false];
  for (let i = 0; i < 120; i++) { send(sim, 0); send(sim, 1); sim.tick(); }
  const [p, cat] = sim.players;
  assert.equal(p.state, 'ground'); assert.equal(p.animal, animal);
  return { sim, p, cat };
}

test('goose and kangaroo avatars validate with their own breeds; protocol 32 carries them; the copy matches the rules', () => {
  for (const id of ['goose', 'kangaroo']) assert.ok(ANIMALS.some(animal => animal.id === id));
  for (const breed of GOOSE_BREEDS) assert.equal(validAvatar({ animal: 'goose', breed: breed.id, color: 2 }), true);
  for (const breed of KANGAROO_BREEDS) assert.equal(validAvatar({ animal: 'kangaroo', breed: breed.id, color: 2 }), true);
  assert.equal(validAvatar({ animal: 'goose', breed: 'red', color: 2 }), false, 'a kangaroo breed is not a goose');
  assert.equal(VERSION, 42); assert.equal(SAVE_VERSION, '0.5', 'no saved result or score semantics change');
  assert.match(ANIMAL_DESCRIPTIONS.goose.description, /出拳速度提升50%/);
  assert.match(ANIMAL_DESCRIPTIONS.kangaroo.description, /高50%/);
});

test('a kangaroo jumps 50% higher (take-off ×√1.5); everyone else keeps the normal jump', () => {
  assert.ok(Math.abs(C.kangarooJumpScale ** 2 - 1.5) < 1e-9);
  for (const [animal, scale] of [['kangaroo', C.kangarooJumpScale], ['cat', 1], ['goose', 1]] as const) {
    const { sim, p } = setup(animal);
    try {
      const truck = p.ground.truck;
      send(sim, 0, ['Space'], ['Space']); send(sim, 1); sim.tick();
      assert.equal(p.state, 'air');
      assert.ok(Math.abs(p.vel.y - (truck.vel.y || 0) - MOTION.jump * scale) < 0.3, `${animal} take-off speed`);
    } finally { sim.dispose(); }
  }
});

test('a goose flaps once per airtime (a little lift), glides slower than the pelican and refills on landing; peers see the flap', () => {
  const { sim, p } = setup('goose');
  try {
    p.state = 'air'; p.ground = null; p.takeoff = sim.trucks[0]; p.pos.y += 6; p.vel.y = -3; p.coyote = 0;
    send(sim, 0, ['Space'], ['Space']); send(sim, 1); sim.tick();
    assert.ok(p.vel.y > C.gooseFlapSpeed - 0.5, 'the flap lifts it');
    assert.equal(p.flapsRemaining, 0); assert.equal(p.flapSerial, 1);
    const peer = new Simulation();
    try { applyPlayer(peer.players[0], quantize(sim.snapshot()).players[0], peer.trucks); assert.deepEqual([peer.players[0].flapSerial, peer.players[0].flapsRemaining], [1, 0]); }
    finally { peer.dispose(); }
    for (let i = 0; i < 10; i++) { send(sim, 0, [], []); send(sim, 1); sim.tick(); }
    send(sim, 0, ['Space'], ['Space']); send(sim, 1); sim.tick();
    assert.equal(p.flapSerial, 1, 'only one flap per airtime');
    let maxDrop = 0;
    for (let i = 0; i < 60 && p.state === 'air'; i++) { send(sim, 0, ['Space']); send(sim, 1); sim.tick(); if (p.vel.y < 0) maxDrop = Math.max(maxDrop, -p.vel.y); }
    assert.ok(maxDrop <= C.gooseGlideFallSpeed + 1e-6, 'holding Space glides at the goose\'s gentler sink');
    for (let i = 0; i < 400 && p.state !== 'ground'; i++) { send(sim, 0); send(sim, 1); sim.tick(); }
    assert.equal(p.state, 'ground');
    assert.equal(p.flapsRemaining, C.gooseFlaps, 'landing refills the flap');
    assert.equal(p.glideRemaining, C.gooseGlideSeconds, 'and the longer goose glide');
  } finally { sim.dispose(); }
  const cat = setup('cat');
  try {
    const p = cat.p; p.state = 'air'; p.ground = null; p.takeoff = cat.sim.trucks[0]; p.pos.y += 6; p.vel.y = -3; p.coyote = 0;
    send(cat.sim, 0, ['Space'], ['Space']); send(cat.sim, 1); cat.sim.tick();
    assert.ok(p.vel.y < 0, 'only geese flap'); assert.equal(p.flapSerial || 0, 0);
  } finally { cat.sim.dispose(); }
});

test('slap profiles: the goose slaps 3 a second at 75% push; a kangaroo punch shoves 1.5× as far with normal recoil', () => {
  assert.deepEqual(ANIMAL_SLAP.goose, { cooldown: 1 / 3, push: 0.75, wobble: 14 });
  assert.equal(slapProfile({ animal: 'kangaroo' }).push, 1.5);
  const { sim, p, cat } = setup('kangaroo');
  try {
    const g = sim.game;
    for (const tool of g.tools) if (tool.holder) g.drop(tool.holder);
    p.yaw = 0; cat.pos.set(p.pos.x + 0.8, p.pos.y, p.pos.z); cat.externalVelocity.set(0, 0, 0); p.externalVelocity.set(0, 0, 0);
    g.interact(p, packetInput({ seq: 1, move: [0, 0], axis: [0, 0], down: ['KeyK'], hits: ['KeyK'] }), 1 / 60);
    assert.equal(cat.slappedSerial, 1);
    assert.ok(Math.abs(cat.externalVelocity.length() / 10 - 1.5 * SLAP.speed * 0.8 / 10) < 0.02, 'about 2.16 m: 1.5× the 1.44 m shove (character scale)');
    assert.ok(Math.abs(p.externalVelocity.length() / 10 - SLAP.recoil * 0.8 / 10) < 0.02, 'the tail braces it: normal 0.32 m recoil');
  } finally { sim.dispose(); }
});
