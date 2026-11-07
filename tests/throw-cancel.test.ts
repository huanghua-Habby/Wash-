import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from './fixtures/Simulation.js';
import { packetInput } from '../shared/protocol.js';
import { applyWorld, applyPlayer } from '../shared/snapshot.js';

const dt = 1 / 60;
const keys = (down: string[] = [], hits: string[] = []) => packetInput({ seq: 1, move: [0, 0], axis: [0, 0], down, hits });

for (const kind of ['towel', 'water']) {
  test(`${kind}: jumping keeps the K charge and releasing K mid-air throws`, () => {
    const sim = new Simulation(), peer = new Simulation();
    try {
      sim.occupy(0, true); sim.phase = 'game'; sim.game.start(sim.director.base);
      const p = sim.players[0], home = sim.trucks[0], game = sim.game;
      p.pos.set(home.pos.x - 2, home.topY, home.pos.z); p.root.position.copy(p.pos);
      p.state = 'ground'; p.ground = { truck: home, plat: home.platforms[0] };
      const tool = kind === 'towel' ? game.towels[0] : game.waterguns[0]; tool.pickup(p);
      for (let i = 0; i < 35; i++) game.interact(p, keys(['KeyK'], i === 0 ? ['KeyK'] : []), dt);
      const before = tool.charge; assert.ok(before > 0.5);
      game.interact(p, keys(['KeyK', 'Space'], ['Space']), dt);
      assert.ok(tool.charge > before, 'Space does not clear or restart the charge'); assert.equal(p.throwCancelled, false);
      p.update(dt, 0, keys(['KeyK', 'Space'], ['Space']), [home], sim.camera, sim.director.base);
      assert.equal(p.state, 'air', 'the jump itself still happens');
      for (let i = 0; i < 5; i++) game.interact(p, keys(['KeyK']), dt);
      // Teammates see the uninterrupted charge.
      const state = sim.snapshot(); applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, state);
      state.players.forEach((data: any, i: number) => applyPlayer(peer.players[i], data, peer.trucks));
      const otherTool = kind === 'towel' ? peer.game.towels[0] : peer.game.waterguns[0];
      assert.equal(peer.players[0].heldTool, otherTool); assert.ok(otherTool.charge > before);
      game.interact(p, keys(), dt);
      assert.equal(p.heldTool, null); assert.equal(tool.flight, true, 'K release in the air throws');
    } finally { sim.dispose(); peer.dispose(); }
  });
}

test('a mid-air throw keeps the jump carry, and Space with a same-tick K release still throws', () => {
  const sim = new Simulation();
  try {
    sim.occupy(0, true); sim.phase = 'game'; sim.game.start(sim.director.base);
    const p = sim.players[0], tool = sim.game.towels[0]; tool.pickup(p);
    p.state = 'air'; p.ground = null; p.airBase.set(4, -1); p.yaw = 0;
    for (let i = 0; i < 40; i++) sim.game.interact(p, keys(['KeyK']), dt);
    sim.game.interact(p, keys([], ['Space']), dt); // K released in the same tick Space is pressed
    assert.equal(p.heldTool, null); assert.equal(tool.flight, true);
    assert.ok(tool.velocity.x > 5.5 + 4 - 1e-6, 'forward throw plus the airborne carry'); assert.ok(Math.abs(tool.velocity.z + 1) < 1e-6);
  } finally { sim.dispose(); }
});

for (const kind of ['towel', 'water', 'soap', 'charger']) for (const shift of ['ShiftLeft', 'ShiftRight']) {
  test(`${kind}: dormant ${shift} does not interrupt a K throw gesture`, () => {
    const sim = new Simulation();
    try {
      sim.occupy(0, true); sim.phase = 'game'; sim.game.start(sim.director.base);
      const p = sim.players[0], game = sim.game;
      const tool = kind === 'towel' ? game.towels[0] : kind === 'water' ? game.waterguns[0] : kind === 'charger' ? game.chargers[0] : game.takeSoap(p);
      tool.pickup(p);
      for (let i = 0; i < 25; i++) game.interact(p, keys(['KeyK'], i === 0 ? ['KeyK'] : []), dt);
      const before = tool.charge; assert.ok(before > 0);
      game.interact(p, keys(['KeyK', shift], [shift]), dt);
      assert.ok(tool.charge > before, 'ignored Shift does not clear or restart charge');
      assert.equal(p.heldTool, tool);
      game.interact(p, keys([], [shift]), dt);
      assert.equal(p.heldTool, null); assert.equal(tool.flight, true, 'K release still throws');
    } finally { sim.dispose(); }
  });
}
