import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Scene } from 'three';
import { Simulation } from './fixtures/Simulation.js';
import { ROAD_SIGN, ROAD_SIGN_PASS_SECONDS, roadSignFrame, roadSignTone } from '../shared/sim/RoadSigns.js';
import { getLevel, SAVE_VERSION } from './fixtures/levels.js';
import { TUTORIAL_ROAD_SIGNS } from '../shared/levels/roadSignPresets.js';
import { applyWorld, applyPlayer } from '../shared/snapshot.js';
import { SnapshotEncoder, SnapshotDecoder, quantize } from '../shared/delta.js';
import { RoadSignView } from '../client/js/world/RoadSignView.js';
import { RoadSignImpact } from '../client/js/fx/RoadSignImpact.js';
import { ROAD_SIGN_PALETTE, ROAD_SIGN_RIM_INTENSITY } from '../client/js/world/roadSignPalette.js';
import { Color } from 'three';
import { room } from './helpers/peerRoom.js';

const dt = 1/60;
test('invalid or overlapping level events fail before gameplay', () => {
  const sim = new Simulation(); try {
    const entry = TUTORIAL_ROAD_SIGNS[0];
    for (const entries of [[{...entry, side:0}], [{...entry, atMinutes:NaN}], [{...entry, atMinutes:0}],
      [entry,{...entry,atMinutes:1}], [entry,{...entry,id:'overlap',atMinutes:.31}], [{...entry,tone:'green'}]]) {
      sim.game.level={...sim.level,roadSigns:entries};
      assert.throws(()=>sim.game.roadSigns.reset(),/Road signs/);
    }
  } finally { sim.dispose(); }
});
function begin(sim: Simulation) {
  sim.game.level = { ...sim.level, roadSigns: TUTORIAL_ROAD_SIGNS };
  sim.phase = 'game'; sim.game.start(30);
  sim.trucks[0].pos.z = -sim.level.road.laneWidth/2; sim.game.homeZ = sim.trucks[0].pos.z;
  for (let i = 0; i < 4; i++) sim.occupy(i, true);
}
function place(sim: Simulation, slot: number, z: number, height = 0) {
  const p = sim.players[slot], truck = sim.trucks[0];
  p.pos.set(truck.pos.x, truck.topY+height, truck.pos.z+z); p.root.position.copy(p.pos);
  p.state = height ? 'air' : 'ground'; p.ground = height ? null : { truck, plat: truck.platforms[0] };
  p.takeoff = truck; p.vel.set(0, 0, 0); p.externalVelocity.set(0, 0, 0);
  p.deathCause = ''; p.roadSignAttachment = null;
  return p;
}
function strike(sim: Simulation, interval = dt) {
  sim.game.elapsed = 18+ROAD_SIGN.startX/ROAD_SIGN.speed-interval/2;
  sim.game.roadSigns.update(interval, sim.players.map(p=>p.pos.clone()));
}

test('first level enables six alternating minute events; warning lasts two seconds', () => {
  const sim = new Simulation(); try {
    const entries = TUTORIAL_ROAD_SIGNS;
    assert.deepEqual(getLevel('highway-01')!.roadSigns, entries);
    assert.deepEqual(entries.map(e=>e.atMinutes*60), [18,45,72,99,126,153]);
    assert.equal(new Set(entries.map(e=>e.id)).size, 6);
    assert.deepEqual(entries.map(e=>e.side), [-1,1,-1,1,-1,1]);
    const entry = entries[0], home = sim.trucks[0];
    assert.equal(roadSignFrame(entry, 15.999, home), null);
    assert.equal(roadSignFrame(entry, 16, home)!.phase, 'warning');
    assert.ok(Math.abs(roadSignFrame(entry, 16, home)!.remaining-2)<1e-9);
    assert.equal(roadSignFrame(entry, 17.999, home)!.phase, 'warning');
    assert.equal(roadSignFrame(entry, 18, home)!.phase, 'passing');
    assert.ok(Math.abs(roadSignFrame(entry, 18.4, home)!.x-home.pos.x)<1e-8);
    assert.equal(roadSignFrame(entry, 18.801, home), null);
    assert.ok(ROAD_SIGN.width >= sim.level.road.laneWidth*.9, 'almost one whole lane is covered');
    assert.ok(ROAD_SIGN.width > home.halfWidth*2, 'same-roof sidestepping cannot dodge the plate');
    assert.ok(ROAD_SIGN.bottom+ROAD_SIGN.height < 10*10/(2*28), 'normal jump clears plate');
  } finally { sim.dispose(); }
});

