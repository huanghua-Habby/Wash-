import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Simulation } from './fixtures/Simulation.js';
import { WASH_CONFIG as C } from '../shared/sim/washConfig.js';
import { pressureForce } from '../shared/sim/SprayPressure.js';
import { playerMass, ANIMAL_MASS } from '../shared/sim/Mass.js';
import { riderWeight } from '../shared/sim/VehicleLoad.js';
import { VERSION, packetInput } from '../shared/protocol.js';
import { quantize, diff, patch } from '../shared/delta.js';
import { applyWorld, applyPlayer } from '../shared/snapshot.js';
import { validAvatar, ELEPHANT_BREEDS, ANIMALS } from '../shared/avatar.js';
import { SAVE_VERSION } from '../shared/levels.js';
import { Player } from '../client/js/game/Player.js';
import { traceSpray } from '../shared/sim/WaterGun.js';

let seq = 0;
const press = (sim: Simulation, slot: number, down: string[] = [], hits: string[] = []) => sim.input(slot, { seq: ++seq, move: [0, 0], axis: [0, 0], down, hits });

/** Practice scene with an elephant in slot 0 facing +x and a cat in slot 1 a few metres in front of its trunk. */
function setup() {
  const sim = new Simulation(); seq = 0;
  sim.occupy(0, true); sim.occupy(1, true); sim.setAnimal(0, 'elephant');
  sim.connected = [true, true, false, false];
  for (let i = 0; i < 120; i++) { press(sim, 0); press(sim, 1); sim.tick(); }
  const [elephant, cat] = sim.players, truck = sim.trucks[0];
  assert.equal(elephant.state, 'ground'); assert.equal(cat.state, 'ground');
  elephant.yaw = 0; elephant.pos.set(truck.pos.x - 1.5, truck.topY, truck.pos.z);
  elephant.ground = { truck, plat: truck.platformAt(elephant.pos.x, elephant.pos.z, 0.3) };
  cat.pos.set(truck.pos.x + 0.4, truck.topY, truck.pos.z + 0.6);
  cat.ground = { truck, plat: truck.platformAt(cat.pos.x, cat.pos.z, 0.3) };
  return { sim, elephant, cat, truck };
}
const peerOf = (sim: Simulation) => {
  const peer = new Simulation(), snap = quantize(sim.snapshot());
  applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, snap);
  snap.players.forEach((state: any, i: number) => applyPlayer(peer.players[i], state, peer.trucks));
  return peer;
};

test('trunk coverage is wider nearby and shorter at full pressure without changing the hand-held gun', () => {
  const { sim, elephant } = setup();
  try {
    const trunk = elephant.trunk, start = new THREE.Vector3(0, 1.72, 0), direction = new THREE.Vector3(1, 0, 0);
    const roof = { topY: 1, platformAt: () => ({}) };
    const old = { holder: elephant, sprayTarget: new THREE.Vector3() } as any;
    traceSpray(old, start, direction, { speed: 11, range: 4.8, lift: 1.4 }, [roof]);
    traceSpray(trunk, start, direction, trunk.jetBallistics(1), [roof]);
    assert.ok(trunk.sprayTarget.x < old.sprayTarget.x * 0.81, 'full-pressure water lands about 20% nearer');
    assert.ok(Math.abs(C.trunkRange / C.trunkSpeed - 4.8 / 11) < 1e-9, 'shortening keeps the flight-time budget');

    const stain = { done: false, mesh: new THREE.Object3D() };
    stain.mesh.position.set(trunk.sprayTarget.x, 1, 1.2);
    traceSpray(trunk, start, direction, trunk.jetBallistics(1), [], [], [stain]);
    assert.equal(trunk.hitStain, stain, 'the wider jet covers a nearby lateral miss');
    traceSpray(old, start, direction, trunk.jetBallistics(1), [], [], [stain]);
    assert.equal(old.hitStain, null, 'ordinary gun coverage does not gain the trunk radius');
    stain.mesh.position.z = 1.5;
    traceSpray(trunk, start, direction, trunk.jetBallistics(1), [], [], [stain]);
    assert.equal(trunk.hitStain, null, 'the broader footprint remains bounded');

    const near = { occupied: true, state: 'ground', pos: new THREE.Vector3(1.5, 1, 0) };
    stain.mesh.position.z = 0;
    traceSpray(trunk, start, direction, trunk.jetBallistics(1), [], [near], [stain]);
    assert.equal(trunk.hitPlayer, near); assert.equal(trunk.hitStain, null, 'a teammate still blocks the wider rinse');
    const far = { ...near, pos: new THREE.Vector3(4.5, 1, 0) };
    traceSpray(trunk, start, direction, trunk.jetBallistics(1), [], [far]);
    assert.equal(trunk.hitPlayer, null, 'the shortened jet cannot shove distant teammates');
    traceSpray(old, start, direction, { speed: 11, range: 4.8, lift: 1.4 }, [], [far]);
    assert.equal(old.hitPlayer, far, 'this teammate was in the old full-pressure reach');
  } finally { sim.dispose(); }
});

