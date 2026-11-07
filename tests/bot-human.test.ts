import test from 'node:test';
import assert from 'node:assert/strict';
import { getLevel } from '../shared/levels.js';
import { packetInput } from '../shared/protocol.js';
import { BOT_DIFFICULTY, DEFAULT_BOT_DIFFICULTY, botProfile, botRandom } from '../shared/sim/bots/BotDifficulty.js';
import { BotBrain, BotTaskBoard } from '../shared/sim/bots/BotBrain.js';
import { Simulation } from './fixtures/Simulation.js';
import { order as authorOrder } from '../shared/levels/authoring.js';
import { solidUnder } from '../shared/sim/Standing.js';
import { enterPlaying } from './helpers/guide.js';

const DT = 1 / 60;
const slapKey = () => packetInput({ seq: 1, move: [0, 0], axis: [0, 0], down: ['KeyK'], hits: ['KeyK'] });

test('difficulty presets: lower is slower, sloppier and picks fewer fights; normal is the default', () => {
  const { easy, normal, hard }: Record<string, any> = BOT_DIFFICULTY;
  assert.equal(DEFAULT_BOT_DIFFICULTY, 'normal'); assert.equal(botProfile(), normal); assert.equal(botProfile('nope'), normal);
  for (const key of ['retaliate', 'aggression']) assert.ok(easy[key] < normal[key] && normal[key] < hard[key], key);
  for (const key of ['ignoreBoard', 'aimAngle', 'aimRange', 'hesitate', 'misjump', 'distract']) assert.ok(easy[key] > normal[key] && normal[key] > hard[key], key);
  assert.ok(easy.recall[0] > normal.recall[0] && normal.recall[0] > hard.recall[0], 'easy takes longest to remember work');
  assert.ok(easy.think[0] > normal.think[0] && normal.think[0] > hard.think[0]);
  const a = botRandom(7), b = botRandom(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()], 'seeded: the same bot repeats its choices');
});

test('a human bot draws among the cheapest jobs, mostly the cheapest; an exact bot always takes the cheapest', () => {
  const sorted = [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }];
  const human = new BotBrain(1, new BotTaskBoard(), BOT_DIFFICULTY.normal, botRandom(3));
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < 2000; i++) counts[human.pick(sorted).id]++;
  assert.equal(counts[3], 0, 'never beyond the top 3');
  assert.ok(counts[0] > counts[1] && counts[1] > counts[2] && counts[2] > 0, `weighted 1 : ½ : ¼ (${counts})`);
  const exact = new BotBrain(1, new BotTaskBoard());
  assert.equal(exact.pick(sorted).id, 0);
});

/** A versus match with one human (slot 0) and one bot (slot 1) face to face on a clear spot of the central roof. */
function brawl(humanTeam: number, difficulty: any = { ...BOT_DIFFICULTY.normal, retaliate: 1 }) {
  const level: any = getLevel('versus-01');
  const sim = new Simulation({ ...level, script: { ...level.script, orders: [] } } as any);
  sim.game.matchSettings = { scoreTarget: null, timeLimit: null };
  sim.occupy(0, true); sim.setTeam(0, humanTeam);
  sim.placeBots([{ slot: 1, team: 0 }]); sim.bots.setDifficulty(difficulty);
  sim.command('start'); enterPlaying(sim);
  const g: any = sim.game, human = sim.players[0], bot = sim.players[1], home = g.homeTruck;
  for (const tool of g.tools) if (tool.holder) g.drop(tool.holder);
  // The home washer has a low rear deck and a tall box roof: stand both on one level (as slap.test.ts duel() does).
  const place = (p: any, x: number, z: number, yaw: number) => {
    const sx = home.pos.x + x, sz = home.pos.z + z;
    p.pos.set(sx, home.topYAt(sx, sz), sz); p.yaw = yaw; p.externalVelocity.set(0, 0, 0);
    p.state = 'ground'; p.ground = { truck: home, plat: home.platformAt(sx, sz, 0), solid: -1 };
  };
  let found = false;
  for (const x of [-1, 0, 1, -2, -3, -5]) for (const z of [-1.5, -0.5, 0.5, 1.5]) {
    if (found) continue;
    place(human, x, z, 0); place(bot, x + 0.8, z, Math.PI);
    if (human.pos.y === bot.pos.y && !g.emptyHandTarget(human).tool && !g.nearSoapBox(human) && !g.emptyHandTarget(bot).tool && !g.nearSoapBox(bot)) found = true;
  }
  assert.ok(found, 'a clear spot on the roof');
  return { sim, g, human, bot };
}
const run = (sim: any, seconds: number, until: () => boolean = () => false) => { for (let i = 0; i < seconds * 60 && !until(); i++) sim.tick(); };

