import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { getLevel } from '../shared/levels.js';
import { packetInput, VERSION } from '../shared/protocol.js';
import { applyPlayer } from '../shared/snapshot.js';
import { quantize } from '../shared/delta.js';
import { PLAYER_BODY, resolvePlayerContacts } from '../shared/sim/PlayerContacts.js';
import { STATION_SOLID, SOAP_BOX_SOLID } from '../shared/sim/ToolModels.js';
import { Simulation } from './fixtures/Simulation.js';
import { enterPlaying } from './helpers/guide.js';

const DT = 1 / 60;
const idle = packetInput({ seq: 1, move: [0, 0], axis: [0, 0], down: [], hits: [] });
const walk = (x: number, z = 0) => packetInput({ seq: 1, move: [x, z], axis: [x, z], down: [], hits: [] });

function world() {
  const sim = new Simulation(getLevel('highway-03') as any); // soap level: the crate is shown
  sim.occupy(0, true); sim.occupy(1, true); sim.command('start'); enterPlaying(sim);
  return sim;
}
/** Drop `p` from `height` above the roof at truck-local (x, z), ticking only its own motion. */
function dropAt(sim: any, p: any, x: number, z: number, height: number) {
  const home = sim.game.homeTruck;
  p.state = 'air'; p.ground = null; p.wall = null; p.vel.set(home.vel.x, 0, home.vel.z); p.airBase.set(home.vel.x, home.vel.z);
  p.pos.set(home.pos.x + x, home.topY + height, home.pos.z + z);
  for (let i = 0; i < 90 && p.state === 'air'; i++) p.update(DT, 0, idle, sim.game.activeTrucks(), sim.camera, sim.game.base);
}

test('the wash station and the soap crate have standable tops; walking off drops back to the roof', () => {
  const sim = world();
  try {
    const g: any = sim.game, home = g.homeTruck, p = sim.players[0];
    assert.equal(home.solids.length, 4, 'station, soap crate, the tutorial dummy and the versus hack console are solid');
    assert.equal(home.solids[2].active, false, 'the dummy is only solid during its lesson');
    assert.equal(home.solids[3].active, false, 'the hack console is only solid in versus');
    const [station, crate] = home.solids;
    assert.equal(crate.height, SOAP_BOX_SOLID.height);
    dropAt(sim, p, station.x, station.z, 2);
    assert.equal(p.state, 'ground'); assert.equal(p.ground.solid, 0);
    assert.ok(Math.abs(p.pos.y - (home.topYAt(home.pos.x + station.x, home.pos.z + station.z) + STATION_SOLID.height)) < 1e-9, 'stands on the counter');
    assert.ok(g.nearStation(p), 'still in towel-wash range up there');
    dropAt(sim, p, crate.x, crate.z, 2);
    assert.equal(p.ground.solid, 1); assert.ok(Math.abs(p.pos.y - (home.topYAt(home.pos.x + crate.x, home.pos.z + crate.z) + SOAP_BOX_SOLID.height)) < 1e-9);
    assert.ok(g.nearSoapBox(p), 'can take soap while standing on the crate');
    // Walk off the crate: airborne, then back on the roof.
    for (let i = 0; i < 90 && !(p.state === 'ground' && p.ground.solid === -1); i++) p.update(DT, 0, walk(0, -1), g.activeTrucks(), sim.camera, g.base); // toward the roof's middle
    assert.equal(p.state, 'ground'); assert.equal(p.ground.solid, -1); assert.ok(Math.abs(p.pos.y - home.topYAt(p.pos.x, p.pos.z)) < 1e-9);
    // From the roof the crate still blocks sideways.
    p.pos.set(home.pos.x + crate.x - 1.2, home.topYAt(home.pos.x + crate.x - 1.2, home.pos.z + crate.z), home.pos.z + crate.z);
    for (let i = 0; i < 60; i++) p.update(DT, 0, walk(1), g.activeTrucks(), sim.camera, g.base);
    assert.ok(p.pos.x - home.pos.x < crate.x - crate.hx, 'pushed out of the crate side');
  } finally { sim.dispose(); }
});

