/** UI-line ownership exception: implement charging bonus ONLY in this module.
 * Both hooks execute exclusively on the host's shared simulation. Do not touch DOM here.
 * Orders expose id/serial/generation/mode/paid/rewardMultiplier. Mutate eligible orders'
 * rewardMultiplier here; snapshot and urgent signature transport it. Purple presentation is UI.
 * Keep repeated completions idempotent, use bounded per-order state, and round final points.
 * The UI line may edit this module and add tests; ChargingSystem/WashSimulation/snapshot
 * hook integration belongs to the level line. No files outside this exception are delegated.
 */
// A defensive duplicate-hook latch, weakly held per order. The authoritative `charged`
// transition already persists in snapshots; this cache adds no wire/save state.
const completions = new WeakMap();
export function onChargeCompleted(game, chargedOrder) {
  if (game.viewOnly || game.ended || !game.orders.includes(chargedOrder) ||
      chargedOrder.mode !== 'working' || chargedOrder.paid || !chargedOrder.charged) return 0;
  const previous = completions.get(chargedOrder);
  if (previous?.game === game && previous.serial === chargedOrder.serial && previous.generation === chargedOrder.generation) return 0;
  completions.set(chargedOrder, { game, serial: chargedOrder.serial, generation: chargedOrder.generation });
  // Versus: only the charged truck itself is boosted. Its stains keep scoring at base value; the ×1.5 is paid
  // in one go when that truck leaves fully washed (`versusChargeBonus`). Not stacked.
  if (game.mode === 'versus') { chargedOrder.rewardMultiplier = Math.max(chargedOrder.rewardMultiplier || 1, 1.5); return 1; }
  let affected = 0;
  for (const order of game.orders) {
    if (order.mode !== 'working' || order.paid || order.remaining === 0) continue;
    order.rewardMultiplier = Math.max(order.rewardMultiplier || 1, 1.5); affected++;
  }
  return affected;
}
export function orderReward(game, order, basePoints) {
  return Math.round(basePoints * (order.rewardMultiplier || 1) * (game.partyBalance?.scoreMultiplier ?? 1));
}
