/** Latency hygiene: held input across Wi-Fi stalls, matching prediction and a continuous render clock. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Simulation } from './fixtures/Simulation.js';
import { NetworkGame } from '../client/js/online/NetworkGame.js';
import { TICK_SECONDS } from '../shared/protocol.js';

test('held movement survives a 400 ms heartbeat stall but still expires when input truly stops',() => {
  const sim=new Simulation();
  try {
    sim.occupy(0,true);
    sim.input(0,{ seq:1,axis:[1,0],move:[1,0],down:[],hits:[] });
    for (let i=0;i<24;i++) sim.tick();
    assert.equal(sim.inputs[0].move[0],1,'one late Wi-Fi heartbeat does not stop the player on the authority');
    for (let i=0;i<60;i++) sim.tick();
    assert.equal(sim.inputs[0].move[0],0);
  } finally { sim.dispose(); }
});

test('a throttled camera turn is predicted with the direction the authority actually holds',() => {
  const server=new Simulation(), client=new Simulation();
  const connection: any=new EventTarget(); connection.room={ slot:0 }; connection.connected=true; connection.playing=true; connection.inputTimeline=true;
  let held: number[]=[], unsent=0;
  connection.send=(_type: string,input: any) => { held=[...input.move]; server.input(0,input); return true; };
  let tick=0;
  // The world forward vector rotates every tick, as when the camera follows a turning truck.
  const camera: any={ getWorldDirection:(v: THREE.Vector3) => v.set(Math.sin(tick*0.02),0,-Math.cos(tick*0.02)) };
  const network=new NetworkGame({ connection,players:client.players,trucks:client.trucks,game:client.game,camera,
    input:{ clear(){},hit(){ return false; },down(){ return false; },axis(){ return { x:0,y:1 }; } },onPhase(){} });
  try {
    server.occupy(0,true); network.receive(server.snapshot());
    for (tick=1;tick<=90;tick++) {
      const before=network.seq;
      network.step(TICK_SECONDS,server.time); server.tick();
      const predicted=network.pending.at(-1);
      assert.equal(predicted.seq,before+1);
      if (server.acks[0]!==predicted.seq) { unsent++; assert.deepEqual(predicted.move,held,`tick ${tick} predicts the held authority direction`); }
      assert.deepEqual(server.inputs[0].move,predicted.move,`tick ${tick} server and prediction use the same direction`);
      if (tick%3===0) network.receive(server.snapshot());
    }
    assert.ok(unsent>30,'the camera turn was throttled on most ticks');
  } finally { server.dispose(); client.dispose(); }
});

test('the render clock keeps moving through a 180 ms snapshot gap and does not jump when the burst arrives',() => {
  const network: any=Object.create(NetworkGame.prototype);
  Object.assign(network,{ game:{ paused:false },renderTime:0,renderScroll:0,clockReset:true,
    window:{ start:Infinity,count:0,gap:0,correction:0,ack:[] },stats:{} });
  let now=0; const realNow=performance.now; (performance as any).now=() => now;
  try {
    const at=(time: number) => ({ time,scroll:time*30,base:30 });
    network.latest=at(1); network.received=0; network.present(1/60);
    let previous=network.renderTime, maxStep=0;
    const frame=() => { now+=1000/60; network.present(1/60); maxStep=Math.max(maxStep,network.renderTime-previous); assert.ok(network.renderTime>previous); previous=network.renderTime; };
    for (let i=0;i<11;i++) frame(); // ~180 ms without any snapshot
    assert.ok(network.renderTime>1.17,'the world kept advancing instead of freezing after 50 ms');
    network.latest=at(1.18); network.received=now; // late snapshots arrive together
    for (let i=0;i<30;i++) { if (i%3===0) { network.latest=at(network.latest.time+0.05); network.received=now; } frame(); }
    assert.ok(maxStep<0.03,`per-frame clock step stayed smooth (max ${maxStep})`);
    network.clockReset=true; network.latest=at(20); network.received=now; network.present(1/60);
    assert.equal(network.renderTime,20,'a scene or epoch change snaps immediately');
  } finally { (performance as any).now=realNow; }
});

/** A delayed room: inputs reach the authority and snapshots reach the client `lag` ticks late, rendered at 60 FPS. */
function delayedRoom(lag: number, axis: (tick: number) => { x: number; y: number }, jump: (tick: number) => boolean = () => false) {
  const server=new Simulation(), client=new Simulation();
  const connection: any=new EventTarget(); connection.room={ slot:0 }; connection.connected=true; connection.playing=true; connection.inputTimeline=true;
  const upload: any[]=[], download: { at: number; data: any }[]=[];
  connection.send=(_type: string,input: any) => { upload.push(input); return true; };
  let tick=0;
  const network=new NetworkGame({ connection,players:client.players,trucks:client.trucks,game:client.game,camera:new THREE.PerspectiveCamera(),
    input:{ clear(){},hit:(key: string) => key==='Space' && jump(tick),down:(key: string) => key==='Space' && jump(tick),axis:() => axis(tick) },onPhase(){} });
  server.occupy(0,true); for (let i=0;i<120;i++) server.tick();
  network.receive(server.snapshot());
  return { server,client,network,
    frame() {
      tick++; network.step(TICK_SECONDS,server.time);
      // Pair the drawn position with its state before the next authority snapshot is applied.
      const rendered=client.players[0].root.position.clone(), state=client.players[0].state, truck=client.trucks[0];
      const onRoof=rendered.clone().sub(truck.pos); onRoof.y-=truck.body.position.y;
      while (upload.length && upload[0].seq<=tick-lag) server.input(0,upload.shift());
      server.tick();
      if (tick%3===0) download.push({ at:tick+lag,data:server.snapshot() });
      while (download.length && download[0].at<=tick) network.receive(download.shift()!.data);
      return { rendered,onRoof,state };
    },
    dispose() { server.dispose(); client.dispose(); } };
}

