/** Per-player match record (shared/sim/PlayerStats.js): host tallies through the real action paths, viewers get the same
 * numbers from the snapshot, and points/titles derive identically everywhere. Also the tutorial's lent elephant. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Simulation } from '../shared/sim/RoomSimulation.js';
import { getLevel } from '../shared/levels.js';
import { applyWorld, applyPlayer } from '../shared/snapshot.js';
import { quantize } from '../shared/delta.js';
import { packetInput } from '../shared/protocol.js';
import { STAT_KEYS, statPoints, rankPlayers, packStats, unpackStats, emptyStats, KNOCKOFF_SECONDS } from '../shared/sim/PlayerStats.js';
import { WASH_CONFIG } from '../shared/sim/washConfig.js';

const dt = 1 / 60;
const keys = (down: string[] = [], hits: string[] = down) => packetInput({ seq: 1, move: [0, 0], axis: [0, 0], down, hits });
const teamTruck = (sim: Simulation, team: number) => sim.game.orders.find((o: any) => o.team === team);

function versus(slots: number[], teams = slots.map((_, i) => i % 2)) {
  const sim = new Simulation(getLevel('versus-01')!);
  slots.forEach((slot, i) => { sim.occupy(slot, true); sim.setTeam(slot, teams[i]); });
  sim.phase = 'game'; sim.game.start(sim.director.base);
  for (let i = 0; !(sim.game.orders.length === 2 && sim.game.orders.every((o: any) => o.arrivalProgress === 1)) && i < 1200; i++) sim.tick();
  return sim;
}
function standAt(p: any, order: any, stain: any) {
  const at = stain.mesh.getWorldPosition(new THREE.Vector3());
  p.state = 'ground'; p.ground = { truck: order.truck, plat: order.truck.platformAt(at.x, at.z, .3) };
  p.pos.set(at.x, order.truck.topY, at.z); p.skipUse = false;
}
/** Two players face to face on a clear spot of the home roof. */
function faceOff(sim: Simulation, a: any, b: any) {
  const g: any = sim.game, home = g.homeTruck;
  for (const tool of g.tools) if (tool.holder) g.drop(tool.holder);
  for (const x of [-3, -2, -1, 0, 1, 2, 3]) for (const z of [-1.5, -0.5, 0.5, 1.5]) {
    a.pos.set(home.pos.x + x, home.topY, home.pos.z + z); a.yaw = 0; a.state = 'ground'; a.ground = { truck: home, plat: home.platforms[0] };
    b.pos.set(home.pos.x + x + 0.8, home.topY, home.pos.z + z); b.yaw = Math.PI; b.state = 'ground'; b.ground = { truck: home, plat: home.platforms[0] };
    a.externalVelocity.set(0, 0, 0); b.externalVelocity.set(0, 0, 0);
    if (!g.emptyHandTarget(a).tool && !g.nearSoapBox(a)) return;
  }
  throw new Error('no clear spot');
}

test('wiping your own truck counts work and the finished stain; the enemy truck gives no work', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, blue = teamTruck(sim, 0), stain = blue.stains[0], p = sim.players[0];
    standAt(p, blue, stain); g.towels[0].pickup(p); p.skipUse = false;
    for (let i = 0; i < 240 && !stain.done; i++) g.interact(p, keys(['KeyJ'], []), dt);
    assert.equal(stain.done, true);
    assert.ok(Math.abs(g.stats[0].work - 1) < 1e-6, 'one whole towel step'); assert.equal(g.stats[0].stains, 1);
    assert.deepEqual(statPoints(g.stats[0], 'versus'), { contribution: 15, disruption: 0, mischief: 0, rating: 15 });
    assert.equal(g.stats[1].work, 0, 'nobody else is credited');
  } finally { sim.dispose(); }
});

test('smearing the enemy truck counts as disruption (sabotage)', () => {
  const sim = versus([0, 1]); try {
    const g = sim.game, red = teamTruck(sim, 1), stain = red.stains[0], p = sim.players[0]; // slot 0 is red's enemy (blue)
    stain.stage = stain.steps.length; stain.done = true; stain.progress = 0;
    standAt(p, red, stain); const towel = g.towels[0]; towel.pickup(p); towel.consume(WASH_CONFIG.towelDurability); p.skipUse = false;
    for (let i = 0; i < 30; i++) g.interact(p, keys(['KeyJ'], []), dt);
    assert.ok(g.stats[0].sabotage > 0.3, 'undone progress is tallied'); assert.equal(g.stats[0].work, 0);
    assert.ok(statPoints(g.stats[0], 'versus').disruption > 0);
  } finally { sim.dispose(); }
});

