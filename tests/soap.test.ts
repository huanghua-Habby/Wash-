import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Simulation } from './fixtures/Simulation.js';
import { packetInput } from '../shared/protocol.js';
import { applyWorld, applyPlayer } from '../shared/snapshot.js';
import { CleaningEffects } from '../client/js/game/CleaningEffects.js';
import { WASH_CONFIG as C } from '../shared/sim/washConfig.js';
import { VERSION } from '../shared/protocol.js';
import { SAVE_VERSION } from '../shared/levels.js';
import { room } from './helpers/peerRoom.js';
import { CleaningSoap } from '../client/js/game/CleaningTools.js';
const keys=(down:string[]=[],hits:string[]=[])=>packetInput({seq:1,down,hits,move:[0,0],axis:[0,0]});
function setup() {
 const sim=new Simulation();sim.occupy(0,true);sim.occupy(1,true);sim.phase='game';sim.game.start(sim.director.base);
 const home=sim.trucks[0];
 sim.players.forEach(p=>{p.state='ground';p.ground={truck:home,plat:home.platforms[0]};p.pos.set(home.pos.x+1.25,home.topY,home.pos.z+0.65);p.root.position.copy(p.pos);p.vel.set(0,0,0);});
 sim.scene.updateMatrixWorld(true);return sim;
}
test('soap supply gives independent bars; continuous budget and soap/water/towel steps are authoritative',()=>{
 const sim=setup(),peer=setup();try {
 const g=sim.game,p=sim.players[0],q=sim.players[1];
 g.interact(p,keys(['KeyJ'],['KeyJ']),1/60);g.interact(q,keys(['KeyJ'],['KeyJ']),1/60);
 assert.equal(p.heldTool.kind,'soap');assert.notEqual(p.heldTool,q.heldTool);assert.equal(g.soaps.length,2);
 const soap=p.heldTool;g.spawnOrder();sim.scene.updateMatrixWorld(true);
 const stain=g.order.stains[2],target=stain.mesh.getWorldPosition(new THREE.Vector3());
 p.pos.copy(target);p.ground={truck:g.orderTruck,plat:g.orderTruck.platforms[0]};p.skipUse=false;
 for(let i=0;i<30;i++)g.interact(p,keys(['KeyJ']),1/60);
 assert.ok(Math.abs(soap.durability-0.5)<1e-6);assert.ok(Math.abs(stain.progress-0.5)<1e-6);
 const snap=sim.snapshot();applyWorld({game:peer.game,trucks:peer.trucks,players:peer.players},snap);
 assert.equal(peer.players[0].heldTool.kind,'soap');assert.equal(peer.game.soaps[0].durability,soap.durability);
 assert.deepEqual(peer.game.order.stains[2].steps,['soap','water','towel']);
 for(let i=0;i<31;i++)g.interact(p,keys(['KeyJ']),1/60);
 assert.equal(stain.stage,1);assert.equal(soap.active,false);assert.equal(p.heldTool,null);assert.equal(g.score,0);
 g.interact(p,keys(['KeyJ']),1/60);assert.equal(stain.progress,0,'empty hands cannot advance water');
 }finally{sim.dispose();peer.dispose();}
});

test('100 J/K take/place cycles stop at ten live bars, then reuse a retired slot with an urgent new generation',()=>{
 const sim=setup();try {
  const g=sim.game,p=sim.players[0],home=sim.trucks[0];
  const atBox=()=>{p.pos.set(home.pos.x+1.25,home.topY,home.pos.z+.65);p.root.position.copy(p.pos);sim.scene.updateMatrixWorld(true);};
  assert.equal(C.maxSoapEntities,10);
  for(let i=0;i<100;i++){
   atBox();g.interact(p,keys(['KeyJ'],['KeyJ']),1/60);
   if(i>=10){assert.equal(p.heldTool,null);assert.equal(p.interactionHint,'拾取现有肥皂');continue;}
   assert.equal(p.heldTool.kind,'soap');p.pos.set(home.pos.x-2,home.topY,home.pos.z+.65);
   g.interact(p,keys(['KeyK'],['KeyK']),1/60);g.interact(p,keys(),1/60);assert.equal(p.heldTool,null);
  }
  assert.equal(g.soaps.length,10);assert.equal(g.soaps.filter((s:any)=>s.active).length,10);
  assert.throws(()=>g.ensureSoap(10),/capacity/);
  const old=g.soaps[3],generation=old.generation;old.retire();const before=sim.urgentSignature();
  atBox();g.interact(p,keys(['KeyJ'],['KeyJ']),1/60);
  assert.equal(p.heldTool,old);assert.equal(old.generation,generation+1);assert.notEqual(sim.urgentSignature(),before);
  assert.equal(g.soaps.length,10);assert.equal(sim.snapshot().game.soaps.length,10);
  g.stop();assert.equal(g.soaps.filter((s:any)=>s.active).length,0);assert.equal(g.soaps.length,10);
  assert.equal(VERSION, 42);assert.equal(SAVE_VERSION,'0.5','entity budget does not change saved results');
 }finally{sim.dispose();}
});

