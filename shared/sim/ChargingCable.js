import { Hose } from './Hose.js';
import { CHARGING } from './chargingConfig.js';

/** Pure geometry, shared by host collision and local rendering; no slack history to synchronize. */
export function writeChargingCablePath(start, end, nodes) {
  const distance = start.distanceTo(end), bend = Math.min(CHARGING.bend, distance * 0.025);
  nodes.forEach((node, i) => {
    const t = i / (nodes.length - 1); node.copy(start).lerp(end, t); node.y -= Math.sin(Math.PI * t) * bend;
  });
  return distance;
}

/** Retracting reel: recompute a short, gently bowed path from its endpoints, never integrate slack rope.
 * Capsule sweeps and maximum-distance constraints are shared with Hose; the water hose is unchanged. */
export class ChargingCable extends Hose {
  constructor(homeTruck, head, config) {
    super(homeTruck, head, config);
    this.maxLength = CHARGING.maxLength;
    this.length = 0;
  }
  path() {
    const start = this.anchor(), end = this.gun.connector();
    this.length = writeChargingCablePath(start, end, this.nodes);
  }
  reset() {
    this.path(); this.nodes.forEach((node, i) => { this.before[i].copy(node); this.previous[i].copy(node); });
    this.taut = false; this.tension = 0; this.initialized = true;
  }
  update(dt, trucks, players, oldPlayerPositions) {
    if (dt <= 0) return;
    if (!this.initialized) this.reset();
    const discontinuity = this.gun.connector().distanceTo(this.nodes.at(-1)) > 3;
    this.nodes.forEach((node, i) => this.before[i].copy(node));
    this.constrainGun(this.anchor());
    this.path();
    this.taut = this.length >= this.maxLength * 0.96;
    // The reel keeps the deployed section straight even below the maximum payout.
    this.tension = this.length > 0.8 ? (this.taut ? 1 : 0.35) : 0;
    if (discontinuity) this.nodes.forEach((node, i) => this.before[i].copy(node));
    else if (this.tension) this.pushPlayers(dt, players, oldPlayerPositions);
  }
}