/** Real roof and real ballistic hits, including the weak opening jet (no mocked trace). */
function rinseSetup() {
  const sim = new Simulation();
  sim.occupy(0, true); sim.setAnimal(0, 'elephant');
  sim.phase = 'game'; sim.game.start(sim.director.base); sim.game.spawnOrder();
  const order = sim.game.orders[0], truck = order.truck;
  truck.setState(sim.game.homeX, sim.game.homeZ - 3.9, 0, 0, sim.game.base);
  order.arrivalProgress = 1; sim.scene.updateMatrixWorld(true);
  const stain = order.stains.find((s: any) => s.steps[0] === 'water');
  const at = stain.mesh.getWorldPosition(new THREE.Vector3());
  const place = (slot: number, distance: number, yaw = 0) => {
    const player = sim.players[slot]; player.state = 'ground'; player.yaw = yaw;
    player.pos.set(at.x - distance, truck.topY, at.z);
    player.ground = { truck, plat: truck.platformAt(player.pos.x, player.pos.z, 0.3) };
    player.root.position.copy(player.pos); player.yawG.rotation.y = yaw;
    return player;
  };
  const elephant = place(0, 1);
  const spray = (player = elephant, down = ['KeyL']) => sim.game.trunkSpray(player,
    packetInput({ seq: 1, down, hits: [], move: [0, 0], axis: [0, 0] }), 1 / 60);
  return { sim, order, stain, elephant, place, spray };
}

test('a weak trunk jet lands on nearby dirt and its rinse progress reaches a peer', () => {
  const { sim, order, stain, elephant, spray } = rinseSetup();
  try {
    const before = quantize(sim.snapshot());
    spray();
    assert.ok(elephant.trunk.hitStain === stain, 'opening water must reach the roof, not expire in mid-air');
    assert.ok(stain.progress > 0, 'L immediately rinses a nearby water step with the actual ballistic trace');
    const peer = new Simulation();
    try {
      applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, patch(before, diff(before, quantize(sim.snapshot()))));
      const target = peer.game.orders.find((o: any) => o.serial === order.serial).stains.find((s: any) => s.id === stain.id);
      assert.ok(Math.abs(target.progress - stain.progress) < 0.0001);
    } finally { peer.dispose(); }
    elephant.trunk.pressure = 0.3;
    const progress = stain.progress; spray(elephant, []);
    assert.ok(elephant.trunk.hitStain === stain, 'the weak release tail also lands');
    assert.ok(stain.progress > progress);
    elephant.yaw = Math.PI / 2;
    const missed = stain.progress; spray();
    assert.equal(stain.progress, missed, 'nearby water does not auto-aim sideways');
  } finally { sim.dispose(); }
});

test('nearby trunk water respects teammate occlusion and concurrent rinses cannot skip the towel step', () => {
  const { sim, stain, elephant, place, spray } = rinseSetup();
  try {
    sim.occupy(1, true); sim.setAnimal(1, 'elephant');
    const other = place(1, 0.1);
    spray();
    assert.equal(elephant.trunk.hitPlayer, other); assert.equal(stain.progress, 0);
    place(1, -1, Math.PI);
    stain.progress = 0.999;
    const signature = sim.urgentSignature();
    spray(); spray(other);
    assert.equal(stain.stage, 1); assert.equal(stain.progress, 0);
    assert.equal(stain.done, false, 'the towel step still requires a towel');
    assert.notEqual(sim.urgentSignature(), signature, 'stage completion is synchronized urgently');
  } finally { sim.dispose(); }
});

