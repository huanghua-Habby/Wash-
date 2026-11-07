/** Shared movement, platform attachment and animation state; no browser APIs. */
import * as THREE from 'three';
import { PAL } from './palette.js';
import { damp, dampAngle } from './util.js';
import { WASH_CONFIG as C } from './washConfig.js';
import { POUCH_X, POUCH_Y } from './CarryItem.js';
import { ROAD_SIGN } from './RoadSigns.js';
import { CHARGING } from './chargingConfig.js';
import { SOLID_RADIUS } from './ToolModels.js';
import { findWall, wallBox, wallNormal, wallPosition, slideSpeed, faceRange, WALL_HANG, WALL_JUMP_LOCK, WALL_DROP_LOCK, WALL_KNOCK } from './WallCling.js';
import { ladderAt, grabLadder, updateLadder } from './Ladder.js';
import { refillAir, glide, flap } from './AirAbilities.js';
import { incapacitated, shockStun, tickWobble, resetWobble } from './Wobble.js';
import { SLIPPERY } from './Slippery.js';
import { DEPARTURE } from './VehicleBehaviors.js';
import { STAND, solidUnder, solidTopY } from './Standing.js';
import { PLAYER_BODY } from './PlayerContacts.js';
import { CHARACTER_SCALE as K, WALK_SPEED_SCALE } from './characterScale.js';

// Character-scaled motion (characterScale.js): gravity and jump scale together (same airtime, jump K as high).
const G = 28 * K;
const JUMP = 10 * K;
const SPEED = 5.5 * K * WALK_SPEED_SCALE;
const TOL = 0.3;        // 平台边缘容差（方块半身悬空也能站住）
const STEP_UP = 0.65;   // Walkable rise between platforms; taller climbs only inside an authored ladder zone (vehicles.js).
/** Body edge probes against a taller level's face, so the body stops at its surface instead of half inside it. */
const EDGE_PROBES = [[SOLID_RADIUS, 0], [-SOLID_RADIUS, 0], [0, SOLID_RADIUS], [0, -SOLID_RADIUS]];
const WIND_DRIFT = 1.4 * K; // 空中被风往后吹
// Shoves (externalVelocity): the roof grips a shoved body hard (e^-10/s, a burst then a stop); the air barely does, so a
// body shoved off an edge keeps flying in an arc instead of stopping dead and dropping straight down (VERSUS_RULES.md §10).
const GROUND_SHOVE_DRAG = 10, AIR_SHOVE_DRAG = 2.5;
const SHOVE_POP = 0.25, SHOVE_POP_MAX = 2.5; // Leaving an edge while shoved: a small hop, this share of the shove speed (m/s).
const DASH_SPEED = 12 * K;
const DASH_SECONDS = 0.18;
const DASH_COOLDOWN = 0.65;
const STILL = new THREE.Vector3();
/** Read-only movement constants for planners that must predict this motion (bots); the rules below stay the only physics. */
export const MOTION = Object.freeze({ gravity: G, jump: JUMP, speed: SPEED, edgeTolerance: TOL, windDrift: WIND_DRIFT });
const _solidPos = new THREE.Vector3(), _solidDelta = new THREE.Vector3(), _solidVel = new THREE.Vector3();
const _wallPos = new THREE.Vector3(), _normal = { x: 0, z: 0 };

const ANIMALS = ['cat', 'dog', 'pelican', 'elephant', 'squirrel', 'goose', 'kangaroo'];
const knownAnimal = animal => ANIMALS.includes(animal) ? animal : 'cat';
/** Animals whose ability is on L (pelican swallow, elephant trunk); the rest are passive or on Space. */
export const L_SKILL_ANIMALS = Object.freeze(['pelican', 'elephant']);

