import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GuestLink } from '../client/js/online/GuestLink.js';
import { PeerLink } from '../client/js/online/PeerLink.js';
import { DepartureSmoke } from '../client/js/fx/DepartureSmoke.js';
import { Simulation } from './fixtures/Simulation.js';
import { applyPlayer } from '../shared/snapshot.js';
import { validRejoinDecision, STATE_CHANNEL } from '../shared/protocol.js';
import { quantize } from '../shared/delta.js';
import { room, rosterOf, FakeLink, pair } from './helpers/peerRoom.js';

function reconnect(r: ReturnType<typeof room>, id: string) {
  const member = r.members.find(m => m.id === id)!;
  member.session += '-new'; member.connected = true;
  r.host.setRoster(rosterOf(r.members));
  let link!: FakeLink;
  const guest = new GuestLink({roster:rosterOf(r.members,id),session:member.session,signal(){},
    createLink:((options:any) => (link=new FakeLink(options))) as any});
  const snapshots:any[]=[]; guest.addEventListener('snapshot',(e:any)=>snapshots.push(e.detail));
  pair(r.host.guests.get(id)!.link as any,link);
  return {guest,link,snapshots};
}

test('departure releases a held tool and pouch immediately, removes physics and synchronizes one smoke record', () => {
  const r=room(['a','b']), viewer=new Simulation();
  try {
    for(let i=0;i<90;i++)r.advance();
    const sim=r.host.sim, p=sim.players[1], tool=sim.game.towels[0];
    tool.pickup(p); p.externalVelocity.set(8,0,0);
    const before=sim.urgentSignature(), position=p.pos.toArray();
    r.guests[0].link.close();
    assert.equal(p.occupied,false); assert.equal(p.sceneReady,false); assert.equal(p.heldTool,null);
    assert.equal(tool.holder,null); assert.equal(p.externalVelocity.lengthSq(),0);
    assert.deepEqual(sim.queues[1],[]); assert.deepEqual(sim.inputs[1].down,[]);
    assert.equal(p.departure.serial,1); assert.deepEqual(p.departure.position,position);
    assert.notEqual(sim.urgentSignature(),before);
    for(let i=0;i<20;i++)r.advance();
    assert.deepEqual(p.pos.toArray(),position,'an absent actor does not continue falling or moving');
    const snap=r.guests[1].received.at(-1);
    applyPlayer(viewer.players[1],snap.players[1],viewer.trucks);
    assert.equal(viewer.players[1].occupied,false); assert.deepEqual(viewer.players[1].departure,quantize(p.departure));
    sim.depart(1); assert.equal(p.departure.serial,1,'registry and direct-link closes cannot duplicate smoke');
    sim.occupy(1,true); sim.setAnimal(1,'pelican');
    sim.game.swallow(p,sim.players[2]);
    sim.depart(1); assert.equal(sim.players[2].swallowedBy,null); assert.equal(p.swallowed,null);
  } finally {r.dispose();viewer.dispose();}
});