test('elephant avatars validate, the elephant is heavy and protocol 14 carries trunk tanks', () => {
  assert.ok(ANIMALS.some(animal => animal.id === 'elephant'));
  for (const breed of ELEPHANT_BREEDS) assert.equal(validAvatar({ animal: 'elephant', breed: breed.id, color: 1 }), true);
  assert.equal(validAvatar({ animal: 'elephant', breed: 'corgi', color: 1 }), false);
  assert.equal(VERSION, 42); assert.equal(SAVE_VERSION, '0.5', 'the trunk adds no saved result or score semantics');
  const sim = new Simulation();
  try {
    sim.setAnimal(0, 'elephant');
    assert.equal(sim.players[0].animal, 'elephant'); assert.equal(sim.players[0].respawnReduction, 0); assert.equal(sim.players[0].workSpeed, 1);
    assert.equal(playerMass(sim.players[0]), ANIMAL_MASS.elephant); assert.equal(riderWeight(sim.players[0]), ANIMAL_MASS.elephant);
    assert.equal(playerMass(sim.players[1]), 1, 'other animals keep the default weight');
  } finally { sim.dispose(); }
});

test('holding L drains the tank, empties into a sputter lockout, and refills after a delay', () => {
  const { sim, elephant } = setup();
  try {
    const trunk = elephant.trunk;
    assert.equal(trunk.water, 1); assert.equal(trunk.spraying, false);
    press(sim, 0, ['KeyL'], ['KeyL']); sim.tick();
    assert.equal(trunk.spraying, true); assert.ok(trunk.sprayNodes.length > 1, 'the authority traces a jet path');
    const openingReach = trunk.sprayTarget.distanceTo(trunk.sprayNodes[0]);
    assert.ok(openingReach < 0.8, `a fresh trunk jet begins beside the elephant (${openingReach.toFixed(2)}m)`);
    let ticks = 1;
    while (!trunk.empty && ticks < 400) { press(sim, 0, ['KeyL']); sim.tick(); ticks++; elephant.pos.x = sim.trucks[0].pos.x - 1.5; }
    assert.ok(Math.abs(ticks / 60 - C.trunkDrainSeconds) < 0.05, `a full tank lasts ${ticks / 60}s`);
    assert.equal(trunk.water, 0); assert.equal(trunk.empty, true);
    press(sim, 0, ['KeyL']); sim.tick();
    assert.equal(trunk.spraying, false, 'an empty trunk stops even while L is held');
    // Still held: refill begins after the delay, and the jet only reopens past the restart level.
    for (let i = 0; i < Math.ceil(C.trunkRefillDelay * 60) - 3; i++) { press(sim, 0, ['KeyL']); sim.tick(); }
    assert.equal(trunk.water, 0, 'no refill during the delay');
    for (let i = 0; i < 20; i++) { press(sim, 0, ['KeyL']); sim.tick(); }
    assert.ok(trunk.water > 0 && trunk.water < C.trunkRestart); assert.equal(trunk.spraying, false);
    for (let i = 0; i < 80; i++) { press(sim, 0, ['KeyL']); sim.tick(); }
    assert.equal(trunk.empty, false); assert.equal(trunk.spraying, true, 'the jet reopens once refilled past the restart level');
    // Released: full refill over trunkRefillSeconds.
    // Released: the pressure tail flows briefly, then a full refill over trunkRefillSeconds.
    for (let i = 0; i < Math.ceil((C.pressureFallSeconds + C.trunkRefillDelay + C.trunkRefillSeconds) * 60) + 2; i++) { press(sim, 0); sim.tick(); }
    assert.equal(trunk.water, 1); assert.equal(trunk.spraying, false);
  } finally { sim.dispose(); }
});

