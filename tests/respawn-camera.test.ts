import { enterPlaying } from './helpers/guide.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Simulation } from './fixtures/Simulation.js';
import { PlayerMotion } from '../shared/sim/PlayerMotion.js';
import { CameraRig } from '../client/js/render/CameraRig.js';
import { SceneCamera } from '../client/js/render/SceneCamera.js';
import { CFG } from '../client/js/core/config.js';
import { projectTeammateEdge, TeammateIndicators } from '../client/js/ui/TeammateIndicators.js';
import { DEFAULTS, applyConfig } from '../client/js/core/config.js';
import { NetworkGame } from '../client/js/online/NetworkGame.js';
import { applyPlayer, capturePlayer } from '../shared/snapshot.js';
import { quantize } from '../shared/delta.js';
import { room } from './helpers/peerRoom.js';

function fallNextTick(sim: Simulation, slot: number) {
  const p = sim.players[slot];
  p.state = 'air'; p.ground = null; p.pos.set(sim.trucks[0].pos.x - 15, 0.01, 12); p.vel.set(0, -1, 0);
  return p;
}

test('default revival is 5 seconds; all cats wait exactly 120 ticks, with pause freezing the wait', () => {
  const sim = new Simulation();
  try {
    const other = new PlayerMotion(new THREE.Scene(), { respawnReduction: 0 }); other.fallOut();
    assert.equal(other.fallTimer, 5);
    sim.occupy(0, true); sim.command('start'); enterPlaying(sim);
    const p = fallNextTick(sim, 0); sim.tick(); assert.equal(p.fallTimer, 2);
    sim.command('pause', true); for (let i=0;i<60;i++) sim.tick(); assert.equal(p.fallTimer, 2);
    sim.command('pause', false);
    for (let i=0;i<119;i++) sim.tick(); assert.equal(p.state, 'fallen'); assert.ok(p.fallTimer > 0);
    sim.tick(); assert.equal(p.state, 'air'); assert.equal(p.fallTimer, 0);
    assert.equal(p.pos.x, sim.trucks[0].pos.x + p.homeLocal.x);
    assert.equal(p.pos.z, sim.trucks[0].pos.z + p.homeLocal.z);
  } finally { sim.dispose(); }
});

test('death and revival are sent the same tick to every guest; dead inputs cannot take a teammate tool', () => {
  const r=room(['g1','g2','g3']);
  try {
    for(let i=0;i<91;i++) r.advance();
    const sim=r.host.sim, p=fallNextTick(sim,1), towel=sim.game.towels[0];
    towel.pickup(p); const before=sim.urgentSignature(); r.advance();
    assert.notEqual(sim.urgentSignature(),before); assert.equal(p.heldTool,null);
    for(const guest of r.guests) {
      const snap=guest.received.at(-1); assert.equal(snap.tick,sim.tickCount);
      assert.equal(snap.players[1].state,'fallen'); assert.equal(snap.players[1].fallTimer,2);
      // Every guest holds the authority's dead body exactly (through its own wire view) in the same tick.
      assert.deepEqual(snap.players[1],r.view(guest,snap.tick).players[1]);
      const copy=new PlayerMotion(new THREE.Scene()); applyPlayer(copy,snap.players[1],sim.trucks);
      assert.equal(copy.state,'fallen'); assert.equal(copy.fallTimer,2); assert.equal(copy.heldTool ?? null,null);
    }
    towel.pickup(sim.players[2]);
    r.guests[0].guest.sendInput({seq:1,move:[1,0],axis:[1,0],down:['KeyJ','Space'],hits:['KeyJ','Space']});
    for(let i=0;i<119;i++) r.advance();
    assert.equal(p.state,'fallen'); assert.equal(towel.holder,sim.players[2]);
    r.advance(); assert.equal(p.state,'air');
    for(const guest of r.guests) { const snap=guest.received.at(-1); assert.equal(snap.tick,sim.tickCount); assert.equal(snap.players[1].state,'air'); assert.equal(snap.players[1].fallTimer,0); }
  } finally { r.dispose(); }
});