export class PlayerMotion {
  constructor(scene, { color = PAL.player, respawnReduction = C.catRespawnReduction } = {}) {
    this.root = new THREE.Group();
    this.lean = new THREE.Group();
    this.yawG = new THREE.Group();
    this.squash = new THREE.Group();
    this.root.add(this.lean);
    this.lean.add(this.yawG);
    this.yawG.add(this.squash);

    scene.add(this.root);

    this.homeLocal = new THREE.Vector3(-2, 0, 0);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.airBase = new THREE.Vector2();
    this.state = 'air';
    this.ground = null;
    this.takeoff = null;
    this.yaw = 0;
    this.sq = 0; this.sqV = 0;
    this.walk = 0;
    this.coyote = 0;
    this.jumpBuf = 0;
    this.fallTimer = 0;
    this.deathCause = '';
    this.roadSignAttachment = null;
    this.animal = 'cat';
    // `animal` is the one in play: the roster's `baseAnimal`, unless a tutorial lends another body (`morph`, e.g. the
    // elephant for the L lesson). `morphSerial` counts swaps so every page plays the poof once.
    this.baseAnimal = 'cat'; this.morph = ''; this.morphSerial = 0;
    // Host-local count of L abilities used (trunk opened, pelican L); the tutorial reads it, it is never sent.
    this.skillSerial = 0;
    this.respawnReduction = respawnReduction;
    this.workSpeed = 1;
    this.team = null; // Versus team from the room roster (0 red, 1 blue); null in co-op.
    this.swallowed = null;   // Pelican pouch: a tool or a teammate.
    this.swallowedBy = null; // The pelican holding this player in its pouch.
    this.swallowRemaining = 0; // Seconds until a swallowed player breaks free.
    this.swallowElapsed = 0; this.struggleLog = []; // Host-only clock and accepted struggle presses while swallowed.
    this.swallowCooldown = 0; // Pelican: seconds until it may swallow a player again.
    refillAir(this); this.gliding = false;
    this.speedScale = 1;     // Squirrels run faster.
    this.wall = null;        // Squirrel cling (WallCling.js): only while airborne.
    this.wallTime = 0;       // Seconds clung since the last landing; drives the slide speed and the grip limit.
    this.wallLock = 0;       // Seconds before the squirrel may grab a face again after kicking or pushing off.
    this.listeners = {};
    this.suppressEvents = false;
    this.occupied = true;
    this.departure = { serial: 0, position: [0, 0, 0], visible: false };
    this._fwd = new THREE.Vector3();
    this.dashDirection = new THREE.Vector3(1, 0, 0);
    this.dashRemaining = 0;
    this.dashCooldown = 0;
    this.jumpBoost = 0;
    this.heldTool = null;
    this.useAction = '';
    this.externalVelocity = new THREE.Vector3();
    this.slipRemaining = this.slipCooldown = this.catchRemaining = 0;
    // Hits (Wobble.js): shock stun (slow shuffle), knockdown (no control), the get-up guard; wobble itself is host memory.
    this.stunRemaining = this.downRemaining = this.guardRemaining = this.wobble = 0; this.downSerial = this.stompSerial = this.stompedSerial = 0;
    // Versus soap: seconds left on ice, the immunity after it, and the carried ice velocity (relative to the roof).
    this.slipperyRemaining = this.slipperyImmunity = 0;
    // Emote shown over the head (host-applied, see shared/emotes.js); the serial restarts the bubble for a repeat.
    this.emoteId = ''; this.emoteSerial = 0; this.emoteRemaining = 0; this.emoteCooldown = 0;
    // Versus slap (shared/sim/Slap.js): cooldown, swings made and slaps taken; `slapArmed` waits for K to be let go after a drop/throw.
    // `slappedBy` is the last slapper's slot: host memory for bots (BOTS.md §14.4), never in a snapshot.
    this.slapCooldown = 0; this.slapSerial = 0; this.slappedSerial = 0; this.slapArmed = true; this.slappedBy = -1;
    // Knock-offs this player caused (StatsTally.fell) and the last victim's slot: the attacker's page plays the "砰～!" feedback.
    this.knockoutSerial = 0; this.knockoutVictim = -1;
    this.iceVelocity = new THREE.Vector3(); this._iceDirection = new THREE.Vector3();
  }

  /** Animal abilities: cats respawn sooner, dogs wipe and soap faster, pelicans swallow, elephants spray with L
   * and squirrels run faster and cling to walls. The host applies the roster's animal. */
  setAnimal(animal) { this.baseAnimal = knownAnimal(animal); this.applyAnimal(); }

  /** Lend this player another animal's body and ability ('' gives the roster's back). Returns whether it changed. */
  setMorph(animal) {
    const next = animal ? knownAnimal(animal) : '';
    if (next === this.morph) return false;
    this.morph = next; this.morphSerial++; this.applyAnimal();
    return true;
  }

  applyAnimal() {
    const next = this.morph || this.baseAnimal;
    if (next !== this.animal) this.trunk?.reset();
    this.animal = next;
    this.respawnReduction = this.animal === 'cat' ? C.catRespawnReduction : 0;
    this.workSpeed = this.animal === 'dog' ? 1 + C.dogWorkSpeedBonus : 1;
    this.speedScale = this.animal === 'squirrel' ? 1 + C.squirrelSpeedBonus : 1;
    this.jumpScale = this.animal === 'kangaroo' ? C.kangarooJumpScale : 1;
    if (this.animal !== 'squirrel') this.wall = null;
    refillAir(this);
  }

  /** The vehicle carrying this player: the roof it stands on or the hull it clings to. */
  get carrierTruck() { return this.state === 'ground' ? this.ground?.truck || null : this.state === 'air' ? this.wall?.truck || null : null; }

  // Preserve the towel-facing API for existing callers while tools share one slot.
  get heldTowel() { return this.heldTool?.kind === 'towel' ? this.heldTool : null; }
  set heldTowel(value) { this.heldTool = value; }

  /** Subscribe to a motion event and return an unsubscribe function. */
  on(ev, fn) {
    const listeners = (this.listeners[ev] ||= []); listeners.push(fn);
    return () => { const index = listeners.indexOf(fn); if (index >= 0) listeners.splice(index, 1); };
  }
  emit(ev, d) { if (!this.suppressEvents) (this.listeners[ev] || []).forEach((f) => f(d)); }

