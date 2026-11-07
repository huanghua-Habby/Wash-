import { WOBBLE } from '../shared/sim/Wobble.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Simulation } from './fixtures/Simulation.js';
import { CHARGING, chargingPortLocal } from '../shared/sim/chargingConfig.js';
import { packetInput, VERSION } from '../shared/protocol.js';
import { applyWorld, applyPlayer } from '../shared/snapshot.js';
import { quantize, diff, patch, SnapshotEncoder, SnapshotDecoder } from '../shared/delta.js';
import { SAVE_VERSION } from '../shared/levels.js';
import { room } from './helpers/peerRoom.js';
import { SharedWetSurfaces } from '../client/js/fx/SharedWetSurfaces.js';
import { WetSurfaces } from '../client/js/fx/WetSurfaces.js';
import { ElectricWaterEffects } from '../client/js/fx/ElectricWaterEffects.js';

const dt = 1 / 60;
function splash(wet: any, truck: any, x: number, z: number) { wet.splash(truck, x, z); wet.advance(.12, 0); }
const keys = (down: string[] = [], hits: string[] = []) => packetInput({ seq: 1, move: [0, 0], axis: [0, 0], down, hits });
function ground(sim: Simulation, slot: number, truck: any, x: number, z: number) {
  const p = sim.players[slot]; p.state = 'ground'; p.ground = { truck, plat: truck.platformAt(truck.pos.x + x, truck.pos.z + z, 0) };
  p.pos.set(truck.pos.x + x, truck.topY, truck.pos.z + z); p.root.position.copy(p.pos);
  p.vel.set(0, 0, 0); p.externalVelocity.set(0, 0, 0); p.yaw = 0; p.yawG.rotation.y = 0;
  return p;
}
function world() {
  const sim = new Simulation(); sim.occupy(0, true); sim.occupy(1, true);
  sim.phase = 'game'; sim.game.start(30); sim.game.wet.random = () => .5; sim.game.inputs = sim.players.map(() => keys());
  ground(sim, 0, sim.trucks[0], -3, -1); ground(sim, 1, sim.trucks[0], -4, 1);
  sim.scene.updateMatrixWorld(true); return sim;
}

test('charging cable retracts with endpoint distance, bends slightly and shares a bounded leash/capsule sweep', () => {
  const sim = world(); try {
    const head = sim.game.chargers[0], cable = sim.game.cables[0], home = sim.trucks[0];
    head.placeOn(home, new THREE.Vector3(2, 0, -.65)); cable.reset(); const long = cable.length;
    head.placeOn(home, new THREE.Vector3(4.8, 0, -.65)); cable.update(dt, [home], [], []);
    assert.ok(cable.length < long / 3, 'unused length returns to reel, no heap of slack rope');
    cable.nodes.forEach((node: any, i: number) => { const t = i / (cable.nodes.length - 1); assert.ok(Math.abs(node.z - THREE.MathUtils.lerp(cable.anchor().z, head.connector().z, t)) < 1e-8); });
    head.release(null); head.mesh.position.copy(cable.anchor()).add(new THREE.Vector3(-CHARGING.maxLength - 2, 0, 0));
    cable.update(dt, [home], [], []); assert.ok(head.connector().distanceTo(cable.anchor()) <= CHARGING.maxLength + 1e-8);
    const a = cable.nodes[0], b = cable.nodes.at(-1);
    cable.nodes.forEach((node: any, i: number) => assert.ok(node.distanceTo(a.clone().lerp(b, i / (cable.nodes.length - 1))) <= CHARGING.bend + 1e-8));
    const p = ground(sim, 1, home, 3.4, -.65);
    head.placeOn(home, new THREE.Vector3(2, 0, -.65)); cable.reset();
    cable.update(dt, [home], [p], [p.pos.clone()]);
    assert.ok(p.externalVelocity.length() > 0, 'deployed reel cable retains player collision below maximum payout');
    p.state = 'air'; p.pos.y = home.topY + 2; p.externalVelocity.set(0, 0, 0);
    cable.update(dt, [home], [p], [p.pos.clone()]); assert.equal(p.externalVelocity.length(), 0, 'jumping clears the finite capsule');
  } finally { sim.dispose(); }
});

