/** HouJianNan's three-truck versus rules (merged from hjn2), on GameLogic's framework: room teams 0 red (left, side -1)
 * and 1 blue (right, side +1), per-team tally arrays, room settings for clock/target. Seat order maps their blue/red
 * to our 0/1, so sides are unchanged. Framework tests (level lists, save, team choice, start gates) live elsewhere. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../shared/sim/RoomSimulation.js';
import { getLevel, SAVE_VERSION } from '../shared/levels.js';
import { applyWorld, applyPlayer } from '../shared/snapshot.js';
import { VERSION, packetInput } from '../shared/protocol.js';
import * as THREE from 'three';
import { WOBBLE } from '../shared/sim/Wobble.js';

test('versus world docks one red (left) and one blue (right) truck that wait for the whole round', () => {
  const sim = new Simulation(getLevel('versus-01')!); try {
    sim.occupy(0, true); sim.occupy(1, true);
    sim.phase = 'game'; sim.game.start(sim.director.base);
    for (let i = 0; sim.game.orders.length < 2 && i < 600; i++) sim.tick();
    const g = sim.game;
    assert.equal(g.orders.length, 2);
    assert.deepEqual(g.orders.map((o: any) => o.side).sort(), [-1, 1]);
    for (const o of g.orders) {
      assert.equal(o.remaining, Infinity); assert.equal(o.definition.onComplete, 'leave');
      assert.deepEqual(o.stains.map((s: any) => s.steps.join('>')), ['towel', 'water>towel', 'soap>water>towel']);
      assert.equal(o.stains.length, 3);
    }
    for (let i = 0; i < 60 * 30; i++) sim.tick();
    assert.equal(g.orders.length, 2, 'both team trucks are still parked after 30 s');
    assert.ok(g.orders.every((o: any) => o.mode === 'working'));
  } finally { sim.dispose(); }
});

function versus(slots: number[]) {
  const sim = new Simulation(getLevel('versus-01')!);
  // Present seats alternate red/blue in slot order (team choice itself is the room's; see versus-mode tests).
  slots.forEach((slot, i) => { sim.occupy(slot, true); sim.setTeam(slot, i % 2); });
  sim.phase = 'game'; sim.game.start(sim.director.base);
  for (let i = 0; !(sim.game.orders.length === 2 && sim.game.orders.every((o: any) => o.arrivalProgress === 1)) && i < 1200; i++) sim.tick();
  return sim;
}

test('everyone spawns and respawns on the neutral home truck', () => {
  const sim = versus([0, 1, 2, 3]); try {
    const home = sim.trucks[0];
    for (let i = 0; i < 120; i++) sim.tick();
    // Eight world slots, four occupied: compare booleans so a failure never tries to print a whole truck graph.
    assert.deepEqual(sim.players.slice(0, 4).map((p: any) => p.ground?.truck === home), [true, true, true, true]);
    const p = sim.players[3]; p.fallOut();
    for (let i = 0; i < 60 * 8 && p.state !== 'ground'; i++) sim.tick();
    assert.equal(p.ground?.truck === home, true); assert.equal(p.team, 1, 'team survives a respawn');
  } finally { sim.dispose(); }
});

test('campaign rounds keep no team', () => {
  const sim = new Simulation(getLevel('highway-02')!); try {
    sim.occupy(0, true); sim.occupy(1, true); sim.phase = 'game'; sim.game.start(sim.director.base);
    assert.deepEqual(sim.players.map((p: any) => p.team), [null, null, null, null]);
    for (let i = 0; sim.game.orders.length < 1 && i < 600; i++) sim.tick();
    assert.ok(sim.game.orders.every((o: any) => o.team === null));
  } finally { sim.dispose(); }
});

// ── Step 3: per-stain team scoring ───────────────────────────────────────────
import { PVP_SCORE } from '../shared/sim/PvpScore.js';
const dt = 1 / 60;
const teamTruck = (sim: Simulation, team: number) => sim.game.orders.find((o: any) => o.team === team);
/** Finish one stain through the real cleaning paths: rinse for a water step, a towel wipe otherwise. */
function finishStain(sim: Simulation, order: any, stain: any) {
  // Cleaned by a member of the truck's own team (an enemy's rinse would run backwards).
  const g = sim.game, p = sim.players.find((player: any) => player.team === order.team) || sim.players[0];
  for (let guard = 0; !stain.done; guard++) {
    assert.ok(guard < 10, 'finishStain made no progress');
    if (stain.steps[stain.stage] === 'water') g.rinse(p, stain, 999);
    else { // Same transition as the towel path in WashSimulation.interact.
      stain.stage++; stain.progress = 0; stain.done = stain.stage === stain.steps.length;
      if (stain.done) { stain.mesh.visible = false; g.stainFinished(order, stain); }
      if (order.stains.every((s: any) => s.done)) g.completeOrder(order);
    }
  }
}

test('each finished stain scores its own team, with a rising per-team combo', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, blue = teamTruck(sim, 0), red = teamTruck(sim, 1);
    assert.deepEqual([g.teamScores, g.teamCombos, g.teamCleaned, g.teamUndone, g.teamChargeBonus, g.teamCompleted], [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]);
    finishStain(sim, blue, blue.stains[0]); finishStain(sim, blue, blue.stains[1]);
    const first = PVP_SCORE.stainPoints + PVP_SCORE.comboTip, second = PVP_SCORE.stainPoints + 2 * PVP_SCORE.comboTip;
    assert.equal(g.teamScores[0], first + second); assert.equal(g.teamCombos[0], 2); assert.equal(g.teamCleaned[0], 2);
    assert.deepEqual([blue.stains[0].points, blue.stains[1].points], [first, second]);
    assert.equal(g.teamScores[1], 0, 'the other team is untouched');
    finishStain(sim, red, red.stains[0]); assert.equal(g.teamScores[1], first);
    assert.equal(g.score, 0, 'the campaign score is not used in versus');
  } finally { sim.dispose(); }
});

test('a fully washed truck leaves like a campaign order, its points lock, and the side gets a new truck', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, blue = teamTruck(sim, 0), red = teamTruck(sim, 1), first = blue.serial;
    for (const stain of blue.stains) finishStain(sim, blue, stain);
    const locked = g.teamScores[0];
    assert.equal(blue.mode, 'leaving'); assert.equal(g.teamCompleted[0], 1); assert.equal(g.ended, false);
    assert.equal(red.mode, 'working', 'the other side is untouched');
    // A dirty towel cannot reach a leaving truck: its points are locked.
    const p = sim.players[1], towel = g.towels[0]; towel.pickup(p); towel.consume(WASH_CONFIG.towelDurability);
    const at = blue.stains[0].mesh.getWorldPosition(new THREE.Vector3());
    p.state = 'ground'; p.ground = { truck: blue.truck, plat: blue.truck.platformAt(at.x, at.z, .3) }; p.pos.set(at.x, blue.truck.topY, at.z);
    assert.equal(g.smudgeTarget(p), null); assert.equal(g.teamScores[0], locked);
    towel.release(null); p.fallOut();
    // Campaign pacing: the leaving truck is reclaimed, then the next blue truck merges in and docks.
    let next: any = null;
    for (let i = 0; i < 60 * 30 && !(next && next.arrivalProgress === 1); i++) { sim.tick(); next = g.orders.find((o: any) => o.team === 0 && o.serial !== first); }
    assert.ok(next, 'a new blue truck arrived'); assert.equal(next.side, -1); assert.equal(next.mode, 'working');
    assert.equal(next.stains.length, 3); assert.ok(next.stains.every((s: any) => !s.done && s.points === 0));
    assert.deepEqual(next.stains.map((s: any) => s.steps.join('>')), ['towel', 'water>towel', 'soap>water>towel']);
    assert.equal(next.rewardMultiplier, 1); assert.equal(next.charged, false); assert.equal(next.behaviorId, 'cruise');
    assert.equal(g.teamScores[0], locked, 'the earlier truck still counts');
    assert.equal(g.teamCombos[0], 3, 'combo carries across trucks like the campaign');
  } finally { sim.dispose(); }
});