test('guest prediction cannot revive without a host snapshot', () => {
  const sim=new Simulation();
  try {
    sim.occupy(0,true); for(let i=0;i<90;i++)sim.tick();
    const p=sim.players[0];p.fallOut();p.fallTimer=0.01;
    const network=new NetworkGame({connection:{room:{slot:0},addEventListener(){}}, players:sim.players,trucks:sim.trucks,game:sim.game,
      input:{clear(){},hit(){return false;}},camera:new THREE.PerspectiveCamera(),onPhase(){}});
    network.latest=sim.snapshot();network.ackBase=0;
    for(let i=1;i<=5;i++)network.predictTick(p,{seq:i,move:[0,0],axis:[0,0],down:[],hits:[]},sim.time+i/60);
    assert.equal(p.state,'fallen');assert.equal(p.fallTimer,0);
  }finally{sim.dispose();}
});

test('riding a departed order uses the same cat wait and drops the tool once', () => {
  const sim=new Simulation();
  try {
    sim.occupy(0,true);sim.phase='game';sim.game.start(sim.director.base);sim.game.openLane();sim.game.spawnOrder();
    const p=sim.players[0], truck=sim.game.orderTruck, towel=sim.game.towels[0];
    p.state='ground';p.ground={truck,plat:truck.platforms[0]};p.pos.set(truck.pos.x,truck.topY,truck.pos.z);towel.pickup(p);
    sim.game.order.mode='leaving';truck.pos.x=sim.game.homeX+23;sim.game.updateFleet(1/60);
    assert.equal(p.state,'fallen');assert.equal(p.fallTimer,2);assert.equal(p.heldTool,null);assert.equal(towel.flight,true);
    p.fallTimer=0.5;p.fallOut();assert.equal(p.fallTimer,0.5,'repeat death does not restart the countdown');
  }finally{sim.dispose();}
});

test('personal camera ignores remote players, fits its own jumps, and returns to its own respawn point', () => {
  const sim=new Simulation();
  const previous=(globalThis as any).addEventListener; (globalThis as any).addEventListener=()=>{};
  try {
    sim.occupy(0,true);for(let i=0;i<90;i++)sim.tick();
    const camera=new THREE.PerspectiveCamera(34,16/9),rig=new CameraRig(camera);
    const p=sim.players[0];p.state='ground';p.pos.set(sim.trucks[0].pos.x,sim.trucks[0].topY,sim.trucks[0].pos.z);p.root.position.copy(p.pos);
    let local=p;
    const view=new SceneCamera({camera,rig,game:sim.game,practice:{trucks:sim.trucks},session:{localPlayer:()=>local},transition:{}});
    const baseline=view.gameplayTargets(); const focus=baseline.focus.clone();
    rig.target.copy(focus);rig.followGameplay(baseline.focus,baseline.points,baseline);rig.updateGameplayFollow(1/60);
    assert.ok(Math.abs(rig.followDistance-12)<1e-9,'close default frame shared by co-op and versus (15 m x character scale 0.8)');
    sim.occupy(1,true);const remote=sim.players[1]; remote.state='air'; remote.pos.set(-500,80,500);remote.vel.y=2;
    for(let i=0;i<120;i++){
      remote.pos.x-=1;const targets=view.gameplayTargets();assert.deepEqual(targets.focus,focus);assert.equal(targets.safetyPoints.length,2);
      rig.followGameplay(targets.focus,targets.points,targets);rig.updateGameplayFollow(1/60);
    }
    assert.ok(Math.abs(rig.followDistance-12)<1e-9,'offscreen teammate cannot expand the local frame');
    p.state='air';p.pos.add(new THREE.Vector3(7,3,4));p.root.position.copy(p.pos);p.vel.y=2;
    const jump=view.gameplayTargets();rig.followGameplay(jump.focus,jump.points,jump);rig.updateGameplayFollow(1/60);camera.updateMatrixWorld(true);
    for(const point of jump.safetyPoints){const screen=point.clone().project(camera);assert.ok(Math.abs(screen.x)<0.9&&Math.abs(screen.y)<0.8);}
    p.state='air';p.vel.y=-1;p.pos.y=.5;assert.equal(view.gameplayTargets().safetyPoints.length,0);
    p.fallOut();p.pos.set(-500,0,500);const fallen=view.gameplayTargets();assert.equal(fallen.safetyPoints.length,0);
    assert.equal(fallen.focus.x,sim.trucks[0].pos.x+p.homeLocal.x);
    remote.root.position.copy(remote.pos);
    local=remote;assert.equal(view.gameplayTargets().safetyPoints.length,2);
    assert.ok(view.gameplayTargets().focus.distanceTo(remote.pos)<1,'a guest follows its own slot');
    CFG.camera.style='fixed';
    try {
      const home=sim.game.homeTruck,fixed=view.gameplayTargets();
      assert.deepEqual(fixed.focus.toArray(),[home.pos.x,home.topY+.65,home.pos.z],'fixed camera frames the home vehicle');
      assert.equal(fixed.points.length,0);assert.equal(fixed.minDistance,rig.gameplayOffset.length());
      local=p;p.pos.set(40,3,-20);assert.deepEqual(view.gameplayTargets().focus.toArray(),fixed.focus.toArray(),'fixed camera ignores the player');
    } finally {CFG.camera.style='follow';}
  }finally{sim.dispose();(globalThis as any).addEventListener=previous;}
});