test('authority kills both exposed players once, while switching lane or jumping at the edge avoids death', () => {
  const sim = new Simulation(); try {
    begin(sim);
    const p = place(sim, 0, -.95), q = place(sim, 1, .95), safe = place(sim, 2, 4.5), jumper = place(sim, 3, 1.5, 1.7);
    strike(sim);
    assert.equal(sim.game.roadSigns.hits[0], 3);
    for (const player of [p,q]) { assert.equal(player.state, 'fallen'); assert.equal(player.ground, null); assert.equal(player.deathCause,'road-sign'); assert.equal(player.roadSignAttachment.id,'sign-01'); assert.equal(player.fallTimer,2); }
    assert.equal(safe.state, 'ground'); assert.equal(jumper.externalVelocity.length(), 0);
    const impulse = p.externalVelocity.toArray(); strike(sim); assert.deepEqual(p.externalVelocity.toArray(), impulse);
    sim.game.start(30); assert.deepEqual(sim.game.roadSigns.hits, [0,0,0,0,0,0]);
    place(sim,0,-.95); strike(sim); assert.equal(sim.game.roadSigns.hits[0] & 1, 1, 'new round can hit again');
  } finally { sim.dispose(); }
});

test('swept collision catches a whole traversal in one step, but cannot hit below/above the sign or unoccupied/pouched players', () => {
  const sim = new Simulation(); try {
    begin(sim); const p=place(sim,0,-.95), q=place(sim,1,-.95,-2), r=place(sim,2,-.95), s=place(sim,3,-.95);
    r.occupied=false; s.swallowedBy=p;
    sim.game.elapsed=17.9; sim.game.roadSigns.update(1,sim.players.map(p=>p.pos.clone()));
    assert.equal(sim.game.roadSigns.hits[0],1); assert.equal(q.externalVelocity.length(),0);
    assert.equal(r.externalVelocity.length(),0); assert.equal(s.externalVelocity.length(),0);
  } finally { sim.dispose(); }
});

test('hit is fatal even with tools, releases inventory, publishes urgently and preserves pause/Ready/practice gates', () => {
  const sim = new Simulation(); try {
    begin(sim); const p=place(sim,0,-.95), q=place(sim,1,-.95); sim.game.waterguns[0].pickup(q);
    sim.game.elapsed=18.4-dt/2;
    const signature=sim.urgentSignature(); sim.tick();
    assert.notEqual(sim.urgentSignature(),signature); assert.equal(sim.game.roadSigns.hits[0],3);
    assert.equal(p.state,'fallen'); assert.equal(q.state,'fallen'); assert.equal(q.heldTool,null);
    assert.ok(sim.game.waterguns[0].flight);
    sim.game.start(30); place(sim,0,-.95); sim.game.elapsed=16.5;
    sim.game.paused=true; const elapsed=sim.game.elapsed; for(let i=0;i<120;i++)sim.tick(); assert.equal(sim.game.elapsed,elapsed);
    assert.equal(roadSignFrame(TUTORIAL_ROAD_SIGNS[0],sim.game.elapsed,sim.trucks[0])!.phase,'warning');
    sim.game.paused=false; sim.game.roundStage='ready'; strike(sim); assert.equal(sim.game.roadSigns.hits[0],0);
    sim.game.enterPractice(30); strike(sim); assert.equal(sim.game.roadSigns.hits[0],0);
  } finally { sim.dispose(); }
});