test('an enemy slap earns an angry emote and one or two slaps back, then the bot calms down', () => {
  // aggression 0: only the grudge may swing (chaos-mode hunting is tested on its own below).
  const { sim, g, human, bot } = brawl(1, { ...BOT_DIFFICULTY.normal, retaliate: 1, aggression: 0 });
  try {
    const emotes = bot.emoteSerial;
    g.interact(human, slapKey(), DT);
    assert.equal(bot.slappedSerial, 1); assert.equal(bot.slappedBy, 0, 'the slapper is remembered (host only)');
    sim.tick(); // the brain notices on its next tick
    assert.ok(sim.bots.controller(1).brain.grudge, 'the bot holds a grudge');
    run(sim, 3, () => !sim.bots.controller(1).brain.grudge);
    assert.equal(bot.emoteSerial, emotes + 1); assert.ok(bot.emoteId === 'angry' || bot.emoteRemaining === 0, 'the angry emote went up');
    assert.ok(bot.slapSerial >= 1 && bot.slapSerial <= 2, `swung back ${bot.slapSerial} time(s)`);
    assert.ok(human.slappedSerial >= 1, 'and landed on the slapper'); assert.equal(human.slappedBy, 1);
    const swings = bot.slapSerial;
    run(sim, 3);
    assert.equal(bot.slapSerial, swings, 'no more swings once the grudge is spent');
  } finally { sim.dispose(); }
});

test('a slapper who keeps hitting gets a fight back: each slap adds swings', () => {
  const { sim, g, human, bot } = brawl(1);
  try {
    const brain = sim.bots.controller(1).brain;
    g.interact(human, slapKey(), DT); sim.tick();
    const first = brain.grudge.swings;
    human.slapCooldown = 0; human.pos.set(bot.pos.x - 0.8, bot.pos.y, bot.pos.z); human.yaw = 0; human.externalVelocity.set(0, 0, 0); bot.externalVelocity.set(0, 0, 0);
    sim.tick(); g.interact(human, slapKey(), DT); sim.tick();
    assert.ok(brain.grudge.swings > first, 'the grudge grew');
  } finally { sim.dispose(); }
});

test('a teammate slap is ignored', () => {
  const { sim, g, bot } = brawl(0);
  try {
    g.interact(sim.players[0], slapKey(), DT);
    assert.equal(bot.slappedSerial, 1);
    assert.equal(sim.bots.controller(1).brain.grudge, null);
    run(sim, 3);
    assert.equal(bot.slapSerial, 0, 'never swung at a teammate');
  } finally { sim.dispose(); }
});

test('a bot holding a tool puts it down before slapping back', () => {
  const { sim, g, human, bot } = brawl(1);
  try {
    const towel = g.towels[0]; towel.pickup(bot); assert.equal(bot.heldTool, towel);
    g.interact(human, slapKey(), DT);
    run(sim, 4, () => bot.slapSerial > 0);
    assert.equal(bot.heldTool, null, 'empty-handed');
    assert.ok(bot.slapSerial > 0, 'then slapped back');
  } finally { sim.dispose(); }
});