  spawn(truck) {
    this.deathCause = '';
    this.roadSignAttachment = null;
    this.root.visible = this.occupied !== false && this.sceneReady !== false;
    if (this.swallowedBy) { this.swallowedBy.swallowed = null; this.swallowedBy = null; }
    this.swallowRemaining = 0;
    refillAir(this); this.gliding = false;
    this.wall = null; this.wallTime = this.wallLock = 0;
    this.fallTimer = this.jumpBuf = this.coyote = 0;
    this.externalVelocity.set(0, 0, 0);
    const local = this.homeLocal || { x: -2, z: 0 };
    this.pos.set(truck.pos.x + local.x, truck.topYAt(truck.pos.x + local.x, truck.pos.z + local.z) + 3.5, truck.pos.z + local.z);
    this.vel.set(truck.vel.x, 0, truck.vel.z);
    this.airBase.set(truck.vel.x, truck.vel.z);
    this.state = 'air';
    this.ground = null;
    this.takeoff = truck;
    this.dashRemaining = this.jumpBoost = 0;
    this.slipRemaining = this.slipCooldown = this.catchRemaining = 0;
    resetWobble(this);
    this.slipperyRemaining = this.slipperyImmunity = 0; this.iceVelocity.set(0, 0, 0);
    this.lean.rotation.set(0, 0, 0);
  }

  fallOut(cause = 'fall') {
    if (this.state === 'fallen') return;
    this.state = 'fallen';
    this.deathCause = cause;
    this.ground = null; this.wall = null;
    this.fallTimer = C.respawnSeconds * (1 - this.respawnReduction);
    this.dashRemaining = this.jumpBoost = this.jumpBuf = this.coyote = 0;
    this.externalVelocity.set(0, 0, 0);
    resetWobble(this);
    this.slipperyRemaining = this.slipperyImmunity = 0; this.iceVelocity.set(0, 0, 0);
    this.sqV -= 6;
    this.emit('fall');
  }

  /** Shock stun (Wobble.js): the upper state over a knockdown, a slow shuffle for its seconds. False while already stunned. */
  stun() { return shockStun(this); }

  /** Thrown upward by a blast; a grounded player leaves the roof it stood on (horizontal shove comes from pushPlayer). */
  blastUp(speed) {
    speed *= K; // a blast throws a smaller body to the same relative height
    if (this.state === 'ground') {
      const T = this.ground.truck;
      this.state = 'air'; this.takeoff = T; this.ground = null;
      this.vel.set(T.vel.x, 0, T.vel.z); this.airBase.set(T.vel.x, T.vel.z);
    }
    if (this.state !== 'air') return;
    if (this.wall) this.releaseWall(0, WALL_DROP_LOCK);
    this.vel.y = Math.max(this.vel.y, speed);
    this.coyote = this.jumpBuf = this.dashRemaining = this.jumpBoost = 0;
    this.sqV += 5;
  }

  /** The roof velocity a player keeps when leaving `T`: all of it, except a departing truck's, capped at
   * DEPARTURE.carrySpeed so jumping off a truck that is driving away does not fling the player down the road. */
  carried(T) {
    const v = this._carried || (this._carried = { x: 0, z: 0 });
    v.x = T.vel.x; v.z = T.vel.z;
    if (T.departing) {
      const speed = Math.hypot(v.x, v.z);
      if (speed > DEPARTURE.carrySpeed) { const k = DEPARTURE.carrySpeed / speed; v.x *= k; v.z *= k; }
    }
    return v;
  }

  jump(T, move) {
    this.state = 'air';
    const boosted = this.dashRemaining > 0;
    const direction = boosted ? this.dashDirection : move;
    const speed = boosted ? DASH_SPEED : SPEED * this.speedScale;
    const carry = this.carried(T);
    this.vel.set(carry.x + direction.x * speed, JUMP * (this.jumpScale || 1), carry.z + direction.z * speed);
    this.jumpBoost = boosted ? 0.3 : 0;
    this.dashRemaining = 0;
    this.airBase.set(carry.x, carry.z);
    this.takeoff = T;
    this.ground = null;
    this.jumpBuf = 0;
    this.coyote = 0;
    this.sqV += 4;
    this.emit('jump', { truck: T });
  }

  slip() {
    if (this.slipCooldown > 0 || !['ground', 'air'].includes(this.state)) return false;
    this.dashDirection.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.dashRemaining = this.slipRemaining = DASH_SECONDS;
    this.dashCooldown = DASH_COOLDOWN; this.slipCooldown = C.soapSlipCooldown;
    if (this.state === 'air') { this.vel.x = this.airBase.x + this.dashDirection.x * DASH_SPEED; this.vel.z = this.airBase.y + this.dashDirection.z * DASH_SPEED; this.jumpBoost = 0.3; }
    this.throwCancelled = !!this.throwWasDown;
    if (this.heldTool) this.heldTool.charge = 0;
    this.emit('dash'); return true;
  }

  /** Squirrel: grab the closest face within reach while airborne. A spent grip waits for the next landing. */
  tryCling(trucks, stunned) {
    if (this.animal !== 'squirrel' || stunned || this.wallLock > 0 || this.wallTime >= C.squirrelGripSeconds || this.vel.y > 3) return false;
    const wall = findWall(this.pos, trucks);
    if (!wall) return false;
    this.wall = wall;
    // Stuck on like glue: a fall is caught at once, a rise keeps only a little of its push.
    this.vel.y = Math.max(-1.2, Math.min(1.5, this.vel.y * 0.3));
    this.dashRemaining = this.jumpBoost = this.coyote = 0; this.gliding = false;
    this.sqV -= 3;
    this.holdWall(wallBox(wall, trucks), STILL);
    return true;
  }

