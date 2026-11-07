import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../shared/sim/RoomSimulation.js';
import { LEVELS, getLevel, SAVE_VERSION, validRoundResult } from '../shared/levels.js';
import { applyWorld } from '../shared/snapshot.js';
import { quantize, SnapshotEncoder, SnapshotDecoder } from '../shared/delta.js';
import { evaluateLevel } from '../shared/sim/LevelRating.js';
import { validateLevelScript } from '../shared/sim/LevelScript.js';
import { validateLevelSet } from '../shared/sim/LevelValidation.js';
import { order } from '../shared/levels/authoring.js';
import { room } from './helpers/peerRoom.js';
import { confirmGuide } from './helpers/guide.js';
import { LevelEvents, registerLevelEvent } from '../shared/sim/LevelEvents.js';
import { registerVehicleBehavior } from '../shared/sim/VehicleBehaviors.js';
import { roadSignDefinitions, ROAD_SIGN } from '../shared/sim/RoadSigns.js';
import { RoadSignView } from '../client/js/world/RoadSignView.js';

function start(id = 'highway-01', count = 1) {
  const sim = new Simulation(getLevel(id)!);
  for (let i = 0; i < count; i++) sim.occupy(i, true);
  sim.phase = 'game'; sim.game.start(sim.director.base);
  // Keep each tutorial learner's first walking steps clear of the other solid bodies.
  for (let i = 0; i < count; i++) place(sim, i, sim.trucks[0], -2 + i * 1.3, 0);
  return sim;
}
function place(sim: Simulation, slot: number, truck: any, x: number, z: number) {
  const p = sim.players[slot]; p.pos.set(truck.pos.x + x, truck.topY, truck.pos.z + z);
  p.state = 'ground'; p.ground = { truck, plat: truck.platformAt(p.pos.x, p.pos.z, .1) };
  p.vel.set(0, 0, 0); p.externalVelocity.set(0, 0, 0); p.root.position.copy(p.pos);
}
function ticks(sim: Simulation, n: number) { for (let i = 0; i < n; i++) sim.tick(); }
function move(sim: Simulation, count: number) {
  for (let n = 1; n <= 8; n++) { // past the tutorial's move distance at the scaled walk speed
    // Sideways along the deck: the new washer's box face is right in front of the low-deck spawn.
    for (let slot = 0; slot < count; slot++) sim.input(slot, { seq: n, axis: [1, 0], move: [0, 1], down: [], hits: [] });
    sim.tick();
  }
  sim.resetInputs();
}
function dock(sim: Simulation) {
  for (let i = 0; !sim.game.orders.length && i < 400; i++) sim.tick();
  assert.ok(sim.game.orders.length);
  sim.game.lanes.forEach((lane: any) => { lane.x = sim.game.orderX(); }); sim.tick();
}
function complete(sim: Simulation, o: any) {
  for (const s of o.stains) { s.stage = s.steps.length; s.done = true; }
  sim.game.completeOrder(o);
}

test('all five production levels validate, author exact dirt and clocks, and only 05 schedules the six signs', () => {
  assert.equal(LEVELS.length, 5); LEVELS.forEach(validateLevelScript);
  assert.deepEqual(LEVELS.map(l => l.clock.duration), [0, 120, 120, 120, 180]);
  assert.deepEqual(LEVELS.map(l => l.script.orders.length), [1, 6, 6, 8, 14]);
  assert.equal(LEVELS[0].guide, null); assert.equal(LEVELS[0].roadSigns.length, 0);
  assert.deepEqual(roadSignDefinitions(LEVELS[4]).map((s: { atMinutes?: number }) => s.atMinutes! * 60), [18, 45, 72, 99, 126, 153]);
  for (const o of LEVELS[1].script.orders) {
    assert.equal(o.stains.length, ['pod', 'sedan'].includes(o.type) ? 2 : 3);
    if (!['pod', 'sedan'].includes(o.type)) assert.ok(o.stains.some((s: any) => s.kind === 'mud'));
    assert.equal(o.patience.multiplier, 1.4);
  }
  for (const o of LEVELS[2].script.orders) if (!['pod', 'sedan'].includes(o.type)) assert.equal(o.stains.filter((s: any) => s.kind === 'grease').length, 1);
  assert.ok(Object.isFrozen(LEVELS[0].script.orders));
  const bad: any = structuredClone(LEVELS[1]); bad.script.orders[0].stains[0].position = [999, 0]; assert.throws(() => validateLevelScript(bad));
});