test('hit masks, death and attachment roundtrip through deltas; view-only simulation cannot confirm death', () => {
  const sim=new Simulation(), peer=new Simulation(); try {
    begin(sim); begin(peer); place(sim,0,-.95); strike(sim);
    const state=quantize(sim.snapshot()), encoder=new SnapshotEncoder(), decoder=new SnapshotDecoder();
    const decoded=decoder.decode(encoder.encode(state,'room:1'));
    assert.deepEqual(decoded,state);
    applyWorld({game:peer.game,trucks:peer.trucks,players:peer.players},decoded);
    decoded.players.forEach((data:any,i:number)=>applyPlayer(peer.players[i],data,peer.trucks));
    assert.deepEqual(peer.game.roadSigns.capture(),sim.game.roadSigns.capture());
    assert.ok(peer.players[0].externalVelocity.distanceTo(sim.players[0].externalVelocity)<.0001);
    assert.deepEqual(peer.players[0].roadSignAttachment,quantize(sim.players[0].roadSignAttachment));
    assert.equal(peer.players[0].deathCause,'road-sign'); assert.equal(peer.players[0].state,'fallen');
    assert.equal(peer.game.elapsed, state.game.elapsed);
    peer.game.roadSigns.hits[0]=0; peer.game.viewOnly=true; place(peer,0,-.95); strike(peer); assert.equal(peer.game.roadSigns.hits[0],0);
    encoder.ack(state.tick); sim.tick(); assert.deepEqual(decoder.decode(encoder.encode(quantize(sim.snapshot()),'room:1')),quantize(sim.snapshot()));
    assert.equal(SAVE_VERSION,'0.5', 'hazard state is transient, no progress format/score contract changes');
    assert.deepEqual(getLevel('highway-02')!.roadSigns, []);
  } finally { sim.dispose(); peer.dispose(); }
});

test('direct host/guest link receives the same two-player hit immediately without accepting client hit claims', () => {
  const r=room(['guest']); try {
    const sim=r.host.sim; begin(sim); place(sim,0,-.95); place(sim,1,-.95);
    sim.game.elapsed=18.4-dt/2; r.advance();
    const snapshot=r.guests[0].received.at(-1);
    assert.deepEqual(snapshot.game.roadSigns.hits,[3,0,0,0,0,0]);
    assert.equal(snapshot.players[0].state,'fallen'); assert.equal(snapshot.players[1].state,'fallen');
    assert.equal(snapshot.players[1].roadSignAttachment.id,'sign-01');
    const before=sim.game.roadSigns.capture();
    r.guests[0].link.send('wash-state',{type:'hit',event:'sign-01',slot:0});
    assert.deepEqual(sim.game.roadSigns.capture(),before);
  } finally { r.dispose(); }
});

test('sign meshes are reused, have explicit warmup samples and release resources', () => {
  const sim=new Simulation(),scene=new Scene(),view=new RoadSignView(scene,[...TUTORIAL_ROAD_SIGNS]); try {
    begin(sim); const geometries=[...view.geometries], samples:any[]=[];
    view.registerReadiness({addSample:(sample:any)=>samples.push(sample)}); assert.equal(samples.length,1); assert.equal(samples[0].parent,null);
    sim.game.elapsed=16;view.update(sim.game);assert.equal(view.root.visible,false);
    sim.game.elapsed=18.4;view.update(sim.game);assert.equal(view.root.visible,true);
    assert.ok(Math.abs(view.root.position.x-sim.trucks[0].pos.x)<1e-8);
    sim.game.elapsed=45.4;view.update(sim.game);assert.equal(view.support.scale.z,1);
    assert.deepEqual([...view.geometries],geometries);
    sim.game.ended=true;view.update(sim.game);assert.equal(view.root.visible,true,'round end freezes the outgoing scene');
    sim.game.stop();view.update(sim.game);assert.equal(view.root.visible,false);
    let disposed=0; geometries.forEach(g=>g.addEventListener('dispose',()=>disposed++));view.dispose();assert.equal(disposed,geometries.length);assert.equal(view.root.parent,null);
  } finally { sim.dispose(); }
});

