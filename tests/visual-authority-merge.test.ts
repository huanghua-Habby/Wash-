import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Simulation } from './fixtures/Simulation.js';
import { NetworkGame } from '../client/js/online/NetworkGame.js';
import { bodyHeight } from '../shared/sim/TruckState.js';
import { applyWorld, applyPlayer } from '../shared/snapshot.js';
import { quantize } from '../shared/delta.js';
import { room } from './helpers/peerRoom.js';
import { TICK_SECONDS, VERSION } from '../shared/protocol.js';

test('all hover orders and lanes traverse host-to-guest deltas and restore the same footprints and roofs',()=>{
 const r=room(['guest']), peer=new Simulation();
 try {
  const host=r.host.sim;host.phase='game';host.game.start(host.director.base);
  assert.equal(VERSION, 42);assert.equal(host.trucks.length,7);
  for(let serial=0;serial<5;serial++) {
   host.game.clearStains();host.game.lane=null;host.game.orderSerial=serial;
   const before=host.urgentSignature();host.game.openLane();
   assert.notEqual(host.urgentSignature(),before,'lane appearance is sent urgently');
   host.game.spawnOrder(serial);
   for(let i=0;i<8;i++)r.advance();
   const data=r.guests[0].received.at(-1);
   assert.deepEqual(data,r.view(r.guests[0],data.tick),'guest delta reconstructs the exact authority snapshot (its wire view)');
   assert.equal(data.game.order.type,host.game.order.type);assert.equal(data.game.order.serial,serial);
   applyWorld({game:peer.game,trucks:peer.trucks,players:peer.players},data);
   data.players.forEach((p:any,i:number)=>applyPlayer(peer.players[i],p,peer.trucks));
   const index=host.trucks.indexOf(host.game.orderTruck);
   assert.equal(peer.game.orderTruck,peer.trucks[index]);assert.deepEqual(peer.game.lane,data.game.lane);
   assert.deepEqual(peer.trucks[index].pos.toArray(),data.trucks[index].pos);
   assert.ok(Math.abs(peer.trucks[index].body.position.y-bodyHeight(data.time,host.game.orderTruck.phase))<1e-9);
   assert.equal(peer.game.order.stains[0].mesh.position.y,host.game.orderTruck.topLocal+.045);
   assert.ok(!('body' in data.trucks[index]),'pure visual body bob stays off the wire');
   assert.ok(!('bodyRotation' in data.trucks[index]));
  }
 } finally {r.dispose();peer.dispose();}
});

test('predictive platform and visual glue include vertical hover motion without touching the rendered fleet',()=>{
 const authority=new Simulation(),client=new Simulation();
 const connection:any=new EventTarget();connection.room={slot:0};
 const network=new NetworkGame({connection,players:client.players,trucks:client.trucks,game:client.game,camera:new THREE.PerspectiveCamera(),input:{clear(){},hit(){return false;}},onPhase(){}});
 try {
  authority.occupy(0,true);network.receive(authority.snapshot());
  const truck=client.trucks[1],state=network.latest.trucks[1];
  state.vel[1]=.6;const future=new THREE.Vector3(),velocity=new THREE.Vector3();
  const bob=network.platformAt(truck,3,future,velocity);
  assert.ok(Math.abs(future.y-state.pos[1]-.6*3*TICK_SECONDS)<1e-9);assert.equal(velocity.y,.6);
  const player=client.players[0];player.ground={truck,plat:truck.platforms[0]};player.state='ground';
  network.seq=3;network.ackBase=0;truck.pos.y=state.pos[1]+.2;truck.body.position.y=bob+.01;
  const offset=network.platformOffset(player,new THREE.Vector3());
  assert.ok(Math.abs(offset.y-(.2-.6*3*TICK_SECONDS+.01))<1e-9);
  const before=client.trucks.map(t=>t.pos.toArray());
  network.predictTick(player,{seq:3,axis:[0,0],move:[0,0],down:[],hits:[]},authority.time);
  assert.deepEqual(client.trucks.map(t=>t.pos.toArray()),before,'prediction restores interpolated vehicle transforms');
 } finally {authority.dispose();client.dispose();}
});

test('guest J cleans towel stains on every new vehicle roof; progress, durability and ownership remain host-owned',()=>{
 const r=room(['guest']);
 try {
  const sim=r.host.sim;sim.phase='game';sim.game.start(sim.director.base);
  let seq=0;
  for(let serial=0;serial<5;serial++) {
   const game=sim.game;game.clearStains();game.lane=null;game.spawnOrder(serial);
   for(let i=0;i<260;i++)r.advance();
   const truck=game.orderTruck,p=sim.players[1],towel=game.towels[0],stain=game.order.stains[0];
   towel.reset();assert.equal(towel.pickup(p),true);
   p.state='ground';p.ground={truck,plat:truck.platforms[0]};p.takeoff=truck;
   p.pos.set(truck.pos.x+stain.mesh.position.x,truck.topY,truck.pos.z+stain.mesh.position.z);p.vel.set(0,0,0);
   for(let i=0;i<240&&!stain.done;i++) {
    r.guests[0].guest.sendInput({seq:++seq,axis:[0,0],move:[0,0],down:['KeyJ'],hits:[]});r.advance();
   }
   assert.equal(stain.done,true,`${truck.type} stain cleaned on its own roof height`);
   const data=r.guests[0].received.at(-1);
   assert.equal(data.game.order.stains[0].done,true);assert.equal(data.game.towels[0].holder,1);
   assert.ok(data.game.towels[0].durability<2);assert.equal(data.game.score,0,'one stain cannot complete the order');
   assert.equal(game.completed,0);
  }
 } finally {r.dispose();}
});