test('a slap on the enemy is disruption; on a teammate it is only recorded for the 内鬼 title and never scores; a fall soon after credits a knock-off', () => {
  const sim = versus([0, 1, 2], [0, 1, 0]); try {
    const g = sim.game, [a, enemy, mate] = sim.players;
    faceOff(sim, a, enemy);
    g.interact(a, keys(['KeyK']), dt);
    assert.deepEqual([g.stats[0].slaps, g.stats[1].slapped, g.stats[0].friendly], [1, 1, 0]);
    // The enemy falls off within the window: the slapper gets the knock-off.
    const signature = sim.urgentSignature();
    enemy.fallOut();
    assert.deepEqual([g.stats[0].knockoffs, g.stats[1].falls], [1, 1]);
    // Knock-off feedback ("砰～!"): the attacker's serial and the victim's slot, sent at once and carried by the snapshot.
    assert.deepEqual([a.knockoutSerial, a.knockoutVictim, enemy.knockoutSerial], [1, 1, 0]);
    assert.notEqual(sim.urgentSignature(), signature);
    const data = quantize(sim.snapshot()) as any;
    assert.deepEqual(data.players[0].ko, [1, 1]);
    const view = versus([0, 1, 2], [0, 1, 0]); try {
      applyPlayer(view.players[0], data.players[0], view.trucks);
      assert.deepEqual([view.players[0].knockoutSerial, view.players[0].knockoutVictim], [1, 1]);
    } finally { view.dispose(); }
    // A teammate: recorded for the title, no points either way.
    a.slapCooldown = 0; faceOff(sim, a, mate); g.interact(a, keys(['KeyK'], ['KeyK']), dt);
    assert.deepEqual([g.stats[0].slaps, g.stats[0].friendly, g.stats[2].slapped], [1, 1, 1]);
    const points = statPoints(g.stats[0], 'versus');
    assert.equal('penalty' in points, false); assert.equal(points.rating, points.contribution + points.disruption, 'no penalty');
    assert.equal(points.disruption, 2 + 8, 'the teammate slap adds nothing');
  } finally { sim.dispose(); }
});

test('a fall long after the shove is not a knock-off; co-op slaps are mischief and never cost work', () => {
  const sim = new Simulation(getLevel('highway-02')!); try {
    sim.occupy(0, true); sim.occupy(1, true); sim.phase = 'game'; sim.game.start(sim.director.base);
    const g = sim.game, [a, b] = sim.players;
    faceOff(sim, a, b); g.interact(a, keys(['KeyK']), dt);
    assert.equal(g.stats[0].slaps, 1, 'co-op counts the slap'); assert.equal(g.stats[0].friendly, 0, 'co-op has no friendly fire');
    g.tally.advance(KNOCKOFF_SECONDS + 0.1); b.fallOut();
    assert.deepEqual([g.stats[0].knockoffs, g.stats[1].falls], [0, 1]);
    assert.equal(a.knockoutSerial, 0, 'no knock-off feedback for a late fall');
    assert.deepEqual(statPoints(g.stats[0], 'coop'), { contribution: 0, disruption: 0, mischief: 2, rating: 0 });
  } finally { sim.dispose(); }
});

test('nothing is tallied at home, while reading/Ready, paused or after the end', () => {
  const sim = new Simulation(getLevel('highway-02')!); try {
    sim.occupy(0, true); sim.occupy(1, true);
    const g = sim.game, [a, b] = sim.players;
    faceOff(sim, a, b); g.interact(a, keys(['KeyK']), dt);
    assert.equal(g.stats[0].slaps, 0, 'home practice');
    sim.phase = 'game'; g.start(sim.director.base); g.paused = true; a.slapCooldown = 0;
    faceOff(sim, a, b); g.tally.add(a, 'work', 1); assert.equal(g.stats[0].work, 0, 'paused');
    g.paused = false; g.finish('time_up'); g.tally.add(a, 'work', 1); assert.equal(g.stats[0].work, 0, 'ended');
  } finally { sim.dispose(); }
});

test('the record reaches viewers through the snapshot and survives quantization; the result carries the roster', () => {
  const host = versus([0, 1]), peer = new Simulation(getLevel('versus-01')!); try {
    peer.game.viewOnly = true;
    const g = host.game; g.stats[0].work = 1.234567; g.stats[1].slaps = 3; g.stats[1].sabotage = 0.5;
    applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, quantize(host.snapshot()));
    assert.equal(peer.game.stats[0].work, 1.23); assert.equal(peer.game.stats[1].slaps, 3); assert.equal(peer.game.stats[1].sabotage, 0.5);
    assert.equal(peer.game.stats.length, peer.players.length);
    g.finish('time_up');
    assert.deepEqual(g.result.roster.map((r: any) => [r.slot, r.team, r.bot]), [[0, 0, false], [1, 1, false]]);
    assert.equal(g.result.roster[1].stats[STAT_KEYS.indexOf('slaps')], 3);
  } finally { host.dispose(); peer.dispose(); }
});