test('water aim drifts within the profile limits; an exact bot does not drift', () => {
  const human = new BotBrain(1, new BotTaskBoard(), BOT_DIFFICULTY.easy, botRandom(5));
  let moved = false;
  for (let i = 0; i < 60 * 10; i++) {
    const aim = human.drift(DT);
    assert.ok(Math.abs(aim.angle) <= BOT_DIFFICULTY.easy.aimAngle + 1e-9 && Math.abs(aim.range) <= BOT_DIFFICULTY.easy.aimRange + 1e-9);
    if (Math.abs(aim.angle) > 0.02) moved = true;
  }
  assert.ok(moved, 'the aim actually wanders');
  const exact = new BotBrain(1, new BotTaskBoard());
  for (let i = 0; i < 120; i++) exact.drift(DT);
  assert.deepEqual([exact.aim.angle, exact.aim.range], [0, 0]);
});

/** A versus match with bots in `botSlots` (team 0) and humans in `humans` (slot → team), nothing to wash. */
function idleMatch(botSlots: number[], humans: Record<number, number>, difficulty: any) {
  const level: any = getLevel('versus-01');
  const sim = new Simulation({ ...level, script: { ...level.script, orders: [] } } as any);
  sim.game.matchSettings = { scoreTarget: null, timeLimit: null };
  for (const [slot, team] of Object.entries(humans)) { sim.occupy(Number(slot), true); sim.setTeam(Number(slot), team); }
  sim.placeBots(botSlots.map(slot => ({ slot, team: 0 }))); sim.bots.setDifficulty(difficulty);
  sim.command('start'); enterPlaying(sim);
  for (const tool of sim.game.tools) if (tool.holder) sim.game.drop(tool.holder);
  return sim;
}

test('chaos mode: with no job an aggressive bot hunts an enemy down and slaps them', () => {
  const sim = idleMatch([1], { 0: 1 }, { ...BOT_DIFFICULTY.normal, aggression: 1 });
  try {
    const human = sim.players[0], bot = sim.players[1];
    run(sim, 20, () => human.slappedSerial > 0);
    assert.ok(human.slappedSerial > 0, 'the enemy got slapped'); assert.equal(human.slappedBy, 1);
    assert.equal(sim.bots.controller(1).brain.task.kind, 'idle', 'it was mischief, not work');
    assert.ok(bot.state !== 'fallen');
  } finally { sim.dispose(); }
});

test('chaos mode: a peaceful bot never slaps but never stands still either', () => {
  const sim = idleMatch([1], { 0: 1 }, { ...BOT_DIFFICULTY.normal, aggression: 0 });
  try {
    const bot = sim.players[1], brain = sim.bots.controller(1).brain, kinds = new Set<string>();
    let moved = 0, last = bot.pos.clone();
    for (let i = 0; i < 60 * 40; i++) { // long enough for the seeded antics to vary on any home layout
      sim.tick(); if (brain.act) kinds.add(brain.act.kind);
      moved += bot.pos.distanceTo(last); last.copy(bot.pos);
    }
    assert.equal(bot.slapSerial, 0, 'no slaps at aggression 0');
    assert.ok(!kinds.has('hunt'));
    assert.ok(kinds.size >= 3, `several antics (${[...kinds]})`);
    assert.ok(kinds.has('roam'), 'strolls around');
    assert.ok(moved > 2, `it moved about (${moved.toFixed(1)} m)`);
  } finally { sim.dispose(); }
});

test('chaos mode: no more than huntCap bots of one team chase the same enemy; teammates are never hunted', () => {
  const sim = idleMatch([1, 2, 3], { 0: 1, 4: 0 }, { ...BOT_DIFFICULTY.normal, aggression: 1, huntCap: 2 });
  try {
    const teammate = sim.players[4];
    let most = 0;
    for (let i = 0; i < 60 * 15; i++) {
      sim.tick();
      const hunters = [1, 2, 3].filter(slot => sim.bots.controller(slot).brain.act?.kind === 'hunt' && sim.bots.controller(slot).brain.act.slot === 0).length;
      most = Math.max(most, hunters);
      for (const slot of [1, 2, 3]) assert.notEqual(sim.bots.controller(slot).brain.act?.slot, 4, 'never hunts a teammate');
    }
    assert.ok(most >= 1 && most <= 2, `at most two hunters at once (saw ${most})`);
    assert.ok(!(teammate.slappedSerial > 0 && [1, 2, 3].includes(teammate.slappedBy) && sim.players[0].slappedSerial === 0), 'the enemy, not the teammate, was the target');
  } finally { sim.dispose(); }
});

