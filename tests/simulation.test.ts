import { enterPlaying } from './helpers/guide.js';
/** Authoritative shared gameplay tests: platform state, ownership races, washing and scoring. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from './fixtures/Simulation.js';
import { applyPlayer, applyWorld, capturePlayer } from '../shared/snapshot.js';
import { PlayerMotion } from '../shared/sim/PlayerMotion.js';
import * as THREE from 'three';

function ground(sim:Simulation,slot:number,truck:any,x:number,z:number) {
  const p=sim.players[slot];p.state='ground';p.ground={truck,plat:truck.platforms[0]};p.pos.set(x,truck.topY,z);p.vel.set(0,0,0);p.root.position.copy(p.pos);return p;
}
function input(sim:Simulation,slot:number,seq:number,down:string[]=[],hits:string[]=[]) {sim.input(slot,{seq,move:[0,0],axis:[0,0],down,hits});}
test('fixed speed, platform-local snapshots and stale packet rejection',() => {
  const sim=new Simulation();try {
    sim.occupy(0,true);for(let i=0;i<90;i++)sim.tick();
    assert.equal(sim.players[0].state,'ground');
    const snapshot=sim.snapshot(),state=snapshot.players[0];
    assert.equal(state.parent,0);assert.ok(state.local);
    const copy=new PlayerMotion(new THREE.Scene());applyPlayer(copy,state,sim.trucks);assert.ok(copy.pos.distanceTo(sim.players[0].pos)<1e-8);
    sim.input(0,{seq:50,move:[0.8,0],axis:[1,0],down:[],hits:[]});sim.tick();assert.equal(sim.acks[0],50);
    sim.input(0,{seq:49,move:[-1,0],axis:[-1,0],down:[],hits:[]});assert.equal(sim.queues[0].length,0);
  }finally{sim.dispose();}
});

test('jitter bursts use the latest direction in one tick, without accelerated movement or stale replay',() => {
  const sim=new Simulation(),reference=new Simulation();try {
    for(const world of [sim,reference]){world.occupy(0,true);for(let i=0;i<90;i++)world.tick();}
    const packet=(seq:number,move:number)=>({seq,move:[move,0],axis:[move,0],down:[],hits:[]});
    for(let seq=1;seq<=20;seq++)sim.input(0,packet(seq,seq===20?-1:1));
    reference.input(0,packet(20,-1));sim.tick();reference.tick();
    assert.equal(sim.acks[0],20);
    assert.equal(sim.queues[0].length,0);
    assert.ok(sim.players[0].pos.distanceTo(reference.players[0].pos)<1e-8);
    for(let seq=21;seq<81;seq++){
      sim.input(0,packet(seq,0));sim.tick();
      assert.equal(sim.acks[0],seq,'burst does not leave a permanent input backlog');
    }
  }finally{sim.dispose();reference.dispose();}
});

test('coalescing retains pickup, charge, jump and release edges for each player',() => {
  const {sim,p,towel}=carryingDemo();try {
    sim.occupy(1,true);
    input(sim,0,1,['KeyK'],['KeyK']);
    for(let seq=2;seq<=9;seq++)input(sim,0,seq,['KeyK']);
    input(sim,0,10,['KeyK','Space'],['Space']);
    input(sim,0,11,[]);
    for(let seq=12;seq<=20;seq++)input(sim,0,seq,[]);
    input(sim,1,1,['KeyJ'],['KeyJ']);input(sim,1,2,[]);
    assert.deepEqual(sim.queues[0].map(p=>p.seq),[1,9,10,20]);
    for(let i=0;i<4;i++)sim.tick();
    assert.equal(sim.acks[0],20);assert.equal(sim.acks[1],2);
    // Jumping no longer cancels the gesture: the coalesced release edge still lands and throws mid-jump.
    assert.ok(p.heldTool===null,'jump keeps the K gesture even inside a burst');
    assert.equal(towel.flight,true,'released K throws');
    assert.equal(sim.queues[0].length,0);
    towel.pickup(p);p.skipUse=false;
    input(sim,0,21,['KeyK'],['KeyK']);input(sim,0,22,[]);
    sim.tick();sim.tick();assert.equal(p.heldTool,null,'a fresh press and release still places the item');
  }finally{sim.dispose();}
});
test('simultaneous pickup has one holder; wiping spends durability and settlement happens once',() => {
  const sim=new Simulation();try {
    sim.occupy(0,true);sim.occupy(1,true);sim.command('start'); enterPlaying(sim);
    assert.equal(sim.phase,'game');const home=sim.trucks[0],towel=sim.game.towels[0];
    sim.scene.updateMatrixWorld(true);const location=towel.worldPosition();
    ground(sim,0,home,location.x,location.z);ground(sim,1,home,location.x,location.z);
    input(sim,0,1,['KeyJ'],['KeyJ']);input(sim,1,1,['KeyJ'],['KeyJ']);sim.tick();
    assert.equal(towel.holder,sim.players[0]);assert.equal(sim.players[1].heldTowel,null);
    input(sim,0,2);sim.tick();
    for(let i=0;i<450;i++)sim.tick();assert.ok(sim.game.order);
    sim.scene.updateMatrixWorld(true);
    const waterStain=sim.game.order.stains[1], waterTarget=waterStain.mesh.getWorldPosition(new THREE.Vector3());
    ground(sim,1,sim.game.orderTruck,waterTarget.x-3.8,waterTarget.z);
    sim.players[1].yaw=0;sim.game.waterguns[0].pickup(sim.players[1]);sim.game.waterguns[0].pressure=1;
    for(let i=0;i<80;i++){input(sim,1,i+2,['KeyJ']);sim.tick();}
    assert.equal(waterStain.stage,1,'water is required before the towel');
    input(sim,1,82);sim.game.drop(sim.players[1]);
    let seq=3;
    function wipe(stain:any) {
      sim.scene.updateMatrixWorld(true);const target=stain.mesh.getWorldPosition(new THREE.Vector3());ground(sim,0,sim.game.orderTruck,target.x,target.z);
      for(let i=0;i<75;i++){input(sim,0,seq++,['KeyJ']);sim.tick();}
      assert.equal(stain.done,true);
    }
    wipe(sim.game.order.stains[0]);wipe(sim.game.order.stains[1]);assert.equal(towel.dirty,true);assert.equal(sim.game.score,0);
    sim.scene.updateMatrixWorld(true);const station=sim.game.station.getWorldPosition(new THREE.Vector3());ground(sim,0,home,station.x,station.z);
    for(let i=0;i<90;i++){input(sim,0,seq++,['KeyJ']);sim.tick();}assert.equal(towel.dirty,false);
    const tough=sim.game.order.stains[2];
    sim.scene.updateMatrixWorld(true);const toughTarget=tough.mesh.getWorldPosition(new THREE.Vector3());
    ground(sim,1,sim.game.orderTruck,toughTarget.x,toughTarget.z);
    const soap=sim.game.takeSoap(sim.players[1]);soap.pickup(sim.players[1]);sim.players[1].skipUse=false;
    for(let i=0;i<65;i++)sim.game.interact(sim.players[1],{down:(key:string)=>key==='KeyJ',hit:()=>false},1/60);
    assert.equal(tough.stage,1);assert.equal(soap.active,false);
    ground(sim,1,sim.game.orderTruck,toughTarget.x-3.8,toughTarget.z);sim.players[1].yaw=0;sim.game.waterguns[0].pickup(sim.players[1]);sim.game.waterguns[0].pressure=1;
    sim.scene.updateMatrixWorld(true);
    for(let i=0;i<80;i++)sim.game.interact(sim.players[1],{down:(key:string)=>key==='KeyJ',hit:()=>false},1/60);
    assert.equal(tough.stage,2);sim.game.drop(sim.players[1]);
    wipe(sim.game.order.stains[2]);assert.equal(sim.game.completed,1);assert.equal(sim.game.score,25);
    sim.game.completeOrder();assert.equal(sim.game.score,25,'duplicate completion cannot pay twice');
    const snap=sim.snapshot();assert.equal(snap.game.towels[0].holder,0);assert.equal(snap.game.order?.stains.filter((s:any)=>s.done).length,3);
  }finally{sim.dispose();}
});

test('host pause freezes authoritative time, trucks and remaining time; home resumes motion',() => {
  const sim=new Simulation();try {
    sim.occupy(0,true);sim.command('start'); enterPlaying(sim);
    sim.command('pause',true);const before=sim.snapshot();for(let i=0;i<60;i++)sim.tick();const after=sim.snapshot();
    assert.equal(after.time,before.time);assert.equal(after.game.remaining,before.game.remaining);assert.deepEqual(after.trucks,before.trucks);
    sim.command('home');const homeTime=sim.time;sim.tick();assert.ok(sim.time>homeTime);assert.equal(sim.game.paused,false);
  }finally{sim.dispose();}
});

function carryingDemo() {
  const sim=new Simulation();sim.occupy(0,true);sim.phase='game';sim.game.start(sim.director.base);
  const home=sim.trucks[0];
  const p=ground(sim,0,home,home.pos.x-2,home.pos.z),towel=sim.game.towels[0];
  towel.pickup(p);towel.consume(0.4);return {sim,p,towel};
}

test('K tap places without throwing; J keeps held items; roof edge and airborne release are safe',() => {
  const {sim,p,towel}=carryingDemo();try {
    input(sim,0,1,['KeyJ'],['KeyJ']);sim.tick();assert.ok(p.heldTowel===towel,'J has no drop action');
    input(sim,0,2,['KeyK'],['KeyK']);sim.tick();input(sim,0,3);sim.tick();
    assert.equal(p.heldTowel,null);assert.equal(towel.flight,false);assert.equal(towel.truck,sim.trucks[0]);
    assert.ok(Math.abs(towel.mesh.position.x-(-2+0.65))<1e-8);assert.equal(towel.durability,1.6);
    const home=sim.trucks[0];
    towel.pickup(p);ground(sim,0,home,home.pos.x+5.45,home.pos.z);p.yaw=0;
    input(sim,0,4,[],['KeyK']);sim.tick(); // A tap fully between samples is preserved in hits.
    assert.equal(towel.flight,false);assert.ok(Math.abs(towel.mesh.position.x-5.45)<1e-8,'edge falls back to feet');
    towel.pickup(p);p.state='air';p.ground=null;p.pos.y+=2;p.airBase.set(0,0);
    input(sim,0,5,[],['KeyK']);sim.tick();
    assert.equal(p.heldTowel,null);assert.equal(towel.flight,true);
    assert.ok(towel.velocity.y<=0,'release has no upwards impulse');assert.ok(Math.abs(towel.velocity.x)<0.1,'no forward throw impulse');
    assert.equal(towel.durability,1.6);
  }finally{sim.dispose();}
});

test('long K hold throws on release, caps charge and synchronizes its flight to another consumer',() => {
  const {sim,p,towel}=carryingDemo(),peer=new Simulation();try {
    for(let i=0;i<65;i++){input(sim,0,i+1,['KeyK'],i===0?['KeyK']:[]);sim.tick();}
    assert.ok(p.heldTowel===towel);assert.equal(towel.charge,1);
    assert.match(p.interactionHint,/投掷 100%/);
    input(sim,0,66);sim.tick();
    assert.equal(p.heldTowel,null);assert.equal(towel.flight,true);assert.ok(towel.velocity.x>8);
    const snap=sim.snapshot();applyWorld({game:peer.game,trucks:peer.trucks,players:peer.players},snap);
    assert.equal(peer.game.towels[0].flight,true);assert.equal(peer.game.towels[0].holder,null);
    assert.deepEqual(peer.game.towels[0].velocity.toArray(),towel.velocity.toArray());
    assert.equal(peer.game.towels[0].durability,1.6);
  }finally{sim.dispose();peer.dispose();}
});

test('a teammate can pick up a placed towel in the same authority tick; ownership stays unique in snapshots',() => {
  const {sim,p,towel}=carryingDemo(),peer=new Simulation();try {
    sim.occupy(1,true);ground(sim,1,sim.trucks[0],sim.trucks[0].pos.x-2,sim.trucks[0].pos.z);
    input(sim,0,1,['KeyK'],['KeyK']);sim.tick();
    input(sim,0,2);input(sim,1,1,['KeyJ'],['KeyJ']);sim.tick();
    assert.equal(p.heldTowel,null);assert.ok(towel.holder===sim.players[1]);assert.ok(sim.players[1].heldTowel===towel);
    assert.equal(towel.charge,0);assert.equal(towel.flight,false);
    const snap=sim.snapshot();applyWorld({game:peer.game,trucks:peer.trucks,players:peer.players},snap);
    assert.equal(snap.game.towels[0].holder,1);assert.equal(peer.players[0].heldTowel,null);
    assert.equal(peer.players[1].heldTowel,peer.game.towels[0]);assert.equal(peer.game.towels[0].mesh.parent,peer.players[1].yawG);
  }finally{sim.dispose();peer.dispose();}
});