test('J picks up one charging connector, K places/throws it and source recall resets the reel', () => {
  const sim = world(); try {
    const head = sim.game.chargers[0], home = sim.trucks[0], cable = sim.game.cables[0];
    const p = ground(sim, 0, home, 4.45, -.55), q = ground(sim, 1, home, 4.45, -.55);
    sim.game.interact(p, keys(['KeyJ'], ['KeyJ']), dt);
    // Only the pickup conflict here: a ready empty-handed J would slap P point-blank and knock the connector loose.
    q.slapCooldown = 1;
    sim.game.interact(q, keys(['KeyJ'], ['KeyJ']), dt);
    assert.equal(head.holder, p); assert.notEqual(q.heldTool, head);
    sim.game.interact(p, keys([], ['KeyK']), dt); assert.equal(head.holder, null); assert.equal(head.flight, false);
    head.pickup(p); head.launch(p); assert.equal(head.flight, true); assert.equal(head.holder, null);
    const anchor = cable.anchor(); ground(sim, 0, home, anchor.x - home.pos.x, anchor.z - home.pos.z);
    sim.game.interact(p, keys(['KeyJ'], ['KeyJ']), dt);
    assert.equal(head.holder, p); assert.equal(cable.tension, 0); assert.ok(cable.nodes.at(-1).distanceTo(head.connector()) < 1e-8);
  } finally { sim.dispose(); }
});

test('front socket charges once, unplugging preserves progress, pause freezes and leaving disconnects', () => {
  const sim = world(); try {
    const order = sim.game.spawnOrder(0), home = sim.trucks[0], head = sim.game.chargers[0];
    order.truck.setState(home.pos.x, home.pos.z - 3.9, 0, 0, 30); order.truck.setAltitude(home.topY - order.truck.topLocal);
    const [x, , z] = chargingPortLocal(order.truck), p = ground(sim, 0, order.truck, x, z);
    assert.ok(x > 0, 'all sockets are on the front roof');
    head.pickup(p); p.skipUse = false; sim.game.interact(p, keys(['KeyJ'], ['KeyJ']), dt);
    assert.equal(head.connectedSerial, order.serial); assert.equal(p.heldTool, null);
    for (let i = 0; i < 60; i++) sim.game.charging.update(dt, sim.players.map((p: any) => p.pos.clone()));
    assert.ok(order.chargeProgress > 0 && order.chargeProgress < 1);
    const progress = order.chargeProgress; head.pickup(p);
    sim.game.charging.update(dt, sim.players.map((p: any) => p.pos.clone())); assert.equal(order.chargeProgress, progress);
    sim.game.charging.plug(head, order);
    sim.game.paused = true; const wetTick = sim.game.wet.tick; sim.game.updateActors(dt, 0, sim.camera);
    assert.equal(order.chargeProgress, progress); assert.equal(sim.game.wet.tick, wetTick); sim.game.paused = false;
    for (let i = 0; i < 400; i++) sim.game.charging.update(dt, sim.players.map((p: any) => p.pos.clone()));
    assert.equal(order.chargeProgress, 1); assert.equal(order.charged, true); assert.equal(sim.game.score, 0, 'base connector does not implement the future combo reward');
    order.mode = 'leaving'; sim.game.charging.update(dt, sim.players.map((p: any) => p.pos.clone()));
    assert.equal(head.connectedSerial, null); assert.equal(head.flight, true);
  } finally { sim.dispose(); }
});

test('ground contact powers the whole connected wet region; airborne heads/carriers and cable-only crossings do not', () => {
  const sim = world(); try {
    const home = sim.trucks[0], head = sim.game.chargers[0], wet = sim.game.wet, charging = sim.game.charging;
    splash(wet, home, -1.125, .225); splash(wet, home, -.675, .225); splash(wet, home, 1.575, 1.125);
    head.placeOn(home, new THREE.Vector3(-1.125, 0, .225)); charging.checkElectricity();
    assert.equal(wet.markAt(home, home.pos.x - .675, home.pos.z + .225).mark.live, true);
    assert.equal(wet.markAt(home, home.pos.x + 1.575, home.pos.z + 1.125).mark.live, false);
    const p = ground(sim, 0, home, -1.125, .225); head.pickup(p); p.state = 'air'; p.ground = null;
    charging.checkElectricity(); assert.equal(wet.markAt(home, p.pos.x, p.pos.z).mark.live, false); assert.equal(p.state, 'air');
    head.launch(p); head.mesh.position.set(p.pos.x, home.topY + 1, p.pos.z);
    charging.checkElectricity(); assert.equal(wet.markAt(home, p.pos.x, p.pos.z).mark.live, false);
    head.placeOn(home, new THREE.Vector3(2, 0, -.65)); charging.checkElectricity();
    assert.equal(wet.markAt(home, home.pos.x - 1.125, home.pos.z + .225).mark.live, false, 'only the endpoint conducts, no cable segment sources');
  } finally { sim.dispose(); }
});

