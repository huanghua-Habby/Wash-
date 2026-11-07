/** Client player: plush cat, dog, pelican, elephant, squirrel, Canadian goose or kangaroo visuals over the shared motion rules in shared/sim. */
import * as THREE from 'three';
import { PlayerMotion } from '../../../shared/sim/PlayerMotion.js';
import { WASH_CONFIG as C } from '../../../shared/sim/washConfig.js';
import { CatModel, COATS } from './cat/CatModel.js';
import { CatAnimator } from './cat/CatAnimator.js';
import { DogModel } from './dog/DogModel.js';
import { PelicanModel, PELICAN_COATS } from './pelican/PelicanModel.js';
import { ElephantModel } from './elephant/ElephantModel.js';
import { SquirrelModel } from './squirrel/SquirrelModel.js';
import { GooseModel } from './goose/GooseModel.js';
import { KangarooModel } from './kangaroo/KangarooModel.js';
import { wallNormal, slideSpeed, WALL_GAP } from '../../../shared/sim/WallCling.js';
import { playerColor } from '../core/playerColors.js';
import { AVATAR_COLORS, defaultAvatar, cleanAvatar, animalInfo } from '../../../shared/avatar.js';
import { identityRings } from '../render/IdentityRings.js';
import { TeamHat } from './TeamHat.js';
import { CFG } from '../core/config.js';
import { CHARACTER_SCALE } from '../../../shared/sim/characterScale.js';

// One look per room slot; the collar matches the slot's name-tag color.
const COAT_ORDER = [COATS.ginger, COATS.grey, COATS.cream, COATS.tuxedo];

const _tailSlap = new THREE.Vector3();
const _raw = new THREE.Vector3(), _force = new THREE.Vector3(), _ctxPush = new THREE.Vector3(), _prev = new THREE.Vector3();
// Swallowed players are sucked into the beak (shrinking and spinning) and pop back out with an overshoot.
const SUCK_SECONDS = 0.28, POP_SECONDS = 0.38;
// Squirrel cling presentation: slide speed that reads as "full panic", and friction haze puffs per second at rest/at full slide.
const SLIDE_FULL = slideSpeed(C.squirrelGripSeconds * 0.8), HAZE_RATE = [4, 26];

// Ground-hit presentation (client only; the shared rules still own the fallen state and respawn).
// Decaying bounces settle before the authoritative respawn countdown ends.
const FALL_G = 30, FALL_BOUNCES = [0.75, 0.3, 0.11];
const FALL_HOPS = FALL_BOUNCES.map((h) => 2 * Math.sqrt(2 * h / FALL_G));
/** Height above the road and index of the bounce at time t since the first impact. */
export function fallBounce(t) {
  for (let i = 0; i < FALL_HOPS.length; i++) {
    if (t < FALL_HOPS[i]) { const v = Math.sqrt(2 * FALL_BOUNCES[i] * FALL_G); return { height: v * t - FALL_G * t * t / 2, hop: i }; }
    t -= FALL_HOPS[i];
  }
  return { height: 0, hop: FALL_HOPS.length };
}

