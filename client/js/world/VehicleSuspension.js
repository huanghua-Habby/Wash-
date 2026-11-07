/** Leans every drawn vehicle under the cats standing on it and keeps those cats on the leaned roof.
 * Physics rules live in shared/sim/VehicleLoad.js; this only gathers riders, kicks landings and applies transforms. */
import * as THREE from 'three';
import { VehicleLoad, riderWeight } from '../../../shared/sim/VehicleLoad.js';
import { RING_BASE } from '../render/IdentityRings.js';

const _local = new THREE.Vector3(), _moved = new THREE.Vector3(), _m = new THREE.Matrix4(), _e = new THREE.Euler();
const BODY_LEAN = 0.45;

export class VehicleSuspension {
  constructor(trucks, players) {
    this.trucks = trucks; this.players = players;
    this.loads = trucks.map((truck) => new VehicleLoad(truck.type));
    this.riders = trucks.map(() => []);
    // Per player: last roof, smoothed fall speed and the surface lean the cat copies.
    this.track = players.map(() => ({ truck: null, lastY: null, vy: 0, roll: 0, pitch: 0 }));
  }

  reset() {
    this.loads.forEach((load, i) => { load.reset(); this.trucks[i].setLoad(load); this.riders[i].length = 0; });
    this.track.forEach(track => { track.truck = null; track.lastY = null; track.vy = track.roll = track.pitch = 0; });
  }

  /** Vehicle-local position (+x forward) of a world point, ignoring the lean itself. */
  local(truck, position) {
    const yaw = truck.group.rotation.y, dx = position.x - truck.pos.x, dz = position.z - truck.pos.z;
    return { x: dx * Math.cos(yaw) - dz * Math.sin(yaw), z: dx * Math.sin(yaw) + dz * Math.cos(yaw) };
  }

  standingOn(player) {
    if (player.occupied === false || !player.root.visible || player.state !== 'ground') return null;
    const truck = player.ground?.truck;
    return truck && truck.group.visible && this.trucks.includes(truck) ? truck : null;
  }

  /** Call once per frame after snapshots/prediction placed every player root and before cat visuals read them. */
  update(dt) {
    this.riders.forEach((list) => { list.length = 0; });
    this.players.forEach((player, i) => {
      const track = this.track[i], truck = this.standingOn(player), y = player.root.position.y;
      if (dt > 0 && track.lastY !== null && !truck) track.vy += ((y - track.lastY) / dt - track.vy) * (1 - Math.exp(-20 * dt));
      track.lastY = y;
      if (truck !== track.truck) {
        const w = riderWeight(player);
        if (truck) { // landing: the fall speed becomes a bounce of the hull under the paws
          const { x, z } = this.local(truck, player.pos);
          this.loads[this.trucks.indexOf(truck)].impulse(x, z, w, Math.max(3, -track.vy));
        } else if (track.truck && player.state === 'air' && player.vel.y > 2) { // jump: the push-off dips the roof
          const { x, z } = this.local(track.truck, player.pos);
          this.loads[this.trucks.indexOf(track.truck)].impulse(x, z, w, player.vel.y * 0.55);
        }
        track.truck = truck; track.vy = 0;
      }
      if (truck) this.riders[this.trucks.indexOf(truck)].push({ ...this.local(truck, player.pos), w: riderWeight(player), player, track });
    });
    this.trucks.forEach((truck, i) => {
      const load = this.loads[i];
      if (!truck.group.visible) { if (load.sink || load.roll || load.pitch) load.reset(); truck.setLoad(load); return; }
      truck.setLoad(load.step(dt, this.riders[i]));
    });
    // Seat each rider on the leaned roof: transform its untilted roof point through the pivot, add the difference.
    this.trucks.forEach((truck, i) => {
      if (!this.riders[i].length) return;
      truck.group.updateMatrixWorld(true);
      _m.multiplyMatrices(truck.loadPivot.matrix, truck.loadInner.matrix);
      const load = this.loads[i];
      for (const { player, track } of this.riders[i]) {
        truck.group.worldToLocal(_local.copy(player.pos));
        truck.group.localToWorld(_moved.copy(_local).applyMatrix4(_m));
        player.root.position.add(_moved.sub(player.pos));
        track.roll = load.roll; track.pitch = load.pitch;
      }
    });
    // Cats stay mostly upright but give a little with the slope they stand on.
    // Their foot ring lies flat on the leaned roof (the rest of the lean), so the roof never covers part of it.
    this.players.forEach((player, i) => {
      const track = this.track[i], k = 1 - Math.exp(-12 * dt);
      if (!track.truck) { track.roll += -track.roll * k; track.pitch += -track.pitch * k; }
      player.root.rotation.set(track.roll * BODY_LEAN, 0, track.pitch * BODY_LEAN);
      player.footRing?.node.quaternion.setFromEuler(_e.set(track.roll * (1 - BODY_LEAN), 0, track.pitch * (1 - BODY_LEAN))).multiply(RING_BASE);
    });
  }
}