test('authoritative spray deposits original splash parameters, players occlude it and stopping clears emission carry', () => {
  const sim = world(); try {
    const gun = sim.game.waterguns[0], home = sim.trucks[0], system = sim.game.charging;
    gun.spraying = true; gun.hitPlayer = null;
    gun.sprayNodes = [new THREE.Vector3(), new THREE.Vector3(home.pos.x - 1, home.topY + .18, home.pos.z)];
    for (let i = 0; i < 8; i++) system.landWater(dt);
    const active = () => sim.game.wet.surfaces[1].marks.filter((mark: any) => mark.id);
    assert.equal(active().length, 1); assert.equal(active()[0].stretch, 1);
    assert.ok(active()[0].dry >= 8 && active()[0].dry <= 11);
    const before = sim.game.wet.capture(); gun.hitPlayer = sim.players[1];
    for (let i = 0; i < 10; i++) system.landWater(dt);
    assert.deepEqual(sim.game.wet.capture(), before, 'a player hit cannot also leave a puddle behind that player');
    gun.hitPlayer = null; gun.spraying = false; system.landWater(dt);
    gun.spraying = true; gun.sprayNodes[1].x -= 2; system.landWater(dt);
    assert.equal(active().length, 1, 'a restarted stream has no stale surface emission accumulator');
  } finally { sim.dispose(); }
});

test('live water stuns through wobble instead of killing: held head stays at the feet, slow shuffle, locked hands, then a guard to walk out', () => {
  const sim = world(); try {
    const home = sim.trucks[0], head = sim.game.chargers[0], wet = sim.game.wet;
    splash(wet, home, -1.125, .225); const p = ground(sim, 0, home, -1.125, .225); head.pickup(p);
    sim.game.charging.checkElectricity(); assert.equal(p.stunRemaining, 0, 'the first contact only adds 50 wobble'); assert.equal(p.wobble, WOBBLE.shock);
    sim.game.charging.checkElectricity(WOBBLE.shockInterval / 2); assert.equal(p.stunRemaining, 0, 'one shock per interval');
    sim.game.charging.checkElectricity(WOBBLE.shockInterval / 2); assert.equal(p.state, 'ground', 'a shock is not a death'); assert.equal(p.deathCause, '');
    assert.equal(p.stunRemaining, CHARGING.stunSeconds); assert.equal(p.wobble, 0, 'a stun empties the bar'); assert.equal(head.holder, null); assert.equal(head.flight, false);
    sim.game.charging.checkElectricity(); assert.equal(wet.markAt(home, p.pos.x, p.pos.z).mark.live, true, 'the dropped head keeps the puddle live');
    // Walking while stunned moves at stunSpeed and jumping is ignored.
    const start = p.pos.clone(); p.update(dt, 0, packetInput({ seq: 1, move: [0, 0], axis: [0, 0], down: [], hits: ['Space'] }) as any, [home], sim.camera, 30);
    assert.equal(p.state, 'ground', 'no jump while stunned');
    (p as any).update(dt, 0, { axis: () => ({ x: 1, y: 0 }), worldAxis: () => ({ x: 1, z: 0 }), hit: () => false, down: () => false }, [home], sim.camera, 30);
    const moved = p.pos.x - start.x - home.vel.x * dt * 2;
    assert.ok(Math.abs(moved - 5.5 * 0.64 * CHARGING.stunSpeed * dt) < 1e-6, `stunned shuffle speed (${moved})`); // walk at character x walk scale
    // Hands are locked: J cannot take the live connector back from the puddle.
    sim.game.interact(p, keys(['KeyJ'], ['KeyJ']), dt); assert.equal(head.holder, null); assert.equal(p.interactionHint, '触电麻痹中…');
    const remaining = p.stunRemaining; for (let i = 0; i < Math.ceil(remaining / dt) + 1; i++) p.update(dt, 0, keys(), [home], sim.camera, 30);
    assert.equal(p.stunRemaining, 0); assert.ok(p.guardRemaining > 0 && p.guardRemaining <= WOBBLE.guardSeconds);
    p.pos.set(head.worldPosition().x, home.topY, head.worldPosition().z);
    // Guarded: shocks add half (25), so staying in takes four contacts to stun again — time to step out.
    for (let i = 0; i < 3; i++) { sim.game.charging.checkElectricity(WOBBLE.shockInterval); assert.equal(p.stunRemaining, 0, 'the guard lets the victim step out'); }
    sim.game.charging.checkElectricity(WOBBLE.shockInterval); assert.equal(p.stunRemaining, CHARGING.stunSeconds, 'staying in shocks again');
    head.pickup(sim.players[1]); sim.game.charging.checkElectricity(); assert.equal(wet.markAt(home, p.pos.x, p.pos.z).mark.live, false);
  } finally { sim.dispose(); }
});

