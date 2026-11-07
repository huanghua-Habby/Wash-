/** Shared towel ownership, durability and flight; Three scene graph without WebGL. */
import * as THREE from 'three';
import { CarryItem } from './CarryItem.js';
import { buildTowel } from './ToolModels.js';
import { WASH_CONFIG as C } from './washConfig.js';

export class Towel extends CarryItem {
  constructor(scene, homeTruck, originalPosition, index) {
    super(scene, homeTruck, originalPosition, index, 'towel');
    this.material = new THREE.MeshLambertMaterial({ color: '#fff9dd' });
    this.mesh.add(buildTowel(this.material)); this.mesh.layers.enable(1);
    this.durability = C.towelDurability;
    /** Versus only: smudge dealt with an already-dirty towel. Full grime is the "filthier" towel that must be washed. */
    this.grime = 0;
    this.placeOn(homeTruck, originalPosition);
    this.mesh.visible = false;
  }
  get dirty() { return this.durability <= 0.000001; }
  get durabilityRatio() { return Math.max(0, this.durability / C.towelDurability); }
  get grimeRatio() { return Math.max(0, Math.min(1, this.grime / C.towelDurability)); }
  /** Dirty and not yet filthiest: can smudge an enemy stain (versus). */
  get canSmudge() { return this.dirty && this.grime < C.towelDurability - 0.000001; }
  get filthy() { return this.dirty && !this.canSmudge; }
  smear(amount) { this.grime = Math.min(C.towelDurability, this.grime + amount); this.tint(); }
  tint() {
    this.material.color.set(this.dirty ? '#292b2a' : '#fff9dd');
    if (this.dirty) this.material.color.lerp(new THREE.Color('#2a1a10'), this.grimeRatio);
    if (!this.dirty) this.material.color.lerp(new THREE.Color('#c2b696'), 1 - this.durabilityRatio);
  }
  clean() { this.durability = C.towelDurability; this.grime = 0; this.washProgress = 0; this.tint(); }
  consume(amount) { this.durability = Math.max(0, this.durability - amount); this.tint(); }
}