test('truck stain positions vary between trucks but are identical on every page', () => {
  const orders = (getLevel('versus-01') as any).script.orders;
  const positions = orders.map((o: any) => JSON.stringify(o.stains.map((s: any) => s.position)));
  assert.ok(new Set(positions).size > 5, 'layouts vary');
  assert.deepEqual(positions, (getLevel('versus-01') as any).script.orders.map((o: any) => JSON.stringify(o.stains.map((s: any) => s.position))));
  for (const o of orders) assert.deepEqual(o.stains.map((s: any) => s.kind), ['dust', 'mud', 'grease']);
  assert.equal(orders.filter((o: any) => o.side === -1).length, orders.filter((o: any) => o.side === 1).length);
});

test('the charge boost follows the truck: the next truck starts uncharged', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, blue = teamTruck(sim, 0), first = blue.serial;
    blue.rewardMultiplier = 1.5; blue.charged = true; blue.chargeProgress = 1;
    for (const stain of blue.stains) finishStain(sim, blue, stain);
    let next: any = null;
    for (let i = 0; i < 60 * 30 && !(next && next.arrivalProgress === 1); i++) { sim.tick(); next = g.orders.find((o: any) => o.team === 0 && o.serial !== first); }
    assert.equal(next.rewardMultiplier, 1); assert.equal(next.chargeProgress, 0); assert.equal(next.charged, false); assert.equal(next.behaviorId, 'cruise');
    assert.equal(plugAs(sim, 0, next).ok, true, 'the new port can be charged again');
  } finally { sim.dispose(); }
});

test('the real wipe path scores through stainFinished', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, blue = teamTruck(sim, 0), stain = blue.stains[0], towel = g.towels[0], p = sim.players[0];
    const at = stain.mesh.getWorldPosition(new THREE.Vector3());
    p.state = 'ground'; p.ground = { truck: blue.truck, plat: blue.truck.platformAt(at.x, at.z, .3) }; p.pos.set(at.x, blue.truck.topY, at.z);
    towel.pickup(p); p.skipUse = false;
    const hold = packetInput({ seq: 1, move: [0, 0], axis: [0, 0], down: ['KeyJ'], hits: [] });
    for (let i = 0; i < 240 && !stain.done; i++) g.interact(p, hold, dt);
    assert.equal(stain.done, true); assert.equal(g.teamScores[0], PVP_SCORE.stainPoints + PVP_SCORE.comboTip);
  } finally { sim.dispose(); }
});

test('reopening a done stain removes exactly its recorded points and breaks that team\'s combo', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, blue = teamTruck(sim, 0);
    finishStain(sim, blue, blue.stains[0]); finishStain(sim, blue, blue.stains[2]);
    const worth = blue.stains[2].points, before = g.teamScores[0];
    assert.equal(worth, PVP_SCORE.stainPoints + 2 * PVP_SCORE.comboTip);
    g.teamCombos[0] = 0; // a later combo change must not alter what comes off
    assert.equal(g.stainReopened(blue, blue.stains[2]), worth, 'the recorded value comes off, not a recomputed one');
    assert.equal(g.teamScores[0], before - worth); assert.equal(g.teamCombos[0], 0); assert.equal(g.teamUndone[0], 1);
    assert.equal(blue.stains[2].done, false); assert.equal(blue.stains[2].mesh.visible, true);
    // Team score always equals the points still standing on its done stains.
    assert.equal(g.teamScores[0], blue.stains.reduce((n: number, s: any) => n + (s.done ? s.points : 0), 0));
  } finally { sim.dispose(); }
});

test('team scores reach viewers, are urgent and decide the result receipt', () => {
  const host = versus([0, 1]), peer = new Simulation(getLevel('versus-01')!); try {
    peer.game.viewOnly = true;
    const g = host.game, red = teamTruck(host, 1), signature = host.urgentSignature();
    finishStain(host, red, red.stains[0]);
    assert.notEqual(host.urgentSignature(), signature);
    applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, host.snapshot());
    assert.deepEqual([peer.game.teamScores, peer.game.teamCombos, peer.game.teamCleaned], [g.teamScores, g.teamCombos, g.teamCleaned]);
    assert.equal(peer.game.orders.find((o: any) => o.team === 1).stains[0].points, red.stains[0].points);
    g.finish('time_up');
    assert.equal(g.result.winner, 1); assert.equal(g.result.teamScores[1], red.stains[0].points); assert.equal(g.result.teamCleaned[1], 1);
  } finally { host.dispose(); peer.dispose(); }
  const draw = versus([0, 1]); try { draw.game.finish('time_up'); assert.deepEqual([draw.game.result.winner, draw.game.result.tie], [null, true]); } finally { draw.dispose(); }
});

test('campaign scoring is unchanged: whole-order pay, no team state', () => {
  const sim = new Simulation(getLevel('highway-02')!); try {
    sim.occupy(0, true); sim.phase = 'game'; sim.game.start(sim.director.base);
    for (let i = 0; sim.game.orders.length < 1 && i < 600; i++) sim.tick();
    const g = sim.game, o = g.orders[0];
    assert.equal(g.mode, 'coop');
    for (const s of o.stains) { s.stage = s.steps.length; s.done = true; }
    g.completeOrder(o); assert.equal(o.paid, true); assert.ok(g.score > 0);
  } finally { sim.dispose(); }
});

// ── Step 4: sabotage — dirty/filthier towel smudge, water rollback, no step crossing ──
import { PVP_TUNING } from '../shared/sim/PvpScore.js';
import { WASH_CONFIG } from '../shared/sim/washConfig.js';
const holdJ = packetInput({ seq: 1, move: [0, 0], axis: [0, 0], down: ['KeyJ'], hits: [] });
function standAt(sim: Simulation, slot: number, order: any, stain: any) {
  const p = sim.players[slot], at = stain.mesh.getWorldPosition(new THREE.Vector3());
  p.state = 'ground'; p.ground = { truck: order.truck, plat: order.truck.platformAt(at.x, at.z, .3) };
  p.pos.set(at.x, order.truck.topY, at.z); p.skipUse = false; return p;
}
function hold(sim: Simulation, p: any, seconds: number) { for (let i = 0; i < Math.round(seconds * 60); i++) sim.game.interact(p, holdJ, dt); }
function dirtyTowel(sim: Simulation, p: any, index = 0) { const t = sim.game.towels[index]; t.pickup(p); t.consume(WASH_CONFIG.towelDurability); return t; }