test('a gliding player settles on a head, rides along when the base walks, and steps off past the head radius', () => {
  const sim = world();
  try {
    const g: any = sim.game, home = g.homeTruck, [a, b] = sim.players;
    const base = () => { b.state = 'ground'; b.ground = { truck: home, plat: home.platforms[0], solid: -1 }; b.pos.set(home.pos.x - 2, home.topY, home.pos.z - 0.8); };
    base();
    a.state = 'air'; a.ground = null; a.vel.set(0, -2, 0); a.gliding = true; // gliders land softly (WOBBLE.md §5)
    const previous = [new THREE.Vector3(b.pos.x + 0.1, b.pos.y + PLAYER_BODY.height + 0.05, b.pos.z), b.pos.clone()];
    a.pos.set(b.pos.x + 0.1, b.pos.y + PLAYER_BODY.height - 0.02, b.pos.z);
    resolvePlayerContacts([a, b], previous, DT);
    assert.equal(a.state, 'ground'); assert.equal(a.ground.stand, 1);
    assert.ok(Math.abs(a.pos.y - (b.pos.y + PLAYER_BODY.height)) < 1e-9, 'on the head');
    // The base walks 0.5 m: the rider moves with it.
    b.pos.x += 0.5; resolvePlayerContacts([a, b], [a.pos.clone(), b.pos.clone()], DT);
    assert.ok(Math.abs(a.pos.x - (b.pos.x + 0.1)) < 1e-9, 'rides along');
    // The rider walks off the head.
    for (let i = 0; i < 30 && a.state === 'ground'; i++) { a.update(DT, 0, walk(1), g.activeTrucks(), sim.camera, g.base); resolvePlayerContacts([a, b], [a.pos.clone(), b.pos.clone()], DT); }
    assert.equal(a.state, 'air', 'stepped off');
  } finally { sim.dispose(); }
});

test('a rider drops when the base falls or leaves, and a two-high stack follows its bottom player', () => {
  const sim = world();
  try {
    const g: any = sim.game, home = g.homeTruck;
    sim.occupy(2, true);
    const [a, b, c] = sim.players;
    for (const p of [a, b, c]) { p.state = 'ground'; p.ground = { truck: home, plat: home.platforms[0], solid: -1 }; p.pos.set(home.pos.x - 2, home.topY, home.pos.z); }
    b.landOnHead(2, c, 0, 0); a.landOnHead(1, b, 0, 0);
    c.pos.x += 0.3; resolvePlayerContacts([a, b, c], [a.pos.clone(), b.pos.clone(), c.pos.clone()], DT);
    assert.ok(Math.abs(a.pos.y - (c.pos.y + 2 * PLAYER_BODY.height)) < 1e-9 && Math.abs(a.pos.x - c.pos.x) < 1e-9, 'stack of three');
    c.state = 'fallen'; resolvePlayerContacts([a, b, c], [a.pos.clone(), b.pos.clone(), c.pos.clone()], DT);
    assert.equal(b.state, 'air', 'the middle drops when its base falls');
  } finally { sim.dispose(); }
});

test('standing state survives the snapshot and is signed urgently', () => {
  const sim = world();
  try {
    const g: any = sim.game, home = g.homeTruck, [a, b] = sim.players;
    b.state = 'ground'; b.ground = { truck: home, plat: home.platforms[0], solid: -1 }; b.pos.set(home.pos.x - 2, home.topY, home.pos.z);
    const before = sim.urgentSignature();
    a.landOnHead(1, b, 0.1, -0.05);
    assert.notEqual(sim.urgentSignature(), before);
    const peer = new Simulation(getLevel('highway-03') as any);
    try {
      const data = quantize(sim.snapshot());
      data.players.forEach((state: any, i: number) => applyPlayer(peer.players[i], state, peer.trucks));
      assert.equal(peer.players[0].ground.stand, 1); assert.deepEqual(peer.players[0].ground.offset, { x: 0.1, z: -0.05 });
    } finally { peer.dispose(); }
    assert.equal(VERSION, 42);
  } finally { sim.dispose(); }
});
