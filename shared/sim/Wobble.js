/** Hidden wobble, knockdown, the shock stun and the get-up guard (WOBBLE.md). Hits (slaps, stomps, shocks) report here;
 * the host alone holds the wobble value, it is never shown or synced. `downRemaining` (knockdown), `stunRemaining`
 * (shock stun, the upper state) and `guardRemaining` are snapshot fields. No browser APIs. */
import * as THREE from 'three';
import { CHARGING } from './chargingConfig.js';

export const WOBBLE = Object.freeze({
  max: 100,               // A full bar knocks a player down (slap/stomp) or shock-stuns them (shock).
  stomp: 30,              // A head stomp's wobble (slaps take theirs from Slap.js ANIMAL_SLAP / SLAP_DEFAULT `wobble`).
  stompRepeatSeconds: 1,  // The same stomper on the same head adds nothing again within this (still bounces).
  shock: 50,              // Live water adds this...
  shockInterval: 0.5,     // ...on contact and every this many seconds while standing in it.
  recoverDelay: 2,        // Seconds without a hit before wobble starts to drain...
  recoverRate: 20,        // ...at this much per second.
  knockdownSeconds: 2,    // Knocked down: no moving, jumping, J/K/L or slapping.
  shockSeconds: CHARGING.stunSeconds, // Shock stun: the slow shuffle of CHARGING.stunSpeed, nothing else; no hit applies.
  downedPush: 0.5,        // Knockback × while knocked down or shock-stunned.
  finisherPush: 1.5,      // The slap that knocks a player down shoves this much harder.
  stompPush: 0.25,        // A stomp shoves the head's owner by this × the slap base shove.
  guardSeconds: 2,        // After getting up: ...
  guardScale: 0.5,        // ...knockback and wobble × this (anti-mobbing; no effect shown).
  dropSpeed: 3,           // A knocked-loose item flies off along the hit at this speed, plus a hop.
  dropLift: 4.5,
});

const _base = new THREE.Vector3();
/** Knocked down or shock-stunned: hands and jumps locked. */
export const incapacitated = (player) => player.downRemaining > 0 || player.stunRemaining > 0;
/** Knockback multiplier for every shove (Mass.pushPlayer). */
export const pushScale = (player) => incapacitated(player) ? WOBBLE.downedPush : player.guardRemaining > 0 ? WOBBLE.guardScale : 1;
/** The wobble `amount` would actually add now (0 while incapacitated, halved under guard). */
export const wobbleGain = (player, amount) => incapacitated(player) ? 0 : amount * (player.guardRemaining > 0 ? WOBBLE.guardScale : 1);
/** Whether a hit of `amount` would fill the bar now: the slap uses it for its finisher shove before applying. */
export const wouldKnockDown = (player, amount) => wobbleGain(player, amount) > 0 && (player.wobble || 0) + wobbleGain(player, amount) >= WOBBLE.max;

/** The held item flies off along unit `direction` (xz). The victim's own throw grace keeps it from snatching it straight
 * back; anyone else can grab it. Charging and K gestures end with the item. */
export function knockLoose(player, direction) {
  const item = player.heldTool;
  if (!item) return;
  const base = player.ground ? player.ground.truck.vel : _base.set(player.airBase.x, 0, player.airBase.y);
  item.release(player, new THREE.Vector3(base.x + direction.x * WOBBLE.dropSpeed, WOBBLE.dropLift, base.z + direction.z * WOBBLE.dropSpeed));
  player.throwWasDown = false; player.throwCancelled = true;
}

/** End every gesture, as a shock always did. */
function lockUp(player) {
  if (player.wall) player.releaseWall(0, 0.3);
  player.dashRemaining = player.slipRemaining = player.jumpBoost = player.jumpBuf = player.coyote = player.catchRemaining = 0;
  player.throwCancelled = !!player.throwWasDown;
  if (player.heldTool) player.heldTool.charge = 0;
}

