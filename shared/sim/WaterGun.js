/** Placeholder gun geometry plus shared nozzle and spray state. */
import * as THREE from 'three';
import { CarryItem } from './CarryItem.js';
import { WASH_CONFIG as C } from './washConfig.js';
import { pressureBallistics } from './SprayPressure.js';
import { CHARACTER_SCALE as K } from './characterScale.js';

export const GUN_SCALE = 0.5;
const _crossing = new THREE.Vector3(), _segment = new THREE.Vector3(), _unit = new THREE.Vector3();
const _center = new THREE.Vector3(), _offset = new THREE.Vector3();
export const GUN_BALLISTICS = Object.freeze({ speed: C.spraySpeed, range: C.sprayRange, lift: C.sprayLift });

/**
 * Shared jet trace for the water gun and the elephant trunk: a fixed ballistic centerline from `start` along unit
 * `direction`, stopping on the first vehicle roof, unfinished stain, player capsule (other than `source.holder`) or the road.
 * Writes `sprayNodes`, `sprayTarget`, `hitPlayer` and `hitStain` on `result` (default `source`; aim previews pass a scratch
 * object so gun state never changes) and returns whether the jet touched something before running out of range.
 */
export function traceSpray(source, start, direction, { speed, range, lift }, trucks, players = [], stains = [], result = source) {
  const radius = source.sprayRadius ?? C.sprayRadius, stainRadius = source.sprayStainRadius ?? C.sprayStainRadius;
  result.sprayNodes = [start]; result.hitPlayer = result.hitStain = null;
  if (speed <= 0 || range <= 0) { result.sprayTarget.copy(start); return false; }
  let hasContact = false;
  const samples = 16;
  // Stains do not move during one trace: resolve each world centre once instead of once per sample.
  const targets = [];
  for (const stain of stains) if (!stain.done) targets.push({ stain, center: stain.mesh.getWorldPosition(new THREE.Vector3()) });
  for (let i = 1; i <= samples; i++) {
    const time = range / speed * i / samples;
    const point = start.clone().addScaledVector(direction, speed * time);
    point.y += lift * time - 0.5 * C.sprayGravity * time * time;
    const previous = result.sprayNodes.at(-1);
    let contact = null, fraction = 1, hitPlayer = null, hitStain = null;
    // Each standing level is its own surface (multi-level roofs): the jet stops on the first one it crosses inside.
    for (const truck of trucks) for (const plat of truck.platTopY ? truck.platforms : [null]) {
      const height = (plat ? truck.platTopY(plat) : truck.topY) + radius;
      if (previous.y < height || point.y > height) continue;
      const t = (previous.y - height) / Math.max(1e-8, previous.y - point.y);
      if (t >= fraction) continue;
      const crossing = _crossing.copy(previous).lerp(point, t);
      const inside = plat ? crossing.x - truck.pos.x >= plat.x0 && crossing.x - truck.pos.x <= plat.x1 && crossing.z - truck.pos.z >= plat.z0 && crossing.z - truck.pos.z <= plat.z1
        : truck.platformAt(crossing.x, crossing.z, 0);
      if (inside) { contact = crossing.clone(); fraction = t; }
    }
    for (const { stain, center } of targets) {
      const height = center.y + radius;
      if (previous.y < height || point.y > height) continue;
      const t = (previous.y - height) / Math.max(1e-8, previous.y - point.y);
      if (t >= fraction) continue;
      const crossing = _crossing.copy(previous).lerp(point, t);
      if (Math.hypot(crossing.x - center.x, crossing.z - center.z) < stainRadius + radius) {
        fraction = t; contact = crossing.clone(); hitStain = stain;
      }
    }
    const segment = _segment.copy(point).sub(previous), length = segment.length(), unit = _unit.copy(segment).divideScalar(length || 1);
    for (const player of players) {
      if (player === source.holder || player.occupied === false || !['ground', 'air'].includes(player.state)) continue;
      // A body-sized capsule (three spheres up the body), at the character scale.
      for (const height of [0.2, 0.6, 1]) {
        const center = _center.copy(player.pos); center.y += height * K;
        const offset = _offset.copy(previous).sub(center), projection = offset.dot(unit);
        const discriminant = projection ** 2 - (offset.lengthSq() - (C.hosePlayerRadius * K + radius) ** 2);
        if (discriminant < 0) continue;
        const enter = Math.max(0, -projection - Math.sqrt(discriminant)), exit = -projection + Math.sqrt(discriminant);
        const t = enter / (length || 1);
        if (exit >= 0 && t <= fraction && enter <= length) { contact = previous.clone().lerp(point, t); fraction = t; hitPlayer = player; hitStain = null; }
      }
    }
    result.sprayNodes.push(contact || point);
    if (contact || point.y <= 0) { hasContact = true; result.hitPlayer = hitPlayer; result.hitStain = hitStain; break; }
  }
  result.sprayTarget.copy(result.sprayNodes.at(-1));
  return hasContact;
}