function plugged(sim: Simulation) {
  const order = sim.game.spawnOrder(0), home = sim.trucks[0], head = sim.game.chargers[0];
  order.truck.setState(home.pos.x, home.pos.z - 3.9, 0, 0, 30); order.truck.setAltitude(home.topY - order.truck.topLocal);
  sim.game.charging.plug(head, order); sim.scene.updateMatrixWorld(true);
  const [x, , z] = chargingPortLocal(order.truck);
  return { order, head, truck: order.truck, x, z };
}

test('water on a plugged-in socket shorts it: connector blasts free, nearby players are thrown, far ones untouched', () => {
  const sim = world(); try {
    const { order, head, truck, x, z } = plugged(sim);
    order.chargeProgress = .4;
    const near = ground(sim, 0, truck, x - 1, z), far = ground(sim, 1, sim.trucks[0], -4, 1);
    sim.game.charging.checkPlugs(); assert.equal(head.connectedSerial, order.serial, 'a dry socket keeps charging');
    splash(sim.game.wet, truck, x, z); sim.game.charging.checkPlugs();
    assert.equal(head.connectedSerial, null); assert.equal(head.flight, true); assert.ok(head.velocity.y > 5, 'connector flies up out of the socket');
    assert.equal(sim.game.charging.blast.id, 1); assert.ok(Math.abs(sim.game.charging.blast.at[0] - (truck.pos.x + x)) < 1e-8);
    assert.equal(near.state, 'air'); assert.ok(near.vel.y > 5); assert.ok(near.externalVelocity.x < -1, 'thrown away from the socket');
    assert.equal(far.state, 'ground'); assert.equal(far.externalVelocity.length(), 0);
    assert.equal(order.chargeProgress, .4, 'charge progress survives the blast');
    assert.equal(sim.game.wet.markAt(truck, truck.pos.x + x, truck.pos.z + z)?.mark.live ?? false, false, 'no live puddle left at the empty socket');
  } finally { sim.dispose(); }
});

test('the blast, stun and its timers survive snapshot/delta round trips and change the urgent signature', () => {
  const sim = world(), peer = world(); try {
    const { head, truck, x, z } = plugged(sim);
    const signature = sim.urgentSignature();
    splash(sim.game.wet, truck, x, z); sim.game.charging.checkPlugs(); sim.players[1].stun(CHARGING.stunSeconds);
    assert.notEqual(sim.urgentSignature(), signature);
    sim.tickCount = 1; const state = quantize(sim.snapshot()), decoded = new SnapshotDecoder().decode(new SnapshotEncoder().encode(state, 'room:1'));
    applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, decoded);
    decoded.players.forEach((data: any, i: number) => applyPlayer(peer.players[i], data, peer.trucks));
    assert.equal(peer.game.charging.blast.id, 1); assert.deepEqual(peer.game.charging.blast.at, state.game.blast.at);
    assert.equal('blast' in peer.game, false, 'the blast record lives on the charging system only');
    assert.equal(peer.game.chargers[0].flight, true); assert.equal(peer.game.chargers[0].id, head.id);
    assert.ok(Math.abs(peer.players[1].stunRemaining - CHARGING.stunSeconds) < 1e-3);
    sim.game.charging.reset(); assert.equal(sim.game.charging.blast.id, 0);
  } finally { sim.dispose(); peer.dispose(); }
});

