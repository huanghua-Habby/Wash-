/** Shared ownership and ballistic movement for all carryable tools. */
import * as THREE from 'three';
import { WASH_CONFIG as C } from './washConfig.js';
import { CHARACTER_SCALE as K } from './characterScale.js';

// Carried tools sit in the cat's paws, just in front of the chest (yaw-local, facing +x).
// The water gun rides lower so its barrel clears the cat's face; its nozzle stays at shoulder height.
export const HOLD_X = 0.46 * K, HOLD_Y = 0.5 * K;
export const holdPoint = (kind) => (kind === 'water' ? [0.42 * K, 0.3 * K] : [HOLD_X, HOLD_Y]);
// A pelican's throat pouch, where swallowed tools and teammates ride (yaw-local, facing +x).
export const POUCH_X = 0.36 * K, POUCH_Y = 0.55 * K;

export class CarryItem {
  constructor(scene, homeTruck, originalPosition, index, kind) {
    Object.assign(this, { scene, homeTruck, originalPosition, index, kind });
    this.id = `${kind}-${index}`;
    this.mesh = new THREE.Group();
    this.velocity = new THREE.Vector3(); this.origin = new THREE.Vector3();
    this.washProgress = this.charge = 0; this.holder = null;
    this.thrower = null; this.ownerGrace = 0;
    // Road landings: each one bumps `returnSerial`, records where it vanished and how long ago (clients puff smoke there).
    this.returnSerial = 0; this.returnFrom = new THREE.Vector3(); this.returnAge = 0;
  }
  clearHolder() {
    if (this.swallowedBy) { this.swallowedBy.swallowed = null; this.swallowedBy = null; }
    if (this.holder) { this.holder.heldTool = null; this.holder.throwWasDown = false; this.holder.throwCancelled = false; }
    this.holder = null; this.spraying = false; this.pressure = 0;
  }
  placeOn(truck, localPosition) {
    this.clearHolder(); this.flight = false; this.truck = truck;
    truck.body.add(this.mesh);
    this.mesh.position.set(localPosition.x, truck.localTopForLocal(localPosition.x, localPosition.z) + 0.12, localPosition.z);
    this.mesh.rotation.set(0, 0, 0); this.washProgress = this.charge = 0;
  }
  worldPosition(target = new THREE.Vector3()) { return this.mesh.getWorldPosition(target); }
  pickup(player) {
    if (this.holder || this.swallowedBy || player.heldTool) return false;
    this.holder = player; this.flight = false; this.truck = null;
    this.thrower = null; this.ownerGrace = 0;
    this.washProgress = this.charge = 0;
    player.yawG.add(this.mesh); this.mesh.position.set(...holdPoint(this.kind), 0);
    this.mesh.rotation.set(0, 0, this.kind === 'towel' ? -0.25 : 0);
    player.heldTool = this; player.throwWasDown = false; player.throwCancelled = false;
    return true;
  }
  launch(player, charge = 0) {
    const power = 5.5 + Math.min(1, charge / C.throwChargeSeconds) * 3;
    const velocity = new THREE.Vector3(Math.cos(player.yaw) * power, 4, -Math.sin(player.yaw) * power);
    // Thrown mid-jump the item keeps the jump's carried motion, like the player.
    if (player.ground) velocity.add(player.ground.truck.vel);
    else velocity.add(new THREE.Vector3(player.airBase.x, 0, player.airBase.y));
    this.release(player, velocity);
  }
  release(player, velocity = player?.ground?.truck.vel || new THREE.Vector3(player?.airBase.x || 0, 0, player?.airBase.y || 0)) {
    const start = this.worldPosition(); this.clearHolder();
    this.scene.add(this.mesh); this.mesh.position.copy(start); this.origin.copy(start);
    this.velocity.copy(velocity); this.flight = true; this.truck = null; this.floorTime = 0;
    this.washProgress = this.charge = 0;
    this.thrower = player; this.ownerGrace = C.itemOwnerGrace;
  }
  update(dt, trucks, onFlightSegment) {
    this.ownerGrace = Math.max(0, this.ownerGrace - dt);
    this.returnAge = Math.min(10, this.returnAge + dt);
    if (!this.flight) return;
    const previous = this.mesh.position.clone();
    const oldY = this.mesh.position.y;
    this.velocity.y -= 16 * dt; this.mesh.position.addScaledVector(this.velocity, dt);
    this.mesh.rotation.y += dt * 5;
    if (onFlightSegment?.(this, previous, this.mesh.position)) return;
    if (Math.hypot(this.mesh.position.x - this.origin.x, this.mesh.position.z - this.origin.z) > C.maximumThrowDistance) this.velocity.x = this.velocity.z = 0;
    for (const truck of trucks) {
      const top = truck.topYAt(this.mesh.position.x, this.mesh.position.z);
      if (this.velocity.y <= 0 && oldY >= top && this.mesh.position.y <= top + 0.12 && truck.platformAt(this.mesh.position.x, this.mesh.position.z, 0)) {
        this.placeOn(truck, new THREE.Vector3(this.mesh.position.x - truck.pos.x, 0, this.mesh.position.z - truck.pos.z)); return;
      }
    }
    // The tethered water gun stays on the road for recall; the connector has its own road rule (ChargingHead).
    if (this.kind === 'water') { if (this.mesh.position.y < 0) { this.mesh.position.y = 0.12; this.velocity.y = 0; } }
    else if (this.kind !== 'charger' && this.mesh.position.y <= 0.12 && this.velocity.y <= 0) this.vanishFromRoad();
  }
  /** Touching the road: poof, gone at once — soap is used up, anything else is back at its home spot. */
  vanishFromRoad() {
    this.returnSerial++; this.returnFrom.set(this.mesh.position.x, 0.12, this.mesh.position.z); this.returnAge = 0;
    if (this.kind === 'soap') this.retire();
    else this.placeOn(this.homeTruck, this.originalPosition);
  }
  reset() { this.clean?.(); this.placeOn(this.homeTruck, this.originalPosition); this.mesh.visible = true; }
}
