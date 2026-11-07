import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Simulation } from './fixtures/Simulation.js';
import { WASH_CONFIG as C } from '../shared/sim/washConfig.js';
import { playerMass, TOOL_MASS } from '../shared/sim/Mass.js';
import { riderWeight } from '../shared/sim/VehicleLoad.js';
import { validInput, packetInput, MAX_STRUGGLES, VERSION } from '../shared/protocol.js';
import { enqueueInput } from '../shared/inputQueue.js';
import { quantize } from '../shared/delta.js';
import { applyWorld, applyPlayer } from '../shared/snapshot.js';
import { validAvatar, PELICAN_BREEDS } from '../shared/avatar.js';
import { Player } from '../client/js/game/Player.js';

let seq = 0;
const press = (sim: Simulation, slot: number, hits: string[] = [], down: string[] = hits) => sim.input(slot, { seq: ++seq, move: [0, 0], axis: [0, 0], down, hits });

/** Practice scene with a pelican in slot 0 and a cat in slot 1 standing just in front of its beak. */
function setup() {
  const sim = new Simulation(); seq = 0;
  sim.occupy(0, true); sim.occupy(1, true); sim.setAnimal(0, 'pelican');
  sim.connected = [true, true, false, false];
  for (let i = 0; i < 120; i++) { press(sim, 0); press(sim, 1); sim.tick(); }
  const [pelican, cat] = sim.players, truck = sim.trucks[0];
  assert.equal(pelican.state, 'ground'); assert.equal(cat.state, 'ground');
  pelican.yaw = 0; cat.pos.copy(pelican.pos).add(new THREE.Vector3(0.55, 0, 0)); cat.ground = { truck, plat: truck.platformAt(cat.pos.x, cat.pos.z, 0.3) };
  return { sim, pelican, cat, truck };
}

test('pelican avatars validate and L joins the input protocol', () => {
  for (const breed of PELICAN_BREEDS) assert.equal(validAvatar({ animal: 'pelican', breed: breed.id, color: 2 }), true);
  assert.equal(validAvatar({ animal: 'pelican', breed: 'corgi', color: 2 }), false);
  assert.equal(VERSION, 42);
  assert.equal(validInput({ seq: 1, move: [0, 0], axis: [0, 0], down: ['Space', 'KeyJ', 'KeyK', 'KeyL'], hits: ['KeyL'] }), true);
  assert.equal(validInput({ seq: 1, move: [0, 0], axis: [0, 0], down: ['KeyL', 'KeyX'], hits: [] }), false);
});

test('L swallows a teammate: they ride in the pouch, cannot act, and make the pelican twice as heavy', () => {
  const { sim, pelican, cat } = setup();
  try {
    const towel = sim.game.towels[0]; towel.pickup(cat);
    const signature = sim.urgentSignature();
    press(sim, 0, ['KeyL']); sim.tick();
    assert.equal(pelican.swallowed, cat); assert.equal(cat.swallowedBy, pelican); assert.equal(cat.state, 'swallowed');
    assert.equal(cat.heldTool, null, 'the swallowed teammate lets go of its tool'); assert.notEqual(towel.holder, cat);
    assert.notEqual(sim.urgentSignature(), signature, 'swallowing is sent in the same tick');
    assert.equal(playerMass(pelican), 2); assert.equal(riderWeight(pelican), 2);
    // The passenger follows the pelican and ignores its own input.
    for (let i = 0; i < 30; i++) { sim.input(0, { seq: ++seq, move: [0, 1], axis: [0, 1], down: [], hits: [] }); press(sim, 1, ['Space', 'KeyJ']); sim.tick(); }
    assert.equal(cat.state, 'swallowed'); assert.ok(cat.pos.distanceTo(pelican.pos) < 0.8);
    assert.equal(cat.heldTool, null, 'cannot pick anything up from inside the pouch');
    // Peers see the same pouch.
    const peer = new Simulation();
    try {
      const snap = quantize(sim.snapshot());
      applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, snap);
      snap.players.forEach((state: any, i: number) => applyPlayer(peer.players[i], state, peer.trucks));
      assert.equal(peer.players[0].swallowed, peer.players[1]); assert.equal(peer.players[1].state, 'swallowed');
      assert.equal(riderWeight(peer.players[0]), 2, 'every viewer leans the vehicle with the same weight');
    } finally { peer.dispose(); }
  } finally { sim.dispose(); }
});

