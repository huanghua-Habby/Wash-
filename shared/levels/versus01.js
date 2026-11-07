import { HIGHWAY_BASE } from './base.js';
import { HIGHWAY_02 } from './highway02.js';
import { order } from './authoring.js';
import { mulberry32 } from '../sim/util.js';

/** HouJianNan's three-truck versus scene: red trucks (left, side −1) | neutral home truck | blue trucks (right, +1).
 * Each side runs its own campaign-style queue: a truck leaves once all three stains are clean and the next one merges
 * in at the campaign pace. Trucks never run out of patience; the match ends by the room settings (clock/score). */
export const VERSUS_TRUCKS_PER_SIDE = 32; // The 64-order level maximum; covers the longest 8-minute room time limit.
// Towel / water→towel / soap→water→towel: every tool on the neutral truck has work on each truck.
const KINDS = ['dust', 'mud', 'grease'];
// Trailer roof columns (cargo: trailer x -5.4..2.2), clear of the cab and its charging port.
const COLUMNS = [-4.6, -3.4, -2.2, -1.0, 0.2, 1.4], ROWS = [-0.55, 0.55];
/** Same seed → same layouts on every page; positions vary from truck to truck. */
function shuffledStains(random) {
  const columns = [...COLUMNS];
  for (let i = columns.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [columns[i], columns[j]] = [columns[j], columns[i]]; }
  return KINDS.map((kind, i) => ({ id: `stain-${i}`, kind, position: [columns[i], ROWS[Math.floor(random() * ROWS.length)]] }));
}
function versusQueue() {
  const random = mulberry32(301), orders = [];
  for (let i = 0; i < VERSUS_TRUCKS_PER_SIDE; i++) for (const [team, side] of [['red', -1], ['blue', 1]]) {
    orders.push({ ...order(`vs-${team}-${i + 1}`, 0, side, 'cargo', KINDS), stains: shuffledStains(random), patience: { mode: 'unlimited' } });
  }
  return orders;
}

/** The central player truck keeps eight spawns; clock and score target come from the room settings frozen at match
 * start (WashSimulation.roundClock), so the level itself is unlimited. */
export const VERSUS_01 = {
  ...HIGHWAY_02, id: 'versus-01', number: 'VS', name: '三车对战', difficulty: 'versus', mode: 'versus', guide: 'versus-terminal',
  partyScaling: false, description: '红队左侧、蓝队右侧 · 结束条件见房间设置', unlockedEquipment: ['towel', 'station', 'water', 'soap', 'charger'],
  road: { ...HIGHWAY_02.road, scenerySeed: 301 },
  home: { ...HIGHWAY_02.home, playerSlots: [...HIGHWAY_BASE.home.playerSlots, [-1.2, 0.55], [2.2, 0.55], [2.3, -0.65], [3.2, -0.65]] },
  clock: { mode: 'unlimited', duration: 0 }, rating: { mode: 'tutorial', thresholds: [] },
  script: { steps: [], events: [], orders: versusQueue() },
  // Road-sign chaos (VERSUS_RULES.md §1.1): about one sign every 15 s from 0:20 to 10 s before the end, generated from
  // the frozen time limit (score-only matches keep going, up to `max`).
  roadSignChaos: { every: 15, firstAt: 20, endGap: 10, jitter: 3, seed: 301, max: 60 },
};
