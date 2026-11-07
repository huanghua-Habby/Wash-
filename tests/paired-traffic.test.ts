import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Simulation } from './fixtures/Simulation.js';
import { getLevel } from './fixtures/levels.js';
import { HIGHWAY_02 } from './fixtures/legacy-highway02.js';
import { applyWorld } from '../shared/snapshot.js';
import { packetInput } from '../shared/protocol.js';
import { room } from './helpers/peerRoom.js';

const level = getLevel('highway-02')!;
const press = packetInput({seq:1,move:[0,0],axis:[0,0],down:['KeyJ'],hits:[]});
function start(sim: Simulation) { sim.occupy(0,true);sim.occupy(1,true);sim.phase='game';sim.game.start(sim.director.base); }
function dock(sim: Simulation) {
  for (let i = 0; !sim.game.orders.length; i++) { assert.ok(i < 3600, 'an order arrives'); sim.tick(); }
  assert.equal(sim.game.orders.length,2);
  for (const lane of sim.game.lanes) lane.x=sim.game.orderX();
  sim.tick();sim.scene.updateMatrixWorld(true);
}

test('all four waves open and dock both sides in the same tick; occupied sides delay the entire pair',()=>{
 const sim=new Simulation(level);try{
  start(sim);const g=sim.game;
  for(let wave=0;wave<HIGHWAY_02.orders.waves.length;wave++){
   g.elapsed=HIGHWAY_02.orders.waves[wave].at;sim.tick();
   assert.equal(g.lanes.length,2);assert.equal(g.orders.length,0);assert.equal(g.waveIndex,wave+1);
   assert.equal(g.lanes[0].x,g.lanes[1].x);
   for(let i=0;!g.orders.length;i++){assert.ok(i<3600,'an order arrives');sim.tick();}assert.equal(g.orders.length,2);
   assert.deepEqual(g.orders.map((o:any)=>g.orderSide(o.serial)),[-1,1]);
   assert.notEqual(g.orders[0].truck,g.orders[1].truck);
   assert.deepEqual(g.orders.map((o:any)=>o.remaining),[60,60]);
   g.lanes.forEach((lane:any)=>{lane.x=g.orderX();});sim.tick();
   assert.deepEqual(g.orders.map((o:any)=>o.arrivalProgress),[1,1]);
   assert.equal(g.orders[0].remaining,g.orders[1].remaining);
   const second=g.orders[1];g.reclaimOrder(g.orders[0]);
   if(wave<3)g.elapsed=HIGHWAY_02.orders.waves[wave+1].at;
   sim.tick();assert.equal(g.orders.length,1);assert.equal(g.waveIndex,wave+1,'cannot drip-feed next pair to the empty side');
   assert.equal(g.orders[0],second);g.reclaimOrder(second);
  }
  g.elapsed=179;for(let i=0;i<20;i++)sim.tick();assert.equal(g.waveIndex,4);assert.equal(g.orders.length,0,'finite script does not restart');
 }finally{sim.dispose();}
});

test('two concurrent orders restore independently; timeout on one side preserves the other and pause freezes both',()=>{
 const sim=new Simulation(level),peer=new Simulation(level);try{
  start(sim);dock(sim);const g=sim.game,[left,right]=g.orders;
  sim.command('pause',true);const times=g.orders.map((o:any)=>o.remaining);
  for(let i=0;i<60;i++)sim.tick();assert.deepEqual(g.orders.map((o:any)=>o.remaining),times);
  sim.command('pause',false);left.remaining=.001;g.combo=2;const sig=sim.urgentSignature();sim.tick();
  assert.equal(left.mode,'leaving');assert.equal(right.mode,'working');assert.ok(right.remaining>59);
  assert.equal(g.missed,1);assert.equal(g.combo,0);assert.notEqual(sim.urgentSignature(),sig);
  const data=sim.snapshot();applyWorld({game:peer.game,trucks:peer.trucks,players:peer.players},data);
  assert.equal(peer.game.orders.length,2);assert.equal(peer.game.orders[0].mode,'leaving');assert.equal(peer.game.orders[1].remaining,right.remaining);
  g.reclaimOrder(left);applyWorld({game:peer.game,trucks:peer.trucks,players:peer.players},sim.snapshot());
  assert.equal(peer.game.orders.length,1);assert.equal(peer.game.order.serial,right.serial);assert.equal(peer.game.orderTruck.type,right.type);
  right.stains.forEach((stain:any)=>{stain.done=true;stain.stage=stain.steps.length;});g.completeOrder(right);g.completeOrder(right);
  assert.equal(g.completed,1);assert.equal(g.score,25);assert.equal(g.missed,1);
 }finally{sim.dispose();peer.dispose();}
});