test('road landing settles a head, road scrolling affects contact, and airborne heads do not conduct', () => {
  const sim = world(); try {
    const head = sim.game.chargers[0], wet = sim.game.wet;
    head.release(null); head.mesh.position.set(0, .01, 0); head.velocity.set(0, -1, 0);
    splash(wet, null, 0, 0); sim.game.charging.checkElectricity(); assert.ok(wet.surfaces[0].marks.every((c: any) => !c.live));
    head.update(dt, []); assert.equal(head.groundedRoad, true); assert.equal(head.flight, false);
    sim.game.charging.checkElectricity(); assert.equal(wet.markAt(null, 0, 0).mark.live, true);
    wet.advance(1, 30); sim.game.charging.checkElectricity(); assert.equal(wet.markAt(null, 0, 0), null);
  } finally { sim.dispose(); }
});

test('separate vehicles/platforms do not connect, drying clears marks and capacity is bounded', () => {
  const sim = world(); try {
    const home = sim.trucks[0], wet = sim.game.wet;
    splash(wet, home, 2.925, .225);
    assert.equal(wet.markAt(home, home.pos.x + 2.8, home.pos.z + .225), null, 'gap between deck and cab remains dry');
    splash(wet, home, -1.125, .225); const p = ground(sim, 0, home, -1.125, .225); sim.game.chargers[0].pickup(p);
    p.state = 'air'; p.ground = null;
    const other = sim.trucks[1]; splash(wet, other, -1.125, .225);
    sim.game.chargers[0].placeOn(home, new THREE.Vector3(-1.125, 0, .225)); sim.game.charging.checkElectricity();
    assert.ok(wet.surfaces[2].marks.every((cell: any) => !cell.live), 'wet roofs do not join across vehicles');
    wet.advance(12, 0); sim.game.charging.checkElectricity();
    assert.ok(wet.surfaces.every((surface: any) => surface.marks.every((m: any) => !m.id)));
    for (let i = 0; i < 500; i++) wet.splash(null, i, 0);
    assert.equal(wet.surfaces[0].marks.filter((m: any) => m.id).length, 160);
    wet.clearTruck(home); assert.ok(wet.surfaces[1].generation > 0); assert.equal(wet.surfaces[1].marks.filter((m: any) => m.id).length, 0);
  } finally { sim.dispose(); }
});

test('drying an intervening splash breaks conduction between two freshly wetted ends', () => {
  const sim = world(); try {
    const home = sim.trucks[0], wet = sim.game.wet, head = sim.game.chargers[0];
    for (const x of [-3.375, -2.925, -2.475, -2.025, -1.575, -1.125]) wet.splash(home, x, .225);
    wet.advance(.2, 0); head.placeOn(home, new THREE.Vector3(-3.375, 0, .225));
    sim.game.charging.checkElectricity();
    assert.equal(wet.markAt(home, home.pos.x - 1.125, home.pos.z + .225).mark.live, true);
    wet.advance(9, 0); wet.splash(home, -3.375, .225); wet.splash(home, -1.125, .225); wet.advance(.2, 0);
    sim.game.charging.checkElectricity();
    assert.equal(wet.markAt(home, home.pos.x - 3.375, home.pos.z + .225).mark.live, true);
    assert.equal(wet.markAt(home, home.pos.x - 1.125, home.pos.z + .225).mark.live, false);
  } finally { sim.dispose(); }
});

