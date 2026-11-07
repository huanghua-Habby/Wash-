/** Consumable work budget. All bars reuse startup-warmed geometry/materials. */
import { CarryItem } from './CarryItem.js';
import { buildSoapBar } from './ToolModels.js';
import { WASH_CONFIG as C } from './washConfig.js';

export class Soap extends CarryItem {
  constructor(scene, homeTruck, originalPosition, index) {
    super(scene, homeTruck, originalPosition, index, 'soap');
    this.mesh.add(buildSoapBar()); this.mesh.layers.enable(1);
    this.generation = 0; this.reset();
  }
  get durabilityRatio() { return this.durability / C.soapDurability; }
  tint() { this.mesh.scale.setScalar(0.7 + 0.3 * this.durabilityRatio); }
  activate() {
    this.generation++; this.durability = C.soapDurability; this.active = true;
    this.placeOn(this.homeTruck, this.originalPosition); this.mesh.visible = true; this.tint();
  }
  consume(amount) { this.durability = Math.max(0, this.durability - amount); this.tint(); }
  retire() {
    this.clearHolder(); this.active = false; this.flight = false; this.truck = null;
    this.mesh.visible = false; this.charge = 0;
  }
  reset() {
    this.durability = C.soapDurability; this.placeOn(this.homeTruck, this.originalPosition);
    this.active = false; this.mesh.visible = false; this.thrower = null; this.ownerGrace = 0; this.tint();
  }
  update(dt, trucks, onFlightSegment) { if (this.active) super.update(dt, trucks, onFlightSegment); }
}