test('a dirty towel undoes an enemy done stain: points come off, combo breaks, towel gets filthier', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, red = teamTruck(sim, 1), stain = red.stains[0];
    finishStain(sim, red, stain); finishStain(sim, red, red.stains[2]);
    const before = g.teamScores[1], worth = stain.points;
    const p = standAt(sim, 0, red, stain), towel = dirtyTowel(sim, p);   // slot 0 is blue
    assert.equal(towel.dirty, true); assert.equal(towel.canSmudge, true);
    hold(sim, p, .3);
    assert.equal(stain.done, false, 'reopened at the first touch'); assert.equal(stain.stage, 0);
    assert.ok(stain.progress < 1 && stain.progress > 0);
    assert.equal(g.teamScores[1], before - worth); assert.equal(g.teamCombos[1], 0); assert.equal(g.teamUndone[1], 1);
    assert.ok(towel.grime > 0, 'filthier progress grows'); assert.equal(towel.durability, 0, 'durability does not change while smudging');
    hold(sim, p, PVP_TUNING.smudgeSeconds + .2);
    assert.equal(stain.progress, 0); assert.equal(stain.stage, 0, 'stays in its step at 0');
    assert.equal(g.teamScores[0], 0, 'sabotage does not score for the attacker');
  } finally { sim.dispose(); }
});

test('smudging never crosses back into an earlier step', () => {
  const sim = versus([0, 1]); try {
    const red = teamTruck(sim, 1), mixed = red.stains[1];   // water > towel
    assert.deepEqual(mixed.steps, ['water', 'towel']);
    mixed.stage = 1; mixed.progress = .5;
    const p = standAt(sim, 0, red, mixed); dirtyTowel(sim, p);
    hold(sim, p, 3);
    assert.equal(mixed.stage, 1, 'the finished rinse stays finished'); assert.equal(mixed.progress, 0);
  } finally { sim.dispose(); }
});

test('only a fully used towel smudges; clean or partly used towels do nothing on the enemy truck', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, red = teamTruck(sim, 1), stain = red.stains[0];
    stain.progress = .6;
    const p = standAt(sim, 0, red, stain), towel = g.towels[0]; towel.pickup(p);
    hold(sim, p, 1);
    assert.equal(stain.progress, .6, 'a clean towel neither cleans nor smudges'); assert.equal(towel.durability, WASH_CONFIG.towelDurability);
    towel.consume(WASH_CONFIG.towelDurability / 2); hold(sim, p, 1);
    assert.equal(stain.progress, .6, 'a half-used towel still does nothing'); assert.equal(p.interactionHint, '毛巾用脏后才能抹对面');
  } finally { sim.dispose(); }
});

test('a filthiest towel stops smudging; the wash basin cleans dirty and filthier towels', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, red = teamTruck(sim, 1);
    const a = red.stains[0], b = red.stains[2];
    finishStain(sim, red, a); finishStain(sim, red, b);   // two whole towel steps to undo
    const p = standAt(sim, 0, red, a), towel = dirtyTowel(sim, p);
    hold(sim, p, 3); standAt(sim, 0, red, b); hold(sim, p, 3);
    assert.equal(towel.filthy, true, 'two full smudges fill the filthier bar'); assert.equal(towel.canSmudge, false);
    b.progress = .5; hold(sim, p, 1); assert.equal(b.progress, .5, 'a filthiest towel cannot smudge');
    assert.equal(p.interactionHint, '毛巾太脏了，带回洗面台');
    const station = g.station.getWorldPosition(new THREE.Vector3()), home = sim.trucks[0];
    p.ground = { truck: home, plat: home.platformAt(station.x, station.z, .3) }; p.pos.set(station.x, home.topYAt(station.x, station.z), station.z);
    hold(sim, p, WASH_CONFIG.washSeconds + .2);
    assert.equal(towel.dirty, false); assert.equal(towel.grime, 0); assert.equal(towel.durability, WASH_CONFIG.towelDurability);
  } finally { sim.dispose(); }
});

test('a towel that falls off keeps its dirt and grime on its way back to the neutral spot', () => {
  const sim = versus([0, 1]); try {
    const towel = sim.game.towels[0]; towel.consume(WASH_CONFIG.towelDurability); towel.smear(.7);
    towel.vanishFromRoad();
    assert.equal(towel.truck, sim.trucks[0]); assert.equal(towel.dirty, true); assert.equal(towel.grime, .7);
  } finally { sim.dispose(); }
});

test('water on the enemy truck washes back rinse progress only within that step; on your own truck it cleans', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, red = teamTruck(sim, 1), blue = teamTruck(sim, 0), p = sim.players[0];
    const enemy = red.stains[1]; enemy.progress = .5;
    g.rinse(p, enemy, .3);
    assert.ok(Math.abs(enemy.progress - (.5 - .3 / PVP_TUNING.rinseBackSeconds)) < 1e-9); assert.equal(enemy.stage, 0);
    g.rinse(p, enemy, 9); assert.equal(enemy.progress, 0); assert.equal(enemy.stage, 0, 'never below the start of the rinse step');
    const towelStep = red.stains[1]; towelStep.stage = 1; towelStep.progress = .4;
    g.rinse(p, towelStep, 1); assert.equal(towelStep.progress, .4, 'water does not touch a towel step');
    const own = blue.stains[1]; g.rinse(p, own, .3); assert.ok(own.progress > 0, 'own truck still rinses forward');
  } finally { sim.dispose(); }
});

test('the real water-gun jet on the enemy truck rolls back', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, red = teamTruck(sim, 1), stain = red.stains[1], gun = g.waterguns[0], p = sim.players[0];
    stain.progress = .8;
    gun.pickup(p); gun.pressure = 1; gun.hitStain = stain; gun.hitPlayer = null;
    const trace = gun.trace; gun.trace = () => {}; // aim is exercised in water-gun.test.ts
    g.spray(p, { down: (k: string) => k === 'KeyJ', hit: () => false }, .2); gun.trace = trace;
    assert.ok(stain.progress < .8); assert.equal(stain.stage, 0);
  } finally { sim.dispose(); }
});

test('towel grime reaches viewers', () => {
  const host = versus([0, 1]), peer = new Simulation(getLevel('versus-01')!); try {
    peer.game.viewOnly = true;
    const towel = host.game.towels[1]; towel.consume(WASH_CONFIG.towelDurability); towel.smear(1.2);
    applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, host.snapshot());
    assert.equal(peer.game.towels[1].grime, 1.2); assert.equal(peer.game.towels[1].dirty, true);
  } finally { host.dispose(); peer.dispose(); }
});

test('campaign towels and water are unchanged by the versus rules', () => {
  const sim = new Simulation(getLevel('highway-02')!); try {
    sim.occupy(0, true); sim.phase = 'game'; sim.game.start(sim.director.base);
    for (let i = 0; sim.game.orders.length < 1 && i < 600; i++) sim.tick();
    const g = sim.game, o = g.orders[0], stain = o.stains.find((s: any) => s.steps[0] === 'towel');
    stain.progress = .5; const p = standAt(sim, 0, o, stain); dirtyTowel(sim, p);
    hold(sim, p, 1); assert.equal(stain.progress, .5, 'no smudging outside versus');
    assert.equal(g.smudgeTarget(p), null);
  } finally { sim.dispose(); }
});

