/** Browser-profile save contract and authority-issued round receipt lifecycle. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ProgressStore, PROGRESS_KEY, decodeProgress } from '../client/js/save/ProgressStore.js';
import { FIRST_LEVEL_ID, SAVE_VERSION } from '../shared/levels.js';
import { GuestLink } from '../client/js/online/GuestLink.js';
import { FakeLink, room, rosterOf, pair } from './helpers/peerRoom.js';
class Storage {
  data = new Map<string,string>(); fail = false;
  getItem(key:string) { return this.data.get(key) ?? null; }
  setItem(key:string,value:string) { if(this.fail) throw new Error('QuotaExceededError'); this.data.set(key,value); }
}
const result = (id:string, score=25, completedOrders=1) => ({ saveVersion:SAVE_VERSION,roundId:id,levelId:FIRST_LEVEL_ID,score,completedOrders,missed:0,reason:'tutorial_complete',outcome:'success',stars:null,partyBalance:{playerCount:1,stainMultiplier:1,patienceMultiplier:1,scoreMultiplier:1} });

test('entry persists last level only; full results merge bests, preserve progress and deduplicate',async()=>{
  const storage=new Storage(),store=new ProgressStore({storage:()=>storage});
  assert.equal(store.resumeLevelId,null);assert.equal(store.status,'missing');
  assert.ok(await store.enter(FIRST_LEVEL_ID));assert.deepEqual(store.data.levels,{});assert.equal(store.resumeLevelId,FIRST_LEVEL_ID);
  assert.ok(await store.record(result('one',100,3)));assert.ok(await store.record(result('one',100,3)));
  assert.equal(store.data.levels[FIRST_LEVEL_ID].finishedRuns,1);
  assert.ok(await store.record(result('two',25,1)));assert.equal(store.data.levels[FIRST_LEVEL_ID].bestScore,100);
  assert.equal(store.data.levels[FIRST_LEVEL_ID].bestCompletedOrders,3);assert.equal(store.data.levels[FIRST_LEVEL_ID].finishedRuns,2);
  await store.enter(FIRST_LEVEL_ID);assert.equal(store.data.levels[FIRST_LEVEL_ID].finishedRuns,2,'new round does not erase valid progress');
  const reopened=new ProgressStore({storage:()=>storage});assert.deepEqual(reopened.data,store.data);
  const saved=JSON.parse(storage.getItem(PROGRESS_KEY)!);assert.equal(saved.version,'0.5');assert.equal(saved.players,undefined);assert.equal(saved.towels,undefined);assert.equal(saved.roomCode,undefined);
});
test('exact save version only; legacy data remains untouched until a new game is entered',async()=>{
  for(const version of ['0.0','0.1','0.2','0.3','0.4',0.1,0.3,'0.10','0.30']) {
    const storage=new Storage(),raw=JSON.stringify({version});storage.setItem(PROGRESS_KEY,raw);
    const store=new ProgressStore({storage:()=>storage});assert.equal(store.status,'incompatible');assert.equal(store.resumeLevelId,null);
    assert.equal(storage.getItem(PROGRESS_KEY),raw);await store.enter(FIRST_LEVEL_ID);assert.equal(store.data.version,'0.5');
  }
  assert.equal(decodeProgress('{broken').status,'corrupt');
  const storage=new Storage(),store=new ProgressStore({storage:()=>storage});await store.enter(FIRST_LEVEL_ID);
  const bad={...store.data,levels:{[FIRST_LEVEL_ID]:{finishedRuns:-1,bestScore:0,bestCompletedOrders:0}}};
  assert.equal(decodeProgress(JSON.stringify(bad)).status,'corrupt');
  assert.equal(await store.record({...result('bad'),saveVersion:'0.2'}),false);
  assert.equal(await store.record({...result('bad'),levelId:'unknown'}),false);
  assert.equal(await store.record({...result('bad'),partyBalance:{...result('bad').partyBalance,playerCount:5}}),false);
});

test('highest-score party count follows that exact receipt; lower scores, equal scores and redeliveries preserve it',async()=>{
 const storage=new Storage(),store=new ProgressStore({storage:()=>storage});
 const receipt=(id:string,score:number,players:number)=>({...result(id,score),partyBalance:{...result(id).partyBalance,playerCount:players}});
 await store.record(receipt('first',100,2));assert.equal(store.data.levels[FIRST_LEVEL_ID].bestScorePlayers,2);
 await store.record(receipt('lower',50,4));assert.equal(store.data.levels[FIRST_LEVEL_ID].bestScorePlayers,2);
 await store.record(receipt('equal',100,3));assert.equal(store.data.levels[FIRST_LEVEL_ID].bestScorePlayers,2);
 await store.record(receipt('higher',150,4));await store.record(receipt('higher',150,1));
 assert.equal(store.data.levels[FIRST_LEVEL_ID].bestScore,150);assert.equal(store.data.levels[FIRST_LEVEL_ID].bestScorePlayers,4);
 const reopened=new ProgressStore({storage:()=>storage});assert.equal(reopened.data.levels[FIRST_LEVEL_ID].bestScorePlayers,4);
 const missing=structuredClone(reopened.data);delete missing.levels[FIRST_LEVEL_ID].bestScorePlayers;assert.equal(decodeProgress(JSON.stringify(missing)).status,'corrupt');
});
test('storage failures preserve the previous bytes and can retry; another browser has independent progress',async()=>{
  const storage=new Storage(),store=new ProgressStore({storage:()=>storage});await store.enter(FIRST_LEVEL_ID);
  const before=storage.getItem(PROGRESS_KEY);storage.fail=true;assert.equal(await store.record(result('retry')),false);
  assert.equal(storage.getItem(PROGRESS_KEY),before);assert.match(store.error,/写入失败/);
  storage.fail=false;assert.equal(await store.record(result('retry')),true);assert.equal(store.error,'');
  assert.equal(new ProgressStore({storage:()=>new Storage()}).resumeLevelId,null);
  const otherTab=new ProgressStore({storage:()=>storage});await otherTab.record(result('tab-two',50,2));
  store.reload();assert.equal(store.data.levels[FIRST_LEVEL_ID].finishedRuns,2);assert.equal(store.data.levels[FIRST_LEVEL_ID].bestScore,50);
});
test('every participant gets one host-issued result; a reconnecting guest gets it again until it acknowledges',()=>{
  const r=room(['g1']);try {
    assert.equal(r.host.command('start',{}),null);
    assert.ok(r.events.some(e=>e.type==='round_started'&&e.detail.saveVersion==='0.5'));
    r.guests[0].link.close('wifi');r.host.setRoster(rosterOf([r.members[0],{...r.members[1],connected:false}]));
    const sim=r.host.sim;sim.game.score=75;sim.game.completed=2;sim.game.finish('time_up');
    r.host.advance();r.host.advance();
    assert.equal(r.events.filter(e=>e.type==='round_result').length,1,'the host page records it once');
    assert.equal(r.host.receipts.get('g1')?.size,1,'kept for the absent guest');
    const reconnected={...r.members[1],session:'g1-s2'};let link!:FakeLink;const results:any[]=[];
    const hostLinks:FakeLink[]=[];const authority:any=r.host,create=authority.createLink;authority.createLink=(options:any)=>{const made=create(options);hostLinks.push(made as any);return made;};
    r.host.setRoster(rosterOf([r.members[0],reconnected]));
    const guest=new GuestLink({roster:rosterOf([r.members[0],reconnected],'g1'),session:'g1-s2',signal(){},createLink:((options:any)=>(link=new FakeLink(options))) as any});
    guest.addEventListener('round_result',(e:any)=>results.push(e.detail));
    pair(hostLinks[0],link);
    assert.equal(results.length,1);assert.equal(results[0].score,75);
    guest.sendControl({type:'result_ack',roundId:results[0].roundId});assert.equal(r.host.receipts.get('g1')?.size,0);
    guest.end('test');
    r.host.setRoster(rosterOf([r.members[0]]));
    r.host.command('home');r.host.command('start',{});r.host.command('home');
    assert.equal(r.events.filter(e=>e.type==='round_result').length,1,'abandoning a partial round cannot create a completed result');
    assert.equal(r.host.command('start',{levelId:'invalid'}),'这个关卡尚未开放');
  }finally{r.dispose();}
});

test('second level continues from its beginning and stores independent results without altering save semantics',async()=>{
 const storage=new Storage(),store=new ProgressStore({storage:()=>storage});
 await store.record(result('first',25,1));await store.enter('highway-02');
 assert.equal(new ProgressStore({storage:()=>storage}).resumeLevelId,'highway-02');
 await store.record({...result('second',50,2),levelId:'highway-02',reason:'time_up',stars:1});
 assert.equal(store.data.levels['highway-02'].bestScore,50);
 assert.equal(store.data.levels[FIRST_LEVEL_ID].bestScore,25);
 assert.equal(store.data!.version,SAVE_VERSION);assert.equal(SAVE_VERSION,'0.5');
});

test('host switches to 02 for the whole room; side, patience, cleaning and timeout traverse existing deltas',()=>{
 const r=room(['guest']);try {
  assert.equal(r.host.command('start',{levelId:'highway-02'}),null);
  assert.equal(r.host.levelId,'highway-02');assert.ok(r.guests[0].guest.state);assert.equal(r.guests[0].guest.state.levelId,'highway-02');
  for(let i=0;i<410;i++)r.advance();
  const sim=r.host.sim,g=sim.game;g.spawnOrder(1);g.lane.x=g.orderX();
  for(let i=0;i<4;i++)r.advance();
  const frame=r.guests[0].received.at(-1);
  assert.ok(frame.game.order.remaining<=60 && frame.game.order.remaining>59);
  assert.equal(frame.game.order.serial,1);assert.ok(frame.game.lane.z>g.homeZ);
  const player=sim.players[1],truck=g.orderTruck,stain=g.order.stains[0],towel=g.towels[0];
  towel.pickup(player);player.skipUse=false;player.state='ground';player.ground={truck,plat:truck.platforms[0]};
  player.pos.set(truck.pos.x+stain.mesh.position.x,truck.topY,truck.pos.z+stain.mesh.position.z);player.vel.set(0,0,0);
  for(let i=0;i<100&&!stain.done;i++){r.guests[0].guest.sendInput({seq:i+1,axis:[0,0],move:[0,0],down:['KeyJ'],hits:[]});r.advance();}
  assert.equal(stain.done,true);assert.equal(r.guests[0].received.at(-1).game.order.stains[0].done,true);
  g.order.remaining=.001;r.advance();
  assert.equal(r.guests[0].received.at(-1).game.order.mode,'leaving');
  assert.equal(r.guests[0].received.at(-1).game.missed,1);assert.equal(g.score,0);
  r.host.command('home');assert.equal(r.host.command('start',{levelId:FIRST_LEVEL_ID}),null);
  assert.equal(r.host.sim.level.id,FIRST_LEVEL_ID);assert.equal(r.host.sim.level.road.laneCount,2);
 }finally{r.dispose();}
});
