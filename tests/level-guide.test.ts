import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from './fixtures/Simulation.js';
import { GUIDE_CLOSE_SECONDS } from '../shared/sim/LevelGuide.js';
import { getLevel, SAVE_VERSION } from './fixtures/levels.js';
import { roundCue } from '../shared/sim/roundFlow.js';
import { validGuideReady, VERSION } from '../shared/protocol.js';
import { applyWorld } from '../shared/snapshot.js';
import { room, rosterOf } from './helpers/peerRoom.js';
import { RoomConnection } from '../client/js/online/RoomConnection.js';

function entered(sim: Simulation) { sim.command('start'); while (sim.phase !== 'game') sim.tick(); }

test('tutorial camera entry leads to a frozen guide; button inputs never confirm or leak into gameplay', () => {
  const sim = new Simulation();
  try {
    sim.occupy(0, true); sim.occupy(2, true); entered(sim);
    const g = sim.game, before = sim.snapshot(), signature = sim.urgentSignature();
    assert.equal(g.roundStage, 'guide'); assert.equal(roundCue(g), '');
    assert.deepEqual(g.guide.capture(), { id:'basic-controls', pageIndex:0, pageCount:1, participants:5, ready:0, closeTime:0, elapsed:0, timeout:0 });
    for (let seq = 1; seq <= 360; seq++) {
      sim.input(0, { seq, move:[1,0], axis:[1,0], down:['KeyJ','KeyK','KeyL','Space'], hits:['KeyJ','KeyK','KeyL','Space'] }); sim.tick();
    }
    assert.equal(g.roundStage, 'guide'); assert.equal(g.elapsed, 0); assert.equal(g.remaining, 180);
    assert.equal(g.roundStageTime, 0); assert.equal(g.orders.length, 0); assert.equal(g.lanes.length, 0);
    assert.equal(g.guide.ready, 0); assert.equal(g.score, 0); assert.equal(g.wet.liveRevision, 0);
    const frozen = sim.snapshot();
    assert.equal(frozen.time,before.time); assert.equal(frozen.scroll,before.scroll);
    assert.deepEqual(frozen.trucks,before.trucks,'road scroll and vehicle bobbing freeze for the entire reading interval');
    assert.ok(frozen.tick > before.tick,'authority transport continues accepting confirmations while the world freezes');
    assert.deepEqual(sim.players.map(p => p.pos.toArray()), before.players.map((p: any) => p.pos));
    assert.equal(sim.confirmGuide(1, 'basic-controls'), false); assert.equal(sim.confirmGuide(0, 'other'), false);
    assert.equal(sim.confirmGuide(0, 'basic-controls'), true); assert.equal(g.guide.ready, 1);
    assert.notEqual(sim.urgentSignature(), signature);
    for (let i = 0; i < 90; i++) sim.tick(); assert.equal(g.roundStage, 'guide');
    sim.confirmGuide(2, 'basic-controls');
    for (let i = 0; i < Math.round(GUIDE_CLOSE_SECONDS * 60) - 1; i++) sim.tick();
    assert.equal(g.roundStage, 'guide'); assert.equal(g.guide.ready, 5); assert.equal(g.elapsed, 0);
    sim.tick(); assert.equal(g.roundStage, 'ready'); assert.equal(roundCue(g), 'ready-3'); assert.equal(g.roundStageTime, 0);
    assert.equal(sim.time,before.time); sim.tick(); assert.ok(sim.time > before.time,'Ready resumes the world after every reader confirms');
    while (g.roundStage === 'ready') sim.tick();
    assert.equal(roundCue(g), 'go'); assert.ok(sim.players.every(p => !p.heldTool));
    assert.deepEqual(sim.players.map(p => [p.pos.x,p.pos.z]), before.players.map((p: any) => [p.pos[0],p.pos[2]]));
  } finally { sim.dispose(); }
});