test('authoring rejects malformed fields, unavailable tools and schedules before allocating a world', () => {
  const cases: [string, (level: any) => void][] = [
    ['script.events', l => { l.script.events = {}; }],
    ['rating.mode', l => { l.rating = null; }],
    ['guide', l => { l.guide = 'unknown'; }],
    ['orders.vehicles[0]', l => { l.orders.vehicles[0].capacity = 0; }],
    ['script.orders[0].patience', l => { l.script.orders[0].patience = null; }],
    ['script.orders[1].at', l => { l.script.orders[1].at = 1; }],
    ['script.orders[0].at', l => { l.script.orders[0].at = 120; }],
    ['script.orders[0].at', l => { delete l.script.orders[0].at; }],
    ['script.orders[1].stains', l => { l.unlockedEquipment = ['towel', 'station']; }],
    ['equipment.water', l => { l.equipment.waterguns = []; }],
    ['script.steps[0].condition.distance', l => { l.script.steps = [{ id: 'bad', text: 'move', condition: { type: 'moved', distance: -1 } }]; }],
    ['script.steps[0]', l => { l.script.steps = [{ id: 'bad', text: 'move', hold: NaN, condition: { type: 'home' } }]; }],
    ['script.steps[0].enter', l => { l.script.steps = [{ id: 'bad', text: 'move', enter: {}, condition: { type: 'home' } }]; }],
    ['script.steps[0].enter[0]', l => { l.script.steps = [{ id: 'bad', text: 'move', enter: [null], condition: { type: 'home' } }]; }],
    ['script.events[0]', l => { l.script.events = [{ id: 'bad', type: 'roadSign', at: 0, duration: .8, params: { side: 1 } }]; }],
    ['roadSigns', l => { l.roadSigns = [{ id: 'duplicate-source', side: 1, atMinutes: 1 }]; }],
  ];
  for (const [path, mutate] of cases) {
    const level: any = structuredClone(getLevel('highway-02')); mutate(level);
    assert.throws(() => validateLevelScript(level), (error: any) => error instanceof Error && error.message.includes(`[highway-02] ${path}:`), path);
  }
  assert.throws(() => registerLevelEvent('invalid-callbacks', { validate: true, start() {}, update() {}, stop() {} } as any), /Invalid event rule/);
  const changed: any = structuredClone(getLevel('highway-03')); changed.equipment.chargers[0].position[0]++;
  assert.throws(() => validateLevelSet([getLevel('highway-02'), changed]), /highway-03.*equipment: new assets/);
  assert.throws(() => validateLevelSet([getLevel('highway-02'), getLevel('highway-02')]), /duplicate level id/);
});