/** Knock down: wobble resets, the held item falls, 2 s without control. */
export function knockDown(player, direction) {
  knockLoose(player, direction);
  player.wobble = 0; player.guardRemaining = 0; player.downRemaining = WOBBLE.knockdownSeconds;
  lockUp(player); player.downSerial = (player.downSerial || 0) + 1;
  player.emit?.('knockdown');
}

/** A slap or stomp landing with `amount` wobble along unit `direction`. Returns 'down', 'hit', or null when nothing
 * applied (incapacitated). A surviving hit drops the held item with probability wobble / max. */
export function hit(player, amount, direction, random = Math.random) {
  const gain = wobbleGain(player, amount);
  if (!(gain > 0)) return null;
  player.wobble = Math.min(WOBBLE.max, (player.wobble || 0) + gain); player.wobbleIdle = 0;
  if (player.wobble >= WOBBLE.max) { knockDown(player, direction); return 'down'; }
  if (player.heldTool && random() * WOBBLE.max < player.wobble) knockLoose(player, direction);
  return 'hit';
}

/** Shock stun, the upper state: starts at once over a knockdown (which restarts its timer once). */
export function shockStun(player) {
  if (player.stunRemaining > 0 || !['ground', 'air'].includes(player.state)) return false;
  if (player.downRemaining > 0) player.downRemaining = WOBBLE.knockdownSeconds;
  player.wobble = 0; player.guardRemaining = 0; player.stunRemaining = WOBBLE.shockSeconds;
  lockUp(player);
  player.emit?.('stun'); return true;
}

/** Live water under the feet this tick: wobble on contact and every interval; a full bar (or any shock while knocked
 * down) shock-stuns. Returns true when the player was shock-stunned now. */
export function shock(player, dt) {
  if (player.stunRemaining > 0) return false;
  player.shockClock = (player.shockClock || 0) - dt;
  if (player.shockClock > 1e-9) return false;
  player.shockClock = WOBBLE.shockInterval;
  if (player.downRemaining > 0) return shockStun(player);
  player.wobble = Math.min(WOBBLE.max, (player.wobble || 0) + wobbleGain(player, WOBBLE.shock)); player.wobbleIdle = 0;
  return player.wobble >= WOBBLE.max ? shockStun(player) : false;
}

/** Out of live water: the next contact shocks at once. */
export function leaveShock(player) { player.shockClock = 0; }

/** Per tick, on host and prediction alike: timers run down, getting up opens the guard, wobble drains after a quiet spell. */
export function tickWobble(player, dt) {
  const wasDown = player.downRemaining > 0 || player.stunRemaining > 0;
  if (player.downRemaining > 0) player.downRemaining = player.downRemaining - dt < 1e-9 ? 0 : player.downRemaining - dt;
  if (player.stunRemaining > 0) player.stunRemaining = player.stunRemaining - dt < 1e-9 ? 0 : player.stunRemaining - dt;
  if (wasDown && !incapacitated(player)) player.guardRemaining = WOBBLE.guardSeconds;
  else if (player.guardRemaining > 0) player.guardRemaining = Math.max(0, player.guardRemaining - dt);
  player.wobbleIdle = (player.wobbleIdle || 0) + dt;
  if (player.wobble > 0 && player.wobbleIdle > WOBBLE.recoverDelay) player.wobble = Math.max(0, player.wobble - WOBBLE.recoverRate * dt);
  if (player.stompBlock) for (const [slot, left] of player.stompBlock) left - dt > 1e-9 ? player.stompBlock.set(slot, left - dt) : player.stompBlock.delete(slot);
}

/** Respawn, swallow or a new world: everything clears. */
export function resetWobble(player) {
  player.wobble = player.wobbleIdle = player.downRemaining = player.stunRemaining = player.guardRemaining = player.shockClock = 0;
  player.stompBlock?.clear();
}