// ── Step 5: charging — one bar per truck; a full bar pays ×1.5 on that truck when it leaves washed ──
import { CHARGING } from '../shared/sim/chargingConfig.js';
function plugAs(sim: Simulation, slot: number, order: any) {
  const p = sim.players[slot], head = sim.game.chargers[0];
  head.pickup(p); return { head, ok: sim.game.charging.plug(head, order) };
}
const chargeFor = (sim: Simulation, seconds: number) => { for (let i = 0; i < Math.round(seconds * 60); i++) sim.tick(); };

test('versus charging takes PVP_TUNING.chargeSeconds (12 s); the campaign keeps CHARGING.seconds', () => {
  assert.equal(PVP_TUNING.chargeSeconds, 12); assert.equal(CHARGING.seconds, 6);
  const sim = versus([0, 1]); try {
    const blue = teamTruck(sim, 0);
    plugAs(sim, 0, blue); chargeFor(sim, CHARGING.seconds + .2);
    assert.equal(blue.charged, false, 'not full after the campaign 6 s');
    assert.ok(Math.abs(blue.chargeProgress - (CHARGING.seconds + .2) / PVP_TUNING.chargeSeconds) < .02);
    chargeFor(sim, PVP_TUNING.chargeSeconds - CHARGING.seconds);
    assert.equal(blue.charged, true, 'full after 12 s');
  } finally { sim.dispose(); }
});

test('a full bar pays ×1.5 on all of that truck\'s stains in one go when it leaves washed', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, blue = teamTruck(sim, 0), red = teamTruck(sim, 1);
    finishStain(sim, blue, blue.stains[0]);                 // scored before charging: still counts
    const { ok } = plugAs(sim, 0, blue); assert.ok(ok);
    chargeFor(sim, PVP_TUNING.chargeSeconds + .2);
    assert.equal(blue.charged, true); assert.equal(blue.rewardMultiplier, 1.5); assert.equal(red.rewardMultiplier, 1, 'only this truck');
    assert.equal(g.teamChargeBonus[0], 0, 'nothing is paid until the truck is washed');
    const scoreBeforeLast = g.teamScores[0];
    finishStain(sim, blue, blue.stains[1]); const base = blue.stains[1].points;
    assert.equal(base, PVP_SCORE.stainPoints + 2 * PVP_SCORE.comboTip, 'stains score at base value');
    finishStain(sim, blue, blue.stains[2]);
    const earned = blue.stains.reduce((n: number, s: any) => n + s.points, 0), bonus = Math.round(earned * .5);
    assert.equal(blue.mode, 'leaving');
    assert.equal(g.teamChargeBonus[0], bonus);
    assert.equal(g.teamScores[0], scoreBeforeLast + base + blue.stains[2].points + bonus);
    assert.equal(g.teamScores[1], 0);
    assert.equal(plugAs(sim, 1, red).ok, true, 'the connector popped out and can be used again');
  } finally { sim.dispose(); }
});

test('a bar not full when the truck is washed is lost: no bonus, the connector pops out', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, blue = teamTruck(sim, 0);
    const { head } = plugAs(sim, 0, blue); chargeFor(sim, PVP_TUNING.chargeSeconds / 2);
    assert.ok(blue.chargeProgress > .4 && !blue.charged);
    for (const stain of blue.stains) finishStain(sim, blue, stain);
    sim.tick();
    assert.equal(g.teamChargeBonus[0], 0);
    assert.equal(g.teamScores[0], blue.stains.reduce((n: number, s: any) => n + s.points, 0));
    assert.equal(head.connectedSerial, null, 'popped out like the campaign');
  } finally { sim.dispose(); }
});

test('either team can plug any truck; charging the other team\'s truck charges theirs', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, red = teamTruck(sim, 1);
    const { ok } = plugAs(sim, 0, red); assert.ok(ok, 'blue may plug the red truck');
    chargeFor(sim, PVP_TUNING.chargeSeconds + .2);
    assert.equal(red.charged, true); assert.equal(red.rewardMultiplier, 1.5);
    assert.equal(red.behaviorId, 'cruise', 'no sway or any other effect on the truck');
    for (const stain of red.stains) finishStain(sim, red, stain);
    assert.ok(g.teamChargeBonus[1] > 0, 'the bonus goes to the truck\'s own team'); assert.equal(g.teamChargeBonus[0], 0);
  } finally { sim.dispose(); }
});

test('pulling the connector keeps the truck\'s bar; plugging back resumes it', () => {
  const sim = versus([0, 1]); try {
    const red = teamTruck(sim, 1), blue = teamTruck(sim, 0);
    const { head } = plugAs(sim, 1, red); chargeFor(sim, 2);
    const progress = red.chargeProgress;
    head.pickup(sim.players[0]); chargeFor(sim, 1);                  // blue pulls it out...
    assert.equal(red.chargeProgress, progress, 'kept after unplugging');
    assert.equal(sim.game.charging.plug(head, blue), true);           // ...and plugs it into their own truck
    chargeFor(sim, 1); assert.ok(blue.chargeProgress > 0); assert.equal(red.chargeProgress, progress);
    head.pickup(sim.players[1]); assert.equal(sim.game.charging.plug(head, red), true);
    chargeFor(sim, PVP_TUNING.chargeSeconds * (1 - progress) + .2);
    assert.equal(red.charged, true, 'resumes from where it stopped');
  } finally { sim.dispose(); }
});

test('water in a port shorts it and keeps the bar', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, red = teamTruck(sim, 1);
    const { head } = plugAs(sim, 0, red); chargeFor(sim, 2);
    const progress = red.chargeProgress, port = g.charging.portPoint(red.truck);
    g.charging.shortCircuit(head, red.truck, port);
    assert.equal(head.connectedSerial, null); assert.equal(red.chargeProgress, progress);
  } finally { sim.dispose(); }
});

test('the charge bar and bonus reach viewers and are urgent', () => {
  const host = versus([0, 1]), peer = new Simulation(getLevel('versus-01')!); try {
    peer.game.viewOnly = true;
    const red = teamTruck(host, 1), signature = host.urgentSignature();
    plugAs(host, 1, red);
    assert.notEqual(host.urgentSignature(), signature, 'plugging is urgent');
    chargeFor(host, PVP_TUNING.chargeSeconds + .2);
    applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, host.snapshot());
    const view = peer.game.orders.find((o: any) => o.team === 1);
    assert.equal(view.charged, true); assert.equal(view.chargeProgress, 1); assert.equal(view.rewardMultiplier, 1.5);
    for (const stain of red.stains) finishStain(host, red, stain);
    applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, host.snapshot());
    assert.equal(peer.game.teamChargeBonus[1], host.game.teamChargeBonus[1]);
  } finally { host.dispose(); peer.dispose(); }
});