test('scripted signs share warning, invocation, stop, collisions and keyframe/delta state with guests', () => {
  const level: any = structuredClone(getLevel('highway-05'));
  level.script.orders = []; level.script.events = [
    { id: 'timed', type: 'roadSign', at: 16, duration: 2.8, params: { side: -1 } },
    { id: 'manual', type: 'roadSign', duration: 2.8, params: { side: 1 } },
  ]; validateLevelScript(level);
  const host = new Simulation(level), peer = new Simulation(level), view = new RoadSignView(peer.scene, [], level.road);
  const encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder();
  const sync = () => {
    host.tickCount++; // Each published revision has a monotonic transport tick.
    const state = quantize(host.snapshot());
    const decoded = decoder.decode(encoder.encode(state, 'event-audit'))!;
    applyWorld({ game: peer.game, players: peer.players, trucks: peer.trucks }, decoded);
    encoder.ack(state.tick); peer.game.viewOnly = true;
    assert.deepEqual(peer.game.roadSigns.entries(), host.game.roadSigns.entries());
  };
  try {
    host.occupy(0, true); host.occupy(1, true); host.phase = 'game'; host.game.start(30); confirmGuide(host);
    const game = host.game, events = game.levelScript.events;
    game.elapsed = 16; events.update(1/60); sync();
    assert.equal(events.active[0].state.launchAt, 18); assert.equal(peer.game.roadSigns.entries().length, 1);
    const signature = host.urgentSignature(); events.stop('timed'); assert.notEqual(host.urgentSignature(), signature);
    game.elapsed = 18.4; sync(); view.update(peer.game); assert.equal(view.root.visible, false);
    place(host, 0, game.homeTruck, 0, -level.road.laneWidth);
    game.roadSigns.update(1/60, host.players.map(p => p.pos.clone())); assert.equal(host.players[0].state, 'ground', 'stopped event cannot collide');
    game.elapsed = 22; events.trigger('manual'); sync(); view.update(peer.game); assert.equal(view.root.visible, false);
    assert.equal(game.roadSigns.entries()[0].atMinutes, .4, 'manual invocation grants the complete two-second warning');
    place(host, 0, game.homeTruck, 0, level.road.laneWidth); place(host, 1, game.homeTruck, .2, level.road.laneWidth);
    game.elapsed = 24 + ROAD_SIGN.startX / ROAD_SIGN.speed - 1/120;
    game.roadSigns.update(1/60, host.players.map(p => p.pos.clone()));
    assert.equal(game.roadSigns.hits[1], 3, 'both players are hit once by the same authority event');
    host.tick(); sync(); view.update(peer.game); assert.equal(view.root.visible, true);
    assert.deepEqual(peer.game.roadSigns.capture(), game.roadSigns.capture());
    const before = peer.game.levelScript.events.capture(); peer.game.levelScript.events.trigger('timed'); peer.game.levelScript.events.stop('manual');
    assert.deepEqual(peer.game.levelScript.events.capture(), before);
    events.stop('manual'); sync(); view.update(peer.game); assert.equal(view.root.visible, false);
    game.roadSigns.update(1/60, host.players.map(p => p.pos.clone())); assert.ok(host.players.every(p => !p.roadSignAttachment));
    game.start(30); assert.deepEqual(game.roadSigns.hits, [0, 0]); assert.deepEqual(game.levelScript.events.started, []);
  } finally { view.dispose(); host.dispose(); peer.dispose(); }
});

for (const count of [1, 2, 3, 4]) test(`tutorial ${count} players: empty roof, all-player movement and fixed 1–3 dirt`, () => {
  const sim = start('highway-01', count);
  try {
    assert.equal(sim.game.clock.mode, 'unlimited'); assert.equal(sim.game.orders.length, 0);
    assert.ok(sim.game.tools.every((tool: any) => !tool.mesh.visible)); assert.equal(sim.game.station.visible, false);
    ticks(sim, 30); assert.equal(sim.game.levelScript.step.id, 'move'); assert.equal(sim.game.ended, false);
    sim.input(0, { seq: 1, move: [0, 0], axis: [0, 0], down: ['KeyJ'], hits: ['KeyJ'] }); sim.tick();
    assert.equal(sim.players[0].heldTool, null, 'hidden equipment cannot be picked up'); sim.resetInputs();
    move(sim, count);
    assert.equal(sim.game.levelScript.step.id, 'clean'); assert.equal(sim.game.station.visible, true);
    assert.equal(sim.game.towels.filter((t: any) => t.mesh.visible).length, 3); assert.equal(sim.game.waterguns[0].mesh.visible, false);
    dock(sim); const o = sim.game.order;
    assert.equal(o.stains.length, Math.min(count, 3)); assert.equal(o.remaining, Infinity);
    assert.ok(o.stains.every((s: any) => s.kind === 'dust' && s.steps.length === 1));
    sim.occupy(count - 1, false); assert.equal(o.stains.length, Math.min(count, 3), 'membership changes do not re-author dirt');
  } finally { sim.dispose(); }
});