test('a heavier pelican is shoved less by the water gun', () => {
  const { sim, pelican, cat } = setup();
  try {
    const direction = new THREE.Vector3(0, 0, 1), shove = () => {
      pelican.externalVelocity.set(0, 0, 0);
      const gun = sim.game.waterguns[0]; gun.pickup(cat); gun.pressure = 1; gun.trace = () => { gun.hitPlayer = pelican; };
      sim.game.spray(cat, { down: (k: string) => k === 'KeyJ', hit: () => false } as any, 1 / 60);
      gun.direction = () => direction; return pelican.externalVelocity.length();
    };
    const gun = sim.game.waterguns[0]; gun.direction = () => direction;
    const light = shove(); gun.clearHolder();
    assert.ok(Math.abs(light - C.sprayPushSpeed * 0.8) < 1e-6); // shoves at the character scale
    // Swallow a towel: the pouch weight adds to the pelican.
    const towel = sim.game.towels[0]; towel.placeOn(sim.trucks[0], new THREE.Vector3(pelican.pos.x - sim.trucks[0].pos.x + 0.5, 0, pelican.pos.z - sim.trucks[0].pos.z));
    sim.scene.updateMatrixWorld(true); cat.pos.z += 3;
    press(sim, 0, ['KeyL']); sim.tick();
    assert.equal(pelican.swallowed, towel); assert.equal(towel.swallowedBy, pelican);
    assert.equal(sim.game.nearestTool(cat), null, 'a swallowed towel cannot be picked up'); assert.equal(towel.pickup(cat), false);
    assert.ok(Math.abs(playerMass(pelican) - (1 + TOOL_MASS.towel)) < 1e-9);
    const loaded = shove();
    assert.ok(Math.abs(loaded - C.sprayPushSpeed * 0.8 / (1 + TOOL_MASS.towel)) < 1e-6, 'knockback scales with 1/mass');
  } finally { sim.dispose(); }
});

test('L again spits the teammate forward into the air; the water gun is never swallowed', () => {
  const { sim, pelican, cat } = setup();
  try {
    press(sim, 0, ['KeyL']); sim.tick(); press(sim, 0); sim.tick();
    assert.equal(pelican.swallowed, cat);
    const start = pelican.pos.clone();
    press(sim, 0, ['KeyL']); sim.tick();
    assert.equal(pelican.swallowed, null); assert.equal(cat.swallowedBy, null); assert.equal(cat.state, 'air');
    for (let i = 0; i < 20; i++) { press(sim, 0); press(sim, 1); sim.tick(); }
    const truck = sim.trucks[0];
    assert.ok((cat.pos.x - truck.pos.x) - (start.x - truck.pos.x) > 1.2, 'spat out forward, relative to the vehicle');
    // Non-pelicans and the hose-tied water gun.
    const gun = sim.game.waterguns[0]; gun.placeOn(truck, new THREE.Vector3(pelican.pos.x - truck.pos.x + 0.5, 0, pelican.pos.z - truck.pos.z));
    cat.pos.copy(pelican.pos).add(new THREE.Vector3(0, 0, 4)); sim.scene.updateMatrixWorld(true);
    press(sim, 0, ['KeyL']); sim.tick(); assert.equal(pelican.swallowed, null, 'water gun stays on its hose');
    sim.setAnimal(0, 'cat'); cat.pos.copy(pelican.pos).add(new THREE.Vector3(0.55, 0, 0));
    press(sim, 0, ['KeyL']); sim.tick(); assert.equal(pelican.swallowed, null, 'only pelicans swallow');
  } finally { sim.dispose(); }
});

