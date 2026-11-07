import { CHARACTER_SCALE as K } from './characterScale.js';
import { pushScale } from './Wobble.js';
/** Body weight shared by every force rule: vehicle suspension, water-gun, trunk and hose knockback, and future wind/sandstorm.
 * A pelican's pouch adds whatever it swallowed, so a full pelican is harder to shove and leans a vehicle further. No browser APIs. */
export const PLAYER_MASS = 1;
/** Animals heavier than the default plush body. An elephant is hard to shove and sinks a vehicle further. */
export const ANIMAL_MASS = { elephant: 1.8 };
/** Extra weight a carried or swallowed tool adds. */
export const TOOL_MASS = { towel: 0.08, soap: 0.12, water: 0.3 };

/** Total weight of a player: body, held tool and pouch contents (a swallowed teammate counts with their own weight). */
export function playerMass(player) {
  const pouch = player?.swallowed;
  const contents = !pouch ? 0 : pouch.kind ? TOOL_MASS[pouch.kind] || 0 : playerMass(pouch);
  return (ANIMAL_MASS[player?.animal] ?? PLAYER_MASS) + (TOOL_MASS[player?.heldTool?.kind] || 0) + contents;
}

/** Shove a player toward `speed` along unit `direction`; heavier bodies reach proportionally less speed. Returns the target speed. */
export function pushPlayer(player, direction, speed) {
  // Every shove (water, trunk, hose, slap, blast) moves a body by distances at the character scale.
  // Knocked down, shock-stunned or guarded after getting up: shoves land at a fraction (WOBBLE.md).
  const target = speed * K * pushScale(player) / playerMass(player), velocity = player.externalVelocity, current = velocity.dot(direction);
  if (current < target) velocity.addScaledVector(direction, target - current);
  return target;
}