test('four peers confirm on reliable control; spoofed slots, stale rounds/epochs and malformed acknowledgements are rejected', () => {
  const r = room(['a','b','c'], {autoGuide:false}), viewer = new Simulation();
  try {
    r.host.command('start'); while (r.host.sim.phase !== 'game') r.advance();
    const frame = {type:'guide_ready', epoch:r.host.epoch, roundId:r.host.roundId!, guideId:'basic-controls',pageIndex:0};
    const guide = r.host.sim.game.guide;
    assert.equal(guide.participants, 15); assert.equal(guide.ready, 0);
    for (const bad of [{...frame, epoch:frame.epoch-1}, {...frame,roundId:'old'}, {...frame,guideId:'other'}, {...frame,epoch:NaN}, {...frame,roundId:7}]) r.guests[0].guest.sendControl(bad);
    assert.equal(guide.ready, 0);
    r.guests[0].guest.sendControl({...frame,slot:0}); r.guests[0].guest.sendControl(frame);
    assert.equal(guide.ready, 2, 'link identity binds slot 1; duplicate acknowledgements are idempotent');
    r.advance();
    for (const guest of r.guests) {
      const snapshot = guest.received.at(-1); assert.equal(snapshot.tick, r.host.sim.tickCount);
      assert.deepEqual(snapshot.game.guide.ready, 2);
      applyWorld({game:viewer.game,trucks:viewer.trucks,players:viewer.players},snapshot);
      assert.equal(viewer.game.guide.ready, 2); assert.equal(viewer.game.roundStage, 'guide');
    }
    r.host.guideReady(0,frame); r.guests[1].guest.sendControl(frame);
    for (let i = 0; i < 30; i++) r.advance(); assert.equal(r.host.sim.game.roundStage, 'guide');
    // Exercise urgent *deltas*: the decoder reports its baseline every received snapshot.
    r.guests[2].guest.sendControl(frame); r.advance();
    assert.ok(r.guests.every(g => g.received.at(-1).game.guide.ready === 15));
    while (r.host.sim.game.roundStage === 'guide') r.advance();
    assert.ok(r.guests.every(g => g.received.at(-1).game.roundStage === 'ready'));
    r.host.command('home'); r.host.command('start'); while (r.host.sim.phase !== 'game') r.advance();
    r.guests[0].guest.sendControl(frame); assert.equal(r.host.sim.game.guide.ready,0,'previous round cannot prepare a new run');
    assert.equal(SAVE_VERSION,'0.5'); assert.equal(VERSION, 42);
  } finally { r.dispose(); viewer.dispose(); }
});

test('departed or broken-link players do not hold the barrier; returning slots must confirm again', () => {
  const r = room(['a','b'], {autoGuide:false});
  try {
    r.host.command('start'); while (r.host.sim.phase !== 'game') r.advance();
    const frame = {type:'guide_ready',epoch:r.host.epoch,roundId:r.host.roundId!,guideId:'basic-controls',pageIndex:0};
    r.guests[0].guest.sendControl(frame); assert.equal(r.host.sim.game.guide.ready, 2);
    // Roster reserves a seat during refresh, but the closed direct link is no longer a reader.
    r.guests[0].hostLink.close(); r.advance(); assert.equal(r.host.sim.game.guide.participants, 5);
    assert.equal(r.host.sim.game.guide.ready, 0);
    r.host.setRoster(rosterOf(r.members.map(m => m.id === 'a' ? {...m,connected:false} : m)));
    r.host.guideReady(0,frame); r.guests[1].guest.sendControl(frame);
    while (r.host.sim.game.roundStage === 'guide') r.advance();
    assert.equal(r.host.sim.game.roundStage, 'ready');
  } finally { r.dispose(); }
  const sim = new Simulation();
  try {
    sim.occupy(0,true); sim.occupy(1,true); entered(sim); sim.confirmGuide(1,'basic-controls');
    sim.occupy(1,false); sim.tick(); sim.occupy(1,true); sim.tick();
    assert.equal(sim.game.guide.participants,3); assert.equal(sim.game.guide.ready,0);
    sim.confirmGuide(1,'basic-controls'); sim.occupy(1,false); sim.occupy(1,true);
    assert.equal(sim.game.guide.ready,0,'a new occupant cannot inherit readiness even within one authority tick');
    sim.confirmGuide(0,'basic-controls'); for(let i=0;i<60;i++)sim.tick(); assert.equal(sim.game.roundStage,'guide');
    sim.command('home'); assert.equal(sim.game.guide.id,null); assert.equal(sim.game.guide.ready,0);
  } finally { sim.dispose(); }
});