test('falling off drops the pouch: the swallowed teammate falls too; resets and departures free the pouch', () => {
  const { sim, pelican, cat } = setup();
  try {
    press(sim, 0, ['KeyL']); sim.tick(); assert.equal(pelican.swallowed, cat);
    pelican.state = 'air'; pelican.ground = null; pelican.pos.y = 0.05; pelican.vel.set(0, -5, 0);
    press(sim, 0); sim.tick();
    assert.equal(pelican.state, 'fallen'); assert.equal(pelican.swallowed, null); assert.notEqual(cat.state, 'swallowed');
    for (let i = 0; i < 20; i++) { press(sim, 0); press(sim, 1); sim.tick(); }
    assert.equal(cat.state, 'fallen', 'the passenger lands on the road as well');
  } finally { sim.dispose(); }
  const again = setup();
  try {
    press(again.sim, 0, ['KeyL']); again.sim.tick(); assert.equal(again.pelican.swallowed, again.cat);
    again.sim.occupy(0, false); assert.equal(again.cat.swallowedBy, null); assert.equal(again.cat.state, 'air');
    again.sim.occupy(0, true); again.sim.setAnimal(0, 'pelican');
    for (let i = 0; i < 120; i++) { press(again.sim, 0); press(again.sim, 1); again.sim.tick(); }
    again.pelican.yaw = 0; again.cat.pos.copy(again.pelican.pos).add(new THREE.Vector3(0.55, 0, 0));
    press(again.sim, 0, ['KeyL']); again.sim.tick(); assert.equal(again.pelican.swallowed, again.cat);
    again.sim.command('start'); assert.equal(again.pelican.swallowed, null); assert.equal(again.cat.swallowedBy, null);
  } finally { again.sim.dispose(); }
});

test('pelican model: shared geometry per breed, crest size, pouch swells on a gulp and the swallowed player is hidden', async () => {
  const scene = new THREE.Scene(), pelican = new Player(scene, { slot: 0 }), cat = new Player(scene, { slot: 1 });
  await pelican.appearanceReady;
  const geometry = pelican.pelican.meshes.base.geometry, details = pelican.pelican.meshes.details.geometry;
  for (const breed of PELICAN_BREEDS) {
    pelican.setAppearance({ animal: 'pelican', breed: breed.id, color: 3 });
    assert.equal(pelican.body, pelican.pelican); assert.equal(pelican.cat.group.visible, false); assert.equal(pelican.dog.group.visible, false);
    assert.equal(pelican.pelican.meshes.base.geometry, geometry); assert.equal(pelican.pelican.meshes.details.geometry, details);
  }
  assert.ok(pelican.pelican.bones.earL.scale.x > 1.5, 'dalmatian pelicans have the big curly crest');
  pelican.state = cat.state = 'ground'; pelican.updateVisual(1 / 60); cat.updateVisual(1 / 60);
  const empty = pelican.pelican.bones.pouch.scale.y;
  pelican.swallowed = cat; cat.swallowedBy = pelican; cat.state = 'swallowed';
  for (let i = 0; i < 40; i++) { pelican.updateVisual(1 / 60); cat.updateVisual(1 / 60); }
  assert.ok(pelican.pelican.bones.pouch.scale.y > empty + 1, 'a swallowed teammate fills the pouch');
  assert.equal(cat.squash.visible, false); assert.equal(cat.footRing.visible, false);
  pelican.swallowed = null; cat.swallowedBy = null; cat.state = 'air';
  for (let i = 0; i < 90; i++) { pelican.updateVisual(1 / 60); cat.updateVisual(1 / 60); }
  assert.ok(pelican.pelican.bones.pouch.scale.y < empty + 0.15, 'spitting empties the pouch'); assert.equal(cat.squash.visible, true);
});

test('a swallowed teammate breaks free when the synced countdown runs out', () => {
  const { sim, pelican, cat } = setup();
  try {
    press(sim, 0, ['KeyL']); sim.tick();
    assert.equal(pelican.swallowed, cat); assert.equal(cat.swallowRemaining, C.swallowSeconds, 'the countdown starts full on the swallow tick');
    for (let i = 0; i < 60; i++) { press(sim, 0); press(sim, 1); sim.tick(); }
    const peer = new Simulation();
    try {
      const snap = quantize(sim.snapshot());
      applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, snap);
      snap.players.forEach((state: any, i: number) => applyPlayer(peer.players[i], state, peer.trucks));
      assert.ok(Math.abs(peer.players[1].swallowRemaining - cat.swallowRemaining) < 1e-3, 'every viewer shows the same countdown');
    } finally { peer.dispose(); }
    for (let i = 0; i < Math.round(C.swallowSeconds * 60) - 61; i++) { press(sim, 0); press(sim, 1); sim.tick(); }
    assert.equal(pelican.swallowed, cat, 'still inside just before the timer ends');
    for (let i = 0; i < 3; i++) { press(sim, 0); press(sim, 1); sim.tick(); }
    assert.equal(pelican.swallowed, null); assert.equal(cat.swallowedBy, null); assert.equal(cat.state, 'air'); assert.equal(cat.swallowRemaining, 0);
    assert.ok(cat.vel.y > 0, 'breaking free launches the teammate out of the beak');
  } finally { sim.dispose(); }
});