test('personal camera follows the drawn local rider when platform prediction is ahead of the rendered truck', () => {
  const sim=new Simulation();
  try {
    sim.occupy(0,true);
    const player=sim.players[0], truck=sim.trucks[0];
    player.state='ground'; player.ground={truck,plat:truck.platforms[0]};
    player.pos.set(12,truck.topY,0); // Authority/prediction clock.
    player.root.position.set(10,truck.topY,0); // Interpolated vehicle clock.
    truck.pos.x=10;
    const view=new SceneCamera({camera:new THREE.PerspectiveCamera(),rig:{gameplayOffset:new THREE.Vector3(20,0,0)} as any,
      game:{homeTruck:truck,activeTrucks:()=>[truck]} as any,practice:{trucks:sim.trucks},session:{localPlayer:()=>player},transition:{} as any});
    const targets=view.gameplayTargets();
    assert.equal(targets.focus.x,10,'camera follows the on-screen rider, not the ahead prediction');
    assert.equal(targets.safetyPoints[0].x,10,'framing uses the same on-screen position');
  } finally { sim.dispose(); }
});

test('wheel zoom is local to a rig, relative to configured FOV and keeps the local player in frame', () => {
  const original = CFG.camera.playFov;
  try {
    CFG.camera.playFov = 32;
    const camera = new THREE.PerspectiveCamera(32, 16 / 9), rig = new CameraRig(camera);
    const other = new CameraRig(new THREE.PerspectiveCamera(32, 16 / 9));
    for (let i = 0; i < 10; i++) rig.zoomByWheel(-240);
    assert.equal(rig.gameplayFov, 16);
    assert.equal(other.gameplayFov, 32);
    assert.equal(CFG.camera.playFov, 32, 'saved camera baseline is untouched');
    const focus = new THREE.Vector3(7, 5, 4), points = [focus.clone(), focus.clone().add(new THREE.Vector3(0, 1.3, 0))];
    rig.followGameplay(focus, points); rig.updateGameplayFollow(1 / 60); camera.updateMatrixWorld(true);
    assert.equal(camera.fov, 16);
    for (const point of points) { const screen = point.clone().project(camera); assert.ok(Math.abs(screen.x) < .9 && Math.abs(screen.y) < .8); }
    for (let i = 0; i < 10; i++) rig.zoomByWheel(240);
    assert.equal(rig.gameplayFov, 48);
    rig.zoomByWheel(NaN); rig.zoomByWheel(Infinity); assert.equal(rig.gameplayFov, 48);
    CFG.camera.playFov = 40; assert.equal(rig.gameplayFov, 60, 'zoom remains relative when the baseline changes');
    rig.resetGameplay(); assert.equal(rig.zoomScale, 1.5, 'scene reset retains only the local preference');
  } finally { CFG.camera.playFov = original; }
});