test('wet data adapter uses the original materials/shaders and scatter records, with no idle uploads or gameplay writes', () => {
  const sim = world(), lighting = { hemi: { color: new THREE.Color('white'), groundColor: new THREE.Color('grey'), intensity: 1 },
    sun: { color: new THREE.Color('white'), intensity: 1 }, offset: new THREE.Vector3(1, 2, 3) };
  const view = new SharedWetSurfaces({ scene: sim.scene, game: sim.game, trucks: sim.trucks, players: [], lighting });
  try {
    splash(sim.game.wet, sim.trucks[0], -1.125, .225); const state = sim.game.wet.capture();
    view.update(dt); const mark = sim.game.wet.surfaces[1].marks.find((m: any) => m.id), roof = view.sharedRoofs[0];
    // One decal layer per standing level: the mark lands in the layer of the level under it.
    const pool = roof.layers[roof.layerAt(mark.x, mark.z)].pool;
    assert.equal(pool.meshes[0].material.vertexShader, view.roofs[0].meshes[0].material.vertexShader);
    assert.equal(pool.meshes[0].material.fragmentShader, view.roofs[0].meshes[0].material.fragmentShader);
    assert.equal(view.pawPrints, WetSurfaces.prototype.pawPrints, 'keep the existing paw/drip presentation code');
    assert.ok(Math.abs(pool.attributes.aDecal.getX(0) - mark.x) < 1e-6);
    assert.ok(Math.abs(pool.attributes.aDecal.getW(0) - mark.seed) < 1e-6);
    assert.equal(pool.attributes.aShape.getW(0), 0, 'retain the original irregular splash kind, no tile/rectangle shape');
    const versions = Object.values(pool.attributes).map((a: any) => a.version);
    for (let i = 0; i < 30; i++) view.update(dt);
    Object.values(pool.attributes).forEach((a: any, i) => assert.equal(a.version, versions[i]));
    assert.deepEqual(sim.game.wet.capture(), state, 'presentation never changes wetness or electric state');
    view.reset(); view.update(dt); assert.ok(pool.attributes.aShape.getX(0) > 0, 'reset can display the same shared generation again');
  } finally { view.dispose(); sim.dispose(); }
});

test('connector ownership, wet topology, charge completion and electric stun survive snapshot/delta round trips', () => {
  const sim = world(), peer = world(); try {
    const home = sim.trucks[0], head = sim.game.chargers[0], p = ground(sim, 0, home, -1.125, .225);
    splash(sim.game.wet, home, -1.125, .225); head.pickup(p); sim.game.charging.checkElectricity(); sim.game.charging.checkElectricity(WOBBLE.shockInterval);
    p.stunRemaining = 1.25; // Not yet worn off when the snapshot is taken.
    sim.game.ensureSoap(3); // Growing soap pools must not shift charger snapshot identities.
    sim.tickCount = 1; const first = quantize(sim.snapshot()), encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder();
    assert.deepEqual(decoder.decode(encoder.encode(first, 'room:1')), first); encoder.ack(1);
    head.pickup(sim.players[1]); sim.game.charging.checkElectricity(); sim.tickCount = 2;
    const state = quantize(sim.snapshot()), decoded = decoder.decode(encoder.encode(state, 'room:1'));
    applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, decoded);
    decoded.players.forEach((data: any, i: number) => applyPlayer(peer.players[i], data, peer.trucks));
    // Identity checks with ok(): a failing equal() on scene objects would print the whole scene graph.
    assert.ok(peer.players[1].heldTool === peer.game.chargers[0]); assert.ok(peer.players[0].stunRemaining > 1); assert.equal(peer.players[0].state, 'ground');
    assert.deepEqual(peer.game.wet.capture(), state.game.wet); assert.equal(peer.game.chargers[0].id, head.id);
    assert.equal('cables' in state.game, false, 'cable paths are derived locally, not transmitted');
    assert.equal(VERSION, 42); assert.equal(SAVE_VERSION, '0.5', 'charging has no new saved result or score semantics');
  } finally { sim.dispose(); peer.dispose(); }
});

