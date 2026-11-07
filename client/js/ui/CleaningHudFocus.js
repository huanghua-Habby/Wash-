import { Vector3 } from 'three';
import { WASH_CONFIG } from '../../../shared/sim/washConfig.js';
import { CHARGING } from '../../../shared/sim/chargingConfig.js';
import { smudgeable, enemyOrder } from '../../../shared/sim/PvpScore.js';

/** Local presentation only: matching tools take priority over the nearest nearby task.
 * These sets never confirm a cleaning/charging hit or enter authority snapshots.
 */
export class CleaningHudFocus {
  constructor() {
    this.stains = new Set(); this.ports = new Set();
    /** Versus: enemy stains the local player's dirty towel can rub back (cue only; the host decides). */
    this.smudge = new Set();
    this.playerPoint = new Vector3(); this.targetPoint = new Vector3();
  }
  reset() { this.stains.clear(); this.ports.clear(); this.smudge.clear(); }
  select(game, entries) {
    this.reset();
    const player = game.players[game.localSlot ?? 0];
    if (!player || player.occupied === false || player.sceneReady === false || !['ground', 'air'].includes(player.state)) return this;
    const kind = player.heldTool?.kind, tool = player.heldTool;
    const enemy = order => enemyOrder(game, player, order);
    // Versus, dirty towel in hand: point at what it can smear on the other truck and nothing on our own.
    if (game.mode === 'versus' && Number.isInteger(player.team) && kind === 'towel' && tool.dirty) {
      if (tool.canSmudge) for (const {order, stain} of entries) {
        if (this.available(order) && enemy(order) && smudgeable(stain)) this.smudge.add(stain);
      }
      return this;
    }
    // All matching current steps can be read at once; a nearby different step cannot override the tool.
    for (const {order, stain} of entries) {
      if (kind && this.available(order) && !enemy(order) && !stain.done && stain.steps[stain.stage] === kind) this.stains.add(stain);
    }
    if (kind === 'charger') for (const order of game.orders) {
      if (this.chargeable(game, order)) this.ports.add(order);
    }
    if (this.stains.size || this.ports.size) return this;

    player.root.getWorldPosition(this.playerPoint);
    let closest = null, distance = WASH_CONFIG.useRange ** 2;
    for (const {order, stain} of entries) {
      if (!this.available(order) || stain.done || enemy(order)) continue;
      stain.mesh.getWorldPosition(this.targetPoint);
      const next = this.playerPoint.distanceToSquared(this.targetPoint);
      if (next < distance) { closest = stain; distance = next; }
    }
    if (closest) { this.stains.add(closest); return this; }

    // Charging uses the same fallback when no stain is nearby, keeping one proximity cue at a time.
    distance = CHARGING.portRange ** 2;
    for (const order of game.orders) {
      const port = game.charging.ports.get(order.truck);
      if (!port || !this.chargeable(game, order)) continue;
      port.getWorldPosition(this.targetPoint);
      const next = this.playerPoint.distanceToSquared(this.targetPoint);
      if (next < distance) { closest = order; distance = next; }
    }
    if (closest) this.ports.add(closest);
    return this;
  }
  available(order) { return order.mode === 'working' && order.truck.group.visible; }
  chargeable(game, order) {
    return this.available(order) && !order.charged && !game.chargers.some(head => head.connectedSerial === order.serial);
  }
}