test('gulp and spit share one wide springy gape animation, particles at the beak and a suck-in/pop-out for the passenger', async () => {
  const scene = new THREE.Scene(), pelican = new Player(scene, { slot: 0 }), cat = new Player(scene, { slot: 1 });
  await pelican.appearanceReady;
  pelican.setAppearance({ animal: 'pelican', breed: 'white', color: 0 });
  const fx: any[] = [], sounds: string[] = [];
  pelican.onPouchFx = (p: any) => fx.push(p); pelican.onSound = (e: string) => { if (e === 'gulp' || e === 'spit') sounds.push(e); };
  pelican.state = cat.state = 'ground'; pelican.updateVisual(1 / 60); cat.updateVisual(1 / 60);
  pelican.swallowed = cat; cat.swallowedBy = pelican; cat.state = 'swallowed';
  let widest = 0, suckShown = false, smallest = 1;
  for (let i = 0; i < 40; i++) {
    pelican.updateVisual(1 / 60); cat.updateVisual(1 / 60);
    widest = Math.max(widest, -pelican.pelican.bones.jaw.rotation.z);
    if (cat.squash.visible) { suckShown = true; smallest = Math.min(smallest, cat.squash.scale.y); }
  }
  assert.ok(widest > 1.3, `the beak gapes wide open (${widest.toFixed(2)} rad)`);
  assert.ok(-pelican.pelican.bones.jaw.rotation.z < 0.3, 'then chomps shut');
  assert.ok(suckShown && smallest < 0.5, 'the passenger is visibly sucked in, shrinking, before hiding');
  assert.equal(cat.squash.visible, false);
  assert.equal(fx.length, 1); assert.equal(fx[0].type, 'gulp'); assert.ok(fx[0].mouth.y > 0.6); assert.deepEqual(sounds, ['gulp']);
  pelican.swallowed = null; cat.swallowedBy = null; cat.state = 'air';
  widest = 0; let popped = 0;
  for (let i = 0; i < 40; i++) { pelican.updateVisual(1 / 60); cat.updateVisual(1 / 60); widest = Math.max(widest, -pelican.pelican.bones.jaw.rotation.z); popped = Math.max(popped, cat.squash.scale.y); }
  assert.ok(widest > 1.3, 'the spit plays the same wide gulp gape'); assert.equal(fx[1].type, 'spit'); assert.deepEqual(sounds, ['gulp', 'spit']);
  assert.equal(cat.squash.visible, true); assert.ok(popped > 1.02, 'pops out with an overshoot');
});

test('pelican player/tool spit has horizontal speed 6, original lift and reduced carry boost', () => {
  const {sim,pelican,cat,truck}=setup(),peer=new Simulation();
  try {
    truck.vel.set(2,0,-1);pelican.yaw=0;
    sim.game.swallow(pelican,cat);sim.game.spit(pelican,true);
    // A spat player flies at the character scale (0.8) relative to the carrier.
    assert.ok(Math.abs(cat.vel.x-truck.vel.x-6*0.8)<1e-9);assert.ok(Math.abs(cat.vel.y-7*0.8)<1e-9);assert.equal(cat.vel.z,truck.vel.z);
    assert.equal(cat.jumpBoost,.3*.6);
    const snap=quantize(sim.snapshot());applyWorld({game:peer.game,trucks:peer.trucks,players:peer.players},snap);
    snap.players.forEach((state:any,i:number)=>applyPlayer(peer.players[i],state,peer.trucks));
    assert.ok(Math.abs(peer.players[1].vel.y-7*0.8)<1e-6);assert.equal(peer.players[1].jumpBoost,.18);
    cat.update(1/60,sim.time,{axis:()=>({x:0,y:0}),worldAxis:()=>({x:0,z:0}),hit:()=>false,down:()=>false},[truck],sim.camera,30);
    assert.ok(cat.vel.x-truck.vel.x<=6);assert.ok(cat.jumpBoost<.18);
    const towel=sim.game.towels[0];sim.game.swallow(pelican,towel);sim.game.spit(pelican,true);
    assert.ok(towel.flight);assert.equal(towel.velocity.x-truck.vel.x,6);assert.equal(towel.velocity.y,7);
    sim.game.swallow(pelican,cat);sim.game.spit(pelican,false);
    assert.equal(cat.vel.x,truck.vel.x);assert.ok(Math.abs(cat.vel.y-0.8)<1e-9);assert.equal(cat.jumpBoost,0,'fall/departure drops retain their original behavior (lift at the character scale)');
  } finally {sim.dispose();peer.dispose();}
});

