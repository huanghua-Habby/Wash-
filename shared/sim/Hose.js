/** Seven-node rope. Only loaded, nearly fully extended ropes push player capsules. */
import * as THREE from 'three';
import { playerMass } from './Mass.js';
import { WASH_CONFIG as C } from './washConfig.js';
import { FIRST_LEVEL_ID, getLevel } from '../levels.js';
import { CHARACTER_SCALE as K } from './characterScale.js';
const clamp = THREE.MathUtils.clamp;

export class Hose {
  constructor(homeTruck, gun, config = getLevel(FIRST_LEVEL_ID).equipment.waterguns[0]) {
    Object.assign(this, { homeTruck, gun });
    this.maxLength = C.hoseLength;
    const [x, z] = config.supplyPosition;
    this.anchorLocal = new THREE.Vector3(x, homeTruck.localTopForLocal(x, z) + config.supplyHeight, z);
    this.recallRange = config.recallRange;
    this.nodes = Array.from({ length: C.hoseNodes }, () => new THREE.Vector3());
    this.previous = this.nodes.map((node) => node.clone());
    this.before = this.nodes.map((node) => node.clone());
    this.tension = 0; this.taut = false; this.initialized = false;
  }
  anchor(target = new THREE.Vector3()) { this.homeTruck.body.updateWorldMatrix(true, false); return this.homeTruck.body.localToWorld(target.copy(this.anchorLocal)); }
  reset() {
    const a = this.anchor(), b = this.gun.connector();
    this.nodes.forEach((node, i) => {
      const t = i / (this.nodes.length - 1);
      node.copy(a).lerp(b, t); node.z += Math.sin(t * Math.PI * 2) * 0.45;
      this.previous[i].copy(node); this.before[i].copy(node);
    });
    this.taut = false; this.tension = 0; this.initialized = true;
  }
  constrainGun(anchor) {
    const end = this.gun.connector(), direction = end.clone().sub(anchor), distance = direction.length();
    if (distance <= this.maxLength) return 0;
    const excess = distance - this.maxLength;
    direction.divideScalar(distance);
    if (this.gun.holder) {
      const player = this.gun.holder;
      if (player.state === 'ground') {
        const horizontal = Math.hypot(end.x - anchor.x, end.z - anchor.z);
        const allowed = Math.sqrt(Math.max(0, this.maxLength ** 2 - (end.y - anchor.y) ** 2));
        const scale = horizontal > 0 ? Math.min(1, allowed / horizontal) : 1;
        player.pos.x += (end.x - anchor.x) * (scale - 1);
        player.pos.z += (end.z - anchor.z) * (scale - 1);
      } else player.pos.addScaledVector(direction, -excess);
      const outward = player.vel.dot(direction);
      if (outward > 0) player.vel.addScaledVector(direction, -outward);
      const drift = player.externalVelocity.dot(direction);
      if (drift > 0) player.externalVelocity.addScaledVector(direction, -drift);
      player.root.position.copy(player.pos);
    } else {
      if (!this.gun.flight) this.gun.release(null, this.gun.truck?.vel || new THREE.Vector3());
      this.gun.mesh.position.addScaledVector(direction, -excess);
      const outward = this.gun.velocity.dot(direction);
      if (outward > 0) this.gun.velocity.addScaledVector(direction, -outward);
    }
    return excess;
  }
  support(node, trucks) {
    let height = C.hoseRadius;
    for (const truck of trucks) if (truck.platformAt(node.x, node.z, 0)) height = Math.max(height, truck.topYAt(node.x, node.z) + C.hoseRadius);
    node.y = Math.max(node.y, height);
  }
  update(dt, trucks, players, oldPlayerPositions) {
    if (dt <= 0) return;
    if (!this.initialized) this.reset();
    const anchor = this.anchor(), pulled = this.constrainGun(anchor), end = this.gun.connector();
    // Recovery/respawn is a discontinuity, not a physical sweep through teammates.
    if (end.distanceTo(this.nodes.at(-1)) > 3) { this.reset(); return; }
    this.nodes.forEach((node, i) => this.before[i].copy(node));
    let strain = 0;
    const last = this.nodes.length - 1, length = C.hoseLength / last;
    const subDt = dt / 2;
    for (let sub = 0; sub < 2; sub++) {
      for (let i = 1; i < last; i++) {
        const node = this.nodes[i], current = node.clone();
        node.add(node.clone().sub(this.previous[i]).multiplyScalar(0.88));
        node.y -= 14 * subDt * subDt; this.previous[i].copy(current);
      }
      this.nodes[0].copy(anchor); this.nodes[last].copy(end);
      for (let iteration = 0; iteration < 10; iteration++) {
        for (let i = 0; i < last; i++) {
          const a = this.nodes[i], b = this.nodes[i + 1], delta = b.clone().sub(a), distance = delta.length();
          if (distance <= length) continue;
          const excess = distance - length;
          strain = Math.max(strain, excess / length);
          delta.multiplyScalar(excess / distance);
          if (i === 0) b.sub(delta);
          else if (i + 1 === last) a.add(delta);
          else { a.addScaledVector(delta, 0.5); b.addScaledVector(delta, -0.5); }
        }
        for (let i = 1; i < last; i++) this.support(this.nodes[i], trucks);
        this.nodes[0].copy(anchor); this.nodes[last].copy(end);
      }
    }
    const ratio = anchor.distanceTo(end) / C.hoseLength;
    const load = Math.max(strain, pulled / length);
    if (ratio < C.hoseTautOff) this.taut = false;
    else if (ratio >= C.hoseTautOn && load > 0.002) this.taut = true;
    this.tension = this.taut ? clamp(Math.max(load * 6, (ratio - C.hoseTautOff) / (1 - C.hoseTautOff)), 0.2, 1) : 0;
    if (this.taut) this.pushPlayers(dt, players, oldPlayerPositions);
  }
  pushPlayers(dt, players, oldPlayerPositions = players.map((p) => p.pos.clone())) {
    const radius = C.hoseRadius + C.hosePlayerRadius * K; // body radius at the character scale
    for (let slot = 0; slot < players.length; slot++) {
      const player = players[slot];
      if (player.occupied === false || player === this.gun.holder || !['ground', 'air'].includes(player.state)) continue;
      let best = null;
      for (let i = 0; i < this.nodes.length - 1; i++) {
        const movement = Math.max(this.nodes[i].distanceTo(this.before[i]), this.nodes[i + 1].distanceTo(this.before[i + 1]), player.pos.distanceTo(oldPlayerPositions[slot]));
        const samples = Math.max(1, Math.min(16, Math.ceil(movement / 0.12)));
        for (let sample = 0; sample <= samples; sample++) {
          const t = sample / samples;
          const a = this.before[i].clone().lerp(this.nodes[i], t), b = this.before[i + 1].clone().lerp(this.nodes[i + 1], t);
          const segment = b.clone().sub(a), lengthSq = segment.lengthSq();
          const feet = oldPlayerPositions[slot].clone().lerp(player.pos, t);
          // Overlapping spheres cover the player's finite vertical capsule.
          for (const height of [0.2, 0.6, 1]) {
            const center = feet.clone(); center.y += height;
            const u = lengthSq > 1e-8 ? clamp(center.clone().sub(a).dot(segment) / lengthSq, 0, 1) : 0;
            const point = a.clone().addScaledVector(segment, u), normal = center.clone().sub(point), distance = normal.length();
            if (distance >= radius) continue;
            normal.y = 0;
            if (normal.lengthSq() < 1e-8) normal.set(-segment.z, 0, segment.x);
            if (normal.lengthSq() < 1e-8) normal.set(0, 0, 1);
            normal.normalize();
            const swept = this.nodes[i].clone().sub(this.before[i]); swept.y = 0;
            if (sample < samples && swept.dot(normal) < 0) normal.negate();
            const penetration = radius - distance;
            if (!best || penetration > best.penetration) best = { normal, penetration };
          }
        }
      }
      if (!best) continue;
      const speed = C.hosePushSpeed * this.tension / playerMass(player);
      player.pos.addScaledVector(best.normal, Math.min(0.1, best.penetration * 0.7));
      const outward = player.externalVelocity.dot(best.normal);
      if (outward < speed) player.externalVelocity.addScaledVector(best.normal, speed - outward);
      player.externalVelocity.clampLength(0, C.hosePushSpeed);
      const ground = player.ground;
      if (ground && !ground.truck.platformAt(player.pos.x, player.pos.z, 0.3)) {
        player.state = 'air'; player.takeoff = ground.truck; player.ground = null; player.coyote = 0;
        player.airBase.set(ground.truck.vel.x, ground.truck.vel.z); player.vel.copy(ground.truck.vel);
      }
      player.root.position.copy(player.pos);
    }
  }
}