test('tutorial cleaning is authoritative; paid car holds, early empty hands waits 1s, respawn home can finish and ending is not time_up', () => {
  const sim = start();
  try {
    move(sim, 1); dock(sim); const g = sim.game, o = g.order, p = sim.players[0], stain = o.stains[0];
    place(sim, 0, o.truck, stain.position[0], stain.position[1]); g.towels[0].pickup(p); p.skipUse = false;
    for (let n = 1; !stain.done && n < 100; n++) {
      sim.input(0, { seq: n, move: [0, 0], axis: [0, 0], down: ['KeyJ'], hits: [] }); sim.tick();
    }
    assert.equal(stain.done, true); assert.equal(g.levelScript.step.id, 'release'); assert.equal(g.score, 25);
    assert.equal(o.mode, 'working'); g.completeOrder(o); assert.equal(g.score, 25, 'payment is idempotent');
    g.drop(p); sim.resetInputs(); ticks(sim, 59); assert.equal(g.levelScript.step.id, 'release');
    g.towels[0].pickup(p); sim.tick(); assert.equal(g.tutorial.dots.entries[0].complete, false);
    g.drop(p); ticks(sim, 61); assert.equal(g.levelScript.step.id, 'return');
    p.fallOut(); ticks(sim, 210); assert.equal(g.levelScript.step.id, 'farewell');
    assert.equal(o.mode, 'leaving'); ticks(sim, 260);
    // Slap lesson: a wooden dummy appears; one empty-handed K on it completes the step.
    assert.equal(g.levelScript.step.id, 'slap'); assert.equal(g.dummy.group.visible, true);
    const at = g.dummy.worldPosition(); p.state = 'ground'; p.ground = { truck: g.homeTruck, plat: g.homeTruck.platforms[0] };
    p.pos.set(at.x - 0.9, at.y, at.z); p.yaw = 0; p.externalVelocity.set(0, 0, 0); p.slapCooldown = 0;
    sim.input(0, { seq: 400, move: [0, 0], axis: [0, 0], down: ['KeyK'], hits: ['KeyK'] }); sim.tick();
    sim.input(0, { seq: 401, move: [0, 0], axis: [0, 0], down: [], hits: [] });
    assert.equal(g.dummy.hitSerial, 1); assert.equal(g.tutorial.dots.entries[0].complete, true);
    ticks(sim, 100); assert.notEqual(g.levelScript.step.id, 'slap'); assert.equal(g.dummy.group.visible, false, 'gone after the lesson');
    // L lesson: a cat has no L ability, so it borrows the elephant (and the trunk works before water is unlocked).
    assert.equal(g.levelScript.step.id, 'skill'); assert.equal(g.ended, false);
    assert.deepEqual([p.baseAnimal, p.morph, p.animal, p.morphSerial], ['cat', 'elephant', 'elephant', 1]);
    assert.equal(g.equipmentKeys.includes('water'), false);
    sim.input(0, { seq: 500, move: [0, 0], axis: [0, 0], down: ['KeyL'], hits: ['KeyL'] }); ticks(sim, 3);
    assert.equal(p.trunk.spraying, true, 'the lent trunk sprays'); assert.equal(g.tutorial.dots.entries[0].complete, true);
    // The lent body stays 1.8 s after the first spray so the player can enjoy it.
    sim.input(0, { seq: 501, move: [0, 0], axis: [0, 0], down: [], hits: [] }); ticks(sim, 90);
    assert.equal(g.levelScript.step.id, 'skill'); ticks(sim, 30);
    // Emote lesson: the elephant goes back (a second poof) and any emote completes it.
    assert.equal(g.levelScript.step.id, 'emote'); assert.deepEqual([p.morph, p.animal, p.morphSerial], ['', 'cat', 2]);
    ticks(sim, 120); assert.equal(g.levelScript.step.id, 'emote', 'waits for an emote');
    assert.equal(sim.emote(0, 'hi'), true); ticks(sim, 30); assert.equal(g.levelScript.step.id, 'graduate');
    ticks(sim, 160);
    assert.equal(g.ended, true); assert.equal(g.result.reason, 'tutorial_complete'); assert.equal(g.result.stars, null);
    assert.equal(g.result.outcome, 'success'); assert.equal(g.completed, 1); assert.equal(g.remaining, 0);
  } finally { sim.dispose(); }
});

test('tutorial disconnect removes blockers and slot reuse resets movement; user pause freezes script but teaching does not freeze world', () => {
  const sim = start('highway-01', 2);
  try {
    const before = sim.time; move(sim, 1); assert.equal(sim.game.levelScript.step.id, 'move'); assert.ok(sim.time > before);
    assert.equal(sim.game.tutorial.dots.entries[0].complete, true); sim.occupy(0, false); sim.occupy(0, true);
    assert.equal(sim.game.tutorial.dots.entries[0].complete, false);
    sim.command('pause', true); const state = sim.game.levelScript.capture(), elapsed = sim.game.elapsed;
    ticks(sim, 30); assert.deepEqual(sim.game.levelScript.capture(), state); assert.equal(sim.game.elapsed, elapsed);
    sim.command('pause', false); place(sim, 0, sim.trucks[0], -2, 0); sim.occupy(1, false); move(sim, 1);
    assert.equal(sim.game.levelScript.step.id, 'clean');
  } finally { sim.dispose(); }
});

