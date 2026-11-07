import * as THREE from 'three';
import { CarryItem } from './CarryItem.js';
import { buildChargingGun } from './ToolModels.js';

/** Shared carry/throw state for the EV charging connector. */
export class ChargingHead extends CarryItem {
  constructor(scene, homeTruck, originalPosition, index) {
    super(scene, homeTruck, originalPosition, index, 'charger');
    this.connectedSerial = null;
    this.groundedRoad = false;
    // EV connector gun; the cable leaves its grip boot at connector().
    this.mesh.add(buildChargingGun());
    this.placeOn(homeTruck, originalPosition); this.mesh.visible = false;
  }
  connector(target = new THREE.Vector3()) {
    this.mesh.updateWorldMatrix(true, false);
    return this.mesh.localToWorld(target.set(-0.16, -0.08, 0));
  }
  placeOn(truck, position) { super.placeOn(truck, position); this.connectedSerial = null; this.groundedRoad = false; }
  pickup(player) {
    if (!super.pickup(player)) return false;
    this.connectedSerial = null; this.groundedRoad = false; return true;
  }
  release(player, velocity) { super.release(player, velocity); this.connectedSerial = null; this.groundedRoad = false; }
  update(dt, trucks, onFlightSegment) {
    if (this.groundedRoad) return;
    super.update(dt, trucks, onFlightSegment);
    if (this.flight && this.mesh.position.y <= 0.12 && this.velocity.y <= 0) {
      this.mesh.position.y = 0.12; this.velocity.set(0, 0, 0);
      this.flight = false; this.groundedRoad = true;
    }
  }
}
