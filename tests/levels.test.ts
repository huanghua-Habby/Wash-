import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRST_LEVEL_ID, getLevel } from './fixtures/levels.js';
import { Simulation } from './fixtures/Simulation.js';
import { TruckDirector } from '../shared/sim/TruckDirector.js';
import { TruckState } from '../shared/sim/TruckState.js';
import { PAL } from '../shared/sim/palette.js';
import { packetInput } from '../shared/protocol.js';
import { applyWorld } from '../shared/snapshot.js';
import * as THREE from 'three';

test('01 menu scene and authority consume the same configurable world', () => {
  const source = getLevel(FIRST_LEVEL_ID)!;
  assert.equal(source.difficulty, 'tutorial');
  assert.equal(source.road.laneCount, 2);
  assert.ok(Object.isFrozen(source.home.motion.initialX));
  const level = structuredClone(source);
  level.home.motion.speed = 18;
  level.home.motion.speedWaves = [];
  level.home.motion.initialX = [4, -3];
  level.home.motion.initialGap = 4.1;
  level.home.playerSlots[0] = [-2, 0.2];
  level.equipment.washStation.position = [-4, -0.1];
  level.equipment.waterguns[0].supplyPosition = [0.2, -0.7];
  const authority = new Simulation(level);
  const a = new TruckState(PAL.truckA, { name: 'client A', type: level.home.vehicles[0].type });
  const b = new TruckState(PAL.truckB, { name: 'client B', type: level.home.vehicles[1].type });
  const preview = new TruckDirector(a, b, { motion: level.home.motion });
  try {
    preview.update(0);
    assert.deepEqual(a.pos.toArray(), authority.trucks[0].pos.toArray());
    assert.deepEqual(b.pos.toArray(), authority.trucks[1].pos.toArray());
    assert.deepEqual(authority.players[0].homeLocal.toArray(), [-2, 0, 0.2]);
    assert.equal(authority.game.station.position.x, -4);
    assert.equal(authority.game.hoses[0].anchorLocal.x, 0.2);
    for (let i = 0; i < 60; i++) { authority.tick(); preview.update(1 / 60); }
    assert.equal(authority.director.base, 18);
    assert.ok(Math.abs(authority.scroll - 18) < 1e-8);
    assert.deepEqual(a.pos.toArray(), authority.trucks[0].pos.toArray());
    assert.equal(source.home.motion.speed, 30);
  } finally { authority.dispose(); }
});

test('wash station and gun supply have separate interaction zones and shared reset positions', () => {
  const sim = new Simulation(), peer = new Simulation();
  try {
    sim.occupy(0, true); sim.occupy(1, true);
    sim.phase = 'game'; sim.game.start(sim.director.base);
    const game = sim.game, home = sim.trucks[0], hose = game.hoses[0], gun = game.waterguns[0];
    const washPosition = game.station.getWorldPosition(new THREE.Vector3()), supplyPosition = hose.anchor();
    assert.ok(Math.hypot(washPosition.x - supplyPosition.x, washPosition.z - supplyPosition.z) > game.equipment.washStation.interactionRange + hose.recallRange);
    const place = (slot: number, position: THREE.Vector3) => {
      const player = sim.players[slot]; player.pos.set(position.x, home.topY, position.z);
      player.state = 'ground'; player.ground = { truck: home, plat: home.platforms[0] }; player.root.position.copy(player.pos);
      return player;
    };
    const p = place(0, washPosition), q = place(1, supplyPosition);
    sim.scene.updateMatrixWorld(true);
    assert.equal(game.recallableHose(p), null);
    assert.equal(game.nearStation(q), false);
    const press = packetInput({ seq: 1, move: [0, 0], axis: [0, 0], down: ['KeyJ'], hits: ['KeyJ'] });
    game.interact(p, press, 1 / 60);
    assert.equal(p.heldTool.kind, 'towel', 'empty hands at wash station do not recall a gun');
    p.heldTool.consume(0.5); p.skipUse = false;
    game.interact(p, packetInput({ seq: 2, move: [0, 0], axis: [0, 0], down: ['KeyJ'], hits: [] }), 1 / 60);
    assert.ok(p.heldTool.washProgress > 0);
    game.interact(q, press, 1 / 60);
    assert.equal(q.heldTool, gun, 'supply point takes the gun');
    applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, sim.snapshot());
    assert.equal(peer.game.waterguns[0].holder, peer.players[1]);
    assert.deepEqual(peer.game.hoses[0].anchorLocal.toArray(), hose.anchorLocal.toArray());
    assert.equal(peer.game.supplyPoints[0].visible, true);
    game.stop(); assert.equal(game.supplyPoints[0].visible, false);
    game.start(sim.director.base);
    assert.equal(gun.mesh.position.x, game.equipment.waterguns[0].position[0]);
    assert.equal(gun.mesh.position.z, game.equipment.waterguns[0].position[1]);
  } finally { sim.dispose(); peer.dispose(); }
});

test('02 alternates shared side lanes and derives 60s patience from six steps, while 01 stays unlimited', () => {
  const sim = new Simulation(getLevel('highway-02')!), peer = new Simulation(getLevel('highway-02')!);
  const tutorial = new Simulation();
  try {
    assert.equal(sim.level.road.laneCount, 3);
    for (const world of [sim, tutorial]) { world.phase = 'game'; world.game.start(world.director.base); }
    tutorial.game.spawnOrder(); assert.equal(tutorial.game.order.remaining, Infinity);
    for (let serial = 0; serial < 2; serial++) {
      const g = sim.game; g.clearStains(); g.lane = null; g.spawnOrder(serial);
      assert.equal(g.order.remaining, 60); assert.equal(g.orderSide(), serial ? 1 : -1);
      assert.equal(Math.sign(g.lane.z - g.homeZ), serial ? 1 : -1);
      assert.equal(Math.sign(g.laneShape(1).z), serial ? 1 : -1);
      for (let i = 0; i < 40; i++) sim.tick();
      assert.equal(g.order.remaining, 60, 'approach does not consume patience');
      g.lane.x = g.orderX(); sim.tick();
      assert.ok(Math.abs(g.order.remaining - (60 - 1 / 60)) < 1e-8);
      const before = g.order.remaining;
      sim.command('pause', true); for (let i = 0; i < 60; i++) sim.tick();
      assert.equal(g.order.remaining, before); sim.command('pause', false);
      const snapshot = sim.snapshot(); applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, snapshot);
      assert.equal(peer.game.order.remaining, before);
      assert.equal(peer.game.orderSide(), g.orderSide());
      assert.deepEqual(peer.game.lane, g.lane);
      g.combo = 3; g.order.remaining = 1 / 120;
      const signature = sim.urgentSignature(); sim.tick();
      assert.equal(g.order.mode, 'leaving'); assert.equal(g.order.remaining, 0);
      assert.equal(g.missed, serial + 1); assert.equal(g.combo, 0); assert.equal(g.score, 0);
      assert.notEqual(sim.urgentSignature(), signature, 'timeout is urgent');
      g.completeOrder(); assert.equal(g.completed, 0, 'late completion cannot pay an expired order');
      applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, sim.snapshot());
      assert.equal(peer.game.order.mode, 'leaving'); assert.equal(peer.game.missed, g.missed);
    }
  } finally { sim.dispose(); peer.dispose(); tutorial.dispose(); }
});
