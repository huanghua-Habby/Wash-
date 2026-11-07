import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Simulation } from './fixtures/Simulation.js';
import { WASH_CONFIG as C } from '../shared/sim/washConfig.js';
import { VERSION } from '../shared/protocol.js';
import { SAVE_VERSION } from '../shared/levels.js';
import { quantize } from '../shared/delta.js';
import { applyWorld, applyPlayer } from '../shared/snapshot.js';
import { validAvatar, SQUIRREL_BREEDS, ANIMALS } from '../shared/avatar.js';
import { WALL_GAP, hullBase, slideSpeed, wallBoxes } from '../shared/sim/WallCling.js';
import { VEHICLES } from '../shared/sim/vehicles.js';
import { Player } from '../client/js/game/Player.js';
import { SQUIRREL_BODY } from '../client/js/game/squirrel/SquirrelModel.js';
import { ANIMAL_DESCRIPTIONS } from '../client/js/ui/animalDescriptions.js';

let seq = 0;
const press = (sim: any, slot: number, hits: string[] = [], move = [0, 0]) => sim.input(slot, { seq: ++seq, move, axis: [0, 0], down: hits, hits });

/** Practice scene with a squirrel in slot 0 and a cat in slot 1, both standing on the home vehicle. */
function setup() {
  const sim: any = new Simulation(); seq = 0;
  sim.occupy(0, true); sim.occupy(1, true); sim.setAnimal(0, 'squirrel');
  sim.connected = [true, true, false, false];
  for (let i = 0; i < 120; i++) { press(sim, 0); press(sim, 1); sim.tick(); }
  const [squirrel, cat] = sim.players, truck = sim.trucks[0];
  assert.equal(squirrel.state, 'ground'); assert.equal(cat.state, 'ground');
  return { sim, squirrel, cat, truck };
}

/** Drop a player into the air beside the home vehicle's left flank (+z), `height` above its hull underside. */
function besideFlank(player: any, truck: any, height: number, gap = 0.5) {
  const box = truck.spec.walls[0];
  player.state = 'air'; player.ground = null; player.takeoff = truck; player.wall = null; player.wallLock = 0;
  player.pos.set(truck.pos.x + (box.x0 + box.x1) / 2, hullBase(truck) + height, truck.pos.z + box.z1 + gap);
  player.vel.set(truck.vel.x, -2, truck.vel.z); player.airBase.set(truck.vel.x, truck.vel.z);
}

test('squirrel avatars validate, every vehicle has clingable walls and protocol 23 carries the cling', () => {
  assert.ok(ANIMALS.some(animal => animal.id === 'squirrel'));
  for (const breed of SQUIRREL_BREEDS) assert.equal(validAvatar({ animal: 'squirrel', breed: breed.id, color: 3 }), true);
  assert.equal(validAvatar({ animal: 'squirrel', breed: 'corgi', color: 3 }), false);
  assert.equal(VERSION, 42); assert.equal(SAVE_VERSION, '0.5', 'the squirrel adds no saved result or score semantics');
  assert.equal(ANIMAL_DESCRIPTIONS.squirrel.type, '被动');
  assert.match(ANIMAL_DESCRIPTIONS.squirrel.description, /25%/);
  for (const [type, spec] of Object.entries(VEHICLES) as any) {
    assert.ok(spec.walls?.length, `${type} has hull walls`);
    // The highest wall top is the highest standing level, so a climb ends on a deck.
    const highest = Math.max(...spec.platforms.map((p: any) => p.y ?? spec.top));
    assert.ok(Math.abs(Math.max(...spec.walls.map((w: any) => w.y1)) - highest) < 1e-9, `${type} walls reach its highest deck`);
  }
  assert.ok(slideSpeed(2) > slideSpeed(1) * 2 && slideSpeed(1) > slideSpeed(0) * 4, 'the slide speeds up the longer it clings');
});