test('independent scripted sides queue without replay; two identical vehicles use separate prepared slots and generations', () => {
  const level: any = structuredClone(getLevel('highway-02'));
  level.script.orders = [order('a', 0, -1, 'pod', ['dust', 'dust']), order('b', 0, 1, 'pod', ['dust', 'mud']), order('c', 1, -1, 'pod', ['dust', 'dust'])];
  const sim = new Simulation(level);
  try {
    sim.occupy(0, true); sim.phase = 'game'; sim.game.start(sim.director.base); dock(sim);
    const g = sim.game, [a, b] = g.orders; assert.equal(g.orders.length, 2); assert.notEqual(a.truck, b.truck);
    assert.equal(a.initialPatience, 28); assert.equal(b.initialPatience, 42);
    const remaining = b.remaining; sim.command('pause', true); ticks(sim, 20); assert.equal(b.remaining, remaining); sim.command('pause', false);
    ticks(sim, 70); assert.equal(g.levelScript.requests.find((r: any) => r.id === 'c').status, 'queued');
    const oldGeneration = a.generation; g.reclaimOrder(a); ticks(sim, 1); assert.equal(g.lanes.filter((l: any) => l.serial === 2).length, 1);
    ticks(sim, 100); const c = g.orders.find((o: any) => o.id === 'c'); assert.ok(c); assert.ok(c.generation > oldGeneration);
    assert.equal(g.orders.find((o: any) => o.id === 'b'), b); assert.equal(g.levelScript.requests.length, 3);
  } finally { sim.dispose(); }
});

test('five dirt definitions, behavior, charging multiplier and script survive keyframe/delta; clients never progress scripts', () => {
  const sim = start('highway-05', 4), peer = new Simulation(getLevel('highway-05')!);
  try {
    sim.game.elapsed = 5; sim.game.levelScript.beforeFleet(1 / 60); dock(sim);
    const g = sim.game, o = g.orders.find((o: any) => o.stains.length === 5); assert.ok(o);
    o.rewardMultiplier = 1.5; o.stains[4].stage = 1;
    const encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder();
    const frame = encoder.encode(quantize(sim.snapshot()), 'test'); const full = decoder.decode(frame); assert.ok(full); encoder.ack(frame.tick);
    applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, full);
    assert.deepEqual(peer.game.levelScript.capture(), quantize(g.levelScript.capture())); assert.equal(peer.game.orders.find((p: any) => p.id === o.id).stains.length, 5);
    assert.equal(peer.game.orders.find((p: any) => p.id === o.id).rewardMultiplier, 1.5);
    o.stains[4].progress = .5; sim.tick();
    const delta = decoder.decode(encoder.encode(quantize(sim.snapshot()), 'test')); applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, delta);
    assert.equal(peer.game.orders.find((p: any) => p.id === o.id).stains[4].progress, .5);
  } finally { sim.dispose(); peer.dispose(); }
});

test('single-page guide waits for all readers, rejects wrong pages/epochs and freezes the 120s challenge', () => {
  const r = room(['a'], { legacy: false, autoGuide: false });
  try {
    r.host.command('start', { levelId: 'highway-02' }); for (let i = 0; i < 220; i++) r.advance();
    const g = r.host.sim.game; assert.equal(g.roundStage, 'guide'); assert.equal(g.remaining, 120);
    const frame = { type: 'guide_ready', epoch: r.host.epoch, roundId: r.host.roundId!, guideId: 'tools-water', pageIndex: 0 };
    assert.equal(g.guide.pageCount, 1);
    assert.equal(r.host.guideReady(0, { ...frame, pageIndex: 1 }), false);
    assert.equal(r.host.guideReady(0, { ...frame, epoch: 0 }), false);
    assert.equal(r.host.guideReady(0, frame), true);
    for (let i = 0; i < 16; i++) r.advance(); assert.equal(g.roundStage, 'guide'); assert.equal(g.guide.pageIndex, 0); assert.equal(g.guide.ready, 1); assert.equal(g.elapsed, 0);
    r.guests[0].guest.sendControl({ ...frame, pageIndex: 1, slot: 0 });
    r.advance(); assert.equal(g.guide.ready, 1, 'retired second page cannot confirm the guest');
    r.guests[0].guest.sendControl({ ...frame, slot: 0 });
    for (let i = 0; i < 16; i++) r.advance(); assert.equal(g.roundStage, 'ready'); assert.equal(g.elapsed, 0);
  } finally { r.dispose(); }
});