  /** Glue the feet to the face, riding with its vehicle. `walk` is the sideways scurry velocity. */
  holdWall(box, walk) {
    const truck = this.wall.truck;
    wallPosition(this.wall, box, this.pos);
    this.vel.x = truck.vel.x + walk.x; this.vel.z = truck.vel.z + walk.z;
    this.airBase.set(truck.vel.x, truck.vel.z);
    this.takeoff = truck;
  }

  /** Let go of the face with an outward `push` (m/s); `lock` keeps the paws from grabbing again at once. */
  releaseWall(push = 0, lock = 0.12) {
    const truck = this.wall.truck, n = wallNormal(this.wall, _normal);
    this.wall = null; this.wallLock = lock;
    const carry = this.carried(truck); // a departing truck's face, like its roof, keeps at most DEPARTURE.carrySpeed
    this.vel.x = carry.x + n.x * push; this.vel.z = carry.z + n.z * push;
    this.airBase.set(carry.x, carry.z); this.takeoff = truck; this.coyote = 0;
  }

  /** Space on a wall: kick off upward and away. Steering back toward the face re-grabs it higher up. */
  wallJump() {
    const truck = this.wall.truck, n = wallNormal(this.wall, _normal);
    this.wall = null; this.wallLock = WALL_JUMP_LOCK;
    const carry = this.carried(truck);
    this.vel.set(carry.x + n.x * C.squirrelWallJumpOut, C.squirrelWallJumpUp, carry.z + n.z * C.squirrelWallJumpOut);
    this.airBase.set(carry.x, carry.z); this.takeoff = truck;
    this.jumpBuf = this.coyote = this.jumpBoost = 0;
    this.sqV += 4;
    this.emit('jump', { truck, wall: true });
  }

  /** One clinging tick. Returns false when the squirrel let go and should fly freely this tick. */
  updateWall(dt, move, trucks, stunned, climb = 0) {
    if (this.wall.ladder >= 0) return updateLadder(this, dt, trucks, stunned, climb);
    const box = wallBox(this.wall, trucks), n = wallNormal(this.wall, _normal);
    const knocked = this.externalVelocity.x * n.x + this.externalVelocity.z * n.z > WALL_KNOCK;
    if (!box || stunned || knocked) { this.releaseWall(0, knocked ? WALL_DROP_LOCK : 0.12); return false; }
    this.wallTime += dt;
    // The paws give out: no grabbing again until the next landing.
    if (this.wallTime >= C.squirrelGripSeconds) { this.releaseWall(0.6, 0); return false; }
    if (this.jumpBuf > 0) { this.wallJump(); return true; }
    if (move.x * n.x + move.z * n.z > 0.55) { this.releaseWall(2.5, WALL_DROP_LOCK); return true; }
    // Scurry sideways along the face; past its end the squirrel drops off the corner.
    const walk = _wallPos.set(n.x ? 0 : move.x, 0, n.z ? 0 : move.z).multiplyScalar(C.squirrelWallWalk);
    const [from, to] = faceRange(box, this.wall.axis);
    this.wall.along += (this.wall.axis === 'z' ? walk.x : walk.z) * dt;
    if (this.wall.along < from || this.wall.along > to) { this.releaseWall(0.4); return false; }
    // Slide: slow at first, faster the longer it clings.
    this.vel.y = damp(this.vel.y, -slideSpeed(this.wallTime), 10, dt);
    this.wall.y += this.vel.y * dt;
    if (box.solid && this.wall.y <= box.y0) {
      // A roof prop: slid down onto the roof it stands on.
      const truck = this.wall.truck;
      this.wall.y = box.y0; this.holdWall(box, walk);
      const plat = truck.platformAt(this.pos.x, this.pos.z, TOL);
      if (plat) { this.wall = null; this.landOn(truck, plat); return true; }
    }
    if (this.wall.y < box.y0 - WALL_HANG) { this.releaseWall(0.3, 0); return false; }
    this.wall.y = Math.min(this.wall.y, box.y1 - 0.1);
    this.holdWall(box, walk);
    return true;
  }

  /** Whether the body edge at (x, z) touches a platform more than a step above local level `level`. */
  tallerNear(T, x, z, level) {
    for (const [ox, oz] of EDGE_PROBES) {
      const plat = T.platformAt(x + ox, z + oz, 0);
      if (plat && T.platformTop(plat) > level + STEP_UP) return true;
    }
    return false;
  }

  /** Every platform of `T` whose top is above world height `above` is a solid box from the side: push the body (radius
   * SOLID_RADIUS) out through its nearest face and drop the motion into it, keeping the slide along the face. */
  pushOutOfLevels(T, above) {
    for (const plat of T.platforms) {
      if (T.platTopY(plat) <= above) continue;
      const lx = this.pos.x - T.pos.x, lz = this.pos.z - T.pos.z, r = SOLID_RADIUS;
      if (lx <= plat.x0 - r || lx >= plat.x1 + r || lz <= plat.z0 - r || lz >= plat.z1 + r) continue;
      const exits = [[lx - (plat.x0 - r), -1, 0], [(plat.x1 + r) - lx, 1, 0], [lz - (plat.z0 - r), 0, -1], [(plat.z1 + r) - lz, 0, 1]];
      const [depth, nx, nz] = exits.reduce((a, b) => b[0] < a[0] ? b : a);
      this.pos.x += nx * depth; this.pos.z += nz * depth;
      const closing = Math.min(0, (this.vel.x - T.vel.x) * nx + (this.vel.z - T.vel.z) * nz);
      this.vel.x -= closing * nx; this.vel.z -= closing * nz;
      if (nx) this.airBase.x = T.vel.x; else this.airBase.y = T.vel.z;
    }
  }