test('a squirrel runs 25% faster than a cat; switching animal restores normal speed', () => {
  const { sim, squirrel, cat, truck } = setup();
  try {
    assert.equal(squirrel.speedScale, 1 + C.squirrelSpeedBonus); assert.equal(cat.speedScale, 1);
    // The same 0.2 s walk across open roof, first as a squirrel, then back as a cat.
    const walk = (direction: number) => {
      const start = squirrel.pos.x - truck.pos.x;
      for (let i = 0; i < 12; i++) { press(sim, 0, [], [direction, 0]); press(sim, 1); sim.tick(); }
      return Math.abs(squirrel.pos.x - truck.pos.x - start);
    };
    const fast = walk(-1);
    sim.setAnimal(0, 'cat'); assert.equal(squirrel.speedScale, 1);
    const normal = walk(1);
    assert.ok(Math.abs(fast / normal - 1.25) < 0.02, `ratio ${fast / normal}`);
  } finally { sim.dispose(); }
});

test('falling past a hull side: the squirrel sticks and slides ever faster, a cat just falls', () => {
  const { sim, squirrel, cat, truck } = setup();
  try {
    besideFlank(squirrel, truck, 2.2); besideFlank(cat, truck, 2.2); cat.pos.x -= 2;
    const signature = sim.urgentSignature();
    press(sim, 0); press(sim, 1); sim.tick();
    assert.ok(squirrel.wall, 'grabs the flank'); assert.equal(squirrel.wall.axis, 'z'); assert.equal(squirrel.wall.side, 1);
    assert.equal(squirrel.state, 'air'); assert.equal(squirrel.carrierTruck, truck);
    assert.ok(Math.abs(squirrel.pos.z - (truck.pos.z + truck.spec.walls[0].z1 + WALL_GAP)) < 1e-6, 'glued to the face');
    assert.notEqual(sim.urgentSignature(), signature, 'grabbing a wall is sent in the same tick');
    assert.equal(cat.wall, null);
    // Average drop speed over consecutive 0.4 s windows keeps rising while it clings.
    const drops: number[] = [];
    for (let w = 0; w < 3; w++) {
      const y = squirrel.pos.y - hullBase(truck);
      for (let i = 0; i < 24; i++) { press(sim, 0); press(sim, 1); sim.tick(); }
      assert.ok(squirrel.wall, `still clinging after ${(w + 1) * 0.4}s`);
      drops.push(y - (squirrel.pos.y - hullBase(truck)));
    }
    assert.ok(drops[0] > 0 && drops[0] < 0.3 && drops[1] > drops[0] * 1.3 && drops[2] > drops[1] * 1.3, `drops ${drops.map(d => d.toFixed(2))}`);
    assert.ok(Math.abs(squirrel.pos.z - (truck.pos.z + truck.spec.walls[0].z1 + WALL_GAP)) < 1e-6, 'rides along with the vehicle');
    assert.ok(cat.state === 'fallen' || cat.pos.y < squirrel.pos.y - 1, 'the cat fell away');
    // Sliding off the bottom of the hull lets go and the squirrel falls to the road.
    for (let i = 0; i < 200 && squirrel.state !== 'fallen'; i++) { press(sim, 0); press(sim, 1); sim.tick(); }
    assert.equal(squirrel.state, 'fallen'); assert.equal(squirrel.wall, null);
  } finally { sim.dispose(); }
});

test('the paws give out after the grip time and cannot grab again until the squirrel lands', () => {
  const { sim, squirrel, truck } = setup();
  try {
    besideFlank(squirrel, truck, 2.6); press(sim, 0); sim.tick();
    assert.ok(squirrel.wall);
    squirrel.wallTime = C.squirrelGripSeconds - 0.05;
    for (let i = 0; i < 4; i++) { press(sim, 0); sim.tick(); }
    assert.equal(squirrel.wall, null, 'grip spent');
    // Held right against the face it still cannot re-grab.
    for (let i = 0; i < 10; i++) { press(sim, 0, [], [0, -1]); sim.tick(); assert.equal(squirrel.wall, null); }
    // Landing refills the grip.
    squirrel.spawn(truck); for (let i = 0; i < 90 && squirrel.state !== 'ground'; i++) { press(sim, 0); sim.tick(); }
    assert.equal(squirrel.state, 'ground'); assert.equal(squirrel.wallTime, 0);
  } finally { sim.dispose(); }
});