test('the jet opens with a heavy kick back and keeps a recoil while spraying; other animals cannot spray', () => {
  const { sim, elephant, cat } = setup();
  try {
    const start = elephant.pos.x;
    press(sim, 0, ['KeyL'], ['KeyL']); sim.tick();
    // The kick is applied this tick and integrated from the next movement step.
    // A fresh press opens at low pressure, so the first kick is the scaled one.
    assert.ok(elephant.externalVelocity.x < -C.trunkKickSpeed * pressureForce(elephant.trunk.pressure) * 0.9, 'kick points away from the trunk');
    for (let i = 0; i < Math.ceil(C.pressureRampSeconds * 60) + 6; i++) { press(sim, 0, ['KeyL']); sim.tick(); }
    assert.equal(elephant.trunk.pressure, 1, 'holding builds the jet to full pressure');
    assert.ok(elephant.externalVelocity.x <= -C.trunkRecoilSpeed + 1e-6, 'sustained recoil while the jet stays open');
    assert.ok(elephant.pos.x < start - 0.3, `recoil slides the elephant back (moved ${elephant.pos.x - start})`);
    // A cat pressing L does nothing.
    press(sim, 1, ['KeyL'], ['KeyL']); sim.tick();
    assert.equal(cat.trunk.spraying, false); assert.equal(cat.externalVelocity.lengthSq() < 1e-9 || cat.externalVelocity.x >= 0, true);
  } finally { sim.dispose(); }
});

test('the trunk shoves the first teammate in its path, harder than the gun, and a cat cannot shove an elephant as far', () => {
  const { sim, elephant, cat } = setup();
  try {
    cat.pos.set(elephant.pos.x + 1.4, elephant.pos.y, elephant.pos.z);
    elephant.trunk.pressure = 1; // compare full jets
    press(sim, 0, ['KeyL'], ['KeyL']); sim.tick();
    assert.equal(elephant.trunk.hitPlayer, cat);
    assert.ok(cat.externalVelocity.x > C.sprayPushSpeed * 0.8, 'the trunk pushes harder than the toy gun'); // shoves at the character scale
    // The same gun shove on an elephant is divided by its weight.
    const gun = sim.game.waterguns[0], direction = new THREE.Vector3(0, 0, 1);
    elephant.trunk.reset(); elephant.externalVelocity.set(0, 0, 0);
    gun.pickup(cat); gun.pressure = 1; gun.direction = () => direction; gun.trace = () => { gun.hitPlayer = elephant; };
    sim.game.spray(cat, { down: (k: string) => k === 'KeyJ', hit: () => false } as any, 1 / 60);
    assert.ok(Math.abs(elephant.externalVelocity.z - C.sprayPushSpeed * 0.8 / ANIMAL_MASS.elephant) < 1e-6);
  } finally { sim.dispose(); }
});

test('the trunk rinses a water-step stain, and the cleaned stage reaches peers through snapshots and deltas', () => {
  const sim = new Simulation(); seq = 0;
  try {
    sim.occupy(0, true); sim.setAnimal(0, 'elephant'); sim.connected = [true, false, false, false];
    sim.command('start');
    for (let i = 0; i < 60 * 30 && !sim.game.orders.some((order: any) => order.arrivalProgress === 1); i++) {
      // The synchronized tutorial guide holds the round until every participant confirms it.
      if (sim.game.roundStage === 'guide') sim.confirmGuide(0, sim.game.guide.id);
      press(sim, 0); sim.tick();
    }
    const order = sim.game.orders.find((entry: any) => entry.arrivalProgress === 1);
    assert.ok(order, 'an order docks');
    const stain = order.stains.find((entry: any) => entry.steps[0] === 'water');
    assert.ok(stain, 'the first level has a water stain');
    const elephant = sim.players[0], truck = order.truck;
    const trunk = elephant.trunk;
    // Aim the trunk straight at the stain from a standing spot on the same roof.
    trunk.trace = function () { this.sprayNodes = [new THREE.Vector3(), stain.mesh.getWorldPosition(new THREE.Vector3())]; this.hitStain = stain; this.hitPlayer = null; this.sprayTarget.copy(this.sprayNodes[1]); };
    elephant.pos.set(truck.pos.x, truck.topY, truck.pos.z); elephant.state = 'ground';
    elephant.ground = { truck, plat: truck.platformAt(elephant.pos.x, elephant.pos.z, 0.3) };
    const before = quantize(sim.snapshot());
    trunk.pressure = 1; // a fully built jet rinses at the configured rate
    const ticks = Math.ceil(C.spraySeconds / C.trunkRinseRate * 60) + 4;
    for (let i = 0; i < ticks; i++) { press(sim, 0, ['KeyL'], i ? [] : ['KeyL']); sim.tick(); trunk.water = 1; }
    assert.equal(stain.stage, 1, 'the water step is rinsed by the trunk');
    const after = quantize(sim.snapshot()), patched = patch(before, diff(before, after));
    const peer = new Simulation();
    try {
      applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, patched);
      const peerOrder = peer.game.orders.find((entry: any) => entry.serial === order.serial);
      assert.equal(peerOrder.stains[order.stains.indexOf(stain)].stage, 1, 'peers see the authority stage, never a local result');
      assert.equal(peer.game.trunks[0].spraying, true); assert.ok(peer.game.trunks[0].sprayNodes.length > 1);
    } finally { peer.dispose(); }
  } finally { sim.dispose(); }
});