  /** Step off the roof, a prop top or a head: airborne with the carried velocity and a short coyote window. */
  walkOff(T, direction, speed) {
    this.state = 'air';
    const carry = this.carried(T);
    this.vel.set(carry.x + direction.x * speed, this.shovePop(), carry.z + direction.z * speed);
    this.airBase.set(carry.x, carry.z);
    this.takeoff = T;
    this.ground = null;
    this.coyote = 0.1;
  }

  /** Head stomp (Stomp.js): a normal landing on `base`'s head springs this player up again with its own jump. */
  bounceOffHead(base) {
    this.pos.y = base.pos.y + PLAYER_BODY.height;
    this.vel.y = JUMP * (this.jumpScale || 1);
    this.takeoff = base.ground?.truck || base.takeoff || this.takeoff;
    this.jumpBuf = this.coyote = 0; refillAir(this);
    this.stompSerial = (this.stompSerial || 0) + 1; this.sqV += 4;
    this.emit('jump', { truck: this.takeoff, stomp: true });
  }

  /** Land on player `base` (slot `slot`): ride its head at `offset` (xz). Placement each tick is resolvePlayerContacts'. */
  landOnHead(slot, base, offsetX, offsetZ) {
    const truck = base.ground?.truck || base.takeoff || this.takeoff;
    if (!truck) return false;
    const impact = -this.vel.y;
    this.pos.set(base.pos.x + offsetX, base.pos.y + PLAYER_BODY.height, base.pos.z + offsetZ);
    this.state = 'ground';
    this.ground = { truck, plat: base.ground?.plat || truck.platforms[0], solid: -1, stand: slot, offset: { x: offsetX, z: offsetZ } };
    this.vel.set(0, 0, 0);
    this.jumpBoost = 0; refillAir(this); this.wallTime = 0;
    this.sqV -= Math.min(6, impact * 0.35);
    this.emit('land', { truck, plat: this.ground.plat, from: this.takeoff, impact });
    return true;
  }

  /** Touch down on a roof (or on top of roof prop `solid`, an index into truck.solids): shared by falling and sliding off a prop. */
  landOn(T, plat, solid = -1) {
    const impact = -this.vel.y;
    this.pos.y = solid >= 0 ? solidTopY(T, T.solids[solid]) : T.platTopY(plat);
    this.state = 'ground';
    this.ground = { truck: T, plat, solid };
    this.vel.set(0, 0, 0);
    this.jumpBoost = 0; refillAir(this); this.wallTime = 0;
    this.sqV -= Math.min(6, impact * 0.35);
    this.emit('land', { truck: T, plat, from: this.takeoff, impact });
  }

  /** A swallowed player rides in its pelican's pouch and cannot act until spat out. */
  followPouch() {
    const owner = this.swallowedBy, c = Math.cos(owner.yaw), s = Math.sin(owner.yaw);
    this.pos.set(owner.pos.x + c * POUCH_X, owner.pos.y + POUCH_Y, owner.pos.z - s * POUCH_X);
    this.vel.copy(owner.vel); this.yaw = owner.yaw;
  }