test('Space kicks off the wall; steering back re-grabs higher and climbs onto the roof; pushing away lets go', () => {
  const { sim, squirrel, truck } = setup();
  try {
    besideFlank(squirrel, truck, 1.1); press(sim, 0); sim.tick();
    assert.ok(squirrel.wall);
    const grabbedAt = squirrel.pos.y - hullBase(truck);
    press(sim, 0, ['Space'], [0, -1]); sim.tick();
    assert.equal(squirrel.wall, null, 'kicked off');
    assert.ok(squirrel.vel.y > 6.4, 'upward'); assert.ok(squirrel.vel.z - truck.vel.z > 1.6, 'away from the face'); // character scale 0.8
    let highest = -Infinity, regrabs = 0, wasOn = false;
    for (let i = 0; i < 240 && squirrel.state !== 'ground'; i++) {
      const on = !!squirrel.wall;
      if (on && !wasOn) { regrabs++; highest = Math.max(highest, squirrel.pos.y - hullBase(truck)); }
      wasOn = on;
      press(sim, 0, on && i % 3 === 0 ? ['Space'] : [], [0, -1]); sim.tick();
    }
    assert.ok(regrabs >= 1 && highest > grabbedAt + 0.8, `re-grabbed higher (${highest.toFixed(2)} vs ${grabbedAt.toFixed(2)})`);
    assert.equal(squirrel.state, 'ground', 'climbed back onto the roof'); assert.equal(squirrel.ground.truck, truck);
    // Pushing away from the face drops off it.
    besideFlank(squirrel, truck, 2.2); press(sim, 0); sim.tick(); assert.ok(squirrel.wall);
    press(sim, 0, [], [0, 1]); sim.tick();
    assert.equal(squirrel.wall, null); assert.ok(squirrel.vel.z - truck.vel.z > 1);
    for (let i = 0; i < 6; i++) { press(sim, 0); sim.tick(); }
    assert.equal(squirrel.wall, null, 'no instant re-grab after pushing off');
  } finally { sim.dispose(); }
});

test('roof props are walls too: a squirrel jumping into the wash station sticks and slides down onto the roof', () => {
  const { sim, squirrel, truck } = setup();
  try {
    const solid = truck.solids[0], box = wallBoxes(truck).find((b: any) => b.solid === solid);
    assert.ok(box && box.y0 === truck.spec.top);
    squirrel.state = 'air'; squirrel.ground = null; squirrel.wall = null; squirrel.wallLock = 0;
    squirrel.pos.set(truck.pos.x + solid.x + solid.hx + 0.5, truck.topY + 0.65, truck.pos.z + solid.z);
    squirrel.vel.set(truck.vel.x, -1, truck.vel.z);
    press(sim, 0); sim.tick();
    assert.ok(squirrel.wall); assert.equal(squirrel.wall.axis, 'x'); assert.equal(squirrel.wall.side, 1);
    for (let i = 0; i < 180 && squirrel.state !== 'ground'; i++) { press(sim, 0); sim.tick(); }
    assert.equal(squirrel.state, 'ground', 'slid down onto the roof'); assert.equal(squirrel.wall, null);
    sim.game.station.visible = false;
    squirrel.state = 'air'; squirrel.ground = null;
    squirrel.pos.set(truck.pos.x + solid.x + solid.hx + 0.5, truck.topY + 0.65, truck.pos.z + solid.z); squirrel.vel.set(truck.vel.x, -1, truck.vel.z);
    press(sim, 0); sim.tick();
    assert.equal(squirrel.wall, null, 'a hidden station is not a wall');
  } finally { sim.dispose(); }
});