// ── Step 6: wet + live connector → the gun holder is shocked and drops the gun ──
function shockAt(sim: Simulation, slot: number, truck: any) {
  const g = sim.game, p = sim.players[slot], x = truck.pos.x + 1, z = truck.pos.z;
  p.state = 'ground'; p.ground = { truck, plat: truck.platformAt(x, z, .3) }; p.pos.set(x, truck.topY, z);
  // Fixed jitter/radius: WetField places marks with Math.random, which occasionally left the connector on the fringe.
  const random = g.charging.wet.random; g.charging.wet.random = () => .5;
  g.charging.wet.splash(truck, x - truck.pos.x, z - truck.pos.z); g.charging.wet.random = random; g.charging.wet.advance(.12, 0);
  const head = g.chargers[0]; head.placeOn(truck, new THREE.Vector3(x - truck.pos.x + .3, 0, z - truck.pos.z));
  // Wobble (WOBBLE.md): contact adds 50, the next interval fills the bar and shock-stuns.
  g.charging.checkElectricity(); g.charging.checkElectricity(WOBBLE.shockInterval); return p;
}

test('a shocked water-gun holder drops the gun on the spot and is stunned 2 s', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, red = teamTruck(sim, 1), gun = g.waterguns[0], p = sim.players[1];
    gun.pickup(p); gun.spraying = true; gun.pressure = 1;
    shockAt(sim, 1, red.truck);
    assert.equal(p.stunRemaining, CHARGING.stunSeconds);
    // Identity checks with ok(): a failing equal() on scene objects would print the whole scene graph.
    assert.ok(p.heldTool === null); assert.ok(gun.holder === null);
    assert.ok(gun.truck === red.truck, 'left at the victim\'s feet on that roof'); assert.equal(gun.spraying, false); assert.equal(gun.pressure, 0);
    assert.ok(Math.hypot(gun.mesh.position.x - (p.pos.x - red.truck.pos.x), gun.mesh.position.z - (p.pos.z - red.truck.pos.z)) < .01);
    // The dropped gun can be picked up by someone else (hose still tied to the neutral truck).
    const other = sim.players[0]; assert.equal(gun.pickup(other), true); assert.equal(gun.holder, other);
  } finally { sim.dispose(); }
});

test('a shocked holder of a towel keeps it; the campaign shock still only drops the connector', () => {
  const sim = versus([0, 1]); try {
    const towel = sim.game.towels[0], p = sim.players[1]; towel.pickup(p);
    shockAt(sim, 1, teamTruck(sim, 1).truck);
    assert.ok(p.stunRemaining > 0); assert.equal(p.heldTool, towel);
  } finally { sim.dispose(); }
  const pve = new Simulation(getLevel('highway-05')!); try {
    pve.occupy(0, true); pve.phase = 'game'; pve.game.start(pve.director.base);
    const gun = pve.game.waterguns[0], p = pve.players[0]; gun.pickup(p);
    shockAt(pve, 0, pve.trucks[0]);
    assert.ok(p.stunRemaining > 0); assert.equal(p.heldTool, gun, 'campaign: unchanged');
  } finally { pve.dispose(); }
});

test('the dropped gun reaches viewers in the same tick it falls', () => {
  const host = versus([0, 1]), peer = new Simulation(getLevel('versus-01')!); try {
    peer.game.viewOnly = true;
    const gun = host.game.waterguns[0], p = host.players[1]; gun.pickup(p);
    const before = host.urgentSignature();
    shockAt(host, 1, teamTruck(host, 1).truck);
    assert.notEqual(host.urgentSignature(), before);
    applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, host.snapshot());
    applyPlayer(peer.players[1], host.snapshot().players[1], peer.trucks);
    assert.equal(peer.game.waterguns[0].holder, null); assert.equal(peer.players[1].heldTool, null);
    assert.ok(peer.players[1].stunRemaining > 0);
  } finally { host.dispose(); peer.dispose(); }
});

// The other two ways to take the gun already exist; these pin them in versus.
test('a pelican swallowing the gun holder makes the gun drop where they stood', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, home = sim.trucks[0], gun = g.waterguns[0], holder = sim.players[1], pelican = sim.players[0];
    gun.pickup(holder); g.swallow(pelican, holder);
    assert.equal(holder.state, 'swallowed'); assert.equal(gun.holder, null); assert.equal(holder.heldTool, null);
    assert.ok(gun.truck === home || gun.flight, 'the gun is left behind, not swallowed'); assert.ok(!gun.swallowedBy);
  } finally { sim.dispose(); }
});

test('an elephant jet that knocks the gun holder off the truck makes them lose the gun', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, gun = g.waterguns[0], holder = sim.players[1];
    gun.pickup(holder); holder.fallOut();
    assert.equal(holder.heldTool, null); assert.equal(gun.holder, null);
  } finally { sim.dispose(); }
});

// ── Smear cue: a usable dirty towel points at enemy stains it can rub back ──
import { CleaningHudFocus } from '../client/js/ui/CleaningHudFocus.js';
function focusFor(sim: Simulation, slot: number) {
  const g = sim.game; g.localSlot = slot;
  return new CleaningHudFocus().select(g, g.orders.flatMap((order: any) => order.stains.map((stain: any) => ({ order, stain }))));
}

test('a usable dirty towel marks every enemy stain it can smear and nothing on its own truck', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, blue = teamTruck(sim, 0), red = teamTruck(sim, 1), p = sim.players[1]; // red
    finishStain(sim, blue, blue.stains[0]);                       // done, ends in towel → smearable
    blue.stains[1].stage = 1; blue.stains[1].progress = .4;        // towel step with progress → smearable
    blue.stains[2].progress = 0;                                  // untouched → nothing to undo
    const towel = g.towels[0]; towel.pickup(p); towel.consume(WASH_CONFIG.towelDurability);
    let focus = focusFor(sim, 1);
    assert.deepEqual([...focus.smudge], [blue.stains[0], blue.stains[1]]);
    assert.equal(focus.stains.size, 0, 'own towel stains are not highlighted for a dirty towel');
    assert.ok(red.stains.every((s: any) => !focus.smudge.has(s)));
    // Rinse progress alone is not smearable.
    blue.stains[1].stage = 0; blue.stains[1].progress = .6;
    assert.deepEqual([...focusFor(sim, 1).smudge], [blue.stains[0]]);
    // Filthiest towel: no cue at all.
    towel.smear(WASH_CONFIG.towelDurability); focus = focusFor(sim, 1);
    assert.equal(focus.smudge.size, 0); assert.equal(focus.stains.size, 0);
  } finally { sim.dispose(); }
});

test('clean towels, empty hands and campaign rounds never show the smear cue', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, blue = teamTruck(sim, 0), p = sim.players[1];
    finishStain(sim, blue, blue.stains[0]);
    assert.equal(focusFor(sim, 1).smudge.size, 0, 'empty hands');
    const towel = g.towels[0]; towel.pickup(p); towel.consume(1);
    const focus = focusFor(sim, 1);
    assert.equal(focus.smudge.size, 0, 'half-used towel'); assert.ok(focus.stains.size > 0, 'it still highlights its own work');
  } finally { sim.dispose(); }
  const pve = new Simulation(getLevel('highway-02')!); try {
    pve.occupy(0, true); pve.phase = 'game'; pve.game.start(pve.director.base);
    for (let i = 0; pve.game.orders.length < 1 && i < 600; i++) pve.tick();
    const towel = pve.game.towels[0]; towel.pickup(pve.players[0]); towel.consume(WASH_CONFIG.towelDurability);
    assert.equal(focusFor(pve, 0).smudge.size, 0);
  } finally { pve.dispose(); }
});

