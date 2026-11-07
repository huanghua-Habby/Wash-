import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Simulation } from './fixtures/Simulation.js';
import { NetworkGame } from '../client/js/online/NetworkGame.js';
import { applyWorld } from '../shared/snapshot.js';
import { WASH_CONFIG as C } from '../shared/sim/washConfig.js';
import { VEHICLES } from '../shared/sim/vehicles.js';

const roofGap = (sim: Simulation) => Math.abs(sim.game.orderTruck.topY - sim.trucks[0].topY);

test('first appearance and reused order vehicles snap to spawn; continuous visible motion still interpolates', () => {
  const authority = new Simulation(), client = new Simulation();
  const connection: any = new EventTarget(); connection.room = { slot: 0 }; connection.connected = true; connection.playing = true;
  const network = new NetworkGame({ connection, players: client.players, trucks: client.trucks, game: client.game,
    input: { clear() {}, hit() { return false; } }, camera: new THREE.PerspectiveCamera(), onPhase() {} });
  try {
    authority.phase = 'game'; authority.game.start(authority.director.base);
    network.receive(authority.snapshot());
    assert.ok(authority.game.orderTrucks.every((truck: any) => !truck.group.visible));
    authority.tickCount += 3; authority.game.spawnOrder(); const first = authority.snapshot(), index = authority.trucks.indexOf(authority.game.orderTruck);
    network.receive(first); network.step(0, 0);
    assert.deepEqual(client.trucks[index].pos.toArray(), first.trucks[index].pos, 'no interpolation from hidden default origin');
    authority.tickCount += 3; authority.game.orderTruck.pos.x += 2;
    const moving = authority.snapshot(); network.receive(moving); network.step(0, 0);
    assert.ok(client.trucks[index].pos.x >= first.trucks[index].pos[0]);
    assert.ok(client.trucks[index].pos.x < moving.trucks[index].pos[0], 'adjacent visible snapshots retain interpolation');
    authority.game.orderTruck.pos.set(50, 0, 0); authority.game.orderTruck.group.visible = false; authority.game.clearStains();
    authority.tickCount += 3; network.receive(authority.snapshot());
    authority.tickCount += 3; authority.game.spawnOrder(0); const next = authority.snapshot(); network.receive(next); network.step(0, 0);
    assert.deepEqual(client.trucks[index].pos.toArray(), next.trucks[index].pos, 'a reused truck never interpolates from its old exit');
  } finally { authority.dispose(); client.dispose(); }
});

test('an off-screen merge lane appears first; the vehicle arrives along it, then levels its roof with the player', () => {
  const sim = new Simulation();
  try {
    sim.phase = 'game'; sim.game.start(sim.director.base);
    const game = sim.game, home = sim.trucks[0];
    let ticks = 0;
    while (!game.lane && ticks++ < 600) sim.tick();
    assert.ok(game.lane, 'lane opens after the first order delay');
    assert.equal(game.order, null, 'no vehicle yet: the lane is built before the vehicle flies in');
    assert.ok(game.lane.x - game.orderX() > C.laneLength + C.laneLead * 0.9, 'lane starts ahead, out of view');
    while (!game.order && ticks++ < 1200) sim.tick();
    assert.ok(game.order, 'vehicle spawns once the player reaches the lane');
    const truck = game.orderTruck;
    assert.ok(Math.abs(truck.pos.z - home.pos.z) > C.laneSideOffset, 'appears on the off-screen side road');
    let previousZ = truck.pos.z;
    while (game.order.arrivalProgress < 1 && ticks++ < 2400) {
      sim.tick();
      if (game.order.arrivalProgress < 1) assert.ok(truck.pos.z >= previousZ - 1e-6, 'merges toward the player without backing off');
      previousZ = truck.pos.z;
    }
    assert.equal(game.order.arrivalProgress, 1);
    const clearance = Math.abs(truck.pos.z - home.pos.z) - truck.halfWidth - home.halfWidth;
    assert.ok(clearance > 0.3 && clearance < 1.2, `docked hull gap ${clearance}`);
    for (let i = 0; i < 240; i++) sim.tick();
    assert.ok(roofGap(sim) < C.roofWobble * 1.6 + 0.12, `roofs level after docking: ${roofGap(sim)}`);
    const heights = [];
    for (let i = 0; i < 180; i++) { sim.tick(); heights.push(truck.pos.y); }
    assert.ok(Math.max(...heights) - Math.min(...heights) > 0.02, 'roof height keeps drifting slightly');
    assert.ok(roofGap(sim) < C.roofWobble * 1.6 + 0.12);
  } finally { sim.dispose(); }
});

test('order vehicle types cycle through different sizes and all align to the player roof; peers follow the type switch', () => {
  const sim = new Simulation(), peer = new Simulation();
  try {
    sim.phase = 'game'; sim.game.start(sim.director.base);
    const game = sim.game, seen = new Set<string>();
    for (let serial = 0; serial < game.orderTrucks.length; serial++) {
      game.clearStains(); game.hideOrderTrucks(); game.lane = null;
      game.spawnOrder(serial);
      const truck = game.orderTruck, spec = VEHICLES[truck.type as keyof typeof VEHICLES];
      seen.add(truck.type);
      game.order.stains.forEach((stain: any) => assert.ok(truck.platformAt(truck.pos.x + stain.mesh.position.x, truck.pos.z + stain.mesh.position.z, 0), `${truck.type} stain on roof`));
      assert.equal(game.order.stains[0].mesh.position.y, spec.top + 0.045);
      for (let i = 0; i < 600 && game.order.arrivalProgress < 1; i++) sim.tick();
      for (let i = 0; i < 240; i++) sim.tick();
      assert.ok(roofGap(sim) < C.roofWobble * 1.6 + 0.12, `${truck.type} roof gap ${roofGap(sim)}`);
      applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, sim.snapshot());
      assert.equal(peer.game.orderTruck.type, truck.type, 'peer shows the same vehicle type');
      assert.equal(peer.game.order.stains.length, 3);
      assert.ok(peer.game.orderTrucks.filter((t: any) => t.group.visible).length === 1);
    }
    assert.ok(seen.size >= 5);
    const tops = [...seen].map((type) => VEHICLES[type as keyof typeof VEHICLES].top);
    assert.ok(Math.max(...tops) - Math.min(...tops) > 1.5, 'vehicles differ in height');
    assert.ok(VEHICLES.washer.width > Math.max(...[...seen].map((type) => VEHICLES[type as keyof typeof VEHICLES].width)), 'player vehicle is the widest');
  } finally { sim.dispose(); peer.dispose(); }
});