test('standing on a bobbing, lane-changing truck needs no vertical correction: prediction uses authority-timed platforms',() => {
  seeded(() => {
    const room=delayedRoom(0,(tick) => ({ x:0.4*Math.sin(tick*0.05),y:0.4*Math.cos(tick*0.05) }));
    try {
      for (let i=0;i<600;i++) assert.equal(room.frame().state,'ground');
      assert.ok(room.network.window.correction<0.005,`largest correction ${room.network.window.correction} m`);
    } finally { room.dispose(); }
  });
});

/** Truck lane changes are random; seed them so drift bounds are deterministic. */
function seeded<T>(run: () => T): T {
  const random=Math.random; let state=12345;
  Math.random=() => ((state=(state*1103515245+12345)%2147483648)/2147483648);
  try { return run(); } finally { Math.random=random; }
}

for (const [lag,limit] of [[2,0.02],[6,0.1]]) test(`an idle local player stays put on the drawn roof with ${lag} ticks each way (was ~${lag===2?21:49} cm)`,() => seeded(() => {
  const now=performance.now; let clock=0; (performance as any).now=() => clock;
  const room=delayedRoom(lag,() => ({ x:0,y:0 }));
  try {
    let first: THREE.Vector3 | null=null, drift=0;
    for (let i=0;i<900;i++) {
      clock+=1000/60; const { onRoof }=room.frame();
      if (i<120) continue;
      first??=onRoof; drift=Math.max(drift,onRoof.distanceTo(first));
    }
    assert.ok(drift<limit,`drawn player slid ${drift} m on the drawn roof`);
  } finally { (performance as any).now=now; room.dispose(); }
}));

test('jumping off and landing on trucks moves the drawn player continuously, without a platform-glue pop',() => seeded(() => {
  const now=performance.now; let clock=0; (performance as any).now=() => clock;
  const room=delayedRoom(6,(tick) => ({ x:0.3*Math.sin(tick*0.02),y:0.3*Math.cos(tick*0.013) }),(tick) => tick%45===0);
  try {
    let previous: { rendered: THREE.Vector3; state: string } | null=null, largest=0;
    const states=new Set<string>();
    for (let i=0;i<900;i++) {
      clock+=1000/60; const current=room.frame(); states.add(current.state);
      // A fall respawn is an intentional teleport.
      if (previous && current.state!=='fallen' && previous.state!=='fallen') largest=Math.max(largest,current.rendered.distanceTo(previous.rendered));
      previous=current;
    }
    assert.ok(states.has('air') && states.has('ground'));
    assert.ok(largest<0.4,`largest per-frame step ${largest} m`);
  } finally { (performance as any).now=now; room.dispose(); }
}));