test('a dirty towel away from any enemy stain says where to go', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, p = sim.players[1], home = sim.trucks[0];
    p.state = 'ground'; p.ground = { truck: home, plat: home.platformAt(home.pos.x + 3, home.pos.z, .3) }; p.pos.set(home.pos.x + 3, home.topY, home.pos.z);
    const towel = g.towels[0]; towel.pickup(p); towel.consume(WASH_CONFIG.towelDurability); p.skipUse = false;
    g.interact(p, packetInput({ seq: 1, move: [0, 0], axis: [0, 0], down: [], hits: [] }), dt);
    assert.equal(p.interactionHint, '毛巾已脏：去对面抹脏，或带回洗面台');
    towel.smear(WASH_CONFIG.towelDurability); g.interact(p, packetInput({ seq: 2, move: [0, 0], axis: [0, 0], down: [], hits: [] }), dt);
    assert.equal(p.interactionHint, '毛巾太脏了，带回洗面台');
  } finally { sim.dispose(); }
});

// ── Water-gun knockback is stronger in versus ──
test('a full jet shoves harder in versus than in the campaign, enough to out-push walking', () => {
  const shove = (levelId: string) => {
    const sim = new Simulation(getLevel(levelId)!); try {
      sim.occupy(0, true); sim.occupy(1, true); sim.phase = 'game'; sim.game.start(sim.director.base);
      const g = sim.game, gun = g.waterguns[0], shooter = sim.players[0], target = sim.players[1];
      gun.pickup(shooter); gun.pressure = 1; target.externalVelocity.set(0, 0, 0);
      const trace = gun.trace; gun.trace = function () { this.hitPlayer = target; this.hitStain = null; }; // aim is covered in water-gun.test.ts
      g.spray(shooter, { down: (k: string) => k === 'KeyJ', hit: () => false }, dt); gun.trace = trace;
      return target.externalVelocity.length();
    } finally { sim.dispose(); }
  };
  const versusPush = shove('versus-01'), campaign = shove('highway-02');
  assert.ok(Math.abs(campaign - WASH_CONFIG.sprayPushSpeed * 0.8) < 1e-6, 'campaign unchanged (shoves at the character scale)');
  assert.ok(Math.abs(versusPush - PVP_TUNING.sprayPushSpeed * 0.8) < 1e-6);
  assert.ok(versusPush > 5.5 * 0.64, 'stronger than walking speed');
});

// ── Soap: versus washes with soap too, and soap in hand makes the other team slippery (contagious, 3 s, 1 s immunity) ──
import { SLIPPERY, spreadSlippery } from '../shared/sim/Slippery.js';
const still = packetInput({ seq: 1, move: [0, 0], axis: [0, 0], down: [], hits: [] });
const walkX = packetInput({ seq: 1, move: [1, 0], axis: [1, 0], down: [], hits: [] });
function placeOnHome(sim: Simulation, slot: number, dx: number, dz = 0) {
  const p = sim.players[slot], home = sim.trucks[0], x = home.pos.x + dx, z = home.pos.z + dz;
  p.state = 'ground'; p.ground = { truck: home, plat: home.platformAt(x, z, .3) }; p.pos.set(x, home.topYAt(x, z), z); return p;
}

test('versus trucks carry a soap → water → towel stain and the soap box is open', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game;
    assert.ok(g.equipmentEnabled('soap')); assert.equal(g.soapBox.visible, true);
    for (const o of g.orders) assert.deepEqual(o.stains.map((s: any) => s.steps.join('>')), ['towel', 'water>towel', 'soap>water>towel']);
    // Soap works on your own truck exactly like the campaign.
    const blue = teamTruck(sim, 0), grease = blue.stains[2], p = sim.players[0];
    const soapBar = g.takeSoap(); soapBar.pickup(p);
    const at = grease.mesh.getWorldPosition(new THREE.Vector3());
    p.state = 'ground'; p.ground = { truck: blue.truck, plat: blue.truck.platformAt(at.x, at.z, .3) }; p.pos.set(at.x, blue.truck.topY, at.z); p.skipUse = false;
    hold(sim, p, WASH_CONFIG.soapSeconds + .2);
    assert.equal(grease.stage, 1, 'soap step done'); assert.equal(soapBar.active, false, 'the bar is used up like the campaign');
  } finally { sim.dispose(); }
});

test('soap in hand makes a touched opponent slippery, never a teammate', () => {
  const sim = versus([0, 1, 2, 3]); try {            // 0 blue, 1 red, 2 blue, 3 red
    const g = sim.game, soapBar = g.takeSoap(), a = placeOnHome(sim, 0, -1);
    soapBar.pickup(a);
    placeOnHome(sim, 2, -1 + .6);                    // teammate touching
    const mask = spreadSlippery(sim.players, 0);
    assert.equal(sim.players[2].slipperyRemaining, 0, 'teammates are safe from the soap in hand');
    placeOnHome(sim, 1, -1, .6);                     // opponent touching
    spreadSlippery(sim.players, mask);
    assert.equal(sim.players[1].slipperyRemaining, SLIPPERY.seconds);
    assert.equal(a.slipperyRemaining, 0, 'holding soap does not make you slippery');
  } finally { sim.dispose(); }
});

test('slippery spreads to anyone newly touched, resets to 3 s on a new bump, and leaves 1 s of immunity', () => {
  const sim = versus([0, 1, 2, 3]); try {
    const [b0, r1, b2] = sim.players;
    placeOnHome(sim, 1, 0); r1.slipperyRemaining = SLIPPERY.seconds;
    placeOnHome(sim, 2, .6);                         // slot 2 is blue: contagion ignores teams
    placeOnHome(sim, 0, 3);                          // far away
    let mask = spreadSlippery(sim.players, 0);
    assert.equal(b2.slipperyRemaining, SLIPPERY.seconds); assert.equal(b0.slipperyRemaining, 0);
    r1.slipperyRemaining = 1; mask = spreadSlippery(sim.players, mask);
    assert.equal(r1.slipperyRemaining, 1, 'staying pressed together does not re-trigger');
    placeOnHome(sim, 2, 2); mask = spreadSlippery(sim.players, mask);   // part...
    placeOnHome(sim, 2, .6); mask = spreadSlippery(sim.players, mask);  // ...and bump again
    assert.equal(r1.slipperyRemaining, SLIPPERY.seconds, 'a new bump resets the timer');
    // Wear off, then immunity.
    placeOnHome(sim, 2, 3.6); mask = spreadSlippery(sim.players, mask);
    for (let i = 0; i < Math.ceil(SLIPPERY.seconds * 60) + 2; i++) r1.update(dt, 0, still, [sim.trucks[0]], sim.camera, 30);
    assert.equal(r1.slipperyRemaining, 0); assert.ok(r1.slipperyImmunity > 0 && r1.slipperyImmunity <= SLIPPERY.immunity);
    placeOnHome(sim, 1, 0); b2.slipperyRemaining = SLIPPERY.seconds; placeOnHome(sim, 2, .6); mask = spreadSlippery(sim.players, mask);
    assert.equal(r1.slipperyRemaining, 0, 'immune right after it wears off');
    for (let i = 0; i < 62; i++) r1.update(dt, 0, still, [sim.trucks[0]], sim.camera, 30);
    placeOnHome(sim, 1, 0); placeOnHome(sim, 2, 2); mask = spreadSlippery(sim.players, mask);
    placeOnHome(sim, 2, .6); spreadSlippery(sim.players, mask);
    assert.equal(r1.slipperyRemaining, SLIPPERY.seconds, 'catchable again after the immunity');
  } finally { sim.dispose(); }
});

