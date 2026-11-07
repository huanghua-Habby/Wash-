import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, getLevel, SAVE_VERSION, validRoundResult } from '../shared/levels.js';
import { Simulation } from '../shared/sim/RoomSimulation.js';
import { partyStainLayouts, PARTY_FACTORS, roundPartyBalance } from '../shared/sim/PartyBalance.js';
import { MAX_STAINS, validateStains, STAIN_KINDS, stainLayout } from '../shared/sim/StainDefinitions.js';
import { VEHICLES, vehicleSpec } from '../shared/sim/vehicles.js';
import { applyWorld } from '../shared/snapshot.js';
import { quantize, SnapshotDecoder, SnapshotEncoder } from '../shared/delta.js';
import { packetInput, VERSION } from '../shared/protocol.js';
import { room } from './helpers/peerRoom.js';

const counts = [[15,19,21,23],[15,19,21,23],[21,26,29,32],[41,51,57,62]];
const steps = [[20,25,28,31],[27,34,37,42],[37,46,52,56],[69,86,96,105]];
function start(levelId: string, count: number) {
  const sim=new Simulation(getLevel(levelId)!);for(let i=0;i<count;i++)sim.occupy(i,true);
  sim.phase='game';sim.game.start(sim.director.base);return sim;
}
function spawn(g: any, id: string) { g.levelScript.enqueue(id);g.levelScript.beforeFleet(1/60);return g.spawnOrder(g.levelScript.requests.find((r:any)=>r.id===id).serial); }
function clean(g: any,o: any) { for(const s of o.stains){s.done=true;s.stage=s.steps.length;}g.completeOrder(o); }

test('authored single-player baselines meet requested load ranges; all 16 exact party quotas preserve the authored tool mix and bounds',()=>{
  const targets=[.9,1.25,1.7,2.15];
  for(const [i,level]of LEVELS.slice(1).entries()) {
    let fixed=0,basePure=0,baseCount=0;
    for(const o of level.script.orders){const tools=new Set(o.stains.flatMap((s:any)=>STAIN_KINDS[s.kind as keyof typeof STAIN_KINDS]));fixed+=6+(o.behavior==='wideCruise'?3:0)+(tools.size-1)*3;for(const s of o.stains){baseCount++;basePure+=1.15+(s.kind!=='dust'?1.2:0)+(s.kind==='grease'?1:0);}}
    const load=(fixed+basePure+2*baseCount+Math.max(0,baseCount-6)*.7)/level.clock.duration;
    assert.ok(Math.abs(load-targets[i])<=.1,`${level.id} load ${load}`);
    for(let n=1;n<=4;n++) {
      const layouts=partyStainLayouts(level,PARTY_FACTORS[n-1]),again=partyStainLayouts(level,PARTY_FACTORS[n-1]);assert.deepEqual(layouts,again);
      const all=level.script.orders.map((o:any)=>layouts.get(o.id)||o.stains);
      assert.equal(all.flat().length,counts[i][n-1]);assert.equal(all.flat().reduce((v:any,s:any)=>v+STAIN_KINDS[s.kind as keyof typeof STAIN_KINDS].length,0),steps[i][n-1]);
      all.forEach((layout:any,j:number)=>{const o=level.script.orders[j];validateStains(layout,vehicleSpec(o.type));assert.ok(layout.length>=o.stains.length&&layout.length<=MAX_STAINS);assert.deepEqual(new Set(layout.map((s:any)=>s.kind)),new Set(o.stains.map((s:any)=>s.kind)));});
    }
  }
  for(const spec of Object.values(VEHICLES)){const layout=stainLayout(spec,Array(5).fill('dust'));validateStains(layout,spec);for(let i=0;i<5;i++)for(let j=0;j<i;j++)assert.ok(Math.hypot(layout[i].position[0]-layout[j].position[0],layout[i].position[1]-layout[j].position[1])>1,'five patch centers remain distinct and reachable');}
  assert.equal(VERSION, 42);assert.equal(SAVE_VERSION,'0.5');
});