/** Spawn an order of these stain kinds on a free cargo truck on `side` (as in bot-work.test.ts). */
function spawn(g: any, serial: number, side: number, kinds: string[]) {
  const definition = authorOrder(`bot-${serial}`, 0, side, 'cargo', kinds);
  const vehicleSlot = g.orderTrucks.findIndex((t: any) => t.type === 'cargo' && !g.orders.some((o: any) => o.truck === t));
  return g.spawnOrder(serial, { side, definition, vehicleSlot });
}
/** Put `who` on its feet about `gap` metres from `bot`, on the bot's level with open deck in between (no roof prop). */
function beside(who: any, bot: any, gap = 2, dry = false) {
  const truck = bot.ground?.truck;
  if (!truck) return false;
  for (const [dx, dz] of [[gap, 0], [-gap, 0], [0, gap], [0, -gap]]) {
    const x = bot.pos.x + dx, z = bot.pos.z + dz, plat = truck.platformAt(x, z, 0);
    if (!plat || truck.platTopY(plat) !== bot.pos.y) continue;
    if ([0.25, 0.5, 0.75, 1].some(t => solidUnder(truck, bot.pos.x + dx * t, bot.pos.z + dz * t, 0.4 as any) >= 0)) continue;
    if (dry) return true;
    who.pos.set(x, bot.pos.y, z); who.state = 'ground'; who.ground = { truck, plat, solid: -1 }; who.externalVelocity.set(0, 0, 0);
    return true;
  }
  return false;
}

/** Stand `who` in the middle of some roof platform more than 4 m from `bot`. */
function away(who: any, bot: any, trucks: any[]) {
  for (const truck of trucks) for (const plat of truck.platforms) {
    const x = truck.pos.x + (plat.x0 + plat.x1) / 2, z = truck.pos.z + (plat.z0 + plat.z1) / 2;
    if (Math.hypot(x - bot.pos.x, z - bot.pos.z) < 4) continue;
    who.pos.set(x, truck.platTopY(plat), z); who.state = 'ground'; who.ground = { truck, plat, solid: -1 }; who.externalVelocity.set(0, 0, 0);
    return true;
  }
  return false;
}

test('absorbed in mischief: a new job waits for the act and the recall pause, then gets done', () => {
  const sim = idleMatch([1], { 0: 1 }, { ...BOT_DIFFICULTY.normal, aggression: 0, recall: [3, 3] });
  try {
    const g = sim.game, brain = sim.bots.controller(1).brain;
    run(sim, 1); assert.ok(brain.act, 'already fooling around');
    const order = spawn(g, 200, -1, ['dust']);
    let ready = -1, took = -1;
    for (let i = 0; i < 60 * 40 && took < 0; i++) {
      sim.tick();
      if (ready < 0 && order.arrivalProgress >= 1) ready = i;
      if (ready >= 0 && brain.task.kind !== 'idle') took = i;
    }
    assert.ok(ready >= 0 && took >= 0, 'the job was taken eventually');
    assert.ok((took - ready) / 60 >= 3, `waited at least the recall pause (${((took - ready) / 60).toFixed(1)} s)`);
    run(sim, 40, () => order.stains[0].done);
    assert.equal(order.stains[0].done, true, 'and the stain got washed');
  } finally { sim.dispose(); }
});