test('a home refresh rejoins automatically; an in-game drop hands the character to a bot until a scoped Y takes it back in place', () => {
  const r=room(['a']); let replacement: ReturnType<typeof reconnect>|undefined;
  try {
    r.guests[0].link.close(); replacement=reconnect(r,'a');
    assert.equal(replacement.guest.rejoinPending,false); assert.equal(r.host.sim.players[1].occupied,true);
    assert.equal(r.host.command('start'),null);
    while(r.host.sim.phase!=='game')r.advance();
    for(let i=0;i<30;i++)r.advance();
    const sim=r.host.sim, p=sim.players[1], serial=p.departure.serial;
    replacement.link.close(); replacement.guest.end('test');
    assert.equal(p.occupied,true,'the character stays on the field'); assert.equal(sim.isStandIn(1),true);
    assert.equal(p.departure.serial,serial,'no departure smoke mid-match');
    assert.deepEqual(sim.game.bots,[{slot:1,name:'a',team:null,appearance:sim.game.bots[0].appearance,standIn:true}]);
    replacement=reconnect(r,'a');
    assert.equal(replacement.guest.rejoinPending,true); assert.equal(sim.isStandIn(1),true);
    assert.equal(replacement.guest.sendInput({seq:1,axis:[1,0],move:[1,0],down:[],hits:[]}),false);
    const request=replacement.guest.rejoinRequest!, frame={type:'rejoin_decision',epoch:r.host.epoch,roundId:r.host.roundId,
      recoveryId:request.recoveryId,accept:true};
    for(const bad of [{...frame,epoch:0},{...frame,roundId:'old'},{...frame,recoveryId:'old'},{...frame,accept:'yes'}])replacement.guest.sendControl(bad);
    assert.equal(sim.isStandIn(1),true);
    replacement.link.send(STATE_CHANNEL,{type:'input',epoch:r.host.epoch,inputs:[{seq:5,axis:[1,0],move:[1,0],down:[],hits:[]}]});
    assert.deepEqual(sim.queues[1],[],'malicious direct inputs cannot take over from the bot');
    const pos=p.pos.toArray();
    replacement.guest.sendControl({...frame,slot:0});
    assert.equal(sim.isStandIn(1),false); assert.equal(p.occupied,true); assert.equal(p.sceneReady,true); assert.equal(sim.connected[1],true);
    assert.deepEqual(p.pos.toArray(),pos,'control comes back in place, no respawn'); assert.deepEqual(sim.game.bots,[]);
    replacement.guest.sendControl(frame); assert.deepEqual(p.pos.toArray(),pos,'duplicate Y changes nothing');
    assert.equal(replacement.guest.rejoinPending,false);
    r.advance(); assert.equal(replacement.snapshots.at(-1).players[1].occupied,true);
  } finally {replacement?.guest.end('test');r.dispose();}
});

test('refresh session replacement suspends even without an intervening roster disconnect; N releases only its bound seat and the bot plays on', () => {
  const r=room(['a','b']); let replacement:ReturnType<typeof reconnect>|undefined;
  try {
    r.host.command('start'); replacement=reconnect(r,'a');
    assert.equal(r.host.sim.isStandIn(1),true); assert.equal(replacement.guest.rejoinPending,true);
    replacement.guest.decideRejoin(false);
    assert.equal(r.host.sim.players[1].occupied,true,'the bot keeps playing'); assert.equal(r.host.sim.isStandIn(1),true);
    assert.equal(r.host.sim.players[2].occupied,true);
    assert.equal(r.events.filter(e=>e.type==='release_guest'&&e.detail.member==='a'&&e.detail.reason==='declined').length,1);
    r.host.setRoster(rosterOf(r.members.filter(m=>m.id!=='a')));
    assert.equal(r.host.released.size,0); assert.equal(r.host.recoveries.size,0);
    assert.equal(r.host.sim.players[1].occupied,true,'leaving the roster does not remove the stand-in mid-match');
    assert.equal(r.host.sim.phase,'transition');
    r.host.command('home');
    assert.equal(r.host.sim.players[1].occupied,false,'the stand-in ends with the match'); assert.equal(r.host.sim.standIns.size,0);
  } finally {replacement?.guest.end('test');r.dispose();}
});

test('recovery deadline keeps running through guide/pause and is not renewed by reconnect or repeated choices', () => {
  const r=room(['a'],{autoGuide:false}); let now=0, replacement:ReturnType<typeof reconnect>|undefined;
  r.host.now=()=>now;
  try {
    r.host.command('start'); while(r.host.sim.phase!=='game')r.advance();
    r.guests[0].link.close(); const deadline=r.host.recoveries.get('a')!.deadline;
    now=20; replacement=reconnect(r,'a'); assert.equal(r.host.recoveries.get('a')!.deadline,deadline);
    r.host.command('pause',{paused:true}); now=31; r.advance();
    assert.equal(r.host.recoveries.size,0); assert.equal(r.host.sim.isStandIn(1),true,'after the window the bot finishes the match');
    assert.ok(r.events.some(e=>e.type==='release_guest'&&e.detail.reason==='expired'));
    assert.equal(replacement.guest.decideRejoin(true),false);
  } finally {replacement?.guest.end('test');r.dispose();}
});