test('two guests competing for the connector get one owner and both receive the same host wet/electric state', () => {
  const r = room(['g1', 'g2']); try {
    for (let i = 0; i < 90; i++) r.advance();
    const sim = r.host.sim, head = sim.game.chargers[0], home = sim.trucks[0]; sim.game.wet.random = () => .5;
    for (const slot of [1, 2]) ground(sim, slot, home, 4.45, -.55);
    for (const guest of r.guests) guest.guest.sendInput({ seq: 1, move: [0, 0], axis: [0, 0], down: ['KeyJ'], hits: ['KeyJ'] });
    r.advance(); assert.equal(head.holder, sim.players[1]); assert.notEqual(sim.players[2].heldTool, head);
    splash(sim.game.wet, home, 4.45, -.55); const signature = sim.urgentSignature();
    // Wobble: contact adds 50, the next 0.5 s interval fills the bar.
    for (let i = 0; i < 40 && !(sim.players[1].stunRemaining > 0); i++) r.advance();
    assert.ok(sim.players[1].stunRemaining > 0); assert.notEqual(sim.players[1].state, 'fallen'); assert.notEqual(sim.urgentSignature(), signature);
    for (let i = 0; i < 3; i++) r.advance();
    for (const guest of r.guests) {
      const snap = guest.received.at(-1); assert.ok(snap.players[1].stunRemaining > 0); assert.equal(snap.players[1].deathCause, '');
      assert.equal(snap.game.chargers[0].holder, -1); assert.deepEqual(snap.game.wet, r.sent.get(snap.tick).game.wet);
    }
  } finally { r.dispose(); }
});

test('electric water grows from the contact point with HDR max-blended arcs and uploads only on shared changes', () => {
  const sim = world(); const fx = new ElectricWaterEffects(sim.game); try {
    const home = sim.trucks[0], head = sim.game.chargers[0], wet = sim.game.wet, pool = fx.pools[1];
    splash(wet, home, -1.125, .225); splash(wet, home, -0.5, .225);
    fx.update(); assert.equal(pool.mesh.visible, false, 'dry of current, nothing shows');
    const p = ground(sim, 0, home, -1.125, .225); head.pickup(p); sim.game.charging.checkElectricity();
    wet.advance(1 / 60, 0); fx.update();
    const uniforms = pool.mesh.material.uniforms, now = wet.tick / 60;
    assert.equal(pool.mesh.visible, true); assert.equal(uniforms.uStart.value, now, 'growth starts when the area becomes live');
    assert.ok(Math.abs(uniforms.uSource.value.x - p.pos.x + home.pos.x) < 1e-6 && Math.abs(uniforms.uSource.value.y - .225) < 1e-6, 'it grows from where the current enters');
    const live = Array.from(pool.live.array as Float32Array).filter(v => v >= 0);
    assert.ok(live.length >= 2 && live.every(v => v === now));
    assert.equal(pool.mesh.material.blendEquation, THREE.MaxEquation); assert.equal(pool.mesh.material.toneMapped, false);
    assert.ok(uniforms.uIntensity.value > 1, 'HDR colour above the Bloom threshold');
    const version = pool.live.version; wet.tick += 30; fx.update();
    assert.equal(pool.live.version, version, 'animation is uniform-only between shared revisions');
    assert.equal(uniforms.uTime.value, wet.tick / 60);
    sim.game.drop(p); head.pickup(sim.players[1]); sim.game.charging.checkElectricity(); fx.update(); // one shock no longer stuns, so p still held it
    assert.equal(pool.mesh.visible, false); assert.ok(Array.from(pool.live.array as Float32Array).every(v => v < 0), 'cutting power collapses every arc');
    fx.reset(); assert.equal(pool.mesh.visible, false);
  } finally { fx.dispose(); sim.dispose(); }
});

test('newly landed water interrupts the completion tick before awarding a charging bonus; reconnect awards once', () => {
  const sim = world(); try {
    const { order, head, truck, x, z } = plugged(sim);
    order.chargeProgress = 1 - dt / CHARGING.seconds / 2;
    const progress = order.chargeProgress;
    // Model water becoming effective during landWater, after beginTick's check.
    const land = sim.game.charging.landWater;
    sim.game.charging.landWater = () => splash(sim.game.wet, truck, x, z);
    sim.game.charging.update(dt, sim.players.map(p => p.pos.clone()));
    sim.game.charging.landWater = land;
    assert.equal(sim.game.charging.blast.id, 1); assert.equal(head.connectedSerial, null);
    assert.equal(order.charged, false); assert.equal(order.chargeProgress, progress); assert.equal(order.rewardMultiplier, 1);
    sim.game.wet.clearTruck(truck); sim.game.charging.plug(head, order);
    sim.game.charging.update(dt, sim.players.map(p => p.pos.clone()));
    assert.equal(order.charged, true); assert.equal(order.rewardMultiplier, 1.5);
    for (let i = 0; i < 3; i++) sim.game.charging.update(dt, sim.players.map(p => p.pos.clone()));
    assert.equal(order.rewardMultiplier, 1.5);
  } finally { sim.dispose(); }
});