export class Player extends PlayerMotion {
  constructor(scene, { color, slot = 0 } = {}) {
    super(scene, { color });
    this.slot = slot; this.appearance = defaultAvatar(slot);
    this.identityColor = playerColor(slot);
    this.cat = new CatModel({ coat: COAT_ORDER[slot % COAT_ORDER.length], accent: this.identityColor });
    // Every animal is built and prepared at boot; switching only toggles visibility (no new meshes or shaders).
    const furUniforms = this.cat.furBase.userData.fur;
    this.dog = new DogModel({ accent: this.identityColor, furUniforms });
    this.pelican = new PelicanModel({ accent: this.identityColor, furUniforms });
    this.elephant = new ElephantModel({ accent: this.identityColor, furUniforms });
    this.squirrel = new SquirrelModel({ accent: this.identityColor, furUniforms });
    this.goose = new GooseModel({ accent: this.identityColor, furUniforms });
    this.kangaroo = new KangarooModel({ accent: this.identityColor, furUniforms });
    this.bodies = { cat: this.cat, dog: this.dog, pelican: this.pelican, elephant: this.elephant, squirrel: this.squirrel, goose: this.goose, kangaroo: this.kangaroo };
    this.animators = Object.fromEntries(Object.entries(this.bodies).map(([animal, body]) => [animal, new CatAnimator(body, slot * 0.37)]));
    this.body = this.cat; this.animator = this.animators.cat;
    this.appearanceReady = Promise.all(Object.values(this.bodies).map(body => body.appearanceReady));
    // Characters draw at CHARACTER_SCALE (shared) through their own node, so a model may still size its group per
    // species or breed (squirrel body, kangaroo breeds) without undoing it; the squash group stays at unit scale.
    this.characterScale = new THREE.Group(); this.characterScale.name = 'character-scale';
    this.characterScale.scale.setScalar(CHARACTER_SCALE); this.squash.add(this.characterScale);
    for (const body of Object.values(this.bodies)) { body.group.visible = body === this.cat; this.characterScale.add(body.group); }
    this.footRing = identityRings(scene).create(this.identityColor);
    this.footRing.name = `player-${slot + 1}-identity-ring`;
    this.footRing.node.scale.setScalar(CHARACTER_SCALE); // the foot ring hugs the smaller body too
    this.root.add(this.footRing.node);
    // Versus team look (CFG.team tunes it): hat on the current body's head and a team foot ring; co-op shows neither.
    // Built and parented at boot, so startup preparation compiles it while hidden.
    this.hat = new TeamHat(); this.hat.group.visible = false; this.hat.attach(this.body);
    this.teamLook = ''; // `team` itself is PlayerMotion's authoritative versus team (0 red, 1 blue, null).
    // CatModel owns its pass layers: the merged proxy covers the mask while
    // the original body, details and active fur shells stay in layer 0.
    /**
     * Dust FX hook for jumps, landings and road hits. `onRoad` dust is left behind by the moving road.
     * @type {((position: THREE.Vector3, strength: number, onRoad: boolean) => void) | null}
     */
    this.onDust = null;
    /**
     * Sound hook for the same one-shot reactions (jump, land, fall, bounce, pickup, drop, throw, dash, slip).
     * @type {((event: string, strength?: number) => void) | null}
     */
    this.onSound = null;
    /**
     * Pelican gulp/spit particle hook: { type: 'gulp' | 'spit', mouth, forward, carry, feather }.
     * @type {((parameters: object) => void) | null}
     */
    this.onPouchFx = null;
    /**
     * Squirrel wall-cling particle hook: { type: 'grab' | 'kick' | 'slide' | 'slip', contact, normal, carry, strength }.
     * @type {((parameters: object) => void) | null}
     */
    this.onWallFx = null;
    this.visual = {
      clock: 0, lastPos: null, vel: new THREE.Vector3(), accel: new THREE.Vector3(), prevLocal: new THREE.Vector3(),
      lastYaw: 0, yawRate: 0, lastState: this.state, airVy: 0, held: null, charge: 0, lastDash: 0, lastStep: 0, pouch: null, suck: 0, pop: 0, suckFrom: new THREE.Vector3(),
      trunk: false, // elephant jet open last frame
      wall: null, wallNormal: { x: 0, z: 0 }, wallTruck: null, haze: 0, // squirrel cling seen last frame, its face normal and vehicle, haze accumulator
      stun: 0, // shared stun countdown seen last frame
      fall: null, // ground-hit presentation: { t, hop, spin, angle, dir, squash }
      pulse: 0, pulseV: 0, // visual-only squash/stretch spring for jump and landing feedback
      toolBase: new THREE.Vector3(), toolApplied: null, offsetTool: null,
      ctx: { dt: 0, t: 0, state: 'ground', speed: 0, vy: 0, accel: new THREE.Vector3(), yawRate: 0, dash: false, slip: false, shock: false, held: null, use: '', charge: 0, push: _ctxPush },
    };
  }

