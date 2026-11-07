import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Simulation } from './fixtures/Simulation.js';
import { packetInput, VERSION } from '../shared/protocol.js';
import { applyWorld } from '../shared/snapshot.js';
import { quantize, SnapshotEncoder, SnapshotDecoder } from '../shared/delta.js';
import { ItemPoof } from '../client/js/fx/ItemPoof.js';
import { SAVE_VERSION } from '../shared/levels.js';
import { room } from './helpers/peerRoom.js';

const dt = 1 / 60, keys = () => packetInput({ seq: 1, move: [0, 0], axis: [0, 0], down: [], hits: [] });
function world() {
  const sim = new Simulation(); sim.occupy(0, true); sim.occupy(1, true);
  sim.phase = 'game'; sim.game.start(30); sim.game.inputs = sim.players.map(() => keys());
  sim.scene.updateMatrixWorld(true); return sim;
}
/** Throw `tool` off the side so it falls onto the road, stepping only its own flight. */
function dropOnRoad(sim: Simulation, tool: any) {
  tool.release(null, new THREE.Vector3(0, 0, 0)); tool.mesh.position.set(sim.trucks[0].pos.x, .6, sim.trucks[0].pos.z + 6);
  for (let i = 0; i < 60 && tool.flight; i++) tool.update(dt, [], () => false);
}

function atPost(sim: Simulation, kind: string, slots = [0]) {
  const g = sim.game, home = sim.trucks[0], post = kind === 'water' ? g.hoses[0] : g.cables[0];
  const anchor = post.anchor(), local = new THREE.Vector3(anchor.x - home.pos.x, 0, anchor.z - home.pos.z);
  // Isolate post overlap from the initial tool rack; the post's own gun remains closest.
  for (const tool of g.tools) tool.placeOn(home, new THREE.Vector3(-3, 0, 0));
  post.gun.placeOn(home, local);
  for (const slot of slots) {
    const p = sim.players[slot]; p.state = 'ground';
    p.ground = { truck: home, plat: home.platformAt(anchor.x, anchor.z, .3) };
    p.pos.set(anchor.x, home.topY, anchor.z); p.root.position.copy(p.pos);
    p.vel.set(0, 0, 0); p.externalVelocity.set(0, 0, 0);
  }
  sim.scene.updateMatrixWorld(true);
  return { post, home, local };
}

for (const postKind of ['water', 'charger']) for (const itemKind of ['towel', 'soap']) {
  test(`${itemKind} within reach beats ${postKind} post recall, with matching hints and snapshot ownership`, () => {
    const sim = world(), peer = world(); try {
      const { post, home, local } = atPost(sim, postKind), g = sim.game, p = sim.players[0];
      const item = itemKind === 'towel' ? g.towels[0] : g.takeSoap(p);
      item.placeOn(home, local.clone().add(new THREE.Vector3(-.6, 0, 0)));
      sim.scene.updateMatrixWorld(true);
      assert.equal(postKind === 'water' ? g.recallableHose(p) : g.charging.recallable(p), post);
      g.interact(p, keys(), dt);
      assert.equal(p.interactionHint, itemKind === 'towel' ? 'J 拿起毛巾' : 'J 拿起肥皂');
      const signature = sim.urgentSignature();
      const before = post.nodes.map((node: any) => node.toArray());
      g.interact(p, packetInput({ seq: 1, move: [0, 0], axis: [0, 0], down: ['KeyJ'], hits: ['KeyJ'] }), dt);
      assert.equal(p.heldTool, item); assert.equal(post.gun.holder, null);
      assert.deepEqual(post.nodes.map((node: any) => node.toArray()), before, 'picking up a loose tool does not reset the tether');
      assert.notEqual(sim.urgentSignature(), signature);
      const snapshot = new SnapshotDecoder().decode(new SnapshotEncoder().encode(quantize(sim.snapshot()), 'pickup:1'));
      applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, snapshot);
      assert.equal(peer.players[0].heldTool.id, item.id);
      assert.equal(peer.players[0].heldTool.holder, peer.players[0]);
      assert.equal(VERSION, 42); assert.equal(SAVE_VERSION, '0.5');

      // Once the loose item is out of reach, J still recalls the gun and clears the rope.
      item.placeOn(home, local.clone().add(new THREE.Vector3(-2, 0, 0)));
      post.gun.placeOn(home, new THREE.Vector3(-3, 0, 0)); post.tension = 1;
      sim.scene.updateMatrixWorld(true); g.interact(p, keys(), dt);
      assert.equal(p.interactionHint, postKind === 'water' ? 'J 拿回水枪' : 'J 拿回充电头');
      g.interact(p, packetInput({ seq: 2, move: [0, 0], axis: [0, 0], down: ['KeyJ'], hits: ['KeyJ'] }), dt);
      assert.equal(p.heldTool, post.gun); assert.equal(post.tension, 0);
    } finally { sim.dispose(); peer.dispose(); }
  });
}