test('host blast reaches two guest links urgently, rejects invented client blast commands, and pauses/resets with the world', () => {
  const r = room(['g1', 'g2']); try {
    r.host.command('start');
    for (let i = 0; i < 1000 && r.host.sim.game.roundStage !== 'playing'; i++) r.advance();
    const sim = r.host.sim;
    sim.game.wet.random = () => .5;
    const { head, truck, x, z } = plugged(sim);
    ground(sim, 1, truck, x - 1, z); ground(sim, 2, truck, x - 1.2, z + .2);
    for (const g of r.guests) g.guest.sendControl({ type: 'blast', playerId: 0, at: [0, 0, 0], epoch: r.host.epoch });
    assert.equal(sim.game.charging.blast.id, 0);
    splash(sim.game.wet, truck, x, z);
    r.host.command('pause', { paused: true }); const tick = sim.game.wet.tick;
    for (let i = 0; i < 10; i++) r.advance();
    assert.equal(sim.game.charging.blast.id, 0); assert.equal(sim.game.wet.tick, tick);
    r.host.command('pause', { paused: false }); r.advance();
    assert.equal(sim.game.charging.blast.id, 1); assert.equal(head.connectedSerial, null);
    for (const g of r.guests) {
      const snapshot = g.received.at(-1);
      assert.equal(snapshot.tick, sim.tickCount, 'same tick urgent state');
      assert.equal(snapshot.game.blast.id, 1); assert.equal(snapshot.game.chargers[0].flight, true);
      for (const slot of [1, 2]) {
        assert.equal(snapshot.players[slot].state, 'air'); assert.ok(snapshot.players[slot].vel[1] > 0);
      }
    }
    r.host.command('home');
    assert.equal(r.host.sim.game.charging.blast.id, 0);
    for (let i = 0; i < 3; i++) r.advance();
    for (const g of r.guests) assert.equal(g.received.at(-1).game.blast.id, 0);
  } finally { r.dispose(); }
});

test('protocol 26: a new or dried wet mark patches one slot key, and the guest rebuilds the identical wet field', () => {
  const sim = world(), peer = world(), wet = sim.game.wet, home = sim.trucks[0];
  try {
    for (let i = 0; i < 40; i++) wet.splash(home, home.pos.x - 2 + (i % 10) * .4, home.pos.z - .5 + Math.floor(i / 10) * .3);
    let before = quantize(sim.snapshot());
    wet.splash(home, home.pos.x + 1.9, home.pos.z + .4);
    let after = quantize(sim.snapshot()), change: any = diff(before, after);
    const marks = change.game.wet.surfaces[1].marks;
    assert.deepEqual(Object.keys(marks), [String(wet.surfaces[1].cursor - 1)], 'only the new slot travels');
    assert.ok(JSON.stringify(change.game.wet).length < 300, 'a splash on a busy roof stays a small delta');
    wet.surfaces[1].marks[0].dry = 0; wet.advance(dt, 0); before = after; after = quantize(sim.snapshot());
    assert.deepEqual(diff(before, after).game.wet.surfaces[1].marks, { 0: { $del: 1 } }, 'a dried mark is one deletion');
    applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, patch(before, diff(before, after)));
    assert.deepEqual(quantize(peer.game.wet.capture()), quantize(wet.capture()));
    assert.equal(VERSION, 42);
  } finally { sim.dispose(); peer.dispose(); }
});

test('protocol 26: vector lists patch only moved nodes, a fully moved list is sent whole, and both round-trip', () => {
  const prev = { nodes: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]] };
  const tip = { nodes: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 1, 0]] }, moved = { nodes: prev.nodes.map(([x, y, z]) => [x + 1, y, z]) };
  assert.deepEqual(diff(prev, tip), { nodes: { $len: 4, 3: [3, 1, 0] } });
  assert.deepEqual(diff(prev, moved), moved);
  for (const next of [tip, moved, { nodes: prev.nodes.slice(0, 2) }]) assert.deepEqual(patch(prev, diff(prev, next)), next);
});
