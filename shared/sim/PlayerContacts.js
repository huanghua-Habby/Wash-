/** Shared upright player bodies. The host resolves every pair after movement; prediction may commit only its own body. */
import * as THREE from 'three';
import { playerMass } from './Mass.js';
import { STAND } from './Standing.js';
import { softLanding, stompHit } from './Stomp.js';
import { CHARACTER_SCALE as K } from './characterScale.js';

export const PLAYER_BODY = Object.freeze({ radius: 0.38 * K, height: 0.95 * K, iterations: 10 });
const DIAMETER = PLAYER_BODY.radius * 2, CONTACT_SLOP = 0.0001;
const solid = player => player.occupied !== false && player.sceneReady !== false && !player.swallowedBy &&
  (player.state === 'ground' || player.state === 'air');

/**
 * Resolve horizontal overlap by inverse mass, including chains of up to four players. No stacking: a jump that
 * clears the other body's height passes overhead. Positions/air momentum are ordinary player snapshot fields.
 * The returned pair mask is authority-local: contact edges request an urgent snapshot without a new wire field.
 * `onlyPlayer` is for local prediction: scratch peers participate, but their state is never changed by the guest.
 * `random` is the host's: only the host (no `onlyPlayer`) lands head-stomp hits (Stomp.js); `onStomp(stomper, victim)`
 * lets the host credit them (match record).
 */
export function resolvePlayerContacts(players, previousPositions, dt, onlyPlayer = null, random = null, onStomp = null) {
  if (!(dt > 0)) return 0;
  if (players.filter(solid).length < 2) return 0;
  standOnHeads(players, previousPositions, onlyPlayer, random, onStomp);
  const bodies = players.map((player, slot) => {
    if (!solid(player)) return null;
    const previous = previousPositions[slot] || player.pos;
    const velocity = new THREE.Vector3().subVectors(player.pos, previous).divideScalar(dt).setY(0);
    return { player, slot, pos: player.pos.clone(), previous, velocity, initialVelocity: velocity.clone(), inverseMass: 1 / playerMass(player) };
  }).filter(Boolean);
  let contacts = 0;
  for (let iteration = 0; iteration < PLAYER_BODY.iterations; iteration++) {
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      // One body height apart (a rider on a head) never pushes sideways; the epsilon absorbs float error in base + height.
      if (Math.abs(a.pos.y - b.pos.y) >= PLAYER_BODY.height - 1e-6) continue;
      let x = b.pos.x - a.pos.x, z = b.pos.z - a.pos.z;
      const distance = Math.hypot(x, z);
      if (distance > DIAMETER + CONTACT_SLOP) continue;
      // Triangular pair index (28 pairs for 8 slots); arithmetic flags stay exact past the 32-bit `<<` wrap.
      const pair = 2 ** (a.slot * (2 * players.length - a.slot - 1) / 2 + b.slot - a.slot - 1);
      if (Math.floor(contacts / pair) % 2 === 0) contacts += pair;
      if (distance > 1e-8) { x /= distance; z /= distance; }
      else {
        // Stable slot ordering also separates coincident spawns without random or frame-dependent directions.
        x = b.previous.x - a.previous.x; z = b.previous.z - a.previous.z;
        const oldDistance = Math.hypot(x, z);
        if (oldDistance > 1e-8) { x /= oldDistance; z /= oldDistance; } else { x = 1; z = 0; }
      }
      const inverseMass = a.inverseMass + b.inverseMass, penetration = Math.max(0, DIAMETER - distance);
      const moveA = penetration * a.inverseMass / inverseMass, moveB = penetration * b.inverseMass / inverseMass;
      a.pos.x -= x * moveA; a.pos.z -= z * moveA;
      b.pos.x += x * moveB; b.pos.z += z * moveB;
      // Inelastic contact: transfer closing motion, never add a bounce or launch stationary overlapping spawns.
      const closing = (a.velocity.x - b.velocity.x) * x + (a.velocity.z - b.velocity.z) * z;
      if (closing > 0) {
        const impulse = closing / inverseMass;
        a.velocity.x -= x * impulse * a.inverseMass; a.velocity.z -= z * impulse * a.inverseMass;
        b.velocity.x += x * impulse * b.inverseMass; b.velocity.z += z * impulse * b.inverseMass;
      }
    }
  }
  for (const body of bodies) {
    if (onlyPlayer && body.player !== onlyPlayer) continue;
    const deltaVelocity = body.velocity.clone().sub(body.initialVelocity);
    if (body.pos.distanceToSquared(body.player.pos) > 1e-16 || deltaVelocity.lengthSq() > 1e-16)
      body.player.applyBodyContact(body.pos, deltaVelocity, body.velocity);
  }
  return contacts;
}

/** Heads are standable (MULTIPLAYER.md "可站立的道具与角色"): riders follow their base (stacks resolve bottom-up), then
 * falling bodies that cross a head's height inside the head radius land on it: gliders stand there, everyone else
 * bounces off with a head stomp (Stomp.js, WOBBLE.md §5). Runs before the horizontal pass, where
 * a rider and its base are one body height apart and never push each other. */
function standOnHeads(players, previousPositions, onlyPlayer, random, onStomp) {
  const mine = (player) => !onlyPlayer || player === onlyPlayer;
  const riding = (player) => player.state === 'ground' && player.ground?.stand >= 0;
  for (let pass = 0; pass < 4; pass++) for (const rider of players) {
    if (!riding(rider) || !solid(rider) || !mine(rider)) continue;
    const base = players[rider.ground.stand];
    if (!base || base === rider || !solid(base) || (riding(base) && players[base.ground.stand] === rider)) {
      const truck = rider.ground.truck;
      rider.walkOff(truck, { x: 0, z: 0 }, 0);
      continue;
    }
    const offset = rider.ground.offset;
    rider.pos.set(base.pos.x + offset.x, base.pos.y + PLAYER_BODY.height, base.pos.z + offset.z);
    if (base.state === 'ground' && base.ground?.truck) { rider.ground.truck = base.ground.truck; rider.ground.plat = base.ground.plat || rider.ground.plat; }
  }
  players.forEach((faller, i) => {
    if (!solid(faller) || faller.state !== 'air' || faller.wall || !(faller.vel.y <= 0) || !mine(faller)) return;
    const previousY = (previousPositions[i] || faller.pos).y;
    let best = -1, bestDistance = STAND.headRadius;
    players.forEach((base, slot) => {
      if (slot === i || !solid(base) || (riding(base) && base.ground.stand === i)) return;
      const top = base.pos.y + PLAYER_BODY.height, distance = Math.hypot(faller.pos.x - base.pos.x, faller.pos.z - base.pos.z);
      if (faller.pos.y <= top && previousY >= top - STAND.landWindow && distance < bestDistance) { best = slot; bestDistance = distance; }
    });
    if (best < 0) return;
    const base = players[best];
    // Gliders settle softly on the head; any other landing springs off it and, on the host, stomps the owner.
    if (softLanding(faller)) { faller.landOnHead(best, base, faller.pos.x - base.pos.x, faller.pos.z - base.pos.z); return; }
    if (!onlyPlayer && random) { stompHit(faller, i, base, best, random); onStomp?.(faller, base); }
    faller.bounceOffHead(base);
  });
}