test('teammate arrows hide visible actors and keep offscreen/behind-camera directions inside safe edges', () => {
  const out={x:0,y:0,angle:0,vertical:false};
  assert.equal(projectTeammateEdge(new THREE.Vector4(0,0,0,1),out),false);
  for(const [x,y] of [[3,0],[-3,0],[0,3],[0,-3],[3,3],[-3,-3]]) {
    assert.equal(projectTeammateEdge(new THREE.Vector4(x,y,0,1),out),true);
    assert.ok(out.x>=100&&out.x<=1340&&out.y>=105&&out.y<=705);
    assert.equal(Math.sign(out.x-720)||0,Math.sign(x)||0); assert.equal(Math.sign(out.y-405)||0,Math.sign(-y)||0);
  }
  assert.equal(projectTeammateEdge(new THREE.Vector4(3,0,3,-1),out),true);assert.equal(out.x,1340,'behind-camera right remains right');
  assert.equal(projectTeammateEdge(new THREE.Vector4(0,0,3,0),out),true);assert.equal(out.y,705);
  assert.equal(projectTeammateEdge(new THREE.Vector4(NaN,0,0,1),out),false);
});

test('versus arrows point only at offscreen teammates (bots included), never enemies; co-op shows every peer', () => {
  const previous = (globalThis as any).document;
  const node = (): any => ({ hidden: false, dataset: {}, style: {}, textContent: '', attrs: {} as any, className: '',
    setAttribute(k: string, v: string) { this.attrs[k] = v; }, getAttribute(k: string) { return this.attrs[k] ?? null; }, append() {}, appendChild() {}, remove() {} });
  (globalThis as any).document = { createElement: node, getElementById: node };
  try {
    // Eight seats far to the camera's right; slots 0-3 red, 4-7 blue, slot 2 is a red bot.
    const players = Array.from({ length: 8 }, (_, slot) => ({ occupied: true, sceneReady: true, state: 'ground', team: slot < 4 ? 0 : 1,
      displayName: `P${slot}`, homeLocal: new THREE.Vector3(), root: { getWorldPosition: (v: THREE.Vector3) => v.set(40 + slot, 0, 0) } }));
    const indicators = new TeammateIndicators(players, { pos: new THREE.Vector3(), topY: 0 });
    const camera = new THREE.PerspectiveCamera(32, 16 / 9, .1, 500); camera.position.set(0, 20, 0); camera.lookAt(0, 0, -1); camera.updateMatrixWorld(true);
    const shown = () => indicators.entries.map((e: any, slot: number) => !e.node.hidden ? slot : -1).filter((slot: number) => slot >= 0);
    indicators.update(camera, 0, true, 1, 0); assert.deepEqual(shown(), [1, 2, 3], 'red sees red teammates only');
    indicators.update(camera, 5, true, 1, 1); assert.deepEqual(shown(), [4, 6, 7], 'blue sees blue teammates only');
    players.length = 4; const coop = new TeammateIndicators(players, { pos: new THREE.Vector3(), topY: 0 });
    for (const p of players) delete (p as any).team;
    coop.update(camera, 0, true, 1, null);
    assert.deepEqual(coop.entries.map((e: any, slot: number) => !e.node.hidden ? slot : -1).filter((slot: number) => slot >= 0), [1, 2, 3], 'co-op shows every peer');
  } finally { (globalThis as any).document = previous; }
});

test('one close gameplay camera for co-op and versus, scaled with the characters; saved legacy 20/15 m distances and the old home offset count as unset', () => {
  const original = CFG.camera.playDistance, home = [CFG.camera.offsetX, CFG.camera.offsetY, CFG.camera.offsetZ];
  try {
    assert.equal(DEFAULTS.camera.playDistance, 12);
    const rig = new CameraRig(new THREE.PerspectiveCamera(32, 16 / 9));
    assert.ok(Math.abs(rig.gameplayOffset.length() - 12) < 1e-9, 'base follow distance and safety minimum share the default');
    for (const legacy of [20, 15]) { applyConfig({ camera: { playDistance: legacy } }); assert.equal(CFG.camera.playDistance, 12); }
    applyConfig({ camera: { playDistance: 24 } }); assert.equal(CFG.camera.playDistance, 24, 'a hand-tuned distance is kept');
    applyConfig({ camera: { offsetX: -8.5, offsetY: 21, offsetZ: 25.5 } });
    assert.deepEqual([CFG.camera.offsetX, CFG.camera.offsetY, CFG.camera.offsetZ], [DEFAULTS.camera.offsetX, DEFAULTS.camera.offsetY, DEFAULTS.camera.offsetZ], 'the old home framing follows the new default');
  } finally { CFG.camera.playDistance = original; [CFG.camera.offsetX, CFG.camera.offsetY, CFG.camera.offsetZ] = home; }
});
