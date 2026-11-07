import test from 'node:test';
import assert from 'node:assert/strict';
import { getLevel } from '../shared/levels.js';
import { order as authorOrder } from '../shared/levels/authoring.js';
import { Simulation } from './fixtures/Simulation.js';
import { BOT_DIFFICULTY } from '../shared/sim/bots/BotDifficulty.js';

/** A versus match with bots in the given slots; the clock is off so only the work decides. */
function match(seats: { slot: number; team: number }[]) {
  // The versus map's own truck queue is left out so each test spawns exactly the orders it needs on free trucks.
  const level: any = getLevel('versus-01');
  const sim = new Simulation({ ...level, script: { ...level.script, orders: [] } } as any);
  sim.game.matchSettings = { scoreTarget: null, timeLimit: null };
  sim.placeBots(seats); sim.command('start');
  for (let i = 0; i < 60 * 8 && sim.game.roundStage !== 'playing'; i++) sim.tick();
  return sim;
}
/** Spawn an order of these stain kinds on a free cargo truck, on `side`. */
function spawn(g: any, serial: number, side: number, kinds: string[]) {
  const definition = authorOrder(`bot-${serial}`, 0, side, 'cargo', kinds);
  const vehicleSlot = g.orderTrucks.findIndex((t: any) => t.type === 'cargo' && !g.orders.some((o: any) => o.truck === t));
  return g.spawnOrder(serial, { side, definition, vehicleSlot });
}
const run = (sim: any, seconds: number, until: () => boolean) => { for (let i = 0; i < seconds * 60 && !until(); i++) sim.tick(); };

test('bots clean their own order through soap, water and towel steps, and never touch the other team order', () => {
  const sim = match([{ slot: 1, team: 0 }, { slot: 2, team: 0 }]);
  try {
    const g = sim.game;
    // A grease stain needs all three tools; spawn one red and one blue order directly.
    const red = spawn(g, 100, -1, ['grease', 'dust']);
    const blue = spawn(g, 101, 1, ['dust']);
    assert.deepEqual([red.team, blue.team], [0, 1]);
    const steps = new Set<string>();
    run(sim, 90, () => { for (const s of red.stains) if (!s.done) steps.add(s.steps[s.stage]); return red.paid; });
    assert.equal(red.paid, true, 'the red bots finished their order');
    assert.ok(['soap', 'water', 'towel'].every(step => steps.has(step)), 'every tool step was worked');
    assert.equal(g.teamCompleted[0], 1); assert.ok(g.teamScores[0] > 0);
    assert.ok(blue.stains.every((s: any) => !s.done && s.progress === 0), 'the blue order was not touched');
    assert.equal(g.teamScores[1], 0);
    assert.ok([1, 2].every(slot => sim.players[slot].state !== 'fallen'));
  } finally { sim.dispose(); }
});

test('a bot washes a dirty towel at the basin and leaves tools a real player holds alone', () => {
  const sim = match([{ slot: 1, team: 0 }]);
  try {
    const g = sim.game, bot = sim.players[1], towel = g.towels[0];
    towel.pickup(bot); towel.consume(towel.durability); assert.equal(towel.dirty, true);
    run(sim, 20, () => !towel.dirty && towel.durability >= 2 - 1e-6);
    assert.equal(towel.dirty, false, 'washed clean at the basin');
    // A human (slot 0) holds the only water gun: a water job waits instead of grabbing it from them.
    sim.occupy(0, true);
    const human = sim.players[0]; g.waterguns[0].pickup(human);
    const order = spawn(g, 102, -1, ['mud']);
    run(sim, 15, () => false);
    assert.equal(g.waterguns[0].holder, human, 'the bot never took the gun out of a player hand');
    assert.equal(order.stains[0].stage, 0, 'the water step waits for the gun');
  } finally { sim.dispose(); }
});

test('pausing freezes bots in place; two bots never work the same stain step', () => {
  const sim = match([{ slot: 1, team: 0 }, { slot: 2, team: 0 }, { slot: 3, team: 0 }]);
  try {
    // The board itself is under test: a human bot sometimes ignores it on purpose (BOTS.md §14.2), so turn that off.
    sim.bots.setDifficulty({ ...BOT_DIFFICULTY.normal, ignoreBoard: 0 });
    const g = sim.game;
    const order = spawn(g, 103, -1, ['dust', 'dust', 'dust']);
    let overlap = false;
    run(sim, 40, () => {
      const targets = [1, 2, 3].map(slot => sim.bots.controller(slot).brain.task).filter((t: any) => t?.kind === 'work').map((t: any) => t.stainKey);
      if (new Set(targets).size !== targets.length) overlap = true;
      return order.paid;
    });
    assert.equal(order.paid, true); assert.equal(overlap, false, 'reservations keep bots on different stains');
    g.paused = true;
    const before = [1, 2, 3].map(slot => sim.players[slot].pos.clone());
    for (let i = 0; i < 120; i++) sim.tick();
    assert.ok([1, 2, 3].every((slot, i) => sim.players[slot].pos.distanceTo(before[i]) < 1e-6), 'paused bots do not move');
  } finally { sim.dispose(); }
});
