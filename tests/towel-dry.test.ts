import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Simulation } from './fixtures/Simulation.js';
import { WetSurfaces } from '../client/js/fx/WetSurfaces.js';

const lighting = { hemi: { color: new THREE.Color('white'), groundColor: new THREE.Color('grey'), intensity: 1 }, sun: { color: new THREE.Color('white'), intensity: 1 }, offset: new THREE.Vector3(1, 2, 3) };

/** Real roof from the shared sim; two minimal presented players standing on it (slot 0 scrubs with a towel). */
function setup() {
  const sim = new Simulation(), truck = sim.trucks[0];
  sim.scene.updateMatrixWorld(true);
  const towelMesh = new THREE.Object3D(); sim.scene.add(towelMesh);
  const player = (x: number, z: number) => ({
    root: Object.assign(new THREE.Object3D(), { visible: true }), occupied: true, state: 'ground', ground: { truck }, useAction: '', heldTool: null as any,
    walk: 0, yaw: 0, pos: new THREE.Vector3(), visual: { vel: new THREE.Vector3() }, wetness: 0, setWetness(v: number) { this.wetness = v; },
    at(this: any) { this.pos.set(truck.pos.x + x, truck.topY, truck.pos.z + z); this.root.position.copy(this.pos); return this; },
  }).at();
  const players = [player(1, 0.5), player(1.4, 0.5)];
  players[0].heldTool = { kind: 'towel', mesh: towelMesh };
  towelMesh.position.set(truck.pos.x + 1.4, truck.topY + 0.1, truck.pos.z + 0.5);
  const game: any = { paused: false, ended: false, equipmentVisible: true, waterguns: [] };
  const wet: any = new WetSurfaces({ scene: sim.scene, game, trucks: [truck], players, lighting });
  return { sim, truck, players, wet, roof: wet.roofs[0] };
}

test('a scrubbing towel soaks up roof water fast without restarting its drying, leaving far marks alone', () => {
  const { sim, players, wet, roof: levels } = setup();
  try {
    // Multi-level roofs keep one decal layer per level; this test works on the level under the towel.
    const roof = levels.layers[levels.layerAt(1.4, 0.5)].pool, farLayer = levels.layers[levels.layerAt(-3, -0.5)].pool;
    const near = roof.emit(1.4, 0.5, wet.time, { radius: 0.5, dry: 9 }), far = farLayer.emit(-3, -0.5, wet.time, { radius: 0.5, dry: 9 });
    for (let i = 0; i < 60; i++) wet.update(1 / 60, 0);
    const before = { ...roof.records[near] }, progress = (wet.time - before.birth) / before.dry;
    // Not scrubbing: nothing changes.
    for (let i = 0; i < 10; i++) wet.update(1 / 60, 0);
    assert.equal(roof.records[near].dry, before.dry);
    // Direct re-time keeps the current drying progress (no visual jump).
    const touched = roof.dryNear(1.4, 0.5, wet.time, 0.55, 0.45);
    assert.equal(touched, 1, 'only the mark under the towel');
    const r = roof.records[near], now = (wet.time - r.birth) / r.dry;
    assert.ok(Math.abs(now - (wet.time - before.birth) / before.dry) < 1e-9 && now > progress * 0.99);
    const left = r.birth + r.dry - wet.time;
    assert.ok(left >= 0.45 - 1e-9 && left < 0.8, `finishes drying within a second (${left.toFixed(2)} s)`);
    assert.ok(wet.time - r.birth >= 0.1 - 1e-9, 'never replays the fade-in');
    assert.equal(farLayer.records[far].dry, 9, 'out-of-reach marks keep drying naturally');
    // Through the frame loop: a fresh mark under a scrubbing towel is gone well before its natural 9 s.
    const fresh = roof.emit(1.45, 0.45, wet.time, { radius: 0.5, dry: 9 });
    players[0].useAction = 'wipe';
    for (let i = 0; i < 12; i++) wet.update(1 / 60, 0);
    const f = roof.records[fresh];
    assert.ok(f.birth + f.dry - wet.time < 0.8, 'scrubbing soaks it up');
  } finally { wet.dispose(); sim.dispose(); }
});

test('the towel rubs a wet teammate dry much faster than air drying', () => {
  const { sim, players, wet } = setup();
  try {
    wet.wet[1] = 1; wet.lastHit[1] = wet.time;
    for (let i = 0; i < 30; i++) wet.update(1 / 60, 0);
    assert.ok(wet.wet[1] > 0.99, 'air drying waits and is slow');
    players[0].useAction = 'wipe';
    for (let i = 0; i < 30; i++) wet.update(1 / 60, 0);
    assert.ok(wet.wet[1] < 0.0 + 0.5, `half a second of rubbing removes most of the water (${wet.wet[1].toFixed(2)})`);
    assert.ok(players[1].wetness < 0.55);
  } finally { wet.dispose(); sim.dispose(); }
});

// Integrated wet fields affect electricity, so wiping must be decided by the
// authority and sent to both guests, while the original fade curve is retained.
import { room } from './helpers/peerRoom.js';

test('host towel drying reaches both guests, preserves distant marks and freezes with pause', () => {
  const r = room(['wipe-guest', 'observer']);
  try {
    r.host.command('start');for (let i = 0; i < 430; i++) r.advance();
    const sim = r.host.sim, g = sim.game, truck = sim.trucks[0], p = sim.players[1];
    p.state = 'ground'; p.ground = { truck, plat: truck.platformAt(truck.pos.x + 1, truck.pos.z + .5, 0) };
    p.pos.set(truck.pos.x + 1, truck.topY, truck.pos.z + .5); p.root.position.copy(p.pos);p.vel.set(0,0,0);p.yaw=0;
    g.towels[0].pickup(p);p.skipUse=false;
    g.wet.random=()=>.5;g.wet.splash(truck,1.46,.5);g.wet.splash(truck,-3,-1);g.wet.advance(.2,0);
    const marks=g.wet.surfaces[1].marks,near=marks.find((m:any)=>m.id&&m.x>0),far=marks.find((m:any)=>m.id&&m.x<0);
    const farDry=far.dry,before=sim.urgentSignature();
    r.guests[0].guest.sendInput({seq:1,move:[0,0],axis:[0,0],down:['KeyJ'],hits:['KeyJ']});
    for(let i=0;i<6;i++)r.advance();
    assert.ok(near.dry<farDry);assert.equal(far.dry,farDry);assert.notEqual(sim.urgentSignature(),before);
    assert.ok(g.wet.dryRevision>0,'wiping requests an immediate authority snapshot');
    for(const guest of r.guests){
      const snap=guest.received.at(-1),mark=(Object.values(snap.game.wet.surfaces[1].marks) as number[][]).find(m=>m[0]===near.id);
      assert.ok(mark&&Math.abs(mark[7]-near.dry)<1e-4,'both peers hold the authority drying duration');
    }
    r.host.command('pause',{paused:true});const frozen=g.wet.capture();for(let i=0;i<30;i++)r.advance();assert.deepEqual(g.wet.capture(),frozen);
    r.host.command('pause',{paused:false});
    r.guests[0].guest.sendInput({seq:2,move:[0,0],axis:[0,0],down:['KeyJ'],hits:[]});
    for(let i=0;i<60;i++)r.advance();
    assert.equal(near.id,0,'wiped water disappears from collision/conduction as well as the image');assert.ok(far.id>0);
  }finally{r.dispose();}
});
