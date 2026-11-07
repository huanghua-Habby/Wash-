import { Color } from 'three';
import { Towel } from '../../../shared/sim/Towel.js';
import { Soap } from '../../../shared/sim/Soap.js';
import { CLEANING_THEME } from '../core/cleaningTheme.js';
import { batchTool } from '../render/ToolBatches.js';

const clean = new Color(CLEANING_THEME.towel.model), used = new Color('#A39576'), empty = new Color('#343E43'), filthy = new Color('#2B1B12');
const palettes = new Map();
function colorParts(root, colors) {
  root.traverse(node => {
    const original = node.material, color = colors[original?.userData.toolPart];
    if (!color) return;
    let variants = palettes.get(original);
    if (!variants) { variants = new Map(); palettes.set(original, variants); }
    if (!variants.has(color)) { const material = original.clone(); material.color.set(color); variants.set(color, material); }
    node.material = variants.get(color);
  });
}

/** Appearance overrides reuse the shared ownership/durability/flight implementation. */
export class CleaningTowel extends Towel {
  constructor(scene, truck, position, index) {
    super(scene, truck, position, index); this.tint();
    batchTool(this.mesh.children[0], { dynamic: [this.material] });
  }
  tint() {
    this.material.color.copy(this.dirty ? empty : clean);
    if (!this.dirty) this.material.color.lerp(used, 1 - this.durabilityRatio);
    else this.material.color.lerp(filthy, this.grimeRatio);
  }
}

export class CleaningSoap extends Soap {
  constructor(scene, truck, position, index) {
    super(scene, truck, position, index);
    colorParts(this.mesh, { soap: CLEANING_THEME.soap.model });
    // Later pool slots borrow the first bar's prepared depth variants too.
    batchTool(this.mesh.children[0], { cache: true });
  }
}

export function colorCleaningStations(game) {
  colorParts(game.soapBox, { crate: CLEANING_THEME.soap.model });
  for (const point of game.supplyPoints) colorParts(point, { tapBody: CLEANING_THEME.water.model });
}
