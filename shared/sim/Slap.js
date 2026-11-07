/** Empty-hand slap in every mode (VERSUS_RULES.md §10): the host shoves the nearest body in front with the shared weight
 * rule. It hits anyone, teammates included. No browser APIs. */
import * as THREE from 'three';
import { pushPlayer } from './Mass.js';
import { WOBBLE, hit, wouldKnockDown } from './Wobble.js';
import { CHARACTER_SCALE as K } from './characterScale.js';

export const SLAP = Object.freeze({
  reach: 1.25 * K, // Body centre to body centre, flat distance (scales with the character size; 2026-10-20: 1.1 → 1.25).
  height: 0.95 * K, // Height difference still in reach (one body).
  // Aim assist (2026-10-20: ±60° → ±75°): a swing picks a body within this cone around the facing, preferring the one
  // nearest the centre line, and snaps the slapper's facing onto it (host yaw, synced by the snapshot).
  cosHalfAngle: Math.cos(Math.PI * 75 / 180),
  // Burst shove: full speed in one tick, then the shared externalVelocity decay (e^-10/s) bleeds it off fast,
  // so ~63% of the travel happens in the first 0.1 s. Distance = speed / 10 ÷ weight.
  speed: 18,      // Target, weight 1 at push 1: 1.8 m between equal weights at full size (2026-10-20: ×1.2 of 15);
                  // pushPlayer scales shoves by CHARACTER_SCALE, so about 1.44 m on the roof.
  recoil: 4,      // The slapper bounces back about 0.4 m (0.32 m at the character scale) from a hit (no recoil on a miss).
});

/** Tunable per character: `cooldown` seconds between swings (also while the key is held), `push` × the shove,
 * `recoil` × the slapper's own bounce-back (defaults to `push`) and `wobble` added to the target (WOBBLE.md).
 * Default: two slaps a second, full shove, 16 wobble. Animals not listed use the default. */
export const SLAP_DEFAULT = Object.freeze({ cooldown: 0.5, push: 1, wobble: 16 });
export const ANIMAL_SLAP = Object.freeze({
  // Canadian goose: pecks three times a second but shoves 25% less (versus-decisions.md 加拿大鹅).
  goose: Object.freeze({ cooldown: 1 / 3, push: 0.75, wobble: 14 }),
  // Kangaroo: a boxer's punch knocks the target twice as far; its tail braces it, so its own recoil stays normal.
  kangaroo: Object.freeze({ cooldown: 0.5, push: 1.5, recoil: 1, wobble: 20 }),
  // Squirrel: a normal slap with less wobble (balance, 2026-10-20).
  squirrel: Object.freeze({ cooldown: 0.5, push: 1, wobble: 14 }),
});
export function slapProfile(player) { return ANIMAL_SLAP[player?.animal] || SLAP_DEFAULT; }

const _dir = new THREE.Vector3(), _back = new THREE.Vector3();
const able = (p) => p.occupied !== false && ['ground', 'air'].includes(p.state) && !p.swallowedBy;

/** The best slappable body in front of `player`, or null: nearest, with off-centre bodies counted up to ~1.6× farther
 * at the cone edge so the one being aimed at wins. */
export function slapTarget(player, players) {
  const fx = Math.cos(player.yaw), fz = -Math.sin(player.yaw);
  let best = null, bestScore = Infinity;
  for (const other of players) {
    if (other === player || !able(other) || Math.abs(other.pos.y - player.pos.y) > SLAP.height) continue;
    const dx = other.pos.x - player.pos.x, dz = other.pos.z - player.pos.z, distance = Math.hypot(dx, dz);
    if (distance > SLAP.reach) continue;
    const cos = distance > 1e-6 ? (dx * fx + dz * fz) / distance : 1;
    if (cos < SLAP.cosHalfAngle) continue;
    const score = distance / (0.5 + 0.5 * cos);
    if (score >= bestScore) continue;
    best = other; bestScore = score;
  }
  return best;
}

/** Aim assist: turn `player` to face the flat direction (dx, dz) it just slapped along. */
export function faceSlap(player, dx, dz) {
  if (dx * dx + dz * dz > 1e-8) player.yaw = Math.atan2(-dz, dx);
}

/** One swing: starts the cooldown and counts it even on a miss. A hit shoves the target away from the slapper (harder
 * when it knocks them down), bounces the slapper back a little (both by weight) and adds the profile's wobble, which may
 * knock the target's held item loose (Wobble.js). Returns the target hit, or null. */
export function slap(player, players, random = Math.random) {
  const profile = slapProfile(player);
  player.slapCooldown = profile.cooldown; player.slapSerial++;
  const target = slapTarget(player, players);
  if (!target) return null;
  _dir.set(target.pos.x - player.pos.x, 0, target.pos.z - player.pos.z);
  if (_dir.lengthSq() < 1e-8) _dir.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  else faceSlap(player, _dir.x, _dir.z);
  _dir.normalize();
  const wobble = profile.wobble ?? SLAP_DEFAULT.wobble;
  pushPlayer(target, _dir, SLAP.speed * profile.push * (wouldKnockDown(target, wobble) ? WOBBLE.finisherPush : 1));
  pushPlayer(player, _back.copy(_dir).negate(), SLAP.recoil * (profile.recoil ?? profile.push));
  target.slappedSerial++; target.slappedBy = players.indexOf(player);
  hit(target, wobble, _dir, random);
  return target;
}
