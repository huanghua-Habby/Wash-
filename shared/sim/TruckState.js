/** Shared hover-vehicle transforms and standing platforms; headless scene graph. */
import * as THREE from 'three';
import { vehicleSpec } from './vehicles.js';

/** Body bob at simulation time t. Shared so a predicting client stands on the same roof height the authority will use that tick. */
export function bodyHeight(t, phase) {
  return 0.06 * Math.sin(t * 1.7 + phase) + 0.012 * Math.sin(t * 11.0 + phase * 2);
}

export class TruckState {
  constructor(colors, { name, phase = 0, type = 'cargo' }) {
    this.name = name;
    this.colors = colors;
    this.phase = phase;
    this.type = type;
    this.spec = vehicleSpec(type);
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);
    this.pos = this.group.position;
    this.pos.y = this.spec.hover;
    this.vel = new THREE.Vector3();
    this.speed = 30;
    // 可站立平台（局部坐标）
    this.platforms = this.spec.platforms;
  }

  /** Roof height in the body frame; equipment and stains sit on it. */
  get topLocal() { return this.spec.top; }
  get halfWidth() { return this.spec.width / 2; }

  get topY() {
    return this.group.position.y + this.body.position.y + this.spec.top;
  }

  /** Local standing height of a platform (multi-level roofs); `top` when it has none of its own. */
  platformTop(plat) { return plat?.y ?? this.spec.top; }
  /** Local standing height under truck-local (x, z); `top` off every platform. */
  localTopForLocal(x, z, tol = 0) {
    const plat = this.platforms.find((p) => x >= p.x0 - tol && x <= p.x1 + tol && z >= p.z0 - tol && z <= p.z1 + tol);
    return this.platformTop(plat);
  }
  /** World standing height under world (x, z): the shared roof plus that platform's own level. */
  topYAt(px, pz, tol = 0) {
    return this.group.position.y + this.body.position.y + this.localTopForLocal(px - this.pos.x, pz - this.pos.z, tol);
  }
  /** World standing height of platform `plat`. */
  platTopY(plat) { return this.group.position.y + this.body.position.y + this.platformTop(plat); }

  /** Planar motion. Altitude is owned separately so lane changes never reset the hover height. */
  setState(x, z, vx, vz, base) {
    this.group.position.set(x, this.group.position.y, z);
    this.vel.set(vx, 0, vz);
    this.speed = base + vx;
    // 变道时车头微微转向
    this.group.rotation.y = -Math.atan2(vz, base) * 3;
  }

  setAltitude(y) { this.group.position.y = Math.max(0.35, y); }

  platformAt(px, pz, tol) {
    const lx = px - this.pos.x;
    const lz = pz - this.pos.z;
    // Adjacent platforms at different heights overlap inside the tolerance: the one that really holds the point wins.
    return this.platforms.find((p) => lx >= p.x0 && lx <= p.x1 && lz >= p.z0 && lz <= p.z1) ||
      this.platforms.find((p) => lx >= p.x0 - tol && lx <= p.x1 + tol && lz >= p.z0 - tol && lz <= p.z1 + tol);
  }

  /** Body bob is a pure function of simulation time, so it is never sent over the wire. */
  pose(t) {
    const p = this.phase;
    this.body.position.y = bodyHeight(t, p);
    this.body.rotation.x = 0.008 * Math.sin(t * 1.3 + p);
    this.body.rotation.z = 0.01 * Math.sin(t * 0.9 + p * 1.4);
  }

  update(dt, t) {
    this.pose(t);
  }
}