  update(dt, t, input, trucks, camera, baseSpeed, { allowRespawn = true } = {}) {
    this.gliding = false;
    if (this.state !== 'air') this.wall = null;
    if (this.state === 'ground') this.wallTime = 0;
    this.wallLock = Math.max(0, this.wallLock - dt);
    if (this.swallowedBy) {
      this.wall = null;
      this.externalVelocity.set(0, 0, 0);
      this.dashRemaining = this.jumpBoost = this.jumpBuf = this.coyote = this.slipRemaining = this.catchRemaining = 0;
      this.followPouch(); this.animate(dt, t, STILL);
      return;
    }
    this.slipRemaining = Math.max(0, (this.slipRemaining || 0) - dt);
    this.slipCooldown = Math.max(0, (this.slipCooldown || 0) - dt);
    if (this.slipperyRemaining > 0) {
      this.slipperyRemaining = Math.max(0, this.slipperyRemaining - dt);
      if (this.slipperyRemaining < 1e-9) { this.slipperyRemaining = 0; this.slipperyImmunity = SLIPPERY.immunity; }
    } else this.slipperyImmunity = Math.max(0, (this.slipperyImmunity || 0) - dt);
    tickWobble(this, dt);
    const stunned = incapacitated(this);
    this.catchRemaining = input.hit('KeyJ') && !stunned ? C.catchSeconds : Math.max(0, (this.catchRemaining || 0) - dt);
    if (this.state === 'air' || (this.state === 'ground' && !(this.ground?.stand >= 0))) this.pos.addScaledVector(this.externalVelocity, dt);
    this.externalVelocity.multiplyScalar(Math.exp(-(this.state === 'air' ? AIR_SHOVE_DRAG : GROUND_SHOVE_DRAG) * dt));
    // 相对镜头的移动方向
    const ax = input.axis();
    const fwd = camera.getWorldDirection(this._fwd);
    fwd.y = 0; fwd.normalize();
    const move = (this._move ||= new THREE.Vector3()).set(-fwd.z * ax.x - fwd.x * ax.y, 0, fwd.x * ax.x - fwd.z * ax.y);
    if (input.worldAxis) { const world = input.worldAxis(); move.set(world.x, 0, world.z); }
    if (move.lengthSq() > 1) move.normalize();
    if (this.slipRemaining > 0) move.copy(this.dashDirection);
    // Knocked down: no control at all. Shock-stunned: a slow shuffle in the chosen direction. Neither jumps.
    if (this.downRemaining > 0) move.set(0, 0, 0);
    else if (this.stunRemaining > 0) move.multiplyScalar(CHARGING.stunSpeed);

    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.dashRemaining = Math.max(0, this.dashRemaining - dt);
    // Manual dash is dormant. Soap slips and ability-driven impulses still use the shared dash state.

    if (input.hit('Space') && !stunned) this.jumpBuf = 0.14;
    else this.jumpBuf = Math.max(0, this.jumpBuf - dt);

    if (this.state === 'ground') {
      const T = this.ground.truck;
      let direction = this.dashRemaining > 0 ? this.dashDirection : move;
      let speed = this.dashRemaining > 0 ? DASH_SPEED : SPEED * this.speedScale;
      if (this.slipperyRemaining > 0) {
        // On ice: velocity eases toward the input instead of snapping to it, and coasts when the input stops.
        const ice = this.iceVelocity, tx = direction.x * speed, tz = direction.z * speed;
        let dx = tx - ice.x, dz = tz - ice.z;
        const pushing = tx * tx + tz * tz > 1e-6, rate = (pushing ? SLIPPERY.acceleration : SLIPPERY.friction) * dt;
        const gap = Math.hypot(dx, dz);
        if (gap > rate) { dx *= rate / gap; dz *= rate / gap; }
        ice.x += dx; ice.z += dz;
        const iceSpeed = Math.hypot(ice.x, ice.z);
        direction = iceSpeed > 1e-6 ? this._iceDirection.set(ice.x / iceSpeed, 0, ice.z / iceSpeed) : STILL;
        speed = iceSpeed;
      } else if (this.iceVelocity) this.iceVelocity.set(direction.x * speed, 0, direction.z * speed); // Enters ice at the current walk.
      // Jump before integrating movement so a dash-jump cannot walk off first.
      if (this.jumpBuf > 0) this.jump(T, move);
      else if (this.ground.stand >= 0) {
        // On a head: walking (and shoves) only move the offset; resolvePlayerContacts places the body on its base.
        const offset = this.ground.offset;
        const dx = (direction.x * speed + this.externalVelocity.x) * dt, dz = (direction.z * speed + this.externalVelocity.z) * dt;
        // The body moves with its offset too, so a step past the edge starts the fall from where it left the head.
        offset.x += dx; offset.z += dz; this.pos.x += dx; this.pos.z += dz;
        if (Math.hypot(offset.x, offset.z) > STAND.headRadius) this.walkOff(T, direction, speed);
      } else {
        // The standing level changes only by walking, landing or falling. A platform underfoot replaces the recorded one
        // only at the body's own height (a stale record after a teleport or a correction); a lower level underfoot — say
        // after a shove carried the body past the box roof's edge — is reached by falling (walkOff below), never by
        // snapping down to it.
        const under = T.platformAt(this.pos.x, this.pos.z, TOL);
        if (under && Math.abs(T.platTopY(under) - this.pos.y) < 0.05) this.ground.plat = under;
        const carriedX = this.pos.x + T.vel.x * dt, carriedZ = this.pos.z + T.vel.z * dt;
        this.pos.x = carriedX + direction.x * speed * dt;
        this.pos.z = carriedZ + direction.z * speed * dt;
        const solid = this.ground.solid >= 0 && T.solids?.[this.ground.solid]?.active ? this.ground.solid : -1;
        const fromTop = T.platformTop(this.ground.plat);
        let climbing = false;
        if (solid < 0 && this.tallerNear(T, this.pos.x, this.pos.z, fromTop)) {
          // The body's edge meets a taller level's face: grab its ladder if this is one, else the face pushes it out
          // (a solid side, like the wash station) so it slides along instead of sinking half into it.
          const ladder = ladderAt(this, T, fromTop, fromTop + 2 * STEP_UP, true);
          if (ladder >= 0) { this.pos.x = carriedX; this.pos.z = carriedZ; climbing = grabLadder(this, T, ladder, fromTop); }
          else this.pushOutOfLevels(T, T.platTopY(this.ground.plat) + STEP_UP);
        }
        const plat = climbing ? null : T.platformAt(this.pos.x, this.pos.z, TOL), toTop = T.platformTop(plat);
        // Off the roof, off the top of the prop it stood on, or off a ledge onto a lower level: falls (and lands below).
        const down = !climbing && solid < 0 && plat && toTop < fromTop - STEP_UP ? ladderAt(this, T, toTop, fromTop) : -1;
        if (climbing) { /* on the ladder now */ }
        else if (down >= 0) { this.pos.x = carriedX; this.pos.z = carriedZ; grabLadder(this, T, down, fromTop); }
        else if (!plat || (this.ground.solid >= 0 && solidUnder(T, this.pos.x, this.pos.z) !== solid) || (solid < 0 && toTop < fromTop - 0.05)) {
          this.walkOff(T, direction, speed);
        } else if (solid < 0 && toTop > fromTop + STEP_UP) {
          this.pos.x = carriedX; this.pos.z = carriedZ; // (the edge probes normally stop the body before this)
        } else {
          this.pos.y = solid >= 0 ? solidTopY(T, T.solids[solid]) : T.platTopY(plat);
          this.ground.plat = plat;
        }
      }
    } else if (this.state === 'air' && this.wall && this.updateWall(dt, move, trucks, stunned, -(input.axis?.().y || 0))) {
      // Clinging to a face (or just kicked off it): no free flight this tick.
    } else if (this.state === 'air') {
      if (this.coyote > 0 && this.jumpBuf > 0 && this.takeoff) this.jump(this.takeoff, move);
      else if (this.animal === 'goose') flap(this, input, stunned);
      this.coyote = Math.max(0, this.coyote - dt);
      this.airBase.x -= WIND_DRIFT * dt;
      const boost = this.jumpBoost / 0.3, steer = SPEED * this.speedScale;
      this.vel.x = damp(this.vel.x, this.airBase.x + move.x * steer + this.dashDirection.x * (DASH_SPEED - steer) * boost, 6, dt);
      this.vel.z = damp(this.vel.z, this.airBase.y + move.z * steer + this.dashDirection.z * (DASH_SPEED - steer) * boost, 6, dt);
      this.jumpBoost = Math.max(0, this.jumpBoost - dt);
      this.vel.y -= G * dt;
      glide(this, input, stunned, dt);
      const prevY = this.pos.y, prevX = this.pos.x, prevZ = this.pos.z;
      this.pos.addScaledVector(this.vel, dt);

      for (const T of trucks) {
        const lx = this.pos.x - T.pos.x, lz = this.pos.z - T.pos.z;
        // The level under this point along the hull's centre line (a low deck has a low hull side).
        const top = T.topYAt(this.pos.x, T.pos.z, TOL);
        // A taller level's face pushes the body's edge out from the side (a body already above its top lands instead).
        if (this.pos.y > T.pos.y - 0.5) this.pushOutOfLevels(T, Math.max(prevY, this.pos.y) + 0.05);
        // 车身侧面碰撞：推出去（悬浮车底下是空的）
        const side = T.halfWidth + 0.4;
        if (prevY < top - 0.15 && this.pos.y > T.pos.y - 0.5 && lx > T.spec.x0 + 0.2 && lx < T.spec.x1 - 0.2 && Math.abs(lz) < side) {
          this.pos.z = T.pos.z + Math.sign(lz || 1) * side;
          this.vel.z = T.vel.z;
          this.airBase.y = T.vel.z;
        }
        // Landing on a roof prop's top comes first: it sits above the roof.
        if (this.vel.y <= 0 && T.solids) {
          const solid = solidUnder(T, this.pos.x, this.pos.z);
          const propTop = solid >= 0 ? solidTopY(T, T.solids[solid]) : 0;
          if (solid >= 0 && this.pos.y <= propTop && prevY >= propTop - STAND.landWindow) {
            this.landOn(T, T.platformAt(this.pos.x, this.pos.z, TOL) || T.platforms[0], solid); break;
          }
        }
        // 着陆: on the level under the feet.
        const landing = T.platformAt(this.pos.x, this.pos.z, TOL), landTop = landing ? T.platTopY(landing) : 0;
        // Falling onto it from above lands; a jump that tops out just under a taller level does not mantle onto it
        // (a 2 m box face is climbed by its ladder), so the catch window only helps bodies already coming down past it.
        const window = this.vel.y < -2 ? 0.3 : 0.05;
        if (landing && this.vel.y <= 0 && this.pos.y <= landTop && prevY >= landTop - window) { this.landOn(T, landing); break; }
      }
      if (this.state === 'air') this.tryCling(trucks, stunned);
      if (this.state === 'air' && !this.wall && this.pos.y <= 0) {
        this.pos.y = 0;
        this.fallOut();
      }
    } else if (this.state === 'fallen') {
      // 掉在路面上，被“跑步机”往后带走
      if (this.deathCause === 'road-sign') {
        if (this.roadSignAttachment) this.pos.x -= ROAD_SIGN.speed * dt;
      } else {
        this.pos.x -= baseSpeed * 0.55 * dt;
        this.lean.rotation.z += dt * 14;
      }
      this.fallTimer = Math.max(0, this.fallTimer - dt);
      if (this.fallTimer < 1e-9 && allowRespawn) {
        this.spawn(trucks[0]);
        this.emit('respawn');
      }
    }

    if ((this.state === 'ground' || this.state === 'air') && !this.wall) this.resolveSolids(trucks);
    this.animate(dt, t, move);
  }

