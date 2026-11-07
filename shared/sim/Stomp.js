/** Head stomp (WOBBLE.md §5): a normal landing on a head bounces the lander up again and counts as a hit on the head's
 * owner; a glider (pelican or goose holding Space) lands softly and stands there instead. The bounce runs in shared
 * motion (prediction too); the hit is the host's. No browser APIs. */
import * as THREE from 'three';
import { pushPlayer } from './Mass.js';
import { SLAP } from './Slap.js';
import { WOBBLE, hit } from './Wobble.js';

const _dir = new THREE.Vector3();

/** A glider settles on the head; everyone else stomps. */
export const softLanding = (player) => !!player.gliding;

/** Host: the stomp lands on `base` (slot `baseSlot`) from `stomper` (slot `stomperSlot`). A small shove along the
 * stomper's motion relative to the head, wobble unless the same stomper hit this head within the repeat window. */
export function stompHit(stomper, stomperSlot, base, baseSlot, random) {
  _dir.set(stomper.vel.x - base.vel.x, 0, stomper.vel.z - base.vel.z);
  if (_dir.lengthSq() < 1e-6) _dir.set(Math.cos(stomper.yaw), 0, -Math.sin(stomper.yaw));
  _dir.normalize();
  pushPlayer(base, _dir, SLAP.speed * WOBBLE.stompPush);
  // Counts as being hit (flinch, camera jolt, bot grudge); `stompedSerial` lets presentation say “踩!” instead of “啪!”.
  base.slappedSerial = (base.slappedSerial || 0) + 1; base.stompedSerial = (base.stompedSerial || 0) + 1; base.slappedBy = stomperSlot;
  const block = stomper.stompBlock ||= new Map();
  if (block.has(baseSlot)) return null;
  block.set(baseSlot, WOBBLE.stompRepeatSeconds);
  return hit(base, WOBBLE.stomp, _dir, random);
}