const struggle = (sim: Simulation, slot: number, count: number) => sim.input(slot, { seq: ++seq, move: [0, 0], axis: [0, 0], down: [], hits: [], struggle: count });

test('struggle presses are a bounded optional input field that the queue never coalesces away', () => {
  const base = { seq: 1, move: [0, 0], axis: [0, 0], down: [], hits: [] };
  assert.equal(validInput(base), true, 'older packets without struggle stay valid');
  assert.equal(validInput({ ...base, struggle: 1 }), true); assert.equal(validInput({ ...base, struggle: MAX_STRUGGLES }), true);
  for (const bad of [0, -1, MAX_STRUGGLES + 1, 1.5, '2']) assert.equal(validInput({ ...base, struggle: bad }), false);
  assert.equal(packetInput({ ...base, struggle: 3 }).struggles(), 3); assert.equal(packetInput(base).struggles(), 0);
  const queue: any[] = [];
  enqueueInput(queue, { ...base, struggle: 2 }); enqueueInput(queue, { ...base, seq: 2 });
  assert.equal(queue.length, 2, 'a sample carrying struggles is not replaced by the next quiet sample');
});

test('swallowing lasts 3 seconds; each struggle press removes 0.2 s, at most 5 per rolling second', () => {
  assert.equal(C.swallowSeconds, 3); assert.equal(C.swallowStruggleSeconds, 0.2); assert.equal(C.swallowStrugglesPerSecond, 5);
  const { sim, pelican, cat } = setup();
  try {
    press(sim, 0, ['KeyL']); sim.tick(); assert.equal(pelican.swallowed, cat);
    assert.equal(cat.interactionHint, '被鹈鹕吞下了！连按任意键挣脱');
    const before = cat.swallowRemaining;
    press(sim, 0); struggle(sim, 1, MAX_STRUGGLES); sim.tick();
    assert.ok(Math.abs(before - cat.swallowRemaining - (5 * 0.2 + 1 / 60)) < 1e-6, 'eight presses in one sample still count as five');
    const capped = cat.swallowRemaining;
    for (let i = 0; i < 30; i++) { press(sim, 0); struggle(sim, 1, 1); sim.tick(); }
    assert.ok(Math.abs(capped - cat.swallowRemaining - 30 / 60) < 1e-6, 'no extra presses are accepted inside the same second');
    // Steady mashing frees the victim well before the plain timer.
    let ticks = 0;
    while (pelican.swallowed && ticks < 600) { press(sim, 0); struggle(sim, 1, 1); sim.tick(); ticks++; }
    assert.equal(pelican.swallowed, null); assert.equal(cat.state, 'air');
    assert.ok(31 + ticks < C.swallowSeconds * 60 - 30, 'struggling shortens the stay');
    // A non-swallowed player's struggle field changes nothing.
    const free = cat.swallowRemaining; struggle(sim, 1, 4); press(sim, 0); sim.tick(); assert.equal(cat.swallowRemaining, free);
  } finally { sim.dispose(); }
});