  setAppearance(value) {
    const appearance = cleanAvatar(value, this.slot);
    if (JSON.stringify(appearance) === JSON.stringify(this.appearance)) return;
    this.appearance = appearance; this.identityColor = AVATAR_COLORS[appearance.color];
    // Presentation of the roster's animal passive (respawn ring); the host applies the same animal to its authority.
    this.setAnimal(appearance.animal);
    this.applyBody();
    this.footRing.material.color.set(this.identityColor);
    this.teamLook = ''; this.applyTeamLook();
  }

  /** The shared rules changed the animal in play (roster or a tutorial's lent body): show that body. */
  applyAnimal() { super.applyAnimal(); if (this.bodies) this.applyBody(); }

  /** Show the body of the animal in play. A lent animal wears its first breed in this player's color. Prepared at boot,
   * so a swap only toggles visibility. */
  applyBody() {
    const animal = this.animal, own = animal === this.appearance.animal;
    const breed = own ? this.appearance.breed : animalInfo(animal)?.breeds[0].id;
    const key = `${animal}|${breed}|${this.identityColor}`;
    if (key === this.bodyKey) return;
    this.bodyKey = key;
    const body = this.bodies[animal] || this.cat;
    if (body !== this.body) {
      this.body.group.visible = false; body.group.visible = true;
      this.body = body; this.animator = this.animators[animal] || this.animators.cat;
      this.hat.attach(body);
    }
    body.setAppearance(breed, this.identityColor);
  }

  /** Team look from the roster's versus team (NetworkGame sets `team`). Presentation only. Two styles under comparison
   * (CFG.team.style): 'plate' (HouJianNan, default) tints the plain foot ring with the team color and leaves the hat
   * off (PlayerNames colors the name plate); 'hat' (Mayulong) draws the team ring and team hat. */
  applyTeamLook() {
    const T = CFG.team, team = this.team === 0 ? 'red' : this.team === 1 ? 'blue' : null, color = team ? T[team] : '';
    const hatStyle = T.style === 'hat';
    const look = team ? `${team}|${color}|${T.style}|${T.hats}|${T.rings}` : '';
    if (look === this.teamLook) return;
    this.teamLook = look;
    this.hat.group.visible = !!team && hatStyle && !!T.hats;
    if (this.hat.group.visible) this.hat.setTeam(team, color);
    const ring = !!team && hatStyle && T.rings;
    this.footRing.material.color.set(team && (!hatStyle || T.rings) ? color : this.identityColor);
    this.footRing.material.style = ring ? 1 : 0;
  }

  /** The drawn trunk tip of a visible elephant; TrunkSpray emits its particles from here. */
  get trunkTip() { return this.body === this.elephant ? this.elephant.trunkTip : null; }

