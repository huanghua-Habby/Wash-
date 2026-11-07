/** Water/hose authority, first-hit occlusion, ownership and snapshot consumers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Simulation } from './fixtures/Simulation.js';
import { packetInput, VERSION } from '../shared/protocol.js';
import { applyWorld, applyPlayer } from '../shared/snapshot.js';
import { WaterAimIndicator } from '../client/js/ui/WaterAimIndicator.js';
import { WASH_CONFIG as C } from '../shared/sim/washConfig.js';
const dt=1/60;
const keys=(down:string[]=[],hits:string[]=[],move=[0,0])=>packetInput({seq:1,down,hits,move,axis:[0,0]});
function place(sim:Simulation,slot:number,truck:any,x:number,z:number,y=truck.topY) {
  const p=sim.players[slot];p.state='ground';p.ground={truck,plat:truck.platforms[0]};p.pos.set(x,y,z);p.vel.set(0,0,0);
  p.yaw=0;p.yawG.rotation.y=0;p.root.position.copy(p.pos);p.externalVelocity.set(0,0,0);return p;
}
function demo() {
  const sim=new Simulation();for(let i=0;i<3;i++)sim.occupy(i,true);
  sim.phase='game';sim.game.start(sim.director.base);sim.game.spawnOrder();
  sim.game.orderTruck.setState(sim.game.homeX,sim.game.homeZ-3.9,0,0,sim.game.base);
  sim.game.order.arrivalProgress=1;sim.scene.updateMatrixWorld(true);
  const gun=sim.game.waterguns[0],hose=sim.game.hoses[0],stain=sim.game.order.stains[1];
  const target=stain.mesh.getWorldPosition(new THREE.Vector3());
  const p=place(sim,0,sim.game.orderTruck,target.x-3.6,target.z);gun.pickup(p) // the smaller character holds the nozzle lower: a slightly shorter jet;p.skipUse=false;
  gun.pressure=1; // a fully built jet; pressure itself has its own test
  for(let i=1;i<3;i++)place(sim,i,sim.trucks[0],sim.trucks[0].pos.x+i,sim.trucks[0].pos.z+0.8);
  sim.scene.updateMatrixWorld(true);return {sim,gun,hose,p,stain,target};
}
test('aimed ballistic water advances only its required stage and never consumes durability',()=>{
  const {sim,gun,p,stain}=demo();try {
    p.yaw=Math.PI/2;p.yawG.rotation.y=p.yaw;
    for(let i=0;i<90;i++)sim.game.interact(p,keys(['KeyJ']),dt);
    assert.equal(stain.progress,0,'off-axis water cannot auto-aim');
    p.yaw=0;p.yawG.rotation.y=0;
    for(let i=0;i<90;i++)sim.game.interact(p,keys(['KeyJ']),dt);
    assert.equal(stain.stage,1);assert.equal(stain.done,false,'still requires a towel');
    assert.equal(gun.durability,undefined);assert.equal(gun.holder,p);
    assert.ok(gun.sprayNodes.length>2);assert.ok(gun.sprayNodes.at(-1).y<gun.sprayNodes[0].y);
    const other=sim.game.order.stains[0];other.mesh.position.set(stain.mesh.position.x+0.6,stain.mesh.position.y,stain.mesh.position.z);other.steps=['water','towel'];
    for(let i=0;i<90;i++)sim.game.interact(p,keys(['KeyJ']),dt);
    assert.equal(other.progress,0,'first stain blocks even when it now requires a towel');
  }finally{sim.dispose();}
});
test('the weak opening gun jet lands nearby; a zero-pressure trace remains finite and dry',()=>{
 const {sim,gun,p,stain,target}=demo();try {
  place(sim,0,sim.game.orderTruck,target.x-1,target.z);gun.pressure=0;
  const preview:any={sprayNodes:[],sprayTarget:new THREE.Vector3(),hitPlayer:null,hitStain:null};
  assert.equal(gun.trace(sim.game.activeTrucks(),sim.players,[stain],preview,0),false);
  assert.equal(preview.sprayNodes.length,1);assert.deepEqual(preview.sprayTarget.toArray(),gun.nozzle().toArray());
  sim.game.interact(p,keys(['KeyJ']),dt);
  assert.ok(gun.hitStain===stain);assert.ok(stain.progress>0);
 }finally{sim.dispose();}
});
test('first player blocks the spray, gets half-speed push; the next player and dirt are unaffected',()=>{
  const {sim,gun,p,stain,target}=demo();try {
    const first=place(sim,1,sim.game.orderTruck,target.x-1.4,target.z);
    const behind=place(sim,2,sim.game.orderTruck,target.x-0.65,target.z);
    sim.game.interact(p,keys(['KeyJ']),dt);
    assert.ok(gun.hitPlayer===first);assert.equal(stain.progress,0);assert.equal(behind.externalVelocity.length(),0);
    assert.ok(Math.abs(first.externalVelocity.x-C.sprayPushSpeed*0.8)<1e-9);assert.equal(C.sprayPushSpeed,5.5/2); // shoves at the character scale
    const old=first.pos.x;first.update(dt,0,keys([],[],[-1,0]),sim.game.activeTrucks(),sim.camera,30);
    // Walk (5.5 x 0.64) against the jet's shove (2.75 x 0.8): both scaled with the characters, the walk also by the walk scale.
    assert.ok(Math.abs(first.pos.x-old+(5.5*0.64-2.75*0.8)*dt)<1e-8,'walking against the jet still makes headway');
    const peer=new Simulation();try {
      const state=sim.snapshot();assert.equal(VERSION, 42);applyWorld({game:peer.game,trucks:peer.trucks,players:peer.players},state);
      state.players.forEach((data:any,i:number)=>applyPlayer(peer.players[i],data,peer.trucks));
      assert.ok(peer.players[0].heldTool===peer.game.waterguns[0]);assert.deepEqual(peer.game.waterguns[0].sprayNodes.map((v:any)=>v.toArray()),gun.sprayNodes.map((v:any)=>v.toArray()));
      assert.deepEqual(peer.players[1].externalVelocity.toArray(),first.externalVelocity.toArray());
    }finally{peer.dispose();}
  }finally{sim.dispose();}
});
test('hose leashes the holder; only taut capsules push teammates, and jumping clears the hose',()=>{
  const {sim,gun,hose,p}=demo();try {
    const anchor=hose.anchor(),home=sim.trucks[0];
    place(sim,0,home,anchor.x+3-0.3,anchor.z);
    const teammate=place(sim,1,home,anchor.x+1.5,anchor.z+0.1),start=teammate.pos.clone();
    hose.reset();for(let i=0;i<60;i++)hose.update(dt,[home],sim.players,sim.players.map((q:any)=>q.pos.clone()));
    assert.equal(hose.taut,false);assert.ok(teammate.pos.equals(start),'slack rope never blocks');
    place(sim,0,home,anchor.x+C.hoseLength+0.8-0.3,anchor.z);
    hose.constrainGun(anchor);assert.ok(gun.connector().distanceTo(anchor)<=C.hoseLength+1e-6,'holder is physically leashed');
    place(sim,1,home,anchor.x+C.hoseLength/2,anchor.z+0.1);
    hose.reset();hose.update(dt,[home],sim.players,sim.players.map((q:any)=>q.pos.clone()));
    assert.equal(hose.nodes.length,7);assert.equal(hose.taut,true);assert.ok(teammate.externalVelocity.length()>0);
    teammate.pos.y=home.topY+2;teammate.externalVelocity.set(0,0,0);teammate.state='air';teammate.ground=null;
    hose.update(dt,[home],sim.players,sim.players.map((q:any)=>q.pos.clone()));assert.equal(teammate.externalVelocity.length(),0);
    sim.game.drop(p);const x=p.pos.x;p.pos.x+=1;hose.update(dt,[home],sim.players,sim.players.map((q:any)=>q.pos.clone()));
    assert.equal(p.heldTool,null);assert.equal(p.pos.x,x+1,'releasing gun removes the leash');
  }finally{sim.dispose();}
});
test('unattended gun never auto-resets; anchor recall is atomic and clears rope state in snapshots',()=>{
  const {sim,gun,hose,p}=demo(),peer=new Simulation();try {
    gun.release(p);gun.mesh.position.copy(hose.anchor()).add(new THREE.Vector3(4,-2,0));
    for(let i=0;i<120;i++){gun.update(dt,sim.game.activeTrucks());hose.update(dt,sim.game.activeTrucks(),sim.players,sim.players.map((q:any)=>q.pos.clone()));}
    const original=new THREE.Vector3(sim.trucks[0].pos.x+gun.originalPosition.x,sim.trucks[0].topY,sim.trucks[0].pos.z+gun.originalPosition.z);
    assert.equal(gun.truck,null);assert.ok(gun.worldPosition().distanceTo(original)>2,'no timeout recovery');
    const anchor=hose.anchor();place(sim,0,sim.trucks[0],anchor.x,anchor.z);place(sim,1,sim.trucks[0],anchor.x,anchor.z);
    sim.game.interact(p,keys(['KeyJ'],['KeyJ']),dt);
    // Only the pickup conflict: a ready empty-handed J would slap P point-blank and knock the gun loose.
    sim.players[1].slapCooldown=1;sim.game.interact(sim.players[1],keys(['KeyJ'],['KeyJ']),dt);
    assert.ok(gun.holder===p);assert.ok(sim.players[1].heldTool!==gun);assert.equal(hose.taut,false);
    assert.equal(hose.tension,0);assert.ok(hose.nodes.at(-1).distanceTo(gun.connector())<1e-8);
    const state=sim.snapshot();applyWorld({game:peer.game,trucks:peer.trucks,players:peer.players},state);
    assert.ok(peer.players[0].heldTool===peer.game.waterguns[0]);assert.equal(peer.game.hoses[0].taut,false);
    assert.deepEqual(peer.game.hoses[0].nodes.map((node:any)=>node.toArray()),hose.nodes.map((node:any)=>node.toArray()));
  }finally{sim.dispose();peer.dispose();}
});
test('authoritative use action reaches peers so teammates see the cat spray, and clears when released',()=>{
  const {sim,p}=demo();try {
    sim.game.interact(p,keys(['KeyJ']),dt);
    assert.equal(p.useAction,'spray');
    const peer=new Simulation();try {
      const state=sim.snapshot();
      state.players.forEach((data:any,i:number)=>applyPlayer(peer.players[i],data,peer.trucks));
      assert.equal(peer.players[0].useAction,'spray');assert.equal(peer.players[1].useAction,'');
      sim.game.interact(p,keys(),dt);assert.equal(p.useAction,'spray','releasing J leaves a short pressure tail');
      for(let i=0;i<Math.ceil(C.pressureFallSeconds*60);i++)sim.game.interact(p,keys(),dt);assert.equal(p.useAction,'');
      sim.snapshot().players.forEach((data:any,i:number)=>applyPlayer(peer.players[i],data,peer.trucks));
      assert.equal(peer.players[0].useAction,'');
    }finally{peer.dispose();}
  }finally{sim.dispose();}
});
test('holding J with a towel or soap shows scrubbing even without progress; K or a skipped press does not',()=>{
  const sim=new Simulation();try {
    sim.occupy(0,true);sim.scene.updateMatrixWorld(true);
    const p=place(sim,0,sim.trucks[0],sim.trucks[0].pos.x+3,sim.trucks[0].pos.z);
    const towel=sim.game.towels[0];towel.pickup(p);p.skipUse=false;
    const durability=towel.durability;
    sim.game.interact(p,keys(['KeyJ']),dt);assert.equal(p.useAction,'wipe');assert.equal(towel.durability,durability,'air wipes cost nothing');
    sim.game.interact(p,keys(['KeyJ','KeyK']),dt);assert.equal(p.useAction,'');
    p.throwCancelled=false;p.throwWasDown=false;sim.game.interact(p,keys(),dt);
    p.skipUse=true;sim.game.interact(p,keys(['KeyJ']),dt);assert.equal(p.useAction,'','pickup press is not a scrub');
  }finally{sim.dispose();}
});

test('dirt-only near misses clean within wider tolerance; distant spray and player capsules stay bounded',()=>{
 const {sim,gun,p,stain,target}=demo();try {
  p.pos.z=target.z+0.82; p.root.position.copy(p.pos); sim.scene.updateMatrixWorld(true);
  sim.game.interact(p,keys(['KeyJ']),dt);
  assert.ok(gun.hitStain===stain,'0.82m player offset is within the widened dirt splash, beyond the old tolerance');
  assert.ok(stain.progress>0); assert.equal(gun.hits(stain),true);
  p.pos.z=target.z+1.2; p.root.position.copy(p.pos); sim.scene.updateMatrixWorld(true);
  const before=stain.progress;sim.game.interact(p,keys(['KeyJ']),dt);
  assert.equal(stain.progress,before,'no auto-aim beyond dirt tolerance');
  assert.equal(C.sprayRadius,0.18);assert.equal(C.sprayPushSpeed,2.75);
 }finally{sim.dispose();}
});


test('aim previews use the authority first-hit query without changing snapshots, spray state or cleaning', () => {
 const {sim,gun,p,stain,target}=demo();
 try {
  const other=sim.players[1];
  for(const obstruction of ['stain','player','roof','road']) {
   p.yaw=0;p.yawG.rotation.y=0;
   const players=obstruction==='player'?[p,other]:[p];
   const stains=obstruction==='stain'?[stain]:[];
   if(obstruction==='player')place(sim,1,sim.game.orderTruck,target.x-2,target.z);
   sim.scene.updateMatrixWorld(true);
   const trucks=obstruction==='road'?[]:sim.game.activeTrucks();
   const before=sim.snapshot(),signature=sim.urgentSignature();
   const result:any={sprayNodes:[],sprayTarget:new THREE.Vector3(),hitPlayer:null,hitStain:null};
   const contact=gun.trace(trucks,players,stains,result);
   assert.equal(contact,obstruction!=='road','the capped airborne end is not a ground landing');
   assert.deepEqual(sim.snapshot(),before,`${obstruction} preview cannot write any synchronized state`);
   assert.equal(sim.urgentSignature(),signature);
   gun.trace(trucks,players,stains);
   assert.deepEqual(result.sprayNodes.map((v:THREE.Vector3)=>v.toArray()),gun.sprayNodes.map((v:THREE.Vector3)=>v.toArray()));
   assert.deepEqual(result.sprayTarget.toArray(),gun.sprayTarget.toArray());
   assert.equal(result.hitPlayer,gun.hitPlayer);assert.equal(result.hitStain,gun.hitStain);
   if(obstruction==='player')assert.equal(result.hitPlayer,other);
   if(obstruction==='stain')assert.equal(result.hitStain,stain);
  }
 }finally{sim.dispose();}
});

test('local water aim previews before spraying, hides for unavailable actions and releases its single DOM node', () => {
 const {sim,gun,p}=demo(),previous=globalThis.document;
 let removed=false;const nodes:any[]=[];
 (globalThis as any).document={createElement:()=>({hidden:false,style:{transform:'',props:{} as any,getPropertyValue(k:string){return this.props[k]||'';},setProperty(k:string,v:string){this.props[k]=v;}},dataset:{},setAttribute(){},remove(){removed=true;}}),
  getElementById:()=>({appendChild:(node:any)=>nodes.push(node)})};
 let anchor:THREE.Vector3|undefined,options:any;
 const positioner:any={hide(node:any){node.hidden=true;},place(node:any,point:THREE.Vector3,opts:any){node.hidden=false;anchor=point.clone();options=opts;}};
 const view=new WaterAimIndicator(sim.players,positioner);
 try {
  const before=sim.snapshot();
  for(let i=0;i<30;i++)view.update(sim.game,0,true);
  assert.equal(view.root.hidden,false,'holding the gun is sufficient; J is not required');
  assert.equal(gun.spraying,false);assert.equal(nodes.length,1);assert.ok(anchor);
  // Before J (pressure fallen to 0) it marks where a press opens, weak and close, not the full-pressure reach.
  {const full=anchor!.clone(); gun.pressure=0; view.update(sim.game,0,true,1/60);
   const near=anchor!.distanceTo(p.pos), far=full.distanceTo(p.pos);
   assert.ok(near<1.5 && near<far,`the idle mark sits close (${near.toFixed(2)} m vs ${far.toFixed(2)} m at full pressure)`);
   gun.pressure=1; view.update(sim.game,0,true,1/60);}
  assert.equal(options.immediate,true,'an aim cue cannot lag behind the predicted landing point');
  assert.deepEqual(sim.snapshot(),before);
  view.update(sim.game,1,true);assert.equal(view.root.hidden,true,'a remote holder never gives this local player an aim cue');
  const activeTrucks=sim.game.activeTrucks,orders=sim.game.orders;
  view.update(sim.game,0,true,1/60);assert.equal(view.root.hidden,false);
  sim.game.activeTrucks=()=>[];sim.game.orders=[];
  view.update(sim.game,0,true,1/60);assert.equal(view.root.hidden,false,'a one-frame contact loss at an edge keeps the ring instead of strobing');
  assert.deepEqual(anchor,view.target,'it stays on the last real contact, never the airborne jet tip');
  for(let i=0;i<30;i++)view.update(sim.game,0,true,1/60);
  assert.equal(view.root.hidden,true,'no phantom ground marker at an airborne range limit');
  sim.game.activeTrucks=activeTrucks;sim.game.orders=orders;
  for(const patch of [{state:'fallen'},{state:'swallowed'},{throwWasDown:true},{occupied:false},{sceneReady:false}]) {
   const saved=Object.fromEntries(Object.keys(patch).map(key=>[key,(p as any)[key]]));Object.assign(p,patch);
   view.update(sim.game,0,true);assert.equal(view.root.hidden,true);Object.assign(p,saved);
  }
  sim.game.paused=true;view.update(sim.game,0,true);assert.equal(view.root.hidden,true);sim.game.paused=false;
  view.update(sim.game,0,false);assert.equal(view.root.hidden,true,'UIManager can hide it during modals, Ready and transitions');
  // An elephant gets the same cue only while its trunk sprays, at the synced first hit (no gun in hand).
  sim.game.drop(p); p.animal='elephant'; p.trunk.spraying=false; view.update(sim.game,0,true,1/60);
  assert.equal(view.root.hidden,true,'an idle trunk shows nothing');
  p.trunk.spraying=true; p.trunk.sprayNodes=[new THREE.Vector3(),new THREE.Vector3(1,0,0)]; p.trunk.sprayTarget.set(3,4,5);
  view.update(sim.game,0,true,1/60); assert.equal(view.root.hidden,false,'a spraying trunk shows the cue');
  assert.deepEqual([anchor!.x,anchor!.y,anchor!.z],[3,4,5]); assert.equal(view.root.dataset.spraying,'true');
  p.trunk.spraying=false; view.update(sim.game,0,true,1/60); assert.equal(view.root.hidden,true);
 }finally{view.dispose();sim.dispose();(globalThis as any).document=previous;}
 assert.equal(removed,true);
});

test('hose pressure builds while J is held, tapers after release, shortens the jet and reaches peers',()=>{
  const {sim,gun,p}=demo();try {
    gun.pressure=0;
    sim.game.interact(p,keys(['KeyJ']),dt);
    assert.ok(Math.abs(gun.pressure-(C.pressureMin+dt*(1-C.pressureMin)/C.pressureRampSeconds))<1e-9,'a press opens as a weak jet');
    const weak=gun.sprayTarget.distanceTo(gun.sprayNodes[0]);
    assert.ok(weak<0.8,`a fresh jet begins beside the player (${weak.toFixed(2)}m)`);
    for(let i=0;i<Math.ceil(C.pressureRampSeconds*60);i++)sim.game.interact(p,keys(['KeyJ']),dt);
    assert.equal(gun.pressure,1);
    const strong=gun.sprayTarget.distanceTo(gun.sprayNodes[0]);
    assert.ok(strong>weak+1.5,`full pressure visibly reaches further (${weak.toFixed(2)} → ${strong.toFixed(2)})`);
    const full=gun.jetBallistics(1),base={speed:C.spraySpeed,range:C.sprayRange,lift:C.sprayLift};
    assert.deepEqual(full,base,'pressure 1 keeps the configured jet exactly');
    sim.game.interact(p,keys(),dt);assert.equal(gun.spraying,true);assert.ok(gun.pressure<1,'release starts the tail');
    const peer=new Simulation();try {
      applyWorld({game:peer.game,trucks:peer.trucks,players:peer.players},sim.snapshot());
      assert.equal(peer.game.waterguns[0].pressure,gun.pressure,'guests present the authority pressure');
    }finally{peer.dispose();}
    let ticks=1;while(gun.pressure>0&&ticks<60){sim.game.interact(p,keys(),dt);ticks++;}
    assert.ok(ticks<=Math.ceil(C.pressureFallSeconds*60)+1,'the tail is short');assert.equal(gun.pressure,0);
    gun.pressure=.8;sim.game.drop(p);sim.tick();assert.equal(gun.pressure,0,'a dropped gun loses pressure');
  }finally{sim.dispose();}
});