test('soaping someone and staying in contact does not soap you back (real ticks)', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, soapBar = g.takeSoap(), a = placeOnHome(sim, 0, -1), b = placeOnHome(sim, 1, -1 + .6);
    soapBar.pickup(a);
    for (let i = 0; i < 6; i++) sim.tick();
    assert.ok(b.slipperyRemaining > 2.8, 'the opponent is soaped');
    // Keep pushing into them for a second: no transfer back.
    sim.inputs[0] = { seq: 1, move: [1, 0], axis: [1, 0], down: [], hits: [] } as any;
    for (let i = 0; i < 60; i++) { sim.tick(); if (a.state !== 'ground') break; }
    assert.equal(a.slipperyRemaining, 0);
    // Drop the soap, part, then the soaped player bumps back into them: that one counts.
    g.drop(a); sim.inputs[0] = { seq: 2, move: [0, 0], axis: [0, 0], down: [], hits: [] } as any;
    placeOnHome(sim, 0, -1); placeOnHome(sim, 1, 1.5); sim.tick();
    b.slipperyRemaining = SLIPPERY.seconds; placeOnHome(sim, 1, -1 + .6); sim.tick();
    assert.ok(a.slipperyRemaining > 2.9);
  } finally { sim.dispose(); }
});

test('slippery movement has inertia: slow to start, keeps sliding after letting go', () => {
  const sim = versus([0, 1]); try {
    const home = sim.trucks[0], step = (p: any, input: any, n: number) => { for (let i = 0; i < n; i++) p.update(dt, 0, input, [home], sim.camera, 30); };
    const normal = placeOnHome(sim, 0, -2), slick = placeOnHome(sim, 1, -2, -.8); // on the box roof, clear of the soap crate
    normal.yaw = slick.yaw = 0; slick.slipperyRemaining = SLIPPERY.seconds; slick.iceVelocity.set(0, 0, 0);
    const n0 = normal.pos.x, s0 = slick.pos.x;
    step(normal, walkX, 12); step(slick, walkX, 12);       // 0.2 s of walking
    const walked = normal.pos.x - n0, slid = slick.pos.x - s0;
    assert.ok(walked > 0.6, `normal walks at once (${walked})`); assert.ok(slid < walked * .4, `ice is slow to start (${slid})`);
    // Let go: normal stops dead; slippery keeps going.
    step(slick, walkX, 60);
    const n1 = normal.pos.x, s1 = slick.pos.x;
    step(normal, still, 30); step(slick, still, 30);
    assert.ok(Math.abs(normal.pos.x - n1) < 1e-6, 'normal stops at once');
    assert.ok(slick.pos.x - s1 > .8, `slippery coasts (${slick.pos.x - s1})`);
  } finally { sim.dispose(); }
});

test('stepping on soap still slips like the campaign, even with soap in hand', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, home = sim.trucks[0], floor = g.takeSoap(), carried = g.takeSoap(), p = placeOnHome(sim, 0, -2);
    carried.pickup(p);
    floor.placeOn(home, new THREE.Vector3(p.pos.x - home.pos.x + .25, 0, p.pos.z - home.pos.z));
    p.yaw = 0; p.skipUse = false; sim.inputs[0] = { seq: 1, move: [1, 0], axis: [1, 0], down: [], hits: [] } as any;
    let slipped = false;
    for (let i = 0; i < 30 && !slipped; i++) { sim.tick(); slipped = p.slipRemaining > 0; }
    assert.ok(slipped);
  } finally { sim.dispose(); }
});

test('campaign players never become slippery, even when soap touches them', () => {
  const sim = new Simulation(getLevel('highway-03')!); try {
    sim.occupy(0, true); sim.occupy(1, true); sim.phase = 'game'; sim.game.start(sim.director.base);
    for (let i = 0; i < 300; i++) sim.tick();
    const g = sim.game, soapBar = g.takeSoap(); soapBar.pickup(sim.players[0]);
    placeOnHome(sim, 0, -1); placeOnHome(sim, 1, -1, .5);
    for (let i = 0; i < 10; i++) sim.tick();
    assert.equal(sim.players[1].slipperyRemaining, 0);
  } finally { sim.dispose(); }
});

test('slipperiness reaches viewers and is urgent', () => {
  const host = versus([0, 1]), peer = new Simulation(getLevel('versus-01')!); try {
    const before = host.urgentSignature(); host.players[1].slipperyRemaining = 2.5; host.players[1].iceVelocity.set(1, 0, 2);
    assert.notEqual(host.urgentSignature(), before);
    applyPlayer(peer.players[1], host.snapshot().players[1], peer.trucks);
    assert.equal(peer.players[1].slipperyRemaining, 2.5); assert.deepEqual(peer.players[1].iceVelocity.toArray(), [1, 0, 2]);
  } finally { host.dispose(); peer.dispose(); }
});

// ── Wrong tool: a J press next to a stain whose step needs another tool pops the right tool (own truck, co-op too) ──
import { wrongToolStain } from '../client/js/ui/WrongToolHint.js';
function standNext(sim: Simulation, slot: number, order: any, stain: any) {
  const p = sim.players[slot], at = stain.mesh.getWorldPosition(new THREE.Vector3());
  p.state = 'ground'; p.ground = { truck: order.truck, plat: order.truck.platformAt(at.x, at.z, .3) }; p.pos.set(at.x, order.truck.topY, at.z);
  return p;
}

test('wrong tool on your own stain names the stain; the right tool or the enemy truck does not', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, own = teamTruck(sim, sim.players[0].team), enemy = teamTruck(sim, sim.players[1].team);
    const mud = own.stains.find((s: any) => s.steps[0] === 'water');
    // Keep other stains out of reach so only `mud` is near.
    for (const s of own.stains) if (s !== mud) s.done = true;
    const p = standNext(sim, 0, own, mud), towel = g.towels[0]; towel.pickup(p);
    assert.equal(wrongToolStain(g, p), mud, 'towel on a stain that needs the gun first');
    towel.release(null); g.waterguns[0].pickup(p);
    assert.equal(wrongToolStain(g, p), null, 'the right tool: no hint');
    mud.stage = 1; assert.equal(wrongToolStain(g, p), mud, 'gun on the towel step');
    g.waterguns[0].release(null); assert.equal(wrongToolStain(g, p), null, 'empty hands: no hint');
    const eMud = enemy.stains.find((s: any) => s.steps[0] === 'water'); for (const s of enemy.stains) if (s !== eMud) s.done = true;
    standNext(sim, 0, enemy, eMud); g.towels[1].pickup(p);
    assert.equal(wrongToolStain(g, p), null, 'never on the other team\'s truck');
  } finally { sim.dispose(); }
});