test('pack/unpack is lossless to 0.01 and tolerates missing or malformed rows', () => {
  const stats = [emptyStats(), emptyStats()]; stats[0].charge = 7.256; stats[1].falls = 2;
  assert.deepEqual(unpackStats(packStats(stats), 2).map((s: any) => [s.charge, s.falls]), [[7.26, 0], [0, 2]]);
  assert.deepEqual(unpackStats(undefined, 1), [emptyStats()]);
  assert.deepEqual(unpackStats([[NaN, -1, 'x']], 1), [emptyStats()]);
});

test('ranking and titles: MVP from the winners, one title per player, ties award nobody, the slacker needs a crowd', () => {
  const row = (slot: number, team: number, stats: any) => ({ slot, team, stats: { ...emptyStats(), ...stats } });
  const ranked = rankPlayers([
    row(0, 0, { work: 6, stains: 2 }),               // 70 work
    row(1, 0, { sabotage: 3, slaps: 4 }),            // 38 disruption
    row(2, 1, { work: 9, stains: 3 }),               // 105 work, best overall but on the losing side
    row(3, 1, { slaps: 1, slapped: 5, falls: 2 }),   // 2
  ], { mode: 'versus', winner: 0 });
  const title = (slot: number) => ranked.find(r => r.slot === slot)!.title;
  assert.equal(ranked[0].slot, 2); assert.equal(ranked[0].rank, 1);
  assert.equal(title(0), 'mvp', 'MVP comes from the winning team');
  assert.equal(title(1), 'villain'); assert.equal(title(2), 'worker'); assert.equal(title(3), 'punchbag');
  assert.equal(new Set(ranked.map(r => r.title)).size, 4, 'one title each');
  const tie = rankPlayers([row(0, null as any, { slaps: 4 }), row(1, null as any, { slaps: 4 })], { mode: 'coop' });
  assert.ok(tie.every(r => r.title === null), 'a shared top value is no title'); assert.deepEqual(tie.map(r => r.rank), [1, 1]);
  const traitor = rankPlayers([row(0, 0, { work: 5 }), row(1, 0, { friendly: 3 })], { mode: 'versus', winner: 1 });
  assert.equal(traitor.find(r => r.slot === 1)!.title, 'traitor'); assert.equal(traitor.find(r => r.slot === 1)!.points.rating, 0, '内鬼 costs nothing');
  const crowd = rankPlayers([row(0, 0, { work: 5 }), row(1, 0, { work: 4 }), row(2, 1, { work: 0.1 })], { mode: 'versus', winner: 0 });
  assert.equal(crowd.find(r => r.slot === 2)!.title, 'slacker');
  assert.ok(rankPlayers([row(0, 0, {}), row(1, 1, {})], { mode: 'versus', winner: null }).every(r => r.title === null), 'a quiet match awards nothing');
});

test('tutorial L lesson lends the elephant only to players without an L skill, syncs the body and gives it back', () => {
  const host = new Simulation(getLevel('highway-01')!), peer = new Simulation(getLevel('highway-01')!); try {
    peer.game.viewOnly = true; peer.setAnimal(0, 'dog'); // a viewer takes the roster animal from the room
    for (const slot of [0, 1, 2]) host.occupy(slot, true);
    host.setAnimal(0, 'dog'); host.setAnimal(1, 'pelican'); host.setAnimal(2, 'elephant');
    host.phase = 'game'; host.game.start(host.director.base);
    const script = host.game.levelScript, skill = host.game.level.script.steps.findIndex((s: any) => s.id === 'skill');
    script.enter(skill);
    const [dog, pelican, elephant] = host.players;
    assert.deepEqual([dog.animal, pelican.animal, elephant.animal], ['elephant', 'pelican', 'elephant']);
    assert.deepEqual([dog.morph, pelican.morph, elephant.morph], ['elephant', '', '']);
    assert.equal(host.game.equipmentEnabled('water'), false); assert.equal(host.game.trunksEnabled(), true, 'the lent trunk works and renders');
    host.setAnimal(0, 'dog'); assert.equal(dog.animal, 'elephant', 'a roster refresh keeps the lent body');
    assert.notEqual(host.urgentSignature(), '', 'signature includes the lent body');
    applyPlayer(peer.players[0], quantize(host.snapshot()).players[0], peer.trucks);
    assert.deepEqual([peer.players[0].morph, peer.players[0].animal, peer.players[0].morphSerial], ['elephant', 'elephant', 1]);
    // Pelican L counts as using the skill; nobody else has yet.
    host.input(1, { seq: 1, move: [0, 0], axis: [0, 0], down: [], hits: ['KeyL'] }); host.tick();
    const entries = host.game.tutorial.dots.entries;
    assert.deepEqual(entries.map((e: any) => e.complete), [false, true, false]);
    script.enter(skill + 1);
    assert.deepEqual([dog.morph, dog.animal, dog.morphSerial], ['', 'dog', 2]);
    assert.equal(host.game.trunksEnabled(), false, 'no trunk water after the lesson until water is unlocked');
    applyPlayer(peer.players[0], quantize(host.snapshot()).players[0], peer.trucks);
    assert.deepEqual([peer.players[0].morph, peer.players[0].animal, peer.players[0].morphSerial], ['', 'dog', 2]);
    script.enter(skill); host.command('home');
    assert.equal(dog.morph, '', 'returning home ends the lesson body');
  } finally { host.dispose(); peer.dispose(); }
});