test('opening, closing and running dry are urgent; tank level, jet and empty state reach a peer', () => {
  const { sim, elephant } = setup();
  try {
    const signature = sim.urgentSignature();
    press(sim, 0, ['KeyL'], ['KeyL']); sim.tick();
    assert.notEqual(sim.urgentSignature(), signature, 'opening the jet is sent in the same tick');
    for (let i = 0; i < 40; i++) { press(sim, 0, ['KeyL']); sim.tick(); }
    const peer = peerOf(sim);
    try {
      const trunk = elephant.trunk, mirror = peer.game.trunks[0];
      assert.ok(Math.abs(mirror.water - trunk.water) < 1e-3); assert.equal(mirror.spraying, true);
      assert.equal(mirror.sprayNodes.length, trunk.sprayNodes.length);
      assert.ok(mirror.sprayTarget.distanceTo(trunk.sprayTarget) < 1e-3);
    } finally { peer.dispose(); }
    const open = sim.urgentSignature();
    press(sim, 0); sim.tick();
    assert.equal(elephant.trunk.spraying, true, 'releasing leaves a short pressure tail');
    for (let i = 0; i < Math.ceil(C.pressureFallSeconds * 60); i++) { press(sim, 0); sim.tick(); }
    assert.equal(elephant.trunk.spraying, false); assert.notEqual(sim.urgentSignature(), open, 'closing is urgent too');
  } finally { sim.dispose(); }
});

test('switching away from the elephant, being swallowed or a scene reset closes and refills the trunk', () => {
  const { sim, elephant } = setup();
  try {
    for (let i = 0; i < 30; i++) { press(sim, 0, ['KeyL'], i ? [] : ['KeyL']); sim.tick(); }
    assert.equal(elephant.trunk.spraying, true); assert.ok(elephant.trunk.water < 1);
    sim.setAnimal(0, 'cat'); press(sim, 0, ['KeyL']); sim.tick();
    assert.equal(elephant.trunk.spraying, false); assert.equal(elephant.trunk.water, 1);
    sim.setAnimal(0, 'elephant');
    for (let i = 0; i < 20; i++) { press(sim, 0, ['KeyL'], i ? [] : ['KeyL']); sim.tick(); }
    sim.game.resetEquipment();
    assert.equal(elephant.trunk.spraying, false); assert.equal(elephant.trunk.water, 1);
  } finally { sim.dispose(); }
});

test('the client player builds an elephant body with a trunk tip for particles', async () => {
  const scene = new THREE.Scene(), player = new Player(scene, { slot: 2 });
  player.setAppearance({ animal: 'elephant', breed: 'pink', color: 5 });
  assert.equal(player.animal, 'elephant'); assert.equal(player.body, player.elephant);
  for (const name of ['trunk0', 'trunk1', 'trunk2', 'trunk3', 'trunkTip']) assert.ok(player.elephant.bones[name], name);
  assert.equal(player.trunkTip, player.elephant.bones.trunkTip);
  player.setAppearance({ animal: 'cat', breed: 'grey', color: 5 });
  assert.equal(player.trunkTip, null, 'only a visible elephant offers its drawn trunk tip');
});
