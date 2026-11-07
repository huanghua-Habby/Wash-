import * as THREE from 'three';

/** Spring for the tilt: stiff enough to snap back, loose enough to rock a few times. */
const STIFFNESS = 140, DAMPING = 5.5, KICK = 7, MAX_TILT = 0.55;
const _axis = new THREE.Vector3();

/**
 * Tutorial slap dummy (shared/sim/TrainingDummy.js): each new shared `hitSerial` (host-confirmed) kicks a damped spring
 * that rocks the puppet away from the slap on its weighted base. Presentation only; it moves one prepared transform
 * (no particles, no draws of its own — the sparks come from SlapHit).
 */
export class DummyWobble {
  constructor(game) { this.game = game; this.reset(); }
  update(dt) {
    const dummy = this.game.dummy;
    if (!dummy?.pivot) return;
    const serial = dummy.hitSerial || 0;
    if (serial !== this.seen) {
      // First sight is only a baseline; a lower count means a new world, never a replay.
      if (serial > this.seen && this.seen >= 0 && dummy.group.visible) {
        // Truck-local direction (the dummy group is turned 180° to face the spawns).
        [this.dx, this.dz] = dummy.hitDirection; this.velocity += KICK;
      }
      this.seen = serial;
    }
    if (!this.angle && !this.velocity) return;
    const step = Math.min(dt, 1 / 30);
    this.velocity += (-STIFFNESS * this.angle - DAMPING * this.velocity) * step;
    this.angle = Math.max(-MAX_TILT, Math.min(MAX_TILT, this.angle + this.velocity * step));
    if (Math.abs(this.angle) < 1e-3 && Math.abs(this.velocity) < 1e-2) this.angle = this.velocity = 0;
    // Tilt the top toward the shove: axis = up × direction, expressed in the turned group's frame.
    _axis.set(-this.dz, 0, this.dx);
    dummy.pivot.quaternion.setFromAxisAngle(_axis.normalize(), this.angle);
  }
  reset() {
    this.seen = this.game.dummy ? this.game.dummy.hitSerial || 0 : -1;
    this.angle = this.velocity = 0; this.dx = 1; this.dz = 0;
    this.game.dummy?.pivot?.quaternion.identity();
  }
  dispose() { this.reset(); }
}