test('leaving the play area cleans up sign and corpse early; independent respawn and pause keep their existing timers', () => {
  const sim=new Simulation(),view=new RoadSignView(sim.scene,[...TUTORIAL_ROAD_SIGNS]); try {
    begin(sim);sim.setAnimal(1,'dog');const cat=place(sim,0,0),dog=place(sim,1,.7);
    place(sim,2,4.5);place(sim,3,4.5);
    sim.game.elapsed=18.4-dt/2;sim.tick();
    assert.equal(cat.fallTimer,2);assert.equal(dog.fallTimer,5);
    const position=cat.pos.clone(), timer=cat.fallTimer;
    sim.game.paused=true;for(let i=0;i<30;i++)sim.tick();
    assert.deepEqual(cat.pos.toArray(),position.toArray());assert.equal(cat.fallTimer,timer);
    sim.game.paused=false;sim.tick();view.update(sim.game);
    assert.ok(Math.abs(cat.pos.x-position.x+ROAD_SIGN.speed*dt)<1e-8);
    assert.ok(cat.root.position.clone().sub(view.root.position).distanceTo(new Vector3().fromArray(cat.roadSignAttachment.offset))<1e-8);
    while(sim.game.elapsed<18+ROAD_SIGN_PASS_SECONDS-1e-8)sim.tick();view.update(sim.game);
    assert.equal(view.root.visible,false,'release at the map exit, do not wait for revival');
    for(const p of [cat,dog]){assert.equal(p.roadSignAttachment,null);assert.equal(p.state,'fallen');assert.equal(p.root.visible,false);}
    assert.ok(cat.fallTimer>1.5);assert.ok(dog.fallTimer>4.5);
    const stopped=dog.pos.clone();sim.tick();assert.deepEqual(dog.pos.toArray(),stopped.toArray(),'cleared corpses stop moving');
    for(let i=0;cat.state==='fallen';i++){assert.ok(i<3600,'respawns');sim.tick();}
    assert.equal(cat.roadSignAttachment,null);assert.equal(cat.deathCause,'');assert.notEqual(cat.state,'fallen');
    assert.equal(cat.root.visible,true);assert.equal(dog.state,'fallen');assert.ok(dog.fallTimer>2.9);
    for(let i=0;dog.state==='fallen';i++){assert.ok(i<3600,'respawns');sim.tick();}view.update(sim.game);
    assert.equal(dog.roadSignAttachment,null);assert.notEqual(dog.state,'fallen');assert.equal(view.root.visible,false);
    assert.equal(dog.root.visible,true);assert.equal(ROAD_SIGN.maxLifetimeSeconds,2);assert.ok(ROAD_SIGN_PASS_SECONDS<=2);
  } finally {view.dispose();sim.dispose();}
});

test('three-second legal launch gaps reuse the sign even while an earlier victim is waiting to respawn',()=>{
 const sim=new Simulation();let view:any;try{
  begin(sim);sim.setAnimal(0,'dog');const p=place(sim,0,0);place(sim,1,4.5);place(sim,2,4.5);place(sim,3,4.5);
  const entries=[{id:'early',atMinutes:.3,side:-1},{id:'late',atMinutes:.35,side:1}];
  sim.game.level={...sim.level,roadSigns:entries};sim.game.roadSigns.reset();view=new RoadSignView(sim.scene,entries,sim.level.road);
  sim.game.elapsed=18.4-dt/2;sim.tick();assert.equal(p.state,'fallen');
  while(sim.game.elapsed<21.4)sim.tick();view.update(sim.game);
  assert.equal(p.state,'fallen');assert.equal(p.roadSignAttachment,null);assert.equal(p.root.visible,false);
  const frame=roadSignFrame(entries[1],sim.game.elapsed,sim.trucks[0],sim.level.road)!;
  assert.equal(view.root.visible,true);assert.ok(Math.abs(view.root.position.x-frame.x)<1e-8,'new sign has the prepared model');
 }finally{view?.dispose();sim.dispose();}
});