  /** Push the body out of solid roof props (truck.solids: truck-local boxes) and drop motion into them.
   * Runs inside update, so the host and guest prediction resolve it identically. A jump above the prop passes over. */
  resolveSolids(trucks) {
    for (const truck of trucks) {
      if (!truck.solids) continue;
      for (const solid of truck.solids) {
        if (!solid.active || this.pos.y >= solidTopY(truck, solid) - 0.01) continue;
        const lx = this.pos.x - truck.pos.x - solid.x, lz = this.pos.z - truck.pos.z - solid.z;
        if (Math.abs(lx) >= solid.hx + SOLID_RADIUS || Math.abs(lz) >= solid.hz + SOLID_RADIUS) continue;
        const cx = Math.max(-solid.hx, Math.min(solid.hx, lx)), cz = Math.max(-solid.hz, Math.min(solid.hz, lz));
        let nx = lx - cx, nz = lz - cz, distance = Math.hypot(nx, nz), push;
        if (distance >= SOLID_RADIUS) continue;
        if (distance > 1e-8) { nx /= distance; nz /= distance; push = SOLID_RADIUS - distance; }
        else {
          // Centre inside the box: leave by the nearest face.
          const ex = solid.hx - Math.abs(lx), ez = solid.hz - Math.abs(lz);
          if (ex < ez) { nx = Math.sign(lx) || 1; nz = 0; push = ex + SOLID_RADIUS; } else { nx = 0; nz = Math.sign(lz) || 1; push = ez + SOLID_RADIUS; }
        }
        _solidPos.copy(this.pos); _solidPos.x += nx * push; _solidPos.z += nz * push;
        // Remove only the closing part of the motion relative to the truck; sliding along the face is kept.
        const closing = Math.min(0, (this.vel.x - truck.vel.x) * nx + (this.vel.z - truck.vel.z) * nz);
        _solidDelta.set(-closing * nx, 0, -closing * nz); _solidVel.copy(this.vel).add(_solidDelta);
        this.applyBodyContact(_solidPos, _solidDelta, _solidVel);
      }
    }
  }