test('a dirty towel, or a right-tool stain also in reach, shows no wrong-tool hint', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, own = teamTruck(sim, sim.players[0].team), mud = own.stains.find((s: any) => s.steps[0] === 'water');
    for (const s of own.stains) if (s !== mud) s.done = true;
    const p = standNext(sim, 0, own, mud), towel = g.towels[0]; towel.pickup(p);
    towel.consume(WASH_CONFIG.towelDurability); assert.equal(wrongToolStain(g, p), null, 'dirty towel has its own hint');
    towel.clean();
    const dust = own.stains.find((s: any) => s.steps[0] === 'towel'); dust.done = false;
    dust.mesh.position.copy(mud.mesh.position);
    assert.equal(wrongToolStain(g, p), null, 'J wipes the dust in reach, so it is not a mistake');
  } finally { sim.dispose(); }
});

test('the campaign gets the same wrong-tool hint', () => {
  const sim = new Simulation(getLevel('highway-03')!); try {
    sim.occupy(0, true); sim.phase = 'game'; sim.game.start(sim.director.base);
    for (let i = 0; !(sim.game.orders[0]?.arrivalProgress === 1) && i < 60 * 40; i++) sim.tick();
    const g = sim.game, order = g.orders[0], stain = order.stains.find((s: any) => s.steps[0] !== 'towel') || order.stains[0];
    for (const s of order.stains) if (s !== stain) s.done = true;
    const p = standNext(sim, 0, order, stain), wrongKind = stain.steps[stain.stage] === 'towel' ? 'water' : 'towel';
    (wrongKind === 'towel' ? g.towels[0] : g.waterguns[0]).pickup(p);
    assert.equal(wrongToolStain(g, p), stain);
  } finally { sim.dispose(); }
});

test('applying a two-truck snapshot keeps both orders and does not rebuild their stains', () => {
  const host = versus([0, 1]), peer = new Simulation(getLevel('versus-01')!); try {
    peer.game.viewOnly = true;
    const world = { game: peer.game, trucks: peer.trucks, players: peer.players };
    let rebuilt = 0; const hud = peer.game.hud, set = hud.setStains; hud.setStains = (...a: any[]) => { rebuilt++; return set.apply(hud, a); };
    applyWorld(world, host.snapshot());
    assert.equal(peer.game.orders.length, 2);
    const stains = peer.game.orders.flatMap((o: any) => o.stains), before = rebuilt;
    for (let i = 0; i < 5; i++) { host.tick(); applyWorld(world, host.snapshot()); }
    assert.equal(peer.game.orders.length, 2, 'the legacy `order` field no longer truncates `orders`');
    assert.equal(rebuilt, before, 'no stain respawn (and no HUD rebuild) on a steady snapshot');
    assert.ok(peer.game.orders.flatMap((o: any) => o.stains).every((s: any, i: number) => s === stains[i]));
  } finally { host.dispose(); peer.dispose(); }
});

// ── Departing truck: gentle start, and a jump off it does not fling the player down the road ──
import { DEPARTURE } from '../shared/sim/VehicleBehaviors.js';
function jumpHomeFromDeparting(levelId: string, delay: number, localX: number) {
  let seq = 1;
  const send = (sim: any, move: number[], hits: string[] = []) => sim.input(0, { seq: seq++, move, axis: [0, 0], down: [], hits });
  const sim: any = new Simulation(getLevel(levelId)!); sim.occupy(0, true); sim.connected[0] = true; sim.phase = 'game'; sim.game.start(sim.director.base);
  try {
    const g = sim.game;
    for (let i = 0; !(g.orders.length >= 1 && g.orders.every((o: any) => o.arrivalProgress === 1)) && i < 4000; i++) { send(sim, [0, 0]); sim.tick(); }
    const order = g.orders[0], truck = order.truck, home = g.homeTruck, p = sim.players[0], toward = Math.sign(home.pos.z - truck.pos.z) || 1;
    const x = truck.pos.x + localX, z = truck.pos.z + toward * (truck.halfWidth - 0.35);
    p.state = 'ground'; p.ground = { truck, plat: truck.platformAt(x, z, .3) }; p.pos.set(x, truck.topY, z);
    for (const s of order.stains) { s.stage = s.steps.length; s.done = true; } g.completeOrder(order);
    for (let i = 0; i < Math.round(delay * 60); i++) { send(sim, [0, 0]); sim.tick(); }
    if (p.state !== 'ground') return 'already off';
    send(sim, [0, toward], ['Space']); sim.tick();
    for (let i = 0; i < 240; i++) { send(sim, [0, toward]); sim.tick(); if (p.state === 'ground') return p.ground.truck === home ? 'home' : 'same'; if (p.state === 'fallen') return 'fell'; }
    return 'air';
  } finally { sim.dispose(); }
}

test('a washed truck creeps away for DEPARTURE.slowSeconds before speeding off', () => {
  const sim = versus([0, 1]); try {
    const blue = teamTruck(sim, 0);
    for (const s of blue.stains) finishStain(sim, blue, s);
    assert.equal(blue.mode, 'leaving'); assert.equal(blue.truck.departing, true);
    let fastest = 0;
    for (let i = 0; i < Math.floor(DEPARTURE.slowSeconds * 60) - 2; i++) { sim.tick(); fastest = Math.max(fastest, blue.truck.vel.x); }
    assert.ok(fastest <= DEPARTURE.slowSpeed + 1e-9, `gentle phase stays at or below ${DEPARTURE.slowSpeed} m/s (${fastest})`);
    for (let i = 0; i < 60 * 2; i++) sim.tick();
    assert.ok(blue.truck.vel.x > 10, 'then it speeds off as before');
  } finally { sim.dispose(); }
});

test('holding toward the home truck and jumping during the gentle phase lands on it, from anywhere on the roof', () => {
  for (const levelId of ['versus-01', 'highway-03']) for (const localX of [-4, 0, 3.6, 4.8]) for (const delay of [0.1, 0.8, 1.5]) {
    assert.equal(jumpHomeFromDeparting(levelId, delay, localX), 'home', `${levelId} x=${localX} after ${delay}s`);
  }
});

test('leaving a departing truck keeps at most DEPARTURE.carrySpeed of its velocity; a docked truck keeps all of it', () => {
  const sim = versus([0, 1]); try {
    const blue = teamTruck(sim, 0), p = sim.players[0];
    blue.truck.vel.set(20, 0, 1);
    blue.truck.departing = true;
    const carried = p.carried(blue.truck);
    assert.ok(Math.abs(Math.hypot(carried.x, carried.z) - DEPARTURE.carrySpeed) < 1e-9);
    blue.truck.departing = false;
    const full = p.carried(blue.truck); assert.equal(full.x, 20); assert.equal(full.z, 1);
  } finally { sim.dispose(); }
});

test('a viewer marks the departing truck from the snapshot, so prediction caps the same jump', () => {
  const host = versus([0, 1]), peer = new Simulation(getLevel('versus-01')!); try {
    peer.game.viewOnly = true;
    const blue = teamTruck(host, 0);
    for (const s of blue.stains) finishStain(host, blue, s);
    host.tick();
    applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, host.snapshot());
    const view = peer.game.orders.find((o: any) => o.serial === blue.serial);
    assert.equal(view.mode, 'leaving'); assert.equal(view.truck.departing, true); assert.ok(view.leaveAge > 0);
  } finally { host.dispose(); peer.dispose(); }
});