test('two guest protocol links compete for the last soap slot; host and both guests agree and recover capacity after retirement',()=>{
 const r=room(['g1','g2']);try {
  for(let i=0;i<90;i++)r.advance();
  const sim=r.host.sim,g=sim.game,home=sim.trucks[0];
  for(let i=0;i<9;i++)g.takeSoap(sim.players[0]).placeOn(home,new THREE.Vector3(-2,0,.65));
  for(const slot of [1,2]){
   const p=sim.players[slot];p.state='ground';p.ground={truck:home,plat:home.platforms[0]};
   // Both contenders can reach the box without starting inside the same collision body.
   p.pos.set(home.pos.x+1.25,home.topY,home.pos.z+.65+(slot===1?-.4:.4));p.root.position.copy(p.pos);p.vel.set(0,0,0);
  }
  sim.scene.updateMatrixWorld(true);
  for(const guest of r.guests)guest.guest.sendInput({seq:1,move:[0,0],axis:[0,0],down:['KeyJ'],hits:['KeyJ']});
  r.advance();assert.equal(g.soaps.length,10);assert.equal(sim.players[1].heldTool,g.soaps[9]);assert.equal(sim.players[2].heldTool,null);
  for(const guest of r.guests){const snap=guest.received.at(-1);assert.equal(snap.game.soaps.filter((s:any)=>s.active).length,10);assert.equal(snap.game.soaps[9].holder,1);}
  const recycled=g.soaps[3],generation=recycled.generation;recycled.retire();
  r.guests[1].guest.sendInput({seq:2,move:[0,0],axis:[0,0],down:['KeyJ'],hits:['KeyJ']});r.advance();
  assert.equal(sim.players[2].heldTool,recycled);assert.equal(recycled.generation,generation+1);assert.equal(g.soaps.length,10);
  for(const guest of r.guests){const snap=guest.received.at(-1);assert.equal(snap.game.soaps[3].holder,2);assert.equal(snap.game.soaps[3].generation,generation+1);}
 }finally{r.dispose();}
});

test('a fresh authority snapshot retires excess view soaps without shifting charger IDs or erasing incoming pouches',()=>{
 const sim=setup(),peer=setup();try{
  peer.game.ensureSoap(9);const stale=peer.game.soaps[9];stale.activate();
  stale.swallowedBy=peer.players[1];peer.players[1].swallowed=stale;
  sim.players[0].swallowedBy=sim.players[1];sim.players[1].swallowed=sim.players[0];
  sim.game.chargers[0].pickup(sim.players[2]);const snap=sim.snapshot();
  applyWorld({game:peer.game,trucks:peer.trucks,players:peer.players},snap);
  assert.equal(peer.game.soaps.length,10,'retain the bounded prepared pool');assert.equal(stale.active,false);assert.equal(stale.mesh.visible,false);
  assert.equal(stale.swallowedBy,null);assert.equal(peer.players[1].swallowed,peer.players[0]);
  assert.equal(peer.players[2].heldTool,peer.game.chargers[0]);assert.equal(peer.game.chargers[0].id,snap.game.chargers[0].id);
  assert.equal(peer.game.chargers[0].holder,peer.players[2]);
 }finally{sim.dispose();peer.dispose();}
});

test('road-fallen soap frees capacity while held, swallowed and other airborne bars keep their identities',()=>{
 const sim=setup();try{
  const g=sim.game,p=sim.players[0];for(let i=0;i<10;i++)g.takeSoap(p);
  const held=g.soaps[0],pouch=g.soaps[1],air=g.soaps[2],fallen=g.soaps[3];
  held.pickup(p);pouch.swallowedBy=sim.players[1];sim.players[1].swallowed=pouch;
  air.release(null,new THREE.Vector3(1,3,0));fallen.release(null,new THREE.Vector3());fallen.mesh.position.y=-1;
  const identities=g.soaps.map((s:any)=>({id:s.id,generation:s.generation}));
  assert.equal(g.takeSoap(p),null);fallen.update(1,[],()=>false);assert.equal(fallen.active,false);
  const renewed=g.takeSoap(sim.players[2]);assert.equal(renewed,fallen);assert.equal(renewed.generation,identities[3].generation+1);
  assert.equal(g.soaps.length,10);assert.equal(held.holder,p);assert.equal(pouch.swallowedBy,sim.players[1]);assert.equal(air.flight,true);
  for(const i of [0,1,2])assert.deepEqual({id:g.soaps[i].id,generation:g.soaps[i].generation},identities[i]);
 }finally{sim.dispose();}
});

