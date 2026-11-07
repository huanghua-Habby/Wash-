/** Vehicle ladders (vehicles.js `ladders`) for every animal: the squirrel's wall-cling state (`wall` with `ladder` set)
 * on the hull face the ladder is mounted on, so pose, snapshot, prediction and kick-off reuse the cling code.
 * W climbs, S descends, no sideways, Space hops off; no stamina or grip clock. No browser APIs. */
import * as THREE from 'three';
import { WASH_CONFIG as C } from './washConfig.js';
import { SOLID_RADIUS } from './ToolModels.js';
import { wallBox, wallBoxes, wallNormal, WALL_JUMP_LOCK, WALL_DROP_LOCK, WALL_KNOCK } from './WallCling.js';
import { CHARACTER_SCALE as K } from './characterScale.js';

export const LADDER = Object.freeze({
  tolerance: 0.3,   // Zone margin around the authored ladder rectangle (the platform edge tolerance).
  levelMatch: 0.35, // A walked level counts as the ladder's foot/top within this height.
  hopOut: 1.4,      // Space: let go with this small push off the face...
  hopUp: 4.5 * K,   // ...and this lift (45% of a jump; not the squirrel's wall kick, which would fly off a short deck).
  stepIn: 0.45,     // Over the top: step this far in onto the deck.
});
const STILL = new THREE.Vector3(), _normal = { x: 0, z: 0 };

/** Index of the ladder of `T` whose zone holds the player and joins local levels `low` and `high`, or -1.
 * `fromBelow` widens the zone by the body radius and ignores `high` (walking into its foot). */
export function ladderAt(player, T, low, high, fromBelow = false) {
  const lx = player.pos.x - T.pos.x, lz = player.pos.z - T.pos.z, tol = LADDER.tolerance, widen = fromBelow ? SOLID_RADIUS : 0;
  return (T.spec.ladders || []).findIndex((ladder) => lx >= ladder.x0 - tol - widen && lx <= ladder.x1 + tol + widen &&
    lz >= ladder.z0 - tol && lz <= ladder.z1 + tol &&
    Math.abs(low - ladder.fromY) < LADDER.levelMatch && (fromBelow || Math.abs(high - ladder.toY) < LADDER.levelMatch));
}

/** Hang on ladder `index` of `T` at local height `y`. */
export function grabLadder(player, T, index, y) {
  const ladder = T.spec.ladders[index], cx = (ladder.x0 + ladder.x1) / 2, boxes = wallBoxes(T);
  // Keep the body's place across the ladder (no sideways snap to its middle).
  const cz = Math.max(ladder.z0, Math.min(ladder.z1, player.pos.z - T.pos.z));
  let wall = null;
  boxes.forEach((box, i) => {
    if (wall || box.solid || box.y1 < ladder.toY - 0.05 || cz < box.z0 || cz > box.z1) return;
    if (Math.abs(box.x0 - cx) < 0.3) wall = { truck: T, box: i, axis: 'x', side: -1, along: cz, y, ladder: index };
    else if (Math.abs(box.x1 - cx) < 0.3) wall = { truck: T, box: i, axis: 'x', side: 1, along: cz, y, ladder: index };
  });
  if (!wall) return false;
  player.state = 'air'; player.ground = null; player.wall = wall;
  // No stamina on a ladder: the squirrel's grip clock neither runs nor refills here.
  player.vel.y = 0; player.dashRemaining = player.jumpBoost = player.coyote = 0; player.gliding = false;
  player.holdWall(boxes[wall.box], STILL);
  player.emit('ladder', { truck: T });
  return true;
}

/** One ladder tick: `climb` > 0 climbs, < 0 descends; the top steps onto the upper deck and the bottom onto the lower
 * one; hanging still at either end stays on. Returns false when the player let go into free flight. */
export function updateLadder(player, dt, trucks, stunned, climb) {
  const box = wallBox(player.wall, trucks), truck = player.wall.truck, ladder = truck.spec.ladders?.[player.wall.ladder];
  const n = wallNormal(player.wall, _normal), knocked = player.externalVelocity.x * n.x + player.externalVelocity.z * n.z > WALL_KNOCK;
  if (!box || !ladder || stunned || knocked) { player.releaseWall(0, knocked ? WALL_DROP_LOCK : 0.12); return false; }
  if (player.jumpBuf > 0) {
    player.releaseWall(LADDER.hopOut, WALL_JUMP_LOCK); player.vel.y = LADDER.hopUp; player.jumpBuf = 0;
    player.emit('jump', { truck }); return true;
  }
  player.vel.y = Math.sign(climb) * (Math.abs(climb) > 0.3 ? C.ladderClimbSpeed : 0);
  player.wall.y = Math.max(ladder.fromY, Math.min(ladder.toY, player.wall.y + player.vel.y * dt));
  const top = player.vel.y > 0 && player.wall.y >= ladder.toY, bottom = player.vel.y < 0 && player.wall.y <= ladder.fromY;
  if (!top && !bottom) { player.holdWall(box, STILL); return true; }
  player.wall.y = top ? ladder.toY : ladder.fromY; player.holdWall(box, STILL);
  if (top) { player.pos.x -= n.x * LADDER.stepIn; player.pos.z -= n.z * LADDER.stepIn; }
  const plat = truck.platformAt(player.pos.x, player.pos.z, top ? 0 : LADDER.tolerance);
  player.wall = null;
  if (plat) { player.landOn(truck, plat); return true; }
  return false;
}