test('later levels skip guides; pause freezes the release clock and save semantics stay unchanged', () => {
  const next = new Simulation(getLevel('highway-02')!), sim = new Simulation();
  try {
    next.occupy(0,true); entered(next); assert.equal(next.game.roundStage,'ready'); assert.equal(next.game.guide.id,null);
    sim.occupy(0,true); entered(sim); sim.confirmGuide(0,'basic-controls'); sim.command('pause',true);
    for(let i=0;i<60;i++)sim.tick(); assert.equal(sim.game.guide.closeTime,0); assert.equal(sim.game.remaining,180);
    sim.command('pause',false); for(let i=0;i<15;i++)sim.tick(); assert.equal(sim.game.roundStage,'ready');
    assert.equal(SAVE_VERSION,'0.5');
  } finally { next.dispose(); sim.dispose(); }
});

test('solo confirmation stays local, never reaches the registry; validation requires a bounded current round scope', async () => {
  (globalThis as any).WebSocket ??= {OPEN:1};
  const connection:any = new RoomConnection(), sent:any[] = [];
  connection.socket={readyState:1,send:(raw:string)=>sent.push(JSON.parse(raw))}; connection.connected=true;
  try {
    connection.setRoster(rosterOf([{id:'host',name:'host',slot:0,session:'s',connected:true}]));
    connection.send('start',{levelId:'highway-02'}); await Promise.resolve(); while(connection.authority.sim.phase!=='game')connection.advanceLocal();
    const count=sent.length; assert.equal(connection.confirmGuide('tools-water',1),false);
    assert.equal(connection.confirmGuide('tools-water',0),true);
    for(let i=0;i<15;i++)connection.advanceLocal();
    assert.equal(connection.confirmGuide('tools-water',1),false,'retired second page cannot confirm after single-page release');
    for(let i=0;i<15;i++)connection.advanceLocal(); assert.equal(sent.length,count);
    assert.equal(connection.authority.sim.game.roundStage,'ready'); assert.equal(sent.some(f=>f.type==='guide_ready'),false);
    assert.equal(validGuideReady({epoch:1,roundId:'r',guideId:'g',pageIndex:0}),true);
    for(const frame of [null,{}, {epoch:0,roundId:'r',guideId:'g'}, {epoch:1,roundId:'x'.repeat(65),guideId:'g'}]) assert.equal(validGuideReady(frame),false);
  } finally { connection.authority?.dispose(); }
});

test('versus terminal guide: before the countdown, eight seats, bots never read it, closes on everyone J or after 15 s', async () => {
  const { getLevel } = await import('../shared/levels.js');
  const { HACK } = await import('../shared/sim/HackConsole.js');
  const { Simulation: Room } = await import('../shared/sim/RoomSimulation.js');
  assert.equal(HACK.seconds, 4.8, 'hacking about 20% faster');
  const run = (aiSeats: number[], humans: number[]) => {
    const sim: any = new Room(getLevel('versus-01') as any);
    for (const slot of humans) { sim.occupy(slot, true); sim.setTeam(slot, slot % 2); }
    sim.placeBots(aiSeats.map(slot => ({ slot, team: slot % 2 })));
    sim.command('start');
    for (let i = 0; i < 60 * 12 && sim.game.roundStage !== 'guide'; i++) sim.tick();
    return sim;
  };
  const sim = run([2, 3, 4, 5, 6, 7], [0, 1]);
  try {
    const g = sim.game;
    assert.equal(g.roundStage, 'guide'); assert.equal(g.guide.id, 'versus-terminal');
    assert.equal(g.guide.participants, 0b11, 'only the two humans read; the six bots do not');
    assert.ok(sim.confirmGuide(1, 'versus-terminal', 0));
    for (let i = 0; i < 60 * 14 && g.roundStage === 'guide'; i++) sim.tick();
    assert.equal(g.roundStage, 'guide', 'still waiting on slot 0 before 15 s');
    for (let i = 0; i < 60 * 2 && g.roundStage === 'guide'; i++) sim.tick();
    assert.equal(g.roundStage, 'ready', 'closed by itself after 15 s');
  } finally { sim.dispose(); }
  const eight = run([], [0, 1, 2, 3, 4, 5, 6, 7]);
  try {
    const g = eight.game;
    assert.equal(g.guide.participants, 0xff);
    for (let slot = 0; slot < 8; slot++) assert.ok(eight.confirmGuide(slot, 'versus-terminal', 0), `slot ${slot} confirms`);
    for (let i = 0; i < 30 && g.roundStage === 'guide'; i++) eight.tick();
    assert.equal(g.roundStage, 'ready', 'everyone pressed J: closes at once');
  } finally { eight.dispose(); }
});