test('client soap pool wrappers share prepared geometry, palette and shadow-depth variants',()=>{
 const sim=setup();try{
  const first=new CleaningSoap(sim.scene,sim.trucks[0],new THREE.Vector3(),0),next=new CleaningSoap(sim.scene,sim.trucks[0],new THREE.Vector3(),1);
  const meshes=(soap:any)=>{const result:any[]=[];soap.mesh.traverse((o:any)=>{if(o.isMesh)result.push(o);});return result;};
  const a=meshes(first),b=meshes(next);assert.equal(a.length,b.length);
  a.forEach((mesh:any,i:number)=>{assert.equal(mesh.geometry,b[i].geometry);assert.equal(mesh.material,b[i].material);if(mesh.castShadow)assert.ok(mesh.customDepthMaterial);assert.equal(mesh.customDepthMaterial,b[i].customDepthMaterial);});
 }finally{sim.dispose();}
});
test('preemptive J catches soap in midair before impact; no J triggers forced slip; snapshot carries slip',()=>{
 for(const catching of [false,true]) {
 const sim=setup(),peer=setup();try {
 const g=sim.game,p=sim.players[1];p.state='air';p.ground=null;p.pos.y+=1;p.pos.x+=5;
 const soap=g.takeSoap(sim.players[0]);soap.pickup(sim.players[0]);soap.launch(sim.players[0]);soap.ownerGrace=0;
 g.inputs[1]=keys(catching?['KeyJ']:[],catching?['KeyJ']:[]);
 const center=p.pos.clone().add(new THREE.Vector3(0,0.65,0));
 assert.equal(g.interceptItem(soap,center.clone().add(new THREE.Vector3(-2,0,0)),center.clone().add(new THREE.Vector3(2,0,0))),true);
 if(catching) {assert.equal(p.heldTool,soap);assert.equal(p.slipRemaining,0);assert.equal(soap.flight,false);}
 else {assert.ok(p.slipRemaining>0);assert.equal(p.heldTool,null);}
 const snap=sim.snapshot();applyWorld({game:peer.game,trucks:peer.trucks,players:peer.players},snap);applyPlayer(peer.players[1],snap.players[1],peer.trucks);
 assert.equal(peer.players[1].slipRemaining,p.slipRemaining);
 }finally{sim.dispose();peer.dispose();}
 }
});
test('stepping forces a forward dash; J pickup and loose near misses do not slip',()=>{
 const sim=setup();try {
 const g=sim.game,p=sim.players[0],home=sim.trucks[0],soap=g.takeSoap(p);
 soap.placeOn(home,new THREE.Vector3(1.25,0,0.65));sim.players[1].occupied=false;g.inputs[0]=keys();
 g.updateActors(1/60,0,sim.camera);assert.ok(p.slipRemaining>0);
 p.slipRemaining=p.slipCooldown=p.dashRemaining=0;p.pos.set(home.pos.x+1.25,home.topY,home.pos.z+0.65);p.root.position.copy(p.pos);
 g.inputs[0]=keys(['KeyJ'],['KeyJ']);g.updateActors(1/60,0,sim.camera);
 assert.equal(p.heldTool,soap);assert.equal(p.slipRemaining,0);
 }finally{sim.dispose();}
});
test('washing charges durability continuously: half-full takes half the empty duration and survives interruption',()=>{
 const sim=setup();try {
 const g=sim.game,p=sim.players[0],t=g.towels[0];t.pickup(p);t.consume(1);
 sim.scene.updateMatrixWorld(true);p.pos.copy(g.station.getWorldPosition(new THREE.Vector3()));p.pos.y=sim.trucks[0].topY;
 g.interact(p,keys(['KeyJ']),0.35);assert.ok(Math.abs(t.durabilityRatio-0.75)<1e-6);
 g.interact(p,keys(),1/60);assert.ok(Math.abs(t.durabilityRatio-0.75)<1e-6);
 g.interact(p,keys(['KeyJ']),0.35);assert.equal(t.durabilityRatio,1);
 }finally{sim.dispose();}
});
test('foam and clean sparkle use fixed GPU instance buffers; clean time survives peer snapshots',()=>{
 const sim=setup(),peer=setup();try {
 const g=sim.game;g.spawnOrder();const fx=new CleaningEffects(g);
 const versions=fx.layers.map(mesh=>(mesh.geometry.attributes.aSeed as THREE.BufferAttribute).version);
 g.order.stains[2].progress=0.5;fx.update();assert.equal(fx.states.value[2].x,0.5);
 g.order.stains[2].stage=1;g.order.stains[2].progress=0.25;g.elapsed=3;fx.update();assert.equal(fx.states.value[2].x,0.75);
 Object.assign(g.order.stains[0],{done:true,cleanedAt:3});
 for(let i=0;i<20;i++){g.elapsed+=0.02;fx.update();}
 fx.layers.forEach((mesh,i)=>{assert.equal(mesh.geometry.isInstancedBufferGeometry,true);assert.ok((mesh.geometry.attributes.aSeed as THREE.BufferAttribute).version>=versions[i]);assert.equal('instanceMatrix' in mesh,false);});
 applyWorld({game:peer.game,trucks:peer.trucks,players:peer.players},sim.snapshot());assert.equal(peer.game.order.stains[0].cleanedAt,3);
 }finally{sim.dispose();peer.dispose();}
});