for (const postKind of ['water', 'charger']) for (const itemKind of ['towel', 'soap']) {
  test(`two guests competing for ${itemKind} beside a ${postKind} post receive the same authoritative owners`, () => {
    const r = room(['g1', 'g2']); try {
      for (let i = 0; i < 90; i++) r.advance();
      const sim = r.host.sim, g = sim.game, { post, home, local } = atPost(sim, postKind, [1, 2]);
      const item = itemKind === 'towel' ? g.towels[0] : g.takeSoap(sim.players[0]);
      item.placeOn(home, local.clone().add(new THREE.Vector3(-.6, 0, 0)));
      sim.scene.updateMatrixWorld(true);
      for (const guest of r.guests) guest.guest.sendInput({ seq: 1, move: [0, 0], axis: [0, 0], down: ['KeyJ'], hits: ['KeyJ'] });
      r.advance();
      assert.equal(sim.players[1].heldTool, item);
      assert.equal(sim.players[2].heldTool, post.gun, 'the second guest cannot take an already owned item');
      for (const guest of r.guests) {
        const snapshot = guest.received.at(-1);
        assert.equal(snapshot.game[itemKind === 'towel' ? 'towels' : 'soaps'].find((tool: any) => tool.id === item.id).holder, 1);
        assert.equal(snapshot.game[postKind === 'water' ? 'waterguns' : 'chargers'][0].holder, 2);
      }
    } finally { r.dispose(); }
  });
}

test('a towel touching the road vanishes at once and is back at its home spot with a synced return record', () => {
  const sim = world(); try {
    const towel = sim.game.towels[0], home = sim.trucks[0], signature = sim.urgentSignature();
    dropOnRoad(sim, towel);
    assert.equal(towel.flight, false); assert.equal(towel.truck, home); assert.equal(towel.returnSerial, 1);
    assert.ok(Math.abs(towel.mesh.position.x - towel.originalPosition.x) < 1e-8, 'back at its home spot');
    assert.ok(Math.abs(towel.returnFrom.z - (home.pos.z + 6)) < 1e-8 && Math.abs(towel.returnFrom.y - .12) < 1e-8, 'records where it touched the road');
    assert.ok(towel.returnAge < .05, 'no 0.9 s sinking through the road any more');
    assert.notEqual(sim.urgentSignature(), signature, 'the return is sent in the same tick');
  } finally { sim.dispose(); }
});

test('soap retires on the road with a return record; the tethered gun and the connector keep their road rules', () => {
  const sim = world(); try {
    const soap = sim.game.takeSoap(sim.players[0]); dropOnRoad(sim, soap);
    assert.equal(soap.active, false); assert.equal(soap.returnSerial, 1);
    const gun = sim.game.waterguns[0]; dropOnRoad(sim, gun);
    assert.equal(gun.returnSerial, 0); assert.equal(gun.truck, null, 'the hose gun stays on the road for recall');
    const head = sim.game.chargers[0]; head.release(null, new THREE.Vector3()); head.mesh.position.set(0, .5, 6);
    for (let i = 0; i < 60 && head.flight; i++) head.update(dt, []);
    assert.equal(head.returnSerial, 0); assert.equal(head.groundedRoad, true, 'the connector still lands and conducts on the road');
  } finally { sim.dispose(); }
});

test('return records survive snapshot/delta and the client poof plays once per new return, never for stale ones', () => {
  const sim = world(), peer = world(); try {
    const towel = sim.game.towels[0];
    const poof = new ItemPoof(peer.scene, peer.game);
    const send = (tick: number) => {
      sim.tickCount = tick; const state = quantize(sim.snapshot());
      applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, new SnapshotDecoder().decode(new SnapshotEncoder().encode(state, 'room:1')));
    };
    send(1); poof.update(dt); assert.equal(poof.mesh.geometry.instanceCount, 0, 'idle: zero instances');
    dropOnRoad(sim, towel); send(2);
    const peerTowel = peer.game.towels[0];
    assert.equal(peerTowel.returnSerial, 1); assert.ok(peerTowel.returnFrom.distanceTo(towel.returnFrom) < 1e-3);
    poof.update(dt); assert.equal(poof.mesh.geometry.instanceCount, 20, 'road poof + home poof');
    assert.ok(peerTowel.mesh.scale.x < .01, 'the towel is hidden inside the home poof');
    for (let i = 0; i < 60; i++) poof.update(dt);
    assert.equal(peerTowel.mesh.scale.x, 1, 'then pops back to full size');
    assert.equal(poof.mesh.geometry.instanceCount, 0); assert.equal(poof.mesh.visible, false, 'tail ends at zero instances/draws');
    // A late snapshot of an old return only updates the baseline.
    dropOnRoad(sim, towel); towel.returnAge = 2; send(3); poof.update(dt);
    assert.equal(poof.mesh.geometry.instanceCount, 0);
    assert.equal(VERSION, 42);
    poof.dispose();
  } finally { sim.dispose(); peer.dispose(); }
});