test('glide wind streams from both wingtips of a gliding goose or pelican, and from nobody else', async () => {
  const THREE_ = await import('three');
  const { GlideWind } = await import('../client/js/fx/GlideWind.js');
  const bird = (animal: string) => {
    const bones = { pawL: new THREE_.Object3D(), pawR: new THREE_.Object3D() };
    return { animal, gliding: true, state: 'air', occupied: true, root: { visible: true }, yaw: 0, vel: new THREE_.Vector3(5, -1, 0), bodies: { [animal]: { bones } } };
  };
  for (const [animal, streams] of [['goose', true], ['pelican', true], ['cat', false]] as const) {
    const wind = new GlideWind(new THREE_.Scene(), { players: [bird(animal)] });
    wind.update(0.1);
    assert.equal(wind.mesh.geometry.instanceCount > 0, streams, animal);
    wind.dispose();
  }
});

test('the tutorial dummy is hit only by an empty-handed slap in reach and in front, never counts as a player slap, and syncs', async () => {
  const { DUMMY } = await import('../shared/sim/TrainingDummy.js');
  const host = new Simulation(getLevel('highway-01')!), peer = new Simulation(getLevel('highway-01')!); try {
    peer.game.viewOnly = true;
    host.occupy(0, true); host.phase = 'game'; host.game.start(host.director.base);
    const g = host.game, p = host.players[0], dummy = g.dummy;
    const stand = (dx: number, yaw: number) => { const at = dummy.worldPosition(); p.state = 'ground'; p.ground = { truck: g.homeTruck, plat: g.homeTruck.platforms[0] };
      p.pos.set(at.x + dx, at.y, at.z); p.yaw = yaw; p.slapCooldown = 0; p.externalVelocity.set(0, 0, 0); };
    stand(-0.9, 0); g.interact(p, keys(['KeyK']), dt);
    assert.equal(dummy.hitSerial, 0, 'hidden outside its lesson');
    g.levelScript.enter(g.level.script.steps.findIndex((s: any) => s.id === 'slap'));
    assert.equal(dummy.group.visible, true);
    assert.ok(g.homeTruck.solids.some((s: any) => s.x === DUMMY.position[0] && s.active), 'solid while shown');
    stand(-0.9, Math.PI); g.interact(p, keys(['KeyK']), dt); assert.equal(dummy.hitSerial, 0, 'facing away');
    stand(-2.5, 0); g.interact(p, keys(['KeyK']), dt); assert.equal(dummy.hitSerial, 0, 'out of reach');
    stand(-0.9, 0); assert.equal(dummy.inReach(p), true); g.interact(p, keys([], [])); 
    assert.equal(p.interactionHint, 'J / K 拍打', 'the slap hint points at it');
    g.interact(p, keys(['KeyK']), dt);
    assert.deepEqual([dummy.hitSerial, dummy.hits[0], p.slapSerial > 0], [1, 1, true]);
    assert.ok(p.externalVelocity.x < -1, 'the slapper bounces back'); assert.equal(g.stats[0].slaps, 0, 'not a player slap');
    const before = host.urgentSignature();
    stand(-0.9, 0); g.interact(p, keys(['KeyK']), dt); assert.notEqual(host.urgentSignature(), before, 'a hit goes out at once');
    applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, quantize(host.snapshot()));
    assert.deepEqual([peer.game.dummy.active, peer.game.dummy.hitSerial], [true, 2]);
    host.command('home'); assert.equal(dummy.active, false, 'leaving the round removes it');
  } finally { host.dispose(); peer.dispose(); }
});
