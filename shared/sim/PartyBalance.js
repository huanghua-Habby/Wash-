/** Host-selected, round-scoped difficulty. All allocation is deterministic; no client RNG or roster polling. */
import { MAX_STAINS, stainLayout } from './StainDefinitions.js';
import { vehicleSpec } from './vehicles.js';

export const PARTY_FACTORS = Object.freeze([
  Object.freeze({ stainMultiplier: 1, patienceMultiplier: 1, scoreMultiplier: 1 }),
  Object.freeze({ stainMultiplier: 1.25, patienceMultiplier: .8, scoreMultiplier: .9 }),
  Object.freeze({ stainMultiplier: 1.4, patienceMultiplier: .72, scoreMultiplier: .85 }),
  Object.freeze({ stainMultiplier: 1.5, patienceMultiplier: .66, scoreMultiplier: .83 }),
]);
export function roundPartyBalance(level, players) {
  const count = Math.max(1, Math.min(4, players.filter(p => p.occupied !== false && p.connected !== false).length));
  return Object.freeze({ playerCount: count, ...PARTY_FACTORS[level.partyScaling ? count - 1 : 0] });
}

/** Largest-remainder quotas preserve the whole-level count and type mix, without per-car rounding inflation. */
function quotas(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map(() => 0);
  const exact = weights.map(w => total * w / sum), result = exact.map(Math.floor);
  const remainder = total - result.reduce((a, b) => a + b, 0);
  const ranks = exact.map((n, i) => ({ i, fraction: n - result[i] })).sort((a, b) => b.fraction - a.fraction || a.i - b.i);
  for (let i = 0; i < remainder; i++) result[ranks[i].i]++;
  return result;
}

/** Retain each car's authored tools and base stains; put extra work on the least-expanded eligible car.
 * Rare stages allocate first so common dust cannot exhaust the roof slots needed by soap/water quotas.
 * The returned map is ephemeral. Snapshot requests/definitions carry actual layouts; the frozen party
 * count reproduces future layouts after restore without storing another copy of the entire script.
 */
export function partyStainLayouts(level, balance) {
  const orders = level.script?.orders || [], result = new Map();
  if (!level.partyScaling || balance.stainMultiplier === 1 || !orders.length) return result;
  const kinds = ['dust', 'mud', 'grease'];
  const authored = orders.map(o => o.stains.map(s => s.kind));
  const mix = kinds.map(kind => authored.reduce((n, stains) => n + stains.filter(k => k === kind).length, 0));
  const total = Math.round(mix.reduce((a, b) => a + b, 0) * balance.stainMultiplier);
  if (total > orders.length * MAX_STAINS) throw new Error('Party dirt exceeds the prepared vehicle capacity');
  const target = quotas(total, mix), layouts = authored.map(stains => [...stains]);
  for (let kind = kinds.length - 1; kind >= 0; kind--) for (let extra = target[kind] - mix[kind]; extra > 0; extra--) {
    const candidates = orders.map((_, i) => i).filter(i => authored[i].includes(kinds[kind]) && layouts[i].length < MAX_STAINS);
    candidates.sort((a, b) => layouts[a].length / authored[a].length - layouts[b].length / authored[b].length || a - b);
    if (!candidates.length) throw new Error(`Party dirt needs more authored ${kinds[kind]} roof capacity`);
    layouts[candidates[0]].push(kinds[kind]);
  }
  orders.forEach((order, i) => result.set(order.id, stainLayout(vehicleSpec(order.type), layouts[i])));
  return result;
}