test('distracted on the way: an enemy stepping close pulls a bot on an errand into a scuffle (never at distract 0)', () => {
  for (const distract of [1, 0]) {
    const sim = idleMatch([1], { 0: 1 }, { ...BOT_DIFFICULTY.normal, aggression: 0, recall: [0, 0], distract });
    try {
      const g = sim.game, bot = sim.players[1], human = sim.players[0], brain = sim.bots.controller(1).brain;
      spawn(g, 201, -1, ['dust']);
      // Keep the enemy out of reach meanwhile, and catch the bot on the way somewhere with open deck beside it.
      const onTheWay = () => ['fetch', 'work'].includes(brain.task?.kind) && !brain.wiping && bot.state === 'ground';
      run(sim, 30, () => { away(human, bot, g.activeTrucks()); return onTheWay() && beside(human, bot, 2, true); });
      assert.ok(onTheWay(), 'walking to a towel or with it to the stain');
      assert.equal(brain.grudge, null);
      assert.ok(beside(human, bot), 'an enemy steps up next to it');
      run(sim, 4, () => human.slappedSerial > 0);
      if (distract) { assert.ok(human.slappedSerial > 0, 'it dropped the errand and slapped'); assert.equal(human.slappedBy, 1); }
      else { assert.equal(human.slappedSerial, 0, 'a focused bot walks on'); assert.equal(bot.slapSerial, 0); }
    } finally { sim.dispose(); }
  }
});

test('a bot busy wiping is not distracted', () => {
  const sim = idleMatch([1], { 0: 1 }, { ...BOT_DIFFICULTY.normal, aggression: 0, recall: [0, 0], distract: 1 });
  try {
    const g = sim.game, bot = sim.players[1], human = sim.players[0], brain = sim.bots.controller(1).brain;
    spawn(g, 202, -1, ['dust', 'dust']);
    run(sim, 40, () => { away(human, bot, g.activeTrucks()); return brain.wiping; });
    assert.ok(brain.wiping, 'wiping a stain');
    if (away(human, bot, g.activeTrucks()) && (sim.tick(), brain.wiping) && beside(human, bot, 1.5)) {
      run(sim, 1);
      assert.equal(brain.grudge, null, 'kept wiping'); assert.equal(bot.slapSerial, 0);
    }
  } finally { sim.dispose(); }
});

test('a stroll goes to other platforms and vehicles, not just around one spot', () => {
  const sim = idleMatch([1], { 0: 1 }, { ...BOT_DIFFICULTY.normal, aggression: 0 });
  try {
    const g = sim.game, bot = sim.players[1], brain = sim.bots.controller(1).brain;
    spawn(g, 203, -1, ['dust']); // a docked order truck to stroll onto
    brain.profile = { ...brain.profile, recall: [999, 999] }; // never "remembers" the job, so it keeps fooling around
    const visited = new Set<string>();
    for (let i = 0; i < 60 * 60; i++) {
      sim.tick();
      if (bot.state === 'ground' && bot.ground) visited.add(`${g.activeTrucks().indexOf(bot.ground.truck)}:${bot.ground.truck.platforms.indexOf(bot.ground.plat)}`);
    }
    assert.ok(visited.size >= 2, `stood on several platforms (${[...visited]})`);
  } finally { sim.dispose(); }
});

test('a slap from another bot is answered about half as often as one from a human', () => {
  const answered = (attackerIsBot: boolean) => {
    let count = 0;
    for (let i = 0; i < 400; i++) {
      const brain = new BotBrain(1, new BotTaskBoard(), { ...BOT_DIFFICULTY.normal, retaliate: 1 }, botRandom(i + 1));
      const me: any = { team: 0, slappedSerial: 0, slappedBy: 0, slapSerial: 0 }, foe: any = { team: 1 };
      const sim: any = { players: [foe, me], isBotControlled: () => attackerIsBot };
      brain.noticeSlap(me, sim); me.slappedSerial = 1; brain.noticeSlap(me, sim);
      if (brain.grudge) count++;
    }
    return count / 400;
  };
  const human = answered(false), bot = answered(true);
  assert.equal(human, 1, 'a human slap is always answered at retaliate 1');
  assert.ok(bot > 0.4 && bot < 0.6, `a bot slap about half the time (${bot})`);
});

