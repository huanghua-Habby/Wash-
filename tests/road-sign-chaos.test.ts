// Versus road-sign chaos (VERSUS_RULES.md §1.1): a schedule generated from the frozen match settings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getLevel } from '../shared/levels.js';
import { chaosSigns } from '../shared/sim/RoadSignChaos.js';
import { validateRoadSigns, ROAD_SIGN_TONES } from '../shared/sim/RoadSigns.js';
import { quantize } from '../shared/delta.js';
import { applyWorld } from '../shared/snapshot.js';
import { Simulation } from './fixtures/Simulation.js';

const chaos = (getLevel('versus-01') as any).roadSignChaos;

test('about one sign every 15 s: 3 / 5 / 8 minutes give ~11 / ~19 / ~31 signs, valid, mixed sides, none in the last 10 s', () => {
  for (const [limit, count] of [[180, 11], [300, 19], [480, 31]]) {
    const signs = chaosSigns(chaos, limit, ROAD_SIGN_TONES);
    assert.equal(signs.length, count, `${limit} s`);
    validateRoadSigns(signs, chaos.max);
    assert.ok(signs.every((s: any) => s.atMinutes * 60 >= chaos.firstAt && s.atMinutes * 60 <= limit - chaos.endGap));
    assert.ok(signs.some((s: any) => s.side < 0) && signs.some((s: any) => s.side > 0));
    for (let i = 2; i < signs.length; i++) assert.ok(!(signs[i].side === signs[i - 1].side && signs[i].side === signs[i - 2].side), 'never three in a row');
  }
  assert.deepEqual(chaosSigns(chaos, 300, ROAD_SIGN_TONES), chaosSigns(chaos, 300, ROAD_SIGN_TONES), 'deterministic');
  assert.equal(chaosSigns(chaos, null, ROAD_SIGN_TONES).length, chaos.max, 'score-only matches keep going up to the cap');
});

test('a versus round builds the schedule from its match settings; a guest derives the same list from the snapshot', () => {
  const level: any = getLevel('versus-01');
  const sim = new Simulation(level), peer = new Simulation(level);
  try {
    sim.setMatchSettings({ scoreTarget: 250, timeLimit: 180, aiFill: 'off', aiDifficulty: 'normal' });
    sim.game.roadSigns.reset();
    assert.equal(sim.game.roadSigns.definitions.length, 11);
    applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, quantize(sim.snapshot()));
    assert.deepEqual(peer.game.roadSigns.entries().map((e: any) => [e.id, e.side]), sim.game.roadSigns.entries().map((e: any) => [e.id, e.side]));
  } finally { sim.dispose(); peer.dispose(); }
});