  /** Upward speed when a shove carries the body over an edge: a small hop so the fall starts as an arc. */
  shovePop() {
    const shove = Math.hypot(this.externalVelocity.x, this.externalVelocity.z);
    return shove > 0.5 ? Math.min(SHOVE_POP_MAX, SHOVE_POP * shove) : 0;
  }

  /** A shared body contact can move a standing player off the roof in this tick, just like walking off its edge. */
  applyBodyContact(position, deltaVelocity, velocity) {
    this.pos.copy(position);
    if (this.state === 'air') this.vel.add(deltaVelocity);
    else if (this.state === 'ground') {
      const truck = this.ground.truck, plat = truck.platformAt(this.pos.x, this.pos.z, TOL), top = plat ? truck.platTopY(plat) : -Infinity;
      // Same level: keep standing. A taller level's side: stay on the current one (its face stops the body next tick).
      // Off the roof or over a ledge onto a lower level: fall, never snap down.
      if (plat && Math.abs(top - this.pos.y) < 0.05) this.ground.plat = plat;
      else if (plat && top > this.pos.y) { /* the edge probes push the body back out */ }
      else {
        this.state = 'air'; this.takeoff = truck; this.ground = null; this.coyote = 0.1;
        this.airBase.set(truck.vel.x, truck.vel.z);
        // External shoves are integrated separately next tick; do not count them twice in the carried velocity.
        this.vel.copy(velocity).sub(this.externalVelocity).setY(this.shovePop());
      }
    }
    this.root.position.copy(this.pos);
  }

  animate(dt, t, move) {
    const moving = move.lengthSq() > 0.01;
    // Clinging squirrels face the wall; everyone else faces where they go.
    if (this.wall && this.state === 'air') { const n = wallNormal(this.wall, _normal); this.yaw = dampAngle(this.yaw, Math.atan2(n.z, -n.x), 16, dt); }
    else if (moving) this.yaw = dampAngle(this.yaw, Math.atan2(-move.z, move.x), 12, dt);
    this.yawG.rotation.y = this.yaw;

    // 弹簧形变（挤压与拉伸）
    this.sqV += (-140 * this.sq - 11 * this.sqV) * dt;
    this.sq += this.sqV * dt;
    const air = this.state === 'air' ? Math.max(-0.12, Math.min(0.15, this.vel.y * 0.012)) : 0;
    const s = Math.max(-0.45, Math.min(0.45, this.sq * 0.12 + air));
    this.squash.scale.set(1 - s * 0.5, 1 + s, 1 - s * 0.5);

    // 走路时小碎步蹦跶
    if (this.state === 'ground' && moving) this.walk += dt * 15;
    else this.walk = damp(this.walk, Math.round(this.walk / Math.PI) * Math.PI, 10, dt);
    this.squash.position.y = Math.abs(Math.sin(this.walk)) * 0.09;

    // 迎风后仰 + 颤动
    if (this.state !== 'fallen') {
      const lean = 0.07 + Math.sin(t * 21) * 0.015 + Math.sin(t * 33) * 0.01;
      this.lean.rotation.z = damp(this.lean.rotation.z, lean, 8, dt);
      this.lean.rotation.x = Math.sin(t * 17) * 0.012;
    }

    this.root.position.copy(this.pos);
  }
}
