/** Elephant trunk jet: a per-player water tank and spray path. No mesh of its own; it looks like a water gun to the
 * shared wet field and to every client presenter (spraying, sprayNodes, sprayTarget, holder, nozzle, direction). */
import * as THREE from 'three';
import { traceSpray } from './WaterGun.js';
import { WASH_CONFIG as C } from './washConfig.js';
import { stepPressure, pressureBallistics } from './SprayPressure.js';
import { CHARACTER_SCALE as K } from './characterScale.js';

// Trunk tip while spraying, yaw-local (x forward, y up), matching the raised trunk of ElephantModel.
export const TRUNK_TIP_X = 0.66 * K, TRUNK_TIP_Y = 0.72 * K;
export const TRUNK_BALLISTICS = Object.freeze({ speed: C.trunkSpeed, range: C.trunkRange, lift: C.trunkLift });

export class TrunkSpray {
  constructor(player, slot) {
    this.player = player; this.slot = slot; this.id = `trunk-${slot}`;
    this.ballistics = TRUNK_BALLISTICS; this.jetScale = C.trunkJetScale;
    this.sprayRadius = C.trunkSprayRadius; this.sprayStainRadius = C.trunkStainRadius;
    this.sprayTarget = new THREE.Vector3(); this.sprayNodes = [];
    this.hitPlayer = this.hitStain = null;
    this.reset();
  }
  /** The spraying elephant is excluded from its own jet, like a gun's holder. */
  get holder() { return this.player; }
  /** Presenters pan and hide with the player's visible root. */
  get mesh() { return this.player.root; }
  reset() {
    this.water = 1; this.empty = false; this.refillDelay = 0; this.pressure = 0;
    this.spraying = false; this.sprayTime = 0; this.sprayNodes = []; this.hitPlayer = this.hitStain = null;
  }
  direction(target = new THREE.Vector3()) { return target.set(Math.cos(this.player.yaw), 0, -Math.sin(this.player.yaw)); }
  /** Rules use the fixed yaw-local tip; a client page may attach the drawn trunk tip (`player.trunkTip`) for particles. */
  nozzle(target = new THREE.Vector3()) {
    const tip = this.player.trunkTip;
    if (tip?.parent) { tip.updateWorldMatrix(true, false); return tip.getWorldPosition(target); }
    const p = this.player.root.position, c = Math.cos(this.player.yaw), s = Math.sin(this.player.yaw);
    return target.set(p.x + c * TRUNK_TIP_X, p.y + TRUNK_TIP_Y, p.z - s * TRUNK_TIP_X);
  }
  ruleNozzle(target = new THREE.Vector3()) {
    const p = this.player.pos, c = Math.cos(this.player.yaw), s = Math.sin(this.player.yaw);
    return target.set(p.x + c * TRUNK_TIP_X, p.y + TRUNK_TIP_Y, p.z - s * TRUNK_TIP_X);
  }

  /**
   * Advance the tank by one tick. Returns true while the jet is open. Holding L builds pressure and releasing tapers
   * it off (SprayPressure); flowing drains the tank, an idle trunk refills after a short delay, and an emptied trunk
   * stays shut until it has refilled `trunkRestart`.
   */
  step(want, dt) {
    if (this.empty && this.water >= C.trunkRestart - 1e-9) this.empty = false;
    const able = !this.empty && this.water > 1e-9;
    if (!able) this.pressure = 0;
    const open = stepPressure(this, want && able, dt) && able;
    if (open) {
      this.sprayTime = this.spraying ? this.sprayTime + dt : 0;
      this.water = Math.max(0, this.water - dt / C.trunkDrainSeconds);
      if (this.water <= 1e-9) { this.water = 0; this.empty = true; }
      this.refillDelay = C.trunkRefillDelay;
    } else {
      this.sprayTime = 0;
      if (this.refillDelay > 0) this.refillDelay = Math.max(0, this.refillDelay - dt);
      else this.water = Math.min(1, this.water + dt / C.trunkRefillSeconds);
    }
    this.spraying = open;
    if (!open) { this.sprayNodes = []; this.hitPlayer = this.hitStain = null; }
    return open;
  }

  jetBallistics(pressure = this.pressure) { return pressureBallistics(this.ballistics, pressure); }
  trace(trucks, players, stains) {
    traceSpray(this, this.ruleNozzle(), this.direction(), this.jetBallistics(), trucks, players, stains);
  }
}
