import * as THREE from 'three';
import { WASH_CONFIG as C } from '../../../shared/sim/washConfig.js';
import { enemyOrder } from '../../../shared/sim/PvpScore.js';

const _at = new THREE.Vector3();
/** How long the "use this tool" bubble stays up after a wrong-tool J press. */
export const WRONG_TOOL_SECONDS = 1.4;

/**
 * Presentation-only hint, campaign and versus alike. When the local player presses J while holding a cleaning tool next
 * to a stain on their own truck whose current step needs a different tool, return that stain so the HUD can pop the
 * right tool's icon over it. Reads applied authority state only (stain step, held tool, position); never feeds back.
 * Returns null when the tool already matches some stain in reach (J does something), and on the other team's truck
 * (smudging and rinse-back have their own cues).
 */
export function wrongToolStain(game, player) {
  const kind = player?.heldTool?.kind;
  if (!['towel', 'water', 'soap'].includes(kind) || player.state !== 'ground' || !player.ground) return null;
  const order = game.orders?.find(entry => entry.truck === player.ground.truck);
  if (!order || order.mode !== 'working' || enemyOrder(game, player, order)) return null;
  // A dirty towel cannot clean anything; that already has its own "take it to the basin" hint.
  if (kind === 'towel' && player.heldTool.dirty) return null;
  // The gun works from range: aim matters, so use the stain it is pointed at, else the nearest one in reach.
  const reach = kind === 'water' ? C.useRange * 2.2 : C.useRange;
  let wrong = null, wrongDistance = reach;
  for (const stain of order.stains) {
    if (stain.done) continue;
    const distance = player.pos.distanceTo(stain.mesh.getWorldPosition(_at));
    if (distance >= reach) continue;
    if (stain.steps[stain.stage] === kind) return null; // Something here is the right job for this tool.
    if (distance < wrongDistance) { wrong = stain; wrongDistance = distance; }
  }
  return wrong;
}