test('tutorial excludes absent readers; Y adds a fresh unread slot and old confirmations cannot prepare it', () => {
  const r=room(['a','b'],{autoGuide:false}); let replacement:ReturnType<typeof reconnect>|undefined;
  try {
    r.host.command('start'); while(r.host.sim.phase!=='game')r.advance();
    const frame={type:'guide_ready',epoch:r.host.epoch,roundId:r.host.roundId!,guideId:'basic-controls',pageIndex:0};
    r.guests[0].guest.sendControl(frame); r.guests[0].link.close();
    assert.equal(r.host.sim.game.guide.participants,5,'the stand-in bot is not a reader'); assert.equal(r.host.sim.game.guide.ready,0);
    replacement=reconnect(r,'a'); replacement.guest.sendControl(frame); assert.equal(r.host.sim.game.guide.ready,0);
    replacement.guest.decideRejoin(true); r.advance(); assert.equal(r.host.sim.game.guide.participants,7);
    assert.equal(r.host.sim.game.guide.ready,0); replacement.guest.sendControl(frame);
    assert.equal(r.host.sim.game.guide.ready,2);
  } finally {replacement?.guest.end('test');r.dispose();}
});

test('departure GPU buffers change only on emit/reset; smoke precedes hiding, does not replay and cancels on respawn', () => {
  const sim=new Simulation(); sim.occupy(1,true);
  const fx=new DepartureSmoke(sim.scene,sim.game), p=sim.players[1];
  try {
    sim.depart(1); fx.update(.01); assert.equal(p.root.visible,true); assert.ok(fx.pool.time.value>0);
    const attrs=Object.values(fx.pool.attributes), versions=attrs.map((a:any)=>a.version);
    for(let i=0;i<30;i++)fx.update(.02);
    assert.equal(p.root.visible,false); attrs.forEach((a:any,i)=>assert.equal(a.version,versions[i]));
    const life=(fx.pool.attributes as any).aLife;
    const births=[...life.array]; fx.update(.02); assert.deepEqual([...life.array],births);
    sim.occupy(1,true); sim.depart(1); fx.update(.01); sim.occupy(1,true); fx.update(.01);
    assert.equal(p.root.visible,true); fx.reset(); fx.update(.01); assert.equal(p.root.visible,true);
  } finally {fx.dispose();sim.dispose();}
});

test('rejoin decision validation rejects unbounded/stale-shaped payloads', () => {
  const good={epoch:2,roundId:'round',recoveryId:'recovery',accept:true}; assert.equal(validRejoinDecision(good),true);
  for(const bad of [null,{}, {...good,epoch:0},{...good,accept:1},{...good,recoveryId:'x'.repeat(65)}])assert.equal(validRejoinDecision(bad),false);
});

test('late host bye/ICE from the old session pair cannot kill or negotiate the replacement link', async () => {
  const r=room(['a']);let replacement:ReturnType<typeof reconnect>|undefined;
  try {
    r.host.command('start');const old=r.guests[0].guest.identity.link;
    r.guests[0].link.close();replacement=reconnect(r,'a');
    const received:any[]=[];(replacement.link as any).receive=async(data:any)=>{received.push(data);};
    const from=r.members[0].session;
    for(const kind of ['bye','ice','offer'])replacement.guest.receiveSignal('host',from,{kind,session:from,link:old});
    assert.deepEqual(received,[]);
    replacement.guest.receiveSignal('host',from,{kind:'bye',session:from,link:replacement.guest.identity.link});
    assert.equal(received.length,1,'only the current session pair reaches the link');
    await PeerLink.prototype.receive.call({closed:false,identity:{link:'new'}} as any,{kind:'bye',link:'old'});
    assert.equal(replacement.guest.open,true);
  } finally {replacement?.guest.end('test');r.dispose();}
});