test('map-exit cleanup reaches guests urgently and hides the body without ending death or losing countdown',()=>{
 const r=room(['guest']),peer=new Simulation();try{
  const sim=r.host.sim;begin(sim);sim.setAnimal(0,'dog');place(sim,0,0);place(sim,1,4.5);place(sim,2,4.5);place(sim,3,4.5);
  sim.game.elapsed=18.4-dt/2;r.advance();assert.ok(sim.players[0].roadSignAttachment);
  sim.game.elapsed=18+ROAD_SIGN_PASS_SECONDS-dt/2;const before=sim.urgentSignature();r.advance();
  assert.notEqual(sim.urgentSignature(),before);const snapshot=r.guests[0].received.at(-1);
  assert.equal(snapshot.players[0].roadSignAttachment,null);assert.equal(snapshot.players[0].state,'fallen');assert.ok(snapshot.players[0].fallTimer>4);
  applyWorld({game:peer.game,trucks:peer.trucks,players:peer.players},snapshot);snapshot.players.forEach((s:any,i:number)=>applyPlayer(peer.players[i],s,peer.trucks));
  assert.equal(peer.players[0].root.visible,false);assert.equal(peer.players[0].fallTimer,snapshot.players[0].fallTimer);
 }finally{r.dispose();peer.dispose();}
});

test('sign tones cycle by schedule (or an explicit tone) and swap colours on shared materials with an HDR Bloom rim', () => {
  const entries = [...TUTORIAL_ROAD_SIGNS];
  assert.deepEqual(entries.map(entry => roadSignTone(entries, entry.id)), ['blue','red','yellow','blue','red','yellow']);
  assert.equal(roadSignTone([{ ...entries[0], tone: 'yellow' }], 'sign-01'), 'yellow');
  const sim=new Simulation(),view=new RoadSignView(new Scene(),entries); try {
    begin(sim); const materials=[...view.materials];
    for (const [elapsed, tone] of [[18.4,'blue'],[45.4,'red'],[72.4,'yellow']] as const) {
      sim.game.elapsed=elapsed; view.update(sim.game); assert.equal(view.tone,tone);
      assert.ok(view.face.color.equals(new Color(ROAD_SIGN_PALETTE[tone].face)));
      const rim=new Color(ROAD_SIGN_PALETTE[tone].rim).multiplyScalar(ROAD_SIGN_RIM_INTENSITY);
      assert.ok(view.rim.color.equals(rim)); assert.ok(Math.max(rim.r,rim.g,rim.b)>1,'rim exceeds the Bloom threshold');
    }
    assert.deepEqual([...view.materials],materials,'no material is created while switching tones');
  } finally { view.dispose(); sim.dispose(); }
});

test('impact smoke bursts once per confirmed hit, ignores baseline and stale attachments, and freezes with gameplay', () => {
  const sim=new Simulation(),scene=new Scene(); let fx: any; try {
    begin(sim); const p=place(sim,0,-.95); strike(sim);
    fx=new RoadSignImpact(scene,sim.game);
    const live=()=>Array.from(fx.pool.expires as Float64Array).filter(t=>t>fx.pool.time.value).length;
    fx.update(1/60); assert.equal(live(),0,'an attachment present at reset is the baseline');
    fx.reset(); p.roadSignAttachment=null; fx.update(1/60); assert.equal(live(),0);
    p.roadSignAttachment={id:'sign-01',offset:[-.23,.1,0]}; fx.update(0); const count=live(); assert.ok(count>20,'smoke and sparks');
    const sparks=Array.from({length:fx.pool.capacity},(_,i)=>fx.pool.attributes.aLife.array[i*4+3]).filter(kind=>kind===1).length; assert.equal(sparks,10);
    const blue=new Color(ROAD_SIGN_PALETTE.blue.spark), colors=fx.pool.attributes.aColor.array;
    assert.ok(Array.from({length:count},(_,i)=>i).some(i=>Math.abs(colors[i*3]-blue.r)<1e-6&&Math.abs(colors[i*3+2]-blue.b)<1e-6),'sparks use the sign tone');
    fx.update(0); assert.equal(live(),count,'the same attachment never repeats');
    const versions=Object.values(fx.pool.attributes).map((a:any)=>a.version); fx.update(.1);
    assert.deepEqual(Object.values(fx.pool.attributes).map((a:any)=>a.version),versions,'animation never rewrites instance buffers');
    p.roadSignAttachment=null; fx.update(0); sim.game.elapsed=60; p.roadSignAttachment={id:'sign-01',offset:[0,0,0]}; fx.update(2);
    assert.equal(live(),0,'a stale hit outside the pass only moves the baseline');
  } finally { fx?.dispose(); sim.dispose(); }
});
