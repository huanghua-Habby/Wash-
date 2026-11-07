import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Simulation } from './fixtures/Simulation.js';
import { applyWorld } from '../shared/snapshot.js';
import { packetInput } from '../shared/protocol.js';

test('home practices the actual level tools with authority ownership, without orders, score or countdown', () => {
  const sim = new Simulation(), peer = new Simulation();
  try {
    const game = sim.game, home = sim.trucks[0];
    const instances = [...game.tools, game.station, ...game.hoses];
    assert.equal(game.practice, true); assert.equal(game.active, false);
    assert.ok(game.tools.filter((tool: any) => tool.active !== false).every((tool: any) => tool.mesh.visible));
    assert.equal(game.soapBox.visible, game.equipment.soap.enabled);
    assert.equal(game.station.visible, true); assert.equal(game.activeTrucks().length, 2);
    for (let i = 0; i < 400; i++) sim.tick();
    assert.equal(game.order, null); assert.equal(game.remaining, 0); assert.equal(game.elapsed, 0); assert.equal(game.score, 0);
    sim.occupy(0, true); sim.occupy(1, true);
    sim.scene.updateMatrixWorld(true);
    const tool = game.waterguns[0], spot = tool.worldPosition();
    for (const p of sim.players.slice(0, 2)) {
      p.state = 'ground'; p.ground = { truck: home, plat: home.platforms[0] };
      p.pos.set(spot.x, home.topY, spot.z); p.root.position.copy(p.pos);
    }
    const press = { seq: 1, move: [0, 0], axis: [0, 0], down: ['KeyJ'], hits: ['KeyJ'] };
    sim.input(0, press); sim.input(1, press); sim.tick();
    assert.equal(tool.holder, sim.players[0]); assert.equal(sim.players[1].heldTool, null);
    sim.players[0].skipUse = false;
    game.interact(sim.players[0], packetInput({ ...press, hits: [] }), 1 / 60);
    assert.equal(tool.spraying, true); assert.equal(game.score, 0); assert.equal(game.remaining, 0);
    applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, sim.snapshot());
    assert.equal(peer.game.practice, true); assert.equal(peer.game.tools[3].holder, peer.players[0]);
    assert.equal(peer.game.waterguns[0].mesh.visible, true); assert.equal(peer.game.station.visible, true);
    sim.command('start'); assert.equal(game.practice, false); assert.equal(tool.holder, null);
    assert.ok(instances.every((object, i) => object === [...game.tools, game.station, ...game.hoses][i]), 'start reuses loaded equipment');
    for (let i = 0; i < 220; i++) sim.tick();
    assert.equal(game.active, true); assert.ok(game.remaining > 175); assert.equal(tool.holder, null);
    assert.equal(tool.mesh.position.x, game.equipment.waterguns[0].position[0]);
    sim.command('home'); assert.equal(game.practice, true); assert.equal(game.elapsed, 0); assert.equal(game.order, null);
    assert.ok(instances.every((object, i) => object === [...game.tools, game.station, ...game.hoses][i]), 'return reuses the same scene objects');
  } finally { sim.dispose(); peer.dispose(); }
});