test('party factors lock at round start through disconnects, guide/pause and future queued cars; restart reselects the current roster',()=>{
  const sim=start('highway-05',4),g=sim.game;
  try{
    const balance=g.partyBalance,defs=g.level.script.orders.map((o:any)=>structuredClone(g.levelScript.definition(o.id)));
    sim.occupy(3,false);sim.occupy(2,false);sim.command('pause',true);sim.tick();
    assert.equal(g.partyBalance,balance);assert.deepEqual(balance,{playerCount:4,...PARTY_FACTORS[3]});
    assert.deepEqual(g.level.script.orders.map((o:any)=>g.levelScript.definition(o.id)),defs);
    g.levelScript.enqueue(defs.at(-1).id);assert.deepEqual(g.levelScript.requests.at(-1).stains,defs.at(-1).stains);
    g.start(sim.director.base);assert.equal(g.partyBalance.playerCount,2);assert.equal(g.partyBalance.scoreMultiplier,.9);
    assert.equal(g.level.script.orders.reduce((n:number,o:any)=>n+g.levelScript.definition(o.id).stains.length,0),51);
    const absent=roundPartyBalance(getLevel('highway-05'),[{occupied:true,connected:false}]);assert.equal(absent.playerCount,1);
  }finally{sim.dispose();}
});

for(const n of [1,2,3,4])test(`${n}-player patience and reward use the locked factors, with combo/charge rounded exactly once`,()=>{
  const sim=start('highway-04',n),g=sim.game;
  try{
    const o=spawn(g,g.level.script.orders[0].id),total=o.stains.reduce((n:number,s:any)=>n+s.steps.length,0);
    assert.ok(Math.abs(o.initialPatience-total*10*1.2*PARTY_FACTORS[n-1].patienceMultiplier)<1e-8);
    sim.tick();assert.equal(o.remaining,o.initialPatience,'approach has not started the patience countdown');
    g.lanes.forEach((l:any)=>l.x=g.orderX());sim.tick();assert.ok(o.remaining<o.initialPatience);
    o.rewardMultiplier=1.5;clean(g,o);assert.equal(g.score,[38,34,32,31][n-1]);
    clean(g,o);assert.equal(g.completed,1);assert.equal(g.score,[38,34,32,31][n-1]);
    g.reclaimOrder(o);const next=spawn(g,g.level.script.orders[1].id);clean(g,next);
    assert.equal(g.score,[38,34,32,31][n-1]+Math.round(30*PARTY_FACTORS[n-1].scoreMultiplier));
    g.finish('time_up');assert.deepEqual(g.result.partyBalance,g.partyBalance);
    assert.ok(validRoundResult({...g.result,saveVersion:SAVE_VERSION,roundId:'party',levelId:'highway-04'}));
    assert.equal(validRoundResult({...g.result,saveVersion:'0.4',roundId:'old',levelId:'highway-04'}),false);
  }finally{sim.dispose();}
});

test('five-patch authority/delta restores the locked roster and future layouts, and a view cannot award a completion',()=>{
  const sim=start('highway-05',4),peer=new Simulation(getLevel('highway-05')!),g=sim.game;
  try{
    const o=spawn(g,g.level.script.orders[0].id);assert.equal(o.stains.length,5);
    const encoder=new SnapshotEncoder(),decoder=new SnapshotDecoder();const frame=encoder.encode(quantize(sim.snapshot()),'party');
    applyWorld({game:peer.game,trucks:peer.trucks,players:peer.players},decoder.decode(frame));encoder.ack(frame.tick);
    assert.deepEqual(peer.game.partyBalance,g.partyBalance);assert.deepEqual(peer.game.levelScript.definition('sign-14'),g.levelScript.definition('sign-14'));
    o.stains[4].progress=.6;sim.tick();applyWorld({game:peer.game,trucks:peer.trucks,players:peer.players},decoder.decode(encoder.encode(quantize(sim.snapshot()),'party')));
    assert.equal(peer.game.orders[0].stains[4].progress,.6);
    peer.game.viewOnly=true;clean(peer.game,peer.game.orders[0]);assert.equal(peer.game.score,0);assert.equal(peer.game.completed,0);
    assert.equal(g.orders[0].stains[4].done,false);
  }finally{sim.dispose();peer.dispose();}
});

