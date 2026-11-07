/** Real authority/prediction checks for change-driven transport and the negotiated legacy boundary. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { InputTransmitter } from '../shared/InputTransmitter.js';
import { ACTIONS, VERSION, validInput, TICK_SECONDS } from '../shared/protocol.js';
import { Simulation } from './fixtures/Simulation.js';
import { NetworkGame } from '../client/js/online/NetworkGame.js';
import { LocalInput } from '../client/js/game/LocalInput.js';

const packet=(seq:number,axis=[0,0],down:string[]=[],hits:string[]=[])=>({seq,axis,move:axis,down,hits});
test('idle and steady movement send four keepalives per second, while button/axis changes send immediately',()=>{
  for(const axis of [[0,0],[1,0]]) {
    const sender=new InputTransmitter();let sent=0;
    for(let tick=1;tick<=600;tick++)if(sender.shouldSend(packet(tick,axis),tick/60))sent++;
    assert.equal(sent,40);
  }
  const sender=new InputTransmitter();
  assert.equal(sender.shouldSend(packet(1),1/60),true);
  assert.equal(sender.shouldSend(packet(2,[1,0]),2/60),true);
  assert.equal(sender.shouldSend(packet(3,[1,0],['KeyK'],['KeyK']),3/60),true);
  assert.equal(sender.shouldSend(packet(4,[1,0],['KeyK','Space'],['Space']),4/60),true);
  assert.equal(sender.shouldSend(packet(5,[1,0],[]),5/60),true);
  assert.equal(sender.shouldSend(packet(6,[1,0],['KeyJ'],['KeyJ']),6/60),true);
});
test('camera direction changes are bounded to twenty refreshes per second without delaying keyboard edges',()=>{
  const sender=new InputTransmitter();let sent=0;
  for(let tick=1;tick<=60;tick++) {
    const input=packet(tick,[1,0]);input.move=[Math.cos(tick*.001),Math.sin(tick*.001)];
    if(sender.shouldSend(input,tick/60))sent++;
  }
  assert.ok(sent<=20);
  assert.equal(sender.shouldSend(packet(61,[-1,0]),61/60),true);
});
test('sparse transport retains sixty-Hz authority and prediction without replaying an entire held-input interval',()=>{
  {
    const server=new Simulation(),client=new Simulation();
    const connection:any=new EventTarget();connection.room={slot:0};connection.connected=true; connection.playing=true;
    let sent=0;connection.send=(_type:string,input:any)=>{sent++;server.input(0,input);return true;};
    const network=new NetworkGame({connection,players:client.players,trucks:client.trucks,game:client.game,
      input:{clear(){},hit(){return false;},down(){return false;},axis(){return {x:1,y:0};}},camera:new THREE.PerspectiveCamera(),onPhase(){}});
    try {
      server.occupy(0,true);network.receive(server.snapshot());
      for(let i=1;i<=60;i++) {
        network.step(TICK_SECONDS,server.time);server.tick();
        if(i%3===0){network.receive(server.snapshot());assert.ok(network.pending.length<=3);}
      }
      assert.equal(sent,4,'protocol 5 always sends on change plus heartbeat');
      assert.equal(server.snapshot().players[0].ackTick,60);
      assert.equal(network.pending.length,0);
      assert.ok(client.players[0].pos.distanceTo(server.players[0].pos)<1e-8);
      server.resetInputs();assert.equal(server.ackTicks[0],0);assert.equal(server.inputs[0].seq,0);
    } finally {server.dispose();client.dispose();}
  }
});
test('timeline samples are validated and virtual prediction confirmation never rejects a later real command',()=>{
  assert.equal(validInput(packet(1)),true);assert.equal(validInput(packet(0)),false);assert.equal(validInput({...packet(1),move:[2,0]}),false);
  const sim=new Simulation();try {
    sim.occupy(0,true);sim.input(0,packet(1));for(let i=0;i<12;i++)sim.tick();
    assert.equal(sim.acks[0],1);assert.equal(sim.ackTicks[0],12);
    sim.input(0,packet(8,[1,0]));sim.tick();
    assert.equal(sim.acks[0],8,'validation uses the received sequence, not extrapolated client time');
    assert.equal(sim.ackTicks[0],8);
  } finally {sim.dispose();}
});

test('protocol 14 accepts J/K/L and rejects every retired gameplay key', () => {
  assert.equal(VERSION, 42);
  assert.deepEqual(ACTIONS, ['Space', 'KeyJ', 'KeyK', 'KeyL']);
  assert.equal(validInput(packet(1, [1, 0], [...ACTIONS], [...ACTIONS])), true);
  for (const key of ['KeyE', 'KeyG', 'KeyQ', 'ShiftLeft', 'ShiftRight']) {
    assert.equal(validInput(packet(1, [0, 0], [key])), false, `${key} down is rejected`);
    assert.equal(validInput(packet(1, [0, 0], [], [key])), false, `${key} edge is rejected`);
  }
});

test('gamepad keeps jump/interact/throw/ability buttons and retires the dash button', () => {
  const source = { enabled: true, hit: () => false, down: () => false, axis: () => ({ x: 1, y: 0 }), clear() {} };
  const input = new LocalInput(source);
  for (const [key, button] of [['Space', 0], ['KeyJ', 2], ['KeyK', 1], ['KeyL', 4]] as const) {
    input.buttons = []; input.previous = []; input.buttons[button] = true;
    assert.equal(input.hit(key), true); assert.equal(input.down(key), true);
    assert.deepEqual(input.axis(), { x: 1, y: 0 }, 'actions do not block simultaneous movement');
    input.endFrame(); assert.equal(input.hit(key), false, 'held button has no second edge');
  }
  input.buttons = []; input.previous = []; input.buttons[3] = true;
  for (const key of [...ACTIONS, 'ShiftLeft', 'ShiftRight']) assert.equal(input.hit(key), false);
  source.enabled = false; input.buttons[2] = true;
  assert.equal(input.hit('KeyJ'), false); assert.deepEqual(input.axis(), { x: 0, y: 0 });
});

test('network samples J/K/L with movement, ignores old keys and preserves valid blocked packets', () => {
  const sim = new Simulation(), sent: any[] = [];
  const pressed = new Set<string>();
  const connection: any = new EventTarget(); connection.room = { slot: 0 }; connection.playing = true;
  connection.send = (_type: string, input: any) => { sent.push(input); return true; };
  const network = new NetworkGame({ connection, players: sim.players, trucks: sim.trucks, game: sim.game,
    input: { clear() {}, hit: (key: string) => pressed.has(key), down: (key: string) => pressed.has(key), axis: () => ({ x: 1, y: 0 }) },
    camera: new THREE.PerspectiveCamera(), onPhase() {} });
  try {
    sim.occupy(0, true); network.receive(sim.snapshot());
    for (const key of ['KeyJ', 'KeyK', 'KeyL']) {
      pressed.clear(); pressed.add(key); pressed.add('ShiftRight'); pressed.add('KeyE');
      network.step(TICK_SECONDS, sim.time);
      const latest = sent.at(-1);
      assert.equal(validInput(latest), true);
      assert.deepEqual(latest.down, [key]); assert.deepEqual(latest.hits, [key]);
      assert.deepEqual(latest.axis, [1, 0]); assert.equal(Math.hypot(...latest.move), 1);
    }
    sim.game.paused = true; network.step(TICK_SECONDS, sim.time);
    const blocked = sent.at(-1);
    assert.equal(validInput(blocked), true);
    assert.deepEqual(blocked.move, [0, 0]); assert.deepEqual(blocked.down, []); assert.deepEqual(blocked.hits, []);
  } finally { sim.dispose(); }
});