  /** Once per rendered frame, after prediction/interpolation has placed root.position. */
  updateVisual(dt) {
    // A swallowed player is out of sight inside the pelican's pouch.
    const swallowed = this.state === 'swallowed';
    this.applyTeamLook();
    this.squash.visible = !swallowed || this.visual.suck > 0;
    // A clinging squirrel hangs on a wall: no ground under its feet for the ring.
    this.footRing.visible = this.occupied !== false && this.state !== 'fallen' && !swallowed && !(this.state === 'air' && this.wall);
    this.footRing.material.opacity = this.state === 'air' ? 0.34 : 0.55;
    if (!this.root.visible) return;
    const v = this.visual, ctx = v.ctx, pos = this.root.position;
    v.clock += dt;
    if (!v.lastPos || dt <= 0) { v.lastPos = pos.clone(); if (dt <= 0) return; }
    _prev.copy(v.lastPos);
    _raw.copy(pos).sub(v.lastPos).divideScalar(dt); v.lastPos.copy(pos);
    if (_raw.lengthSq() > 40 * 40) _raw.set(0, 0, 0); // respawn / snap
    const truck = this.ground?.truck;
    if (truck) { _raw.x -= truck.vel.x; _raw.z -= truck.vel.z; }
    else if (this.state === 'air') { _raw.x -= this.airBase.x; _raw.z -= this.airBase.y; }
    v.vel.lerp(_raw, 1 - Math.exp(-16 * dt));

    // Velocity in the cat's facing frame (x forward, z right).
    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
    const lx = v.vel.x * cos - v.vel.z * sin, lz = v.vel.x * sin + v.vel.z * cos;
    v.accel.lerp(_raw.set((lx - v.prevLocal.x) / dt, 0, (lz - v.prevLocal.z) / dt), 1 - Math.exp(-10 * dt));
    v.prevLocal.set(lx, 0, lz);
    const dYaw = Math.atan2(Math.sin(this.yaw - v.lastYaw), Math.cos(this.yaw - v.lastYaw));
    v.yawRate += (dYaw / dt - v.yawRate) * (1 - Math.exp(-10 * dt)); v.lastYaw = this.yaw;

    // Gameplay transitions become one-shot reactions.
    if (this.state === 'air') v.airVy = v.vel.y;
    if (v.lastState !== this.state) {
      if (this.state === 'fallen' && this.deathCause === 'road-sign') { this.endFall(); this.onSound?.('fall'); }
      else if (this.state === 'fallen') this.beginFall(v.airVy);
      if (v.lastState === 'fallen') { this.endFall(); if (this.state === 'ground' || this.state === 'air') this.onSound?.('respawn'); }
      // Fly from where we stood into the beak; on release, pop out of it.
      if (this.state === 'swallowed') { v.suck = SUCK_SECONDS; v.suckFrom.copy(_prev).sub(pos); v.pop = 0; }
      if (v.lastState === 'swallowed') { v.suck = 0; v.pop = POP_SECONDS; }
      if (this.state === 'ground' && v.lastState === 'air') this.landFeedback(Math.max(0, -v.airVy));
      if (this.state === 'air' && v.lastState === 'ground') {
        if (v.vel.y > 2) this.jumpFeedback();
        // Snapshot-presented cats can leave the ground before the smoothed velocity catches up;
        // the authoritative take-off speed still identifies a jump (walking off an edge has none).
        else if (this.vel.y > 2) this.onSound?.('jump');
      }
      v.lastState = this.state;
    }
    // Each half walk cycle (walk crosses a multiple of π, the bob's low point) is a paw touching down.
    const step = Math.floor(this.walk / Math.PI);
    if (step !== v.lastStep && this.state === 'ground' && Math.hypot(lx, lz) > 1.2) {
      this.onSound?.('step');
      // Heavy feet kick up a little dust on every stomp.
      if (this.body.species.heavy) this.onDust?.(this.root.position, 0.07, false);
    }
    v.lastStep = step;
    // A dash timer that jumps back up is a new dash (or a soap slip, which reuses the dash).
    if (this.dashRemaining > v.lastDash + 0.02) {
      const slip = this.slipRemaining > 0;
      this.onSound?.(slip ? 'slip' : 'dash');
      // Stepping on soap: a startled stretch-and-squash wobble on top of the slip pose (bubbles come from EffectsManager).
      if (slip) v.pulseV += 5.5;
    }
    v.lastDash = this.dashRemaining;
    // A stun countdown that jumps back up is a new shock (host rule or snapshot alike).
    const stun = this.stunRemaining || 0;
    if (stun > v.stun + 0.05) { this.onSound?.('shock'); v.pulseV += 4; }
    v.stun = stun;
    // Slaps from the host-confirmed counters (a lower count is a new world: re-baseline without a reaction).
    // Swings alternate paws; a hit snaps the head away from the side the shove comes from.
    const swings = this.slapSerial || 0, hits = this.slappedSerial || 0;
    if (v.swings !== undefined && swings > v.swings && this.state !== 'fallen') { this.animator.slap?.(swings % 2 ? 1 : -1); v.pulseV += 2.2; }
    if (v.hits !== undefined && hits > v.hits && this.state !== 'fallen') {
      const ex = this.externalVelocity, lateral = ex.x * Math.sin(this.yaw) + ex.z * Math.cos(this.yaw);
      this.animator.slapped?.(lateral < 0 ? -1 : 1); v.pulseV -= 6;
    }
    v.swings = swings; v.hits = hits;
    // Goose mid-air flap (shared `flapSerial`): one big wing beat, a whump and a puff of air under it.
    const flaps = this.flapSerial || 0;
    if (v.flaps !== undefined && flaps > v.flaps && this.state === 'air') {
      this.animator.flap?.(); v.pulseV += 3; this.onSound?.('flap'); this.onDust?.(this.root.position, 0.18, false);
    }
    v.flaps = flaps;
    const held = this.heldTool;
    if (held !== v.held) {
      if (held && !v.held) { this.animator.pickup(); this.onSound?.('pickup'); }
      else if (!held && v.held) {
        if (v.held.flight && v.charge >= C.throwHoldSeconds) {
          const power = (v.charge - C.throwHoldSeconds) / (C.throwChargeSeconds - C.throwHoldSeconds);
          this.animator.thrown(power); this.onSound?.('throw', Math.max(0, Math.min(1, power)));
        } else { this.animator.dropped(); this.onSound?.('drop'); }
      }
      v.held = held;
    }
    v.charge = held?.charge || 0;
    // Pelican pouch transitions: gulp when something goes in, lunge when it comes out.
    if (this.swallowed !== v.pouch) {
      const type = this.swallowed && !v.pouch ? 'gulp' : !this.swallowed && v.pouch ? 'spit' : null;
      if (type) {
        // Swallowing and spitting share the gulp animation; only the particles and sound differ.
        this.animator.gulp?.(); this.onSound?.(type);
        v.pulseV -= 3.5;
        this.pouchFx(type);
      }
      v.pouch = this.swallowed;
    }
    // Elephant trunk: the jet opening is a heavy kick (squash, dust at the braced feet); closing rebounds forward.
    const trunkOpen = this.body === this.elephant && !!this.trunk?.spraying && this.state !== 'fallen';
    if (trunkOpen !== v.trunk) {
      if (trunkOpen) { this.animator.trunkKick?.(); v.pulseV -= 4.2; this.onDust?.(this.root.position, 0.32, false); this.onSound?.('trunk'); }
      else this.animator.trunkStop?.();
      v.trunk = trunkOpen;
    }
    // A ladder uses the squirrel cling pose for every animal, paws cycling with the climb; no claw haze or scrape.
    const ladder = this.state === 'air' && this.wall?.ladder >= 0;
    const clinging = ladder || this.updateWallFeedback(dt);
    const ex = this.externalVelocity;

    Object.assign(ctx, {
      dt, t: v.clock, state: this.state, speed: Math.hypot(lx, lz), vy: v.vel.y, yawRate: v.yawRate,
      dash: this.dashRemaining > 0, glide: !!this.gliding, slip: this.slipRemaining > 0, shock: stun > 0, held: held?.kind || null, use: this.useAction || '',
      pouch: this.swallowed ? (this.swallowed.kind ? 0.45 : 1) : 0,
      trunk: trunkOpen ? 1 : 0, water: this.trunk?.water ?? 1,
      wall: clinging ? 1 : 0, wallSlide: ladder ? Math.min(1, Math.abs(this.vel.y) / C.ladderClimbSpeed) : clinging ? Math.min(1, slideSpeed(this.wallTime) / SLIDE_FULL) : 0,
      charge: held ? Math.max(0, Math.min(1, (v.charge - C.throwHoldSeconds * 0.5) / (C.throwChargeSeconds - C.throwHoldSeconds * 0.5))) : 0,
    });
    ctx.accel.copy(v.accel);
    ctx.push.set(ex.x * cos - ex.z * sin, 0, ex.x * sin + ex.z * cos);

    // Whole-body squash & stretch from the shared jump/land spring.
    const stretch = this.state === 'air' ? Math.max(-0.1, Math.min(0.12, v.vel.y * 0.01)) : 0;
    v.pulseV += (-230 * v.pulse - 13 * v.pulseV) * dt; v.pulse += v.pulseV * dt;
    const s = Math.max(-0.4, Math.min(0.4, this.sq * 0.1 + stretch + v.pulse));
    this.squash.scale.set(1 - s * 0.45, 1 + s * 0.8, 1 - s * 0.45);
    this.squash.position.set(0, 0, 0); this.squash.rotation.set(0, 0, 0);
    // A small-bodied squirrel leans in so its belly still touches the face it clings to (squash sits in the yaw frame: +x forward).
    const reach = this.body.species.wallReach || 0;
    if (reach) this.squash.position.x += reach * this.animator.blend.wall;
    if (v.suck > 0 || v.pop > 0) this.updateSwallowMotion(dt);
    if (v.fall) this.updateFall(dt);
    // Knocked down (shared `downRemaining`, WOBBLE.md): tip over onto the side; a placeholder until Mayulong's animation.
    v.down = (v.down || 0) + ((this.downRemaining > 0 ? 1 : 0) - (v.down || 0)) * (1 - Math.exp(-14 * dt));
    if (v.down > 0.01) { this.squash.rotation.x = v.down * 1.35; this.squash.position.y += v.down * 0.1; }
    if (stun > 0) {
      // Whole-body tremble on top of the stiff pose; fades over the last moments of the stun.
      const k = Math.min(1, stun / 0.3), c = v.clock;
      this.squash.position.set(Math.sin(c * 91) * 0.028 * k, Math.abs(Math.sin(c * 77)) * 0.022 * k, Math.sin(c * 83 + 1) * 0.028 * k);
      this.squash.rotation.y = Math.sin(c * 67) * 0.09 * k;
      this.squash.scale.multiplyScalar(1 + Math.abs(Math.sin(c * 59)) * 0.04 * k);
    }

    // Fur hangs under gravity, streams in the travel wind and trails the cat's own motion.
    _force.set(-0.2 + Math.sin(v.clock * 17 + this.animator.seed * 9) * 0.06, -0.32, Math.sin(v.clock * 11) * 0.04).addScaledVector(v.vel, -0.035);
    // Electrocuted fur stands on end and crackles.
    if (stun > 0) _force.set(Math.sin(v.clock * 71) * 0.12, 0.55 + Math.sin(v.clock * 53) * 0.12, Math.sin(v.clock * 63) * 0.12);
    this.body.setFurForce(_force);

    const offset = this.animator.pose(ctx);
    if (this.state === 'fallen' && this.deathCause === 'road-sign') {
      // A flattened stamp against the plate, never the ordinary road bounce/spin.
      this.squash.scale.set(.22, 1.12, 1.3); this.lean.rotation.set(0, 0, 0);
    }
    this.applyToolOffset(held, offset);
    this.root.updateMatrixWorld(true);
    this.animator.solveArms(held?.mesh, held?.kind);
  }

