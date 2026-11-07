/** Tutorial slap dummy: a wooden "enemy" on the home truck that empty hands can slap (K, or J with nothing to pick up),
 * so new players learn the slap without hitting a friend. Host-owned: only the authority decides a hit; viewers get
 * `active`, the hit count and direction from the snapshot (the wobble, sparks and smack sound read them). No browser APIs. */
import * as THREE from 'three';
import { SLAP, faceSlap } from './Slap.js';
import { pushPlayer } from './Mass.js';
import { buildTrainingDummy, DUMMY_SOLID } from './ToolModels.js';

/** Where it stands on the home roof (truck-local x, z): the front of the home roof, clear of the spawns, the water
 * post and the cab gap (soap stays locked in the tutorial). Its body radius. */
export const DUMMY = Object.freeze({ position: [2.0, 0.9], radius: 0.28 });

const _at = new THREE.Vector3();

export class TrainingDummy {
  constructor(game) {
    this.game = game;
    const home = game.homeTruck, [x, z] = DUMMY.position;
    this.group = buildTrainingDummy(); this.pivot = this.group.userData.pivot;
    // The painted face looks back along -x, toward the spawns and the camera.
    // Stands on whichever roof level is under it (multi-level home trucks), like the wash station.
    this.group.position.set(x, home.localTopForLocal(x, z), z); this.group.rotation.y = Math.PI; this.group.visible = false;
    home.body.add(this.group);
    // Solid while shown, like the wash station: players bump around it and can stand on its head.
    const dummy = this;
    home.solids.push({ x, z, ...DUMMY_SOLID, get active() { return dummy.group.visible; } });
    this.reset();
  }
  reset() { this.active = false; this.hitSerial = 0; this.hitDirection = [1, 0]; this.hits = this.game.players.map(() => 0); this.present(); }
  /** Host: show or remove it (a tutorial step's `dummy` flag). */
  setActive(active) { if (this.game.viewOnly) return; this.active = !!active; this.present(); }
  present() { this.group.visible = this.active && !!this.game.equipmentVisible; }
  worldPosition(target = _at) {
    const home = this.game.homeTruck, x = home.pos.x + DUMMY.position[0], z = home.pos.z + DUMMY.position[1];
    return target.set(x, home.topYAt(x, z), z);
  }
  /** Within a slap of `player`: same reach, height band and aim-assist cone as a player target. */
  inReach(player) {
    if (!this.group.visible || !['ground', 'air'].includes(player.state)) return false;
    const at = this.worldPosition(), dx = at.x - player.pos.x, dz = at.z - player.pos.z, distance = Math.hypot(dx, dz);
    if (distance > SLAP.reach + DUMMY.radius * 0.5 || Math.abs(player.pos.y - at.y) > SLAP.height) return false;
    return distance < 1e-6 || (dx * Math.cos(player.yaw) - dz * Math.sin(player.yaw)) / distance >= SLAP.cosHalfAngle;
  }
  /** A swing that found no body: hit the dummy if it is in reach. The slapper bounces back like on a body hit. */
  slapped(player) {
    if (this.game.viewOnly || !this.inReach(player)) return false;
    const at = this.worldPosition(), direction = new THREE.Vector3(at.x - player.pos.x, 0, at.z - player.pos.z);
    if (direction.lengthSq() < 1e-8) direction.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
    else faceSlap(player, direction.x, direction.z);
    direction.normalize();
    pushPlayer(player, direction.clone().negate(), SLAP.recoil);
    this.hitSerial++; this.hitDirection = [direction.x, direction.z];
    const slot = this.game.players.indexOf(player); if (slot >= 0) this.hits[slot]++;
    return true;
  }
  capture() { return { active: this.active, hitSerial: this.hitSerial, hitDirection: [...this.hitDirection] }; }
  apply(data) {
    this.active = !!data?.active; this.hitSerial = data?.hitSerial || 0;
    this.hitDirection = Array.isArray(data?.hitDirection) ? [...data.hitDirection] : [1, 0]; this.present();
  }
}