test('after a swallowed player leaves the pouch the pelican waits 5 s before swallowing a player; tools are exempt', () => {
  assert.equal(C.swallowCooldownSeconds, 5);
  const { sim, pelican, cat, truck } = setup();
  try {
    press(sim, 0, ['KeyL']); sim.tick(); press(sim, 0); sim.tick();
    press(sim, 0, ['KeyL']); sim.tick(); assert.equal(pelican.swallowed, null);
    assert.equal(pelican.swallowCooldown, C.swallowCooldownSeconds);
    for (let i = 0; i < 60; i++) { press(sim, 0); press(sim, 1); sim.tick(); }
    const peer = new Simulation();
    try {
      const snap = quantize(sim.snapshot());
      snap.players.forEach((state: any, i: number) => applyPlayer(peer.players[i], state, peer.trucks));
      assert.ok(Math.abs(peer.players[0].swallowCooldown - pelican.swallowCooldown) < 1e-3, 'the cooldown is synced');
    } finally { peer.dispose(); }
    const place = () => { cat.state = 'ground'; cat.vel.set(0, 0, 0); cat.pos.copy(pelican.pos).add(new THREE.Vector3(0.55, 0, 0)); cat.ground = { truck, plat: truck.platformAt(cat.pos.x, cat.pos.z, 0.3) }; };
    place(); press(sim, 0, ['KeyL']); sim.tick();
    assert.equal(pelican.swallowed, null, 'players cannot be swallowed during the cooldown');
    // A loose towel within reach is still swallowed and spat during the cooldown.
    const towel = sim.game.towels[0]; towel.placeOn(truck, new THREE.Vector3(pelican.pos.x - truck.pos.x + 0.5, 0, pelican.pos.z - truck.pos.z));
    cat.pos.z += 6; sim.scene.updateMatrixWorld(true);
    press(sim, 0, ['KeyL']); sim.tick(); assert.equal(pelican.swallowed, towel, 'tools ignore the player cooldown');
    press(sim, 0); sim.tick(); press(sim, 0, ['KeyL']); sim.tick(); assert.equal(pelican.swallowed, null);
    for (let i = 0; i < 4 * 60; i++) { press(sim, 0); press(sim, 1); sim.tick(); }
    assert.equal(pelican.swallowCooldown, 0, 'spitting a tool does not restart the player cooldown');
    place(); press(sim, 0, ['KeyL']); sim.tick(); assert.equal(pelican.swallowed, cat);
  } finally { sim.dispose(); }
});

test('an empty-pouched pelican glides while holding Space and falling; the glide refills on landing', () => {
  const fall = (animal: string, hold: boolean, pouch = false) => {
    const { sim, pelican, cat } = setup();
    try {
      sim.setAnimal(0, animal);
      if (pouch) { press(sim, 0, ['KeyL']); sim.tick(); assert.equal(pelican.swallowed, cat); }
      pelican.state = 'air'; pelican.ground = null; pelican.pos.y += 8; pelican.vel.y = 0; pelican.takeoff = sim.trucks[0];
      let maxDrop = 0, glidingTicks = 0;
      for (let i = 0; i < 60; i++) {
        press(sim, 0, [], hold ? ['Space'] : []); press(sim, 1); sim.tick();
        if (pelican.state !== 'air') break;
        maxDrop = Math.max(maxDrop, -pelican.vel.y); if (pelican.gliding) glidingTicks++;
        if (i === 30) {
          // Every viewer poses the same glide.
          const peer = new Simulation();
          try { applyPlayer(peer.players[0], quantize(sim.snapshot()).players[0], peer.trucks); assert.equal(peer.players[0].gliding, pelican.gliding); }
          finally { peer.dispose(); }
        }
      }
      return { maxDrop, glidingTicks, remaining: pelican.glideRemaining };
    } finally { sim.dispose(); }
  };
  const glide = fall('pelican', true);
  assert.ok(glide.maxDrop <= C.pelicanGlideFallSpeed + 1e-6, 'descent is capped while gliding');
  assert.equal(glide.glidingTicks, 60, 'a one-second fall stays inside the 1.25 s glide');
  assert.ok(Math.abs(glide.remaining - (C.pelicanGlideSeconds - 1)) < 1e-6);
  assert.ok(fall('pelican', false).maxDrop > 10, 'without Space the pelican falls normally');
  assert.ok(fall('cat', true).maxDrop > 10, 'only pelicans glide');
  assert.ok(fall('pelican', true, true).maxDrop > 10, 'a pelican holding a player cannot glide');

  const { sim, pelican } = setup();
  try {
    pelican.glideRemaining = 0;
    pelican.state = 'air'; pelican.ground = null; pelican.pos.y += 0.5; pelican.vel.y = 0; pelican.takeoff = sim.trucks[0];
    for (let i = 0; i < 60 && pelican.state !== 'ground'; i++) { press(sim, 0, [], ['Space']); press(sim, 1); sim.tick(); }
    assert.equal(pelican.state, 'ground'); assert.equal(pelican.glideRemaining, C.pelicanGlideSeconds, 'landing refills the glide');
  } finally { sim.dispose(); }
});