test('live star progress is authoritative at each threshold, clamps the bar and stays hidden in tutorial',()=>{
 const sim=start('highway-02',2),peer=new Simulation(getLevel('highway-02')!),tutorial=start('highway-01',2);
 try{
  assert.equal(tutorial.game.ratingProgress,null);
  peer.game.viewOnly=true;
  for(const [score,stars]of [[0,0],[24,0],[25,1],[54,1],[55,2],[129,2],[130,3],[200,3]]){
   sim.game.score=score;const frame=sim.snapshot();applyWorld({game:peer.game,trucks:peer.trucks,players:peer.players},frame);
   assert.equal(peer.game.ratingProgress.stars,stars);assert.equal(peer.game.ratingProgress.ratio,Math.min(1,score/130));
   peer.game.score=999;assert.equal(peer.game.ratingProgress.score,score,'local view state cannot award a live star');
  }
 }finally{sim.dispose();peer.dispose();tutorial.dispose();}
});

test('four-player shared pickup conflict and cleaning the fifth patch produce one urgent normalized reward and matching receipts',()=>{
  const r=room(['a','b','c'],{legacy:false});
  try{
    r.host.command('start',{levelId:'highway-05'});const sim=r.host.sim,g=sim.game;sim.phase='game';g.start(sim.director.base);
    const o=spawn(g,g.level.script.orders[0].id);g.lanes.forEach((l:any)=>l.x=g.orderX());r.advance();
    const towel=g.towels[0],home=sim.trucks[0];g.towels.slice(1).forEach((t:any)=>t.mesh.position.x=20);
    for(const slot of [1,2]){const p=sim.players[slot];p.state='ground';p.ground={truck:home,plat:home.platforms[0]};p.pos.set(home.pos.x+towel.mesh.position.x,home.topY,home.pos.z+towel.mesh.position.z);p.root.position.copy(p.pos);}
    const key={seq:1,axis:[0,0],move:[0,0],down:['KeyJ'],hits:['KeyJ']};
    r.guests[0].guest.sendInput(key);r.guests[1].guest.sendInput(key);r.advance();
    assert.equal(towel.holder,sim.players[1]);assert.equal(sim.players[2].heldTool,null);
    const s=o.stains[4],p=sim.players[1];o.stains.slice(0,4).forEach((s:any)=>{s.done=true;s.stage=s.steps.length;});s.stage=s.steps.length-1;
    p.skipUse=false;p.state='ground';p.ground={truck:o.truck,plat:o.truck.platforms[0]};p.pos.set(o.truck.pos.x+s.position[0],o.truck.topY,o.truck.pos.z+s.position[1]);p.root.position.copy(p.pos);
    for(let i=2;i<120&&!s.done;i++){r.guests[0].guest.sendInput({...key,seq:i,hits:[]});r.advance();}
    assert.equal(s.done,true);assert.equal(g.score,21);assert.equal(g.completed,1);
    for(const guest of r.guests){const frame=guest.received.at(-1);assert.equal(frame.game.partyBalance.playerCount,4);assert.equal(frame.game.score,21);assert.equal(frame.game.orders.find((x:any)=>x.id===o.id).stains[4].done,true);}
    g.remaining=.001;r.advance();for(const guest of r.guests){assert.equal(guest.results.length,1);assert.equal(guest.results[0].score,21);assert.equal(guest.results[0].partyBalance.playerCount,4);}
  }finally{r.dispose();}
});