export class WaterGun extends CarryItem {
  constructor(scene, homeTruck, originalPosition, index) {
    super(scene, homeTruck, originalPosition, index, 'water');
    const blue = new THREE.MeshLambertMaterial({ color: '#86cddc' });
    const yellow = new THREE.MeshLambertMaterial({ color: '#f0cf76' });
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.35, 0.2), yellow);
    grip.position.set(-0.13, 0.05, 0); grip.rotation.z = -0.2;
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.22, 0.27), blue);
    barrel.position.y = 0.24;
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.14, 8), yellow);
    tip.rotation.z = -Math.PI / 2; tip.position.set(0.4, 0.24, 0);
    this.mesh.add(grip, barrel, tip);
    this.mesh.traverse((node) => { node.layers.enable(1); if (node.isMesh) node.castShadow = true; });
    // Toy-sized for the cat; nozzle() and connector() scale with the mesh, so hose and spray follow.
    this.mesh.scale.setScalar(GUN_SCALE);
    this.spraying = false; this.pressure = 0; this.sprayTarget = new THREE.Vector3(); this.sprayNodes = [];
    this.placeOn(homeTruck, originalPosition); this.mesh.visible = false;
  }
  nozzle(target = new THREE.Vector3()) { this.mesh.updateWorldMatrix(true, false); return this.mesh.localToWorld(target.set(0.5, 0.24, 0)); }
  connector(target = new THREE.Vector3()) { this.mesh.updateWorldMatrix(true, false); return this.mesh.localToWorld(target.set(-0.28, 0.13, 0)); }
  direction(target = new THREE.Vector3()) { return target.set(Math.cos(this.holder?.yaw || 0), 0, -Math.sin(this.holder?.yaw || 0)); }
  /** The jet at the current (or a given) pressure; particles and aim previews read the same numbers as the rules. */
  jetBallistics(pressure = this.pressure) { return pressureBallistics(GUN_BALLISTICS, pressure); }
  /** Same first-hit query for authority and local aim previews. A separate result never changes gun state. */
  trace(trucks, players = [], stains = [], result = this, pressure = this.pressure) {
    return traceSpray(this, this.nozzle(), this.direction(), this.jetBallistics(pressure), trucks, players, stains, result);
  }
  hits(stain) {
    const center = stain.mesh.getWorldPosition(new THREE.Vector3()), height = center.y + C.sprayRadius;
    for (let i = 1; i < this.sprayNodes.length; i++) {
      const a = this.sprayNodes[i - 1], b = this.sprayNodes[i];
      if (a.y < height || b.y > height) continue;
      const t = (a.y - height) / Math.max(1e-8, a.y - b.y), point = a.clone().lerp(b, t);
      if (Math.hypot(point.x - center.x, point.z - center.z) < C.sprayStainRadius + C.sprayRadius) return true;
    }
    return false;
  }
}
