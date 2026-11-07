/** Room registry and signaling service: codes, seats, host-reported phase, relay identity and socket-level integration. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createSocket } from 'node:dgram';
import { Rooms } from '../server/src/Rooms.js';
import { createServer, iceServersFor } from '../server/src/main.js';
import { bindingResponse } from '../server/src/stun.js';
import { parseName, REGISTRY_VERSION, HOST_RECOVERY_SECONDS, GUEST_RECOVERY_SECONDS, capacityFor, TEAM_CAPACITY } from '../shared/protocol.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

class Peer { readyState=1; messages: any[]=[]; send(raw: string) { this.messages.push(JSON.parse(raw)); } close() { this.readyState=3; } }
const offer={ kind:'offer',session:'s',link:'host:guest',sdp:'v=0' };

test('four seats, atomic joins, retired own codes and main-menu-only joining',() => {
  const service=new Rooms();
  try {
    const players=Array.from({length:5},(_,i)=>service.connect(new Peer(),`P${i}`));
    const code=players[0].room.code, old=players[1].room.code;
    for (const p of players.slice(1,4)) service.join(p,code.toLowerCase());
    assert.equal(players[0].room.members.length,4);
    assert.deepEqual(players.slice(0,4).map((p)=>p.slot),[0,1,2,3]);
    assert.equal(service.rooms.has(old),false,'joining retires the guest\'s own code');
    const fifth=players[4].room;
    assert.throws(()=>service.join(players[4],code),(e:any)=>e.code==='room_full');
    assert.equal(players[4].room,fifth); assert.ok(service.rooms.has(fifth.code));
    assert.throws(()=>service.join(players[4],old),(e:any)=>e.code==='room_not_found');
    assert.throws(()=>service.hostPhase(players[1],'game'),(e:any)=>e.code==='bad_request','only the host reports its phase');
    service.leave(players[1]); assert.notEqual(players[1].room.code,old); assert.ok(service.rooms.has(players[1].room.code)); assert.equal(players[0].room.members.length,3);
    service.hostPhase(players[0],'transition');
    assert.throws(()=>service.join(players[4],code),(e:any)=>e.code==='room_started'); assert.equal(players[4].room,fifth);
    service.hostPhase(players[0],'home');
    service.join(players[0],players[4].room.code);
    assert.ok(!service.rooms.has(code),'a departing host retires its room');
    for (const guest of players.slice(2,4)) { assert.equal(guest.room.host,guest.id); assert.ok((guest.peer as Peer).messages.some((m)=>m.type==='notice')); }
  } finally { service.close(); }
});

test('the roster binds identity, slot and session; the relay stamps the sender and only links host and guests',() => {
  const service=new Rooms();
  try {
    const [hostPeer,aPeer,bPeer]=[new Peer(),new Peer(),new Peer()];
    const host=service.connect(hostPeer,'Host'), a=service.connect(aPeer,'A'), b=service.connect(bPeer,'B');
    service.join(a,host.room.code); service.join(b,host.room.code);
    const roster=hostPeer.messages.filter((m)=>m.type==='room').at(-1);
    assert.deepEqual(roster.members.map((m:any)=>[m.id,m.slot,m.session]),[[host.id,0,host.session],[a.id,1,a.session],[b.id,2,b.session]]);
    assert.equal(roster.ownCode,host.room.code); assert.equal(aPeer.messages.filter((m)=>m.type==='room').at(-1).ownCode,null);
    service.signal(host,a.id,offer);
    const relayed=aPeer.messages.find((m)=>m.type==='signal');
    assert.deepEqual([relayed.from,relayed.fromSession,relayed.data.kind],[host.id,host.session,'offer']);
    service.signal(a,b.id,offer);
    assert.equal(bPeer.messages.some((m)=>m.type==='signal'),false,'guests cannot signal each other');
    assert.throws(()=>service.signal(a,host.id,{ kind:'offer',session:'s',sdp:'x'.repeat(20_000) }),(e:any)=>e.code==='bad_signal');
    const outsider=service.connect(new Peer(),'Outsider');
    service.signal(outsider,host.id,offer);
    assert.equal(hostPeer.messages.some((m)=>m.type==='signal'),false,'non-members cannot reach the host');
    service.hostPhase(host,'game'); service.turnAway(host,b.id);
    assert.notEqual(b.room,host.room); assert.ok(bPeer.messages.some((m)=>m.code==='room_started'));
  } finally { service.close(); }
});

test('resume keeps room and slot with a new session; an absent host ends the room sooner than a guest seat expires',() => {
  const service=new Rooms();
  try {
    const first=new Peer(),host=service.connect(first,'房主');
    const guestPeer=new Peer(),guest=service.connect(guestPeer,'Guest');service.join(guest,host.room.code);
    const code=host.room.code, session=host.session;
    service.disconnect(host,first);
    assert.equal(guestPeer.messages.filter((m)=>m.type==='room').at(-1).members[0].connected,false);
    const second=new Peer(),resume=service.connect(second,'Other',host.token);
    assert.equal(resume,host); assert.equal(resume.room.code,code); assert.equal(resume.name,'房主'); assert.notEqual(resume.session,session);
    service.disconnect(host,first); assert.equal(host.peer,second,'an old connection closing cannot disconnect the resumed socket');
    const now=Date.now();
    service.disconnect(guest,guestPeer,now); service.sweep(now+(HOST_RECOVERY_SECONDS+1)*1000);
    assert.equal(guest.room.code,code,'a guest seat survives the host window');
    service.disconnect(host,second,now); service.sweep(now+(HOST_RECOVERY_SECONDS+1)*1000);
    assert.equal(service.rooms.has(code),false); assert.equal(service.sessions.has(host.token),false);
    assert.equal(guest.room.host,guest.id,'guests return to their own new room');
    service.sweep(now+(GUEST_RECOVERY_SECONDS+1)*1000); assert.equal(service.sessions.has(guest.token),false);
    const lonely=service.connect(new Peer(),'H'), late=service.connect(new Peer(),'L');
    service.disconnect(lonely,lonely.peer!);
    assert.throws(()=>service.join(late,lonely.room.code),(e:any)=>e.code==='host_offline');
  } finally { service.close(); }
});

test('nickname width and scripts are validated on the service',() => {
  assert.equal(parseName('abcdefghijkl'),'abcdefghijkl'); assert.equal(parseName('中文昵称六字'),'中文昵称六字');
  assert.equal(parseName('中文Alice123'),'中文Alice123'); assert.equal(parseName('中文Alice1234'),null);
  assert.equal(parseName('中文昵称七个字'),null);assert.equal(parseName('abcdefghijklm'),null);
  assert.equal(parseName('<script>'),null);assert.equal(parseName('😀'),null);assert.equal(parseName('   '),null);
});

test('guest link recovery rotates its session once, retains identity/slot, and guests cannot release another seat', () => {
  const rooms=new Rooms();
  try {
    const host=rooms.connect(new Peer(),'Host'), a=rooms.connect(new Peer(),'A'), b=rooms.connect(new Peer(),'B');
    rooms.join(a,host.room.code); rooms.join(b,host.room.code); rooms.hostPhase(host,'game');
    const session=a.session, id=a.id, slot=a.slot;
    rooms.reconnect(a); assert.notEqual(a.session,session); assert.equal(a.id,id); assert.equal(a.slot,slot);
    const next=a.session; rooms.reconnect(a); assert.equal(a.session,next,'repeated requests cannot churn peer negotiations');
    rooms.releaseGuest(a,b.id,'declined'); assert.equal(host.room.members.length,3);
    rooms.releaseGuest(host,a.id,'invalid'); assert.equal(host.room.members.length,3);
    rooms.releaseGuest(host,a.id,'declined'); assert.equal(host.room.members.length,2); assert.equal(a.room.host,a.id);
  } finally {rooms.close();}
});

test('expired recovery releases online or offline seats and reports only a small notice on reconnect', () => {
  const rooms=new Rooms();
  try {
    const host=rooms.connect(new Peer(),'Host'), onlinePeer=new Peer(), online=rooms.connect(onlinePeer,'A');
    rooms.join(online,host.room.code); rooms.releaseGuest(host,online.id,'expired');
    assert.equal(online.room.host,online.id);
    assert.ok(onlinePeer.messages.some(m=>m.type==='notice'&&m.message==='房间已超时'));
    const peer=new Peer(), offline=rooms.connect(peer,'B'); rooms.join(offline,host.room.code);
    rooms.disconnect(offline,peer); const token=offline.token; rooms.releaseGuest(host,offline.id,'expired');
    assert.equal(rooms.sessions.has(token),false); assert.equal(host.room.members.length,1);
    const returnedPeer=new Peer(), returned=rooms.connect(returnedPeer,'B',token);
    assert.notEqual(returned.id,offline.id); assert.equal(returned.room.host,returned.id);
    assert.equal(returnedPeer.messages.find(m=>m.type==='welcome').recoveryExpired,true);
    const expired=rooms.connect(new Peer(),'C'); rooms.join(expired,host.room.code); expired.expires=0;
    const replacement=rooms.connect(new Peer(),'C',expired.token);
    assert.equal(host.room.members.length,1,'connect itself cleans an expired seat before the sweep runs');
    assert.notEqual(replacement.id,expired.id);
  } finally {rooms.close();}
});

test('STUN binding answers with the sender address; ICE servers follow the page\'s service host',async () => {
  const request=Buffer.alloc(20); request.writeUInt16BE(1,0); request.writeUInt32BE(0x2112a442,4); request.fill(7,8,20);
  const response=bindingResponse(request,'192.168.1.20',50000)!;
  assert.equal(response.readUInt16BE(0),0x0101); assert.deepEqual([...response.subarray(8,20)],[...request.subarray(8,20)]);
  assert.equal(response.readUInt16BE(26)^0x2112,50000);
  assert.equal(((response.readUInt32BE(28)^0x2112a442)>>>0).toString(16),(0xc0a80114).toString(16));
  assert.equal(bindingResponse(Buffer.alloc(8),'1.2.3.4',1),null);
  assert.deepEqual(iceServersFor({ headers:{ host:'192.168.1.10:8080' } } as any,3478,''),[{ urls:'stun:192.168.1.10:3478' }]);
  assert.deepEqual(iceServersFor({ headers:{ host:'192.168.1.10:8080' } } as any,0,''),[]);
  const { app }=await createServer({ basePath:'/mp/test-cn',clientRoot:resolve('client'),stunPort:34999 });
  const client=createSocket('udp4');
  try {
    const reply=await new Promise<Buffer>((done,fail)=>{ client.once('message',done); client.once('error',fail); client.send(request,34999,'127.0.0.1'); });
    assert.equal(reply.readUInt16BE(0),0x0101);
  } finally { client.close(); await app.close(); }
});

test('real WebSocket: hello, join, roster, relayed signaling and deployment path; no gameplay messages exist',async () => {
  const {app}=await createServer({basePath:'/mp/test-cn',clientRoot:resolve('client')});
  await app.listen({host:'127.0.0.1',port:0});
  const address=app.server.address() as {port:number};
  const peers:WebSocket[]=[];
  async function connect() {
    const ws=new WebSocket(`ws://127.0.0.1:${address.port}/mp/test-cn/ws`); peers.push(ws);
    const messages:any[]=[];ws.on('message',raw=>messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
    ws.send(JSON.stringify({v:REGISTRY_VERSION,type:'hello',name:'Tester'}));return {ws,messages};
  }
  async function until(check:()=>boolean) { const end=Date.now()+2000;while(!check()){if(Date.now()>end)throw new Error('timeout');await new Promise(r=>setTimeout(r,10));} }
  try {
    assert.equal((await app.inject('/mp/test-cn/health')).json().registry,REGISTRY_VERSION);
    const host=await connect(),guest=await connect();await until(()=>host.messages.some(m=>m.type==='room')&&guest.messages.some(m=>m.type==='room'));
    const welcome=guest.messages.find(m=>m.type==='welcome'); assert.ok(welcome.session); assert.deepEqual(welcome.iceServers,[]);
    const code=host.messages.find(m=>m.type==='room').code, hostId=host.messages.find(m=>m.type==='welcome').playerId;
    guest.ws.send(JSON.stringify({v:REGISTRY_VERSION,type:'join',code}));await until(()=>guest.messages.some(m=>m.type==='room'&&m.code===code));
    guest.ws.send(JSON.stringify({v:REGISTRY_VERSION,type:'signal',to:hostId,data:{kind:'answer',session:welcome.session,link:'host:guest',sdp:'v=0'}}));
    await until(()=>host.messages.some(m=>m.type==='signal'&&m.data.kind==='answer'&&m.from===welcome.playerId));
    for (const type of ['input','start','snapshot']) guest.ws.send(JSON.stringify({v:REGISTRY_VERSION,type}));
    await until(()=>guest.messages.filter(m=>m.type==='error'&&m.code==='bad_request').length===3);
    guest.ws.send(JSON.stringify({v:3,type:'join',code}));await until(()=>guest.messages.some(m=>m.code==='protocol_mismatch'));
    assert.equal(host.messages.some(m=>m.type==='snapshot'),false,'the service never streams gameplay state');
  } finally { peers.forEach(ws=>ws.terminate());await app.close(); }
});

test('shutdown closes active WebSockets before HTTP close and the same port can restart',async () => {
  const {app,rooms}=await createServer({clientRoot:resolve('client')});
  await app.listen({host:'127.0.0.1',port:0});
  const port=(app.server.address() as {port:number}).port;
  const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`);
  let closing:Promise<void>|undefined, deadline:ReturnType<typeof setTimeout>|undefined;
  try {
    await new Promise<void>((done,fail)=>{ws.once('open',done);ws.once('error',fail);});
    const welcomed=new Promise<void>(done=>ws.once('message',()=>done()));
    ws.send(JSON.stringify({v:REGISTRY_VERSION,type:'hello',name:'Shutdown test'}));await welcomed;
    assert.equal(rooms.rooms.size,1);
    const closed=new Promise<void>(done=>ws.once('close',()=>done()));
    closing=app.close();
    await Promise.race([Promise.all([closing,closed]),new Promise((_,fail)=>{
      deadline=setTimeout(()=>fail(new Error('shutdown must not wait for players to disconnect')),1500);
    })]);
    clearTimeout(deadline);
    assert.equal(rooms.rooms.size,0);
    const replacement=await createServer({clientRoot:resolve('client')});
    try {
      await replacement.app.listen({host:'127.0.0.1',port});
      assert.equal((await replacement.app.inject('/health')).json().registry,REGISTRY_VERSION);
    } finally {await replacement.app.close();}
  } finally {clearTimeout(deadline);ws.terminate();await (closing||app.close());}
});

test('built modules have JavaScript MIME under root and deployment prefix',async () => {
  const clientRoot=await mkdtemp(join(tmpdir(),'wash-static-'));
  await writeFile(join(clientRoot,'index.html'),'<script type="module" src="./main.js"></script>');
  await writeFile(join(clientRoot,'main.js'),'export const ready=true;');
  const {app}=await createServer({clientRoot,basePath:'/mp/test-cn'});
  try {
    for (const prefix of ['', '/mp/test-cn']) {
      const page=await app.inject(`${prefix}/`);
      assert.equal(page.statusCode,200);
      assert.equal(page.headers['cache-control'],'no-store');
      const script=await app.inject(`${prefix}/main.js`);
      assert.equal(script.statusCode,200);
      assert.match(String(script.headers['content-type']),/javascript/);
      assert.equal(script.body,'export const ready=true;');
    }
    assert.equal((await app.inject('/favicon.ico')).statusCode,204);
  } finally { await app.close();await rm(clientRoot,{recursive:true,force:true}); }
});

test('host-only room mode: versus seats eight in two teams of four, co-op stays four',() => {
  const service=new Rooms();
  try {
    const players=Array.from({length:10},(_,i)=>service.connect(new Peer(),`P${i}`));
    const [host]=players, room=host.room, code=room.code;
    assert.equal(room.mode,'coop'); assert.equal(capacityFor('coop'),4); assert.equal(capacityFor('versus'),8); assert.equal(TEAM_CAPACITY,4);
    service.join(players[1],code);
    assert.throws(()=>service.setMode(players[1],'versus'),(e:any)=>e.code==='bad_request','only the host switches mode');
    assert.throws(()=>service.setMode(host,'arena'),(e:any)=>e.code==='bad_request');
    service.hostPhase(host,'game');
    assert.throws(()=>service.setMode(host,'versus'),(e:any)=>e.code==='room_started','mode changes only on the main menu');
    service.hostPhase(host,'home');
    service.setMode(host,'versus');
    assert.deepEqual([host.team,players[1].team],[0,1],'switching to versus balances current members by slot');
    for (const p of players.slice(2,8)) service.join(p,code);
    assert.equal(room.members.length,8);
    assert.deepEqual(room.members.map(m=>m.slot),[0,1,2,3,4,5,6,7]);
    assert.deepEqual([0,1].map(team=>room.members.filter(m=>m.team===team).length),[4,4],'joiners fill the smaller team');
    assert.throws(()=>service.join(players[8],code),(e:any)=>e.code==='room_full');
    const roster=(players[7].peer as Peer).messages.filter((m)=>m.type==='room').at(-1);
    assert.equal(roster.mode,'versus'); assert.deepEqual(roster.members.map((m:any)=>m.team),room.members.map(m=>m.team));
    assert.throws(()=>service.setTeam(players[2],1-(players[2].team as number)),(e:any)=>e.code==='team_full');
    assert.throws(()=>service.setMode(host,'coop'),(e:any)=>e.code==='too_many_for_coop');
    // Below the co-op limit the host may switch back; teams are cleared.
    for (const p of players.slice(4,8)) service.leave(p);
    const moving=room.members.find(m=>m.team===room.members.find(o=>o!==m)!.team)!;
    service.setTeam(moving,1-(moving.team as number));
    assert.throws(()=>service.setTeam(moving,2),(e:any)=>e.code==='bad_request');
    service.setMode(host,'coop');
    assert.equal(room.mode,'coop'); assert.ok(room.members.every(m=>m.team===null));
    assert.throws(()=>service.setTeam(players[1],0),(e:any)=>e.code==='bad_request','co-op rooms have no teams');
    assert.equal(room.members.length,4);
    assert.throws(()=>service.join(players[9],code),(e:any)=>e.code==='room_full','co-op stays at four seats');
    service.leave(players[3]); service.join(players[9],code);
    assert.equal(players[9].slot,3); assert.equal(players[9].team,null);
  } finally { service.close(); }
});