  /** Swallowed: shrink, spin and fly from the old spot into the pouch. Released: pop out of the beak with an overshoot. */
  updateSwallowMotion(dt) {
    const v = this.visual;
    if (v.suck > 0) {
      v.suck = Math.max(0, v.suck - dt);
      const k = 1 - v.suck / SUCK_SECONDS, ease = k * k, scale = Math.max(0.05, 1 - ease * 0.95);
      // The offset lives in the yaw frame (squash is under yawG).
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw), fx = v.suckFrom.x * (1 - ease), fz = v.suckFrom.z * (1 - ease);
      this.squash.position.set(fx * c - fz * s, v.suckFrom.y * (1 - ease), fx * s + fz * c);
      this.squash.scale.multiplyScalar(scale); this.squash.rotation.y = ease * 9;
    } else {
      v.pop = Math.max(0, v.pop - dt);
      const k = 1 - v.pop / POP_SECONDS, back = 1 + 2.7 * (k - 1) ** 3 + 1.7 * (k - 1) ** 2;
      const scale = 0.3 + 0.7 * back;
      this.squash.scale.set(this.squash.scale.x * scale * (1 - 0.15 * (1 - k)), this.squash.scale.y * scale * (1 + 0.3 * (1 - k)), this.squash.scale.z * scale * (1 - 0.15 * (1 - k)));
    }
  }

  /**
   * Squirrel cling feedback from the shared cling state (host rule, prediction or snapshot alike): a grab slaps on with
   * a puff, a kick-off bursts away from the face, running out of grip slips off, and sliding leaves friction haze that
   * thickens with the slide speed. Returns whether the squirrel is clinging this frame.
   */
  updateWallFeedback(dt) {
    const v = this.visual, wall = this.state === 'air' && this.body === this.squirrel && !(this.wall?.ladder >= 0) ? this.wall : null;
    if (!!wall !== !!v.wall) {
      if (wall) {
        wallNormal(wall, v.wallNormal); v.wallTruck = wall.truck;
        const strength = Math.min(1, Math.max(0, -v.airVy) / 10);
        this.animator.cling?.(); v.pulseV -= 2.5 + 2 * strength;
        this.wallFx('grab', 0.55, 0.4 + 0.6 * strength); this.onSound?.('cling', strength);
      } else if (this.state === 'air' && this.vel.y > 4) {
        this.animator.wallKick?.(); v.pulseV += 3.5;
        this.wallFx('kick', 0.3, 1); this.onSound?.('wallJump');
      } else if (this.state === 'air') {
        this.wallFx('slip', 0.6, 0.6); this.onSound?.('wallSlip');
      }
      v.wall = wall; v.haze = 0;
    }
    if (!wall) return false;
    wallNormal(wall, v.wallNormal); v.wallTruck = wall.truck;
    const slide = Math.min(1, slideSpeed(this.wallTime) / SLIDE_FULL);
    v.haze += dt * (HAZE_RATE[0] + (HAZE_RATE[1] - HAZE_RATE[0]) * slide);
    // Alternate between the reaching paws and the planted feet.
    for (; v.haze >= 1; v.haze--) this.wallFx('slide', Math.random() < 0.55 ? 0.78 : 0.14, slide);
    return true;
  }

  /** One wall-cling effect call at `height` above the feet, on the clung face. */
  wallFx(type, height, strength) {
    if (!this.onWallFx) return;
    const n = this.visual.wallNormal, p = this.root.position, truck = this.wall?.truck || this.visual.wallTruck;
    this.onWallFx({
      type, contact: new THREE.Vector3(p.x - n.x * WALL_GAP, p.y + height, p.z - n.z * WALL_GAP), normal: { x: n.x, z: n.z },
      carry: truck ? truck.vel.clone() : new THREE.Vector3(this.airBase.x, 0, this.airBase.y), strength,
    });
  }

  /** Smoke, suction and feathers at the beak tip, riding along with whatever the pelican stands on. */
  pouchFx(type) {
    if (!this.onPouchFx) return;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw), p = this.root.position;
    const carry = this.ground?.truck ? this.ground.truck.vel.clone() : new THREE.Vector3(this.airBase.x, 0, this.airBase.y);
    this.onPouchFx({
      type, mouth: new THREE.Vector3(p.x + c * 0.62, p.y + 0.76, p.z - s * 0.62), forward: new THREE.Vector3(c, 0, -s),
      carry, feather: (PELICAN_COATS[this.appearance.breed] || PELICAN_COATS.white).body,
    });
  }

  /** 0 dry … 1 soaked; set by WetSurfaces from the presented spray. */
  setWetness(value) { this.body.furBase.userData.fur.furWet.value = value; }

  /** Take-off: brief stretch kick and a small puff kicked down from the feet.
   * A tail jumper (the squirrel) squashes and pops into a bigger stretch, with a puff where the tail slaps the roof. */
  jumpFeedback() {
    this.animator.jump();
    const v = this.visual;
    if (this.body.species.tailJump) {
      v.pulse = Math.min(v.pulse, -0.16); v.pulseV += 6.5;
      const p = this.root.position;
      this.onDust?.(_tailSlap.set(p.x - Math.cos(this.yaw) * 0.42, p.y, p.z + Math.sin(this.yaw) * 0.42), 0.2, false);
    } else v.pulseV += 3.2;
    this.onDust?.(this.root.position, 0.12, false);
    this.onSound?.('jump');
  }

  /** Landing: squash and dust both scale with how hard the cat came down. */
  landFeedback(impact) {
    this.animator.land(impact);
    const k = Math.min(1.2, impact / 14), heavy = 1 + 0.6 * (this.body.species.heavy || 0);
    this.visual.pulseV -= (2 + 4.5 * k) * heavy;
    if (impact > 3) this.onDust?.(this.root.position, (0.1 + 0.32 * k) * heavy, false);
    this.onSound?.('land', impact);
  }

  /** Hitting the road: first dust ring and a sideways spin in a random direction. */
  beginFall(impactVy) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    this.visual.fall = { t: 0, hop: 0, spin: dir * (13 + Math.random() * 5), angle: 0, dir, squash: 1 };
    this.lean.rotation.order = 'YXZ';
    this.onDust?.(this.root.position, Math.min(1, 0.6 + Math.max(0, -impactVy) / 30), true);
    this.onSound?.('fall');
  }

  endFall() {
    this.visual.fall = null;
    this.lean.rotation.order = 'XYZ'; this.lean.rotation.set(0, 0, 0);
  }

  /** Bounce a few times while lying on the side and spinning flat; squash and puff on every hit. */
  updateFall(dt) {
    const f = this.visual.fall;
    f.t += dt;
    const { height, hop } = fallBounce(f.t);
    if (hop !== f.hop) {
      // Landed again: smaller dust ring and squash for each successive bounce.
      f.hop = hop; f.squash = 1;
      this.onDust?.(this.root.position, hop < FALL_BOUNCES.length ? 0.55 / hop : 0.18, true);
      this.onSound?.('bounce', hop - 1);
    }
    f.squash = Math.max(0, f.squash - dt * 7);
    this.root.position.y += height;
    // Spin about the vertical axis, slowing with ground friction; tip over onto the side quickly.
    f.spin *= Math.exp(-2.2 * dt);
    f.angle += f.spin * dt;
    const tip = Math.min(1, f.t / 0.12);
    // lean = Ry(spin) · Rx(tip): the cat (yaw kept inside) lies on its side and spins flat on the road.
    this.lean.rotation.set(f.dir * 1.35 * tip + Math.sin(f.t * 21) * 0.12 * Math.max(0, 1 - f.t), f.angle, 0);
    const sq = Math.sin(f.squash * Math.PI) * 0.35 * (hop === 0 ? 1 : 0.6);
    this.squash.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);
  }

  /** Visual-only nudge of the held tool; snapshots re-seat the authoritative hold point. */
  applyToolOffset(tool, offset) {
    const v = this.visual;
    if (tool !== v.offsetTool) { v.offsetTool = tool; v.toolApplied = null; }
    if (!tool) return;
    const p = tool.mesh.position;
    if (!v.toolApplied || !p.equals(v.toolApplied)) v.toolBase.copy(p);
    p.copy(v.toolBase).add(offset);
    (v.toolApplied ||= new THREE.Vector3()).copy(p);
  }
}