test('peers restore the cling in the vehicle frame; stuns, swallows and other animals never cling', () => {
  const { sim, squirrel, cat, truck } = setup();
  try {
    besideFlank(squirrel, truck, 2.2); press(sim, 0); sim.tick();
    for (let i = 0; i < 20; i++) { press(sim, 0); sim.tick(); }
    const snap = quantize(sim.snapshot()), state = snap.players[0];
    assert.equal(state.parent, sim.trucks.indexOf(truck), 'the clung hull is the interpolation parent');
    assert.ok(state.wall && state.wallTime > 0.3);
    const peer: any = new Simulation();
    try {
      applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, snap);
      snap.players.forEach((data: any, i: number) => applyPlayer(peer.players[i], data, peer.trucks));
      const mirror = peer.players[0];
      assert.equal(mirror.wall.truck, peer.trucks[sim.trucks.indexOf(truck)]); assert.equal(mirror.wall.axis, 'z');
      assert.equal(mirror.ground, null, 'a clinging squirrel is not standing on the roof');
      assert.ok(mirror.pos.distanceTo(squirrel.pos) < 0.01);
      assert.ok(Math.abs(mirror.wallTime - squirrel.wallTime) < 0.01);
    } finally { peer.dispose(); }
    // Live water shock drops it off.
    squirrel.stun(1); assert.equal(squirrel.wall, null);
    // A cat beside the same face never grabs.
    besideFlank(cat, truck, 2.2); press(sim, 1); sim.tick(); assert.equal(cat.wall, null);
  } finally { sim.dispose(); }
});

test('the client squirrel shows grab, slide haze and kick-off feedback from the shared cling state', async () => {
  const player: any = new Player(new THREE.Scene(), { slot: 2 });
  await player.appearanceReady;
  player.setAppearance({ animal: 'squirrel', breed: 'chipmunk', color: 5 });
  assert.equal(player.body, player.squirrel); assert.equal(player.animal, 'squirrel');
  for (const name of ['tail0', 'tail3', 'earL', 'earR']) assert.ok(player.squirrel.bones[name], name);
  // A smaller body under a full-size tail: the head sits lower, but the tail spans what an unscaled model's would.
  const model = player.squirrel, at = (bone: any) => { player.root.updateMatrixWorld(true); return bone.getWorldPosition(new THREE.Vector3()); };
  const measure = () => ({ head: at(model.bones.head).y - at(model.bones.root).y, tail: at(model.bones.tail0).distanceTo(at(model.bones.tail3)) });
  const drawn = measure();
  model.group.scale.setScalar(1); model.bones.tail0.scale.setScalar(1);
  const full = measure();
  model.group.scale.setScalar(SQUIRREL_BODY); model.bones.tail0.scale.setScalar(1 / SQUIRREL_BODY);
  assert.ok(SQUIRREL_BODY < 1 && Math.abs(drawn.head - full.head * SQUIRREL_BODY) < 1e-6, 'smaller body');
  assert.ok(Math.abs(drawn.tail - full.tail) < 1e-6, 'tail keeps its size');
  const calls: any[] = [], sounds: string[] = [];
  player.onWallFx = (parameters: any) => calls.push(parameters); player.onSound = (event: string) => sounds.push(event);
  const truck = { vel: new THREE.Vector3(1, 0, 0) };
  player.state = 'air'; player.ground = null; player.vel.set(0, -6, 0); player.updateVisual(1 / 60);
  player.wall = { truck, axis: 'z', side: 1, along: 0, y: 1 }; player.wallTime = 0;
  player.updateVisual(1 / 60);
  assert.equal(calls[0].type, 'grab'); assert.deepEqual(calls[0].normal, { x: 0, z: 1 }); assert.ok(sounds.includes('cling'));
  assert.ok(Math.abs(calls[0].contact.z - (player.root.position.z - WALL_GAP)) < 1e-9, 'puffs sit on the face, not on the body');
  // A fast slide leaves far more haze than a fresh grab.
  const count = (wallTime: number) => {
    player.wallTime = wallTime; const before = calls.length;
    for (let i = 0; i < 60; i++) player.updateVisual(1 / 60);
    return calls.slice(before).filter(call => call.type === 'slide').length;
  };
  const slow = count(0.1), fast = count(2.5);
  assert.ok(slow >= 2 && fast > slow * 3, `haze per second slow ${slow}, fast ${fast}`);
  player.wall = null; player.vel.set(0, 9, 0); player.updateVisual(1 / 60);
  assert.equal(calls.at(-1).type, 'kick'); assert.ok(sounds.includes('wallJump'));
  assert.ok(calls.at(-1).carry.equals(truck.vel), 'effects ride with the vehicle');
});