test('star thresholds depend on score, finish freezes rewards and authentic result persists 0.5 semantics', () => {
  for (const [score, stars] of [[24, 0], [25, 1], [54, 1], [55, 2], [129, 2], [130, 3]]) assert.equal(evaluateLevel(getLevel('highway-02'), score, 'time_up').stars, stars);
  const sim = start('highway-04');
  try {
    dock(sim); const g = sim.game; assert.equal(g.order.initialPatience, 72); assert.equal(g.order.chargeRequired, false);
    complete(sim, g.order); assert.equal(g.completed, 1); assert.equal(g.order.mode, 'leaving');
    g.remaining = .001; sim.tick(); assert.equal(g.result.stars, 1); const score = g.score; complete(sim, g.order); assert.equal(g.score, score);
    const receipt = { ...g.result, saveVersion: SAVE_VERSION, roundId: 'r', levelId: 'highway-04' };
    assert.ok(validRoundResult(receipt)); assert.equal(validRoundResult({ ...receipt, stars: 3 }), false);
    assert.equal(validRoundResult({ ...receipt, saveVersion: '0.3' }), false);
  } finally { sim.dispose(); }
});

test('05 retains charging unlock: both peers receive the connector and current-order bonus, cleaning remains optional-charge', () => {
  const r=room(['a'],{legacy:false}),peer=new Simulation(getLevel('highway-05')!);
  try{
    r.host.command('start',{levelId:'highway-05'});
    const sim=r.host.sim,g=sim.game;sim.phase='game';g.start(sim.director.base);
    assert.equal(g.equipmentEnabled('charger'),true);assert.equal(g.charging.source.visible,true);
    g.elapsed=g.level.script.orders[1].at;g.levelScript.beforeFleet(1/60);g.lanes.forEach((l:any)=>l.x=g.orderX());r.advance();
    const charged=g.orders[0];assert.equal(g.charging.plug(g.chargers[0],charged),true);charged.chargeProgress=.999;
    r.advance();const frame=r.guests[0].received.at(-1);
    assert.ok(frame.game.equipmentKeys.includes('charger'));assert.ok(frame.game.orders.every((o:any)=>o.rewardMultiplier===1.5));
    applyWorld({game:peer.game,trucks:peer.trucks,players:peer.players},frame);
    assert.equal(peer.game.charging.source.visible,true);assert.equal(peer.game.chargers[0].mesh.visible,true);
    assert.equal(peer.game.chargers[0].connectedSerial,charged.serial);
    assert.equal(peer.game.orders[1].charged,false);assert.equal(peer.game.orders[1].chargeRequired,false);
    complete(sim,g.orders[1]);assert.equal(g.score,34,'uncharged neighbouring car receives the current-scene bonus and 2-player reward correction');
    g.remaining=.001;r.advance();assert.equal(r.guests[0].results[0].score,34);assert.equal(r.guests[0].results[0].stars,0);
  }finally{r.dispose();peer.dispose();}
});

test('production host tutorial goals and rewards propagate urgently; score endings produce one shared receipt', () => {
  const r = room(['a'], { legacy: false });
  try {
    r.host.command('start'); for (let i = 0; i < 410; i++) r.advance();
    const sim = r.host.sim; move(sim, 2); r.advance();
    assert.equal(sim.game.levelScript.step.id, 'clean'); assert.equal(r.guests[0].received.at(-1).game.tutorial.stepId, 'clean');
    assert.equal(r.guests[0].received.at(-1).game.clock.mode, 'unlimited');
    r.host.command('load', { levelId: 'highway-02' }); for (let i = 0; i < 500; i++) r.advance();
    r.host.sim.game.score = 55; r.host.sim.game.remaining = .001; r.advance(); r.advance();
    assert.equal(r.guests[0].results.length, 1); assert.equal(r.guests[0].results[0].stars, 2);
    assert.equal(r.guests[0].results[0].reason, 'time_up'); assert.ok(validRoundResult(r.guests[0].results[0]));
  } finally { r.dispose(); }
});