test('players clean their own roofs concurrently and cannot consume another side’s stain or award twice',()=>{
 const sim=new Simulation(level);try{
  start(sim);dock(sim);const g=sim.game;
  g.orders.forEach((order:any,i:number)=>{
   const p=sim.players[i],target=order.stains[0].mesh.getWorldPosition(new THREE.Vector3());
   p.pos.copy(target);p.state='ground';p.ground={truck:order.truck,plat:order.truck.platforms[0]};p.root.position.copy(p.pos);
   g.towels[i].pickup(p);p.skipUse=false;
  });
  for(let i=0;i<75;i++){g.interact(sim.players[0],press,1/60);g.interact(sim.players[1],press,1/60);}
  assert.equal(g.orders[0].stains[0].done,true);assert.equal(g.orders[1].stains[0].done,true);
  assert.equal(g.orders[0].stains[1].stage,0);assert.equal(g.orders[1].stains[1].stage,0);assert.equal(g.completed,0);
  const towel=g.towels[2];assert.equal(towel.pickup(sim.players[0]),false,'holding another towel cannot claim a second tool');
 }finally{sim.dispose();}
});

test('both orders, both merge lanes and secondary-side cleaning cross host-to-guest deltas urgently',()=>{
 const r=room(['guest']);try{
  r.host.command('start',{levelId:'highway-02'});
  for(let i=0;i<850&&!r.host.sim.game.orders.length;i++)r.advance();
  const g=r.host.sim.game;assert.equal(g.orders.length,2);
  for(let i=0;i<4;i++)r.advance();let data=r.guests[0].received.at(-1);
  assert.equal(data.game.orders.length,2);assert.equal(data.game.lanes.length,2);
  assert.deepEqual(data.game.orders.map((o:any)=>o.serial),[0,1]);
  for(let i=0;i<250;i++)r.advance();
  const sim=r.host.sim,right=g.orders[1],player=sim.players[1],stain=right.stains[0];
  const target=stain.mesh.getWorldPosition(new THREE.Vector3());
  player.pos.set(target.x,right.truck.topY,target.z);player.state='ground';player.ground={truck:right.truck,plat:right.truck.platforms[0]};player.takeoff=right.truck;player.vel.set(0,0,0);
  g.towels[0].pickup(player);player.skipUse=false;
  for(let i=0;i<100&&!stain.done;i++){r.guests[0].guest.sendInput({seq:i+1,axis:[0,0],move:[0,0],down:['KeyJ'],hits:[]});r.advance();}
  assert.equal(stain.done,true);data=r.guests[0].received.at(-1);
  assert.equal(data.game.orders[1].stains[0].done,true);assert.equal(data.game.orders[0].stains[0].done,false);
  right.remaining=.001;g.lanes.forEach((lane:any)=>{lane.x=g.orderX();});r.advance();
  data=r.guests[0].received.at(-1);assert.equal(data.game.orders[1].mode,'leaving');assert.equal(data.game.orders[0].mode,'working');
  assert.equal(data.game.missed,1);
 }finally{r.dispose();}
});


test('a legacy single-order snapshot still restores and removes only the unrepresented secondary view',()=>{
 const source=new Simulation(),peer=new Simulation(level);try{
  start(source);source.game.spawnOrder();start(peer);dock(peer);
  const snapshot:any=source.snapshot();delete snapshot.game.orders;delete snapshot.game.lanes;delete snapshot.game.waveIndex;
  applyWorld({game:peer.game,trucks:peer.trucks,players:peer.players},snapshot);
  assert.equal(peer.game.orders.length,1);assert.equal(peer.game.order.serial,source.game.order.serial);
  assert.equal(peer.game.order.remaining,Infinity);assert.deepEqual(peer.game.lane,source.game.lane);
 }finally{source.dispose();peer.dispose();}
});