test('client prediction cannot relight tutorial lamps or execute scripts; hidden chargers cannot electrify a tools-only level', () => {
  const host = start('highway-01'), peer = new Simulation(getLevel('highway-01')!);
  try {
    host.game.levelScript.enter(2); const tool = host.game.towels[0]; host.game.setEquipment(['towel','station']); tool.pickup(host.players[0]);
    peer.game.viewOnly = true; applyWorld({game:peer.game,trucks:peer.trucks,players:peer.players}, host.snapshot());
    assert.equal(peer.game.tutorial.dots.entries[0].complete, false);
    peer.players[0].heldTool = null; assert.equal(peer.game.tutorial.dots.entries[0].complete, false, 'prediction does not decide goal state');
    const state = peer.game.levelScript.capture(); peer.game.levelScript.beforeFleet(1); peer.game.levelScript.afterActors(2, peer.players.map(p=>p.pos.clone()));
    assert.deepEqual(peer.game.levelScript.capture(),state);
  } finally { host.dispose(); peer.dispose(); }
  const tools = start('highway-02');
  try {
    const g = tools.game, truck=tools.trucks[0], point=g.chargers[0].worldPosition();
    g.wet.splash(truck,point.x-truck.pos.x,point.z-truck.pos.z); place(tools,0,truck,point.x-truck.pos.x,point.z-truck.pos.z);
    ticks(tools,2); assert.equal(tools.players[0].state,'ground'); assert.equal(g.chargers[0].mesh.visible,false);
    assert.equal(g.wet.markAt(truck,point.x,point.z,true),null,'hidden connector does not power wet floor');
  } finally { tools.dispose(); }
});

test('independent event and AI registrations run on the host, restore state without replay, and stop on reset', () => {
  let starts=0,stops=0;
  registerLevelEvent('test-gust',{validate: (p: any)=>p.strength===1,start:()=>{starts++;return {age:0};},update:(_g: any,s: any,dt: number)=>{s.age+=dt;},stop:()=>{stops++;}});
  registerVehicleBehavior('test-service',{approachRate:1,update:(_g: any,o: any,dt: number)=>{o.behaviorState.time=(o.behaviorState.time||0)+dt;}});
  const level: any=structuredClone(getLevel('highway-02'));level.script.events=[{id:'gust',type:'test-gust',at:0,duration:1,params:{strength:1}}];
  level.script.orders=[{...order('test-car',0,-1,'pod',['dust','dust']),behavior:'test-service'}];validateLevelScript(level);
  const sim=new Simulation(level);
  try {
    sim.occupy(0,true);sim.phase='game';sim.game.start(sim.director.base);ticks(sim,5);assert.equal(starts,1);
    const copy=new LevelEvents(sim.game);copy.apply(sim.game.levelScript.events.capture());assert.equal(starts,1,'restore never replays start');
    sim.game.lanes[0].x=sim.game.orderX();sim.tick();assert.ok(sim.game.order.behaviorState.time>0);
    sim.game.levelScript.reset();assert.equal(stops,1);assert.equal(sim.game.levelScript.events.active.length,0);
  } finally { sim.dispose(); }
});

test('step clocks can invoke/stop independent events and select future vehicle AI without freezing gameplay', () => {
  let starts=0,stops=0;
  registerLevelEvent('test-step-event',{validate:()=>true,start:()=>{starts++;return {};},update:()=>{},stop:()=>{stops++;}});
  const level:any=structuredClone(getLevel('highway-02'));
  level.script.orders=[order('future-car',1,-1,'pod',['dust','dust'])];
  level.script.events=[{id:'step-event',type:'test-step-event',duration:5,params:{}}];
  level.script.steps=[{id:'practice',text:'练习中',condition:{type:'elapsed',seconds:.05},
    enter:[{type:'event',eventId:'step-event'},{type:'behavior',orderId:'future-car',behavior:'wideCruise'}],exit:[{type:'stopEvent',eventId:'step-event'}]}];
  validateLevelScript(level);const sim=new Simulation(level);
  try{
    sim.occupy(0,true);sim.phase='game';sim.game.start(sim.director.base);assert.equal(starts,1);
    ticks(sim,4);assert.equal(stops,1);assert.ok(sim.game.elapsed>0);assert.equal(sim.game.levelScript.step,null);
    ticks(sim,170);assert.equal(sim.game.order.behaviorId,'wideCruise');assert.equal(starts,1);
  }finally{sim.dispose();}
});
