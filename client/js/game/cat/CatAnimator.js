/**
 * Procedural, spring-driven cat animation (Party Animals-style floppy follow-through, no physics engine).
 * Each frame builds a target pose from gameplay state; every bone then chases its target through an
 * under-damped spring, so heads lag, ears flop, tails whip and landings wobble without keyframes.
 * Bone axes in bind pose: x forward, y up, z right. Rotation z pitches (+ tips a vertical bone back,
 * swings a hanging limb forward), x rolls (+ tips a vertical bone to the right), y yaws.
 */
import * as THREE from 'three';
import { RIG } from './CatModel.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const SIDES = [['L', -1], ['R', 1]];
const SLAP_SWING = 0.3, HIT_REACT = 0.4, FLAP_BEAT = 0.32;
// Pelican beak timelines (s). The gape is a springy 0..1 opening driven toward these targets, so it overshoots
// wide open and chomps shut with a wobble.
const GULP = 0.6, GAPE_JAW = 1.5;
// Elephant trunk: floppy springs per trunk bone, and the raised spray pose (z swings the hanging trunk forward/up).
const TRUNK_SPRING = [[170, 0.3], [150, 0.27], [130, 0.24], [115, 0.22]];
const TRUNK_RAISE = [0.62, 0.17, 0.1, -0.06];
// Squirrel tail jump (s): the plume slams down under the body for the first part, then whips up over the back.
const TAIL_JUMP = 0.45, TAIL_PUSH = 0.28;

// [stiffness, damping ratio]: low ratios ring longer and read as "jelly".
const SPRINGS = {
  hips: [300, 0.62], spine: [210, 0.45], head: [125, 0.36],
  earL: [230, 0.14], earR: [230, 0.14],
  armL: [190, 0.42], armR: [190, 0.42], pawL: [240, 0.5], pawR: [240, 0.5],
  legL: [420, 0.62], legR: [420, 0.62], footL: [380, 0.6], footR: [380, 0.6],
  tail0: [120, 0.32], tail1: [95, 0.28], tail2: [78, 0.25], tail3: [62, 0.22],
};

// Paw targets in each tool's local space.
const GRIPS = {
  towel: { L: new THREE.Vector3(-0.1, 0.03, -0.2), R: new THREE.Vector3(-0.1, 0.03, 0.2) },
  soap: { L: new THREE.Vector3(-0.06, 0.02, -0.2), R: new THREE.Vector3(-0.06, 0.02, 0.2) },
  water: { L: new THREE.Vector3(0.12, 0.05, -0.17), R: new THREE.Vector3(-0.02, -0.12, 0.1) },
  charger: { L: new THREE.Vector3(0.02, 0.1, -0.13), R: new THREE.Vector3(-0.12, -0.02, 0.1) },
};

class Spring {
  constructor(k, zeta) { this.k = k; this.c = 2 * Math.sqrt(k) * zeta; this.x = new THREE.Vector3(); this.v = new THREE.Vector3(); }
  step(target, dt) {
    const steps = Math.max(1, Math.ceil(dt * 240)), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.v.x += ((target.x - this.x.x) * this.k - this.v.x * this.c) * h;
      this.v.y += ((target.y - this.x.y) * this.k - this.v.y * this.c) * h;
      this.v.z += ((target.z - this.x.z) * this.k - this.v.z * this.c) * h;
      this.x.addScaledVector(this.v, h);
    }
  }
}

export class CatAnimator {
  constructor(model, seed = 0) {
    this.model = model; this.bones = model.bones; this.seed = seed;
    // Species flavour: dogs wag fast at rest and scrub at their faster cleaning pace.
    this.idleWag = model.species?.idleWag ?? 1.6; this.scrubRate = model.species?.scrubRate ?? 1;
    // Heavy species (the elephant) stomp: slower cadence, deeper bob, braced spray recoil.
    this.heavy = model.species?.heavy ?? 0;
    // Twitchy species (the squirrel) flick the tail now and then.
    this.flick = model.species?.flick ?? 0; this.flickIn = 1.5 + seed * 2;
    // Small species patter faster; tail jumpers (the squirrel) spring off the tail.
    this.cadence = model.species?.cadence ?? 1; this.tailJump = model.species?.tailJump ?? 0; this.tailJumpT = 0;
    this.trunkSprings = this.bones.trunk0 ? TRUNK_SPRING.map(([k, z]) => new Spring(k, z)) : null;
    this.trunkTarget = new THREE.Vector3();
    this.springs = Object.fromEntries(Object.entries(SPRINGS).map(([name, [k, z]]) => [name, new Spring(k, z)]));
    this.hipsSpring = new Spring(260, 0.42);
    this.targets = Object.fromEntries(Object.keys(SPRINGS).map((name) => [name, new THREE.Vector3()]));
    this.hipsTarget = new THREE.Vector3();
    this.hipsBind = this.bones.hips.position.clone();
    this.blend = { move: 0, air: 0, glide: 0, wall: 0, slide: 0, dash: 0, slip: 0, shock: 0, fall: 0, hold: 0, push: 0, wipe: 0, soap: 0, wash: 0, spray: 0, hack: 0, charge: 0, trunk: 0 };
    this.scrabble = 0; this.armReach = 1; // squirrel wall-cling paw cycle and cartoon arm stretch
    this.pushDir = new THREE.Vector3(-1, 0, 0);
    this.phase = 0; this.airTime = 0;
    this.throwT = 0; this.pickT = 0;
    this.slapT = 0; this.slapSide = 1; this.hitT = 0; this.hitSide = 1; // empty-hand slap swing and being slapped
    this.flapT = 0; // goose mid-air wing beat
    this.blinkIn = 1.5 + seed; this.blinkT = 0;
    this.lookIn = 1; this.look = new THREE.Vector2(); this.lookTarget = new THREE.Vector2();
    this.twitchIn = 2 + seed * 0.7;
    this.mouth = 0;
    this.pouchFill = 0; this.pouchV = 0; this.gulpT = 0; // pelican jaw and pouch
    this.gape = 0; this.gapeV = 0;
    this.toolOffset = new THREE.Vector3();
    this._q = new THREE.Quaternion(); this._dir = new THREE.Vector3(); this._target = new THREE.Vector3();
  }

  // --- one-shot reactions -------------------------------------------------
  jump() {
    if (this.tailJump) { this.tailSpring(); return; }
    this.hipsSpring.v.y += 0.9;
    this.springs.tail0.v.z -= 7; this.springs.tail1.v.z -= 6;
    for (const [side] of SIDES) { this.springs[`ear${side}`].v.z += 9; this.springs[`arm${side}`].v.z -= 4; }
  }
  /** Squirrel take-off: the tail kicks down hard like a spring leg and the body pops up off it (see the TAIL_JUMP timeline). */
  tailSpring() {
    this.tailJumpT = TAIL_JUMP;
    this.hipsSpring.v.y += 1.4;
    this.springs.tail0.v.z += 15; this.springs.tail1.v.z += 7; this.springs.tail2.v.z -= 9; this.springs.tail3.v.z -= 6;
    this.springs.spine.v.z -= 6; this.springs.head.v.z += 6;
    for (const [side, s] of SIDES) { this.springs[`ear${side}`].v.z += 12; this.springs[`arm${side}`].v.x -= 8 * s; this.springs[`leg${side}`].v.z += 6; }
  }
  land(impact) {
    const k = clamp(impact / 12, 0, 1.4);
    this.hipsSpring.v.y -= 1.6 * k;
    this.springs.spine.v.z -= 7 * k; this.springs.head.v.z += 9 * k;
    for (const [side, s] of SIDES) {
      this.springs[`ear${side}`].v.x -= 14 * s * k; this.springs[`ear${side}`].v.z += 10 * k;
      this.springs[`arm${side}`].v.x -= 9 * s * k;
    }
    this.springs.tail0.v.z += 9 * k; this.springs.tail2.v.z += 8 * k;
  }
  pickup() { this.pickT = 0.32; }
  /** Pelican gulp (used for both swallowing and spitting): the beak flies wide open, the head rears back, then it chomps shut. */
  gulp() { this.gulpT = GULP; this.gapeV += 14; this.springs.head.v.z += 10; this.hipsSpring.v.y += 0.5; }
  thrown(power) { this.throwT = 0.5; this.throwPower = 0.5 + power * 0.7; }
  /** Elephant jet opens: a heavy shove back through hips, spine and head, ears blown wide, the trunk whipping up. */
  trunkKick() {
    this.hipsSpring.v.x -= 1.1; this.hipsSpring.v.y -= 0.7;
    this.springs.spine.v.z += 9; this.springs.head.v.z += 7; this.springs.hips.v.z += 4;
    for (const [side, s] of SIDES) { this.springs[`ear${side}`].v.x += 16 * s; this.springs[`arm${side}`].v.z -= 6; this.springs[`leg${side}`].v.z -= 5; }
    this.trunkSprings?.forEach((spring, i) => { spring.v.z += 5.5 - i; });
  }
  /** Jet closes: the body rocks forward out of the brace and the trunk flops down. */
  trunkStop() {
    this.springs.spine.v.z -= 5; this.springs.head.v.z -= 4; this.hipsSpring.v.x += 0.4;
    this.trunkSprings?.forEach((spring, i) => { spring.v.z -= 6 + i * 2; });
  }
  dropped() { this.pickT = 0.22; }
  /** Goose flap: one big downstroke of both wings (arm springs) with a hip lift and tail flick. */
  flap() {
    this.flapT = FLAP_BEAT; this.hipsSpring.v.y += 0.7; this.springs.tail0.v.z += 8;
    for (const [side, s] of SIDES) { this.springs[`arm${side}`].v.x += 14 * s; this.springs[`arm${side}`].v.z -= 3; }
  }
  /** Empty-hand slap: a quick wind-up, then one paw whips forward and across (`side` −1 left, 1 right). */
  slap(side = 1) {
    this.slapT = SLAP_SWING; this.slapSide = side;
    this.hipsSpring.v.x += 0.6; this.springs.head.v.y -= 5 * side; this.springs.tail0.v.y += 6 * side;
  }
  /** Slapped: the head snaps away from the hit, eyes squeeze shut, ears pin back and the arms fly up. */
  slapped(side = 1) {
    this.hitT = HIT_REACT; this.hitSide = side;
    this.springs.head.v.z += 14; this.springs.head.v.y += 10 * side; this.hipsSpring.v.y -= 0.5;
    for (const [s] of SIDES) { this.springs[`ear${s}`].v.z -= 16; this.springs[`arm${s}`].v.z += 8; }
  }
  /** Squirrel slaps onto a wall: the body squashes into the face, paws fling up to grab, ears and tail flop on. */
  cling() {
    this.hipsSpring.v.x += 0.7; this.hipsSpring.v.y -= 0.4;
    this.springs.spine.v.z -= 8; this.springs.head.v.z += 7;
    for (const [side, s] of SIDES) { this.springs[`arm${side}`].v.z += 10; this.springs[`arm${side}`].v.x -= 6 * s; this.springs[`ear${side}`].v.z -= 12; this.springs[`leg${side}`].v.z += 8; }
    this.springs.tail0.v.z -= 9; this.springs.tail1.v.z += 7; this.springs.tail2.v.z -= 6;
  }
  /** Squirrel kicks off a wall: legs shove, arms swing down, the tail whips. */
  wallKick() {
    this.hipsSpring.v.y += 0.8; this.springs.spine.v.z += 9; this.springs.head.v.z -= 5;
    for (const [side] of SIDES) { this.springs[`arm${side}`].v.z -= 12; this.springs[`leg${side}`].v.z -= 14; this.springs[`ear${side}`].v.z += 10; }
    this.springs.tail0.v.z += 10; this.springs.tail1.v.z -= 8;
  }

  /**
   * Pelican beak targets, before the springs step: advance the gulp timeline, spring the gape toward it
   * and rear the head back so the open mouth faces the camera.
   */
  beakTargets(T, hp, dt) {
    this.gulpT = Math.max(0, this.gulpT - dt);
    const gulp = this.gulpT > 0 ? 1 - this.gulpT / GULP : -1;
    // Wide open, a beat of hold, then snap shut.
    const target = gulp >= 0 && gulp < 0.42 ? 1 : 0;
    const steps = Math.max(1, Math.ceil(dt * 240)), h = dt / steps;
    for (let i = 0; i < steps; i++) { this.gapeV += ((target - this.gape) * 420 - this.gapeV * 13) * h; this.gape += this.gapeV * h; }
    const g = Math.max(0, this.gape);
    if (gulp >= 0) { T.head.z += 0.75 * g; T.spine.z += 0.2 * g; hp.y += 0.03 * g; }
  }

  /** Pelican beak write-out: jaw from the gape and the mouth, pouch swelling with its contents and stretching wide while open. */
  poseBeak(ctx, dt, t) {
    this.pouchV += ((ctx.pouch || 0) - this.pouchFill) * 150 * dt - this.pouchV * 7 * dt;
    this.pouchFill += this.pouchV * dt;
    const f = Math.max(-0.35, this.pouchFill), slosh = Math.sin(t * 6.5 + this.seed * 4) * 0.06 * Math.max(0, f);
    const g = Math.max(0, this.gape);
    this.bones.jaw.rotation.z = -(0.25 * this.mouth + GAPE_JAW * g);
    // Cartoon "big mouth": the whole head (beak, pouch, eyes, crest) swells while gaping so it reads from the game camera.
    this.bones.head.scale.setScalar(1 + 0.45 * g);
    this.bones.pouch.scale.set(1 + 0.3 * f + 0.45 * g, 1 + 1.7 * f + slosh + 0.6 * g, 1 + 1.15 * f - slosh * 0.5 + 0.55 * g);
  }

  /** Builds the target pose, steps all springs and writes bone transforms. Returns the held-tool offset. */
  pose(ctx) {
    const { dt, t } = ctx, T = this.targets, B = this.blend;
    for (const v of Object.values(T)) v.set(0, 0, 0);
    const hp = this.hipsTarget.set(0, 0, 0), tool = this.toolOffset.set(0, 0, 0);
    let squint = 1, mouth = 0, earBack = 0;

    const grounded = ctx.state === 'ground', airborne = ctx.state === 'air' || ctx.state === 'returning', fallen = ctx.state === 'fallen';
    const speed01 = clamp(ctx.speed / 5.5, 0, 1.5);
    B.move = damp(B.move, grounded ? Math.min(1, speed01) : 0, 9, dt);
    B.air = damp(B.air, airborne ? 1 : 0, 12, dt);
    B.glide = damp(B.glide, airborne && ctx.glide ? 1 : 0, 10, dt);
    B.wall = damp(B.wall, airborne && ctx.wall ? 1 : 0, ctx.wall ? 18 : 9, dt);
    B.slide = damp(B.slide, ctx.wall ? ctx.wallSlide || 0 : 0, 8, dt);
    B.dash = damp(B.dash, ctx.dash && !ctx.slip ? 1 : 0, 16, dt);
    B.slip = damp(B.slip, ctx.slip ? 1 : 0, 14, dt);
    B.fall = damp(B.fall, fallen ? 1 : 0, 9, dt);
    B.hold = damp(B.hold, ctx.held ? 1 : 0, 11, dt);
    for (const use of ['wipe', 'soap', 'wash', 'spray', 'hack']) B[use] = damp(B[use], ctx.use === use ? 1 : 0, 9, dt);
    B.charge = damp(B.charge, ctx.charge, 12, dt);
    const pushAmount = clamp(ctx.push.length() / 3.5, 0, 1);
    if (pushAmount > 0.05) this.pushDir.lerp(this._dir.copy(ctx.push).normalize(), 1 - Math.exp(-12 * dt));
    B.push = damp(B.push, pushAmount, pushAmount > B.push ? 16 : 5, dt);
    this.airTime = airborne ? this.airTime + dt : 0;
    this.throwT = Math.max(0, this.throwT - dt); this.pickT = Math.max(0, this.pickT - dt);
    this.slapT = Math.max(0, this.slapT - dt); this.hitT = Math.max(0, this.hitT - dt); this.flapT = Math.max(0, this.flapT - dt);

    // Gait phase: faster cadence at higher speed; parks on a neutral stance when stopping.
    if (grounded && ctx.speed > 0.25) this.phase += dt * (5 + ctx.speed * 1.05) * (1 - 0.28 * this.heavy) * this.cadence;
    else this.phase = damp(this.phase, Math.round(this.phase / Math.PI) * Math.PI, 8, dt);
    const sw = Math.sin(this.phase), cw = Math.cos(this.phase), m = B.move;
    const busy = Math.max(B.hold, B.wipe, B.soap, B.wash, B.spray, B.hack);

    // Idle: breathing, slow weight shifts, glances around.
    const breath = Math.sin(t * 2.3 + this.seed);
    T.spine.z += -0.05 + breath * 0.018 * (1 - m);
    T.head.z += 0.04 - breath * 0.012;
    T.hips.x += Math.sin(t * 0.85 + this.seed) * 0.03 * (1 - m);
    hp.y += breath * 0.004;
    if ((this.lookIn -= dt) <= 0) {
      this.lookIn = 1.2 + Math.random() * 2.6;
      this.lookTarget.set((Math.random() - 0.5) * 1.1, (Math.random() - 0.4) * 0.35);
    }
    this.look.lerp(this.lookTarget, 1 - Math.exp(-6 * dt));
    const idle = (1 - m) * (1 - busy) * (1 - B.air);
    T.head.y += this.look.x * idle; T.head.z += this.look.y * idle;
    for (const [side, s] of SIDES) { T[`arm${side}`].x += -s * 0.16; T[`arm${side}`].z += 0.06; T[`ear${side}`].x += s * 0.05; }
    for (let i = 0; i < 4; i++) T[`tail${i}`].y += Math.sin(t * this.idleWag - i * 0.75 + this.seed) * (0.2 + 0.05 * i);
    T.tail0.z += 0.12;

    // Locomotion: waddle roll, hip twist, bouncing stride, swinging mittens, tail up.
    hp.y += (Math.abs(cw) - 0.55) * 0.075 * m * (1 + 0.5 * this.heavy);
    T.hips.x += sw * 0.08 * m * this.heavy; // side-to-side heft
    T.hips.x += sw * 0.13 * m; T.hips.y += sw * 0.12 * m;
    T.spine.x += -sw * 0.07 * m; T.spine.y += -sw * 0.14 * m;
    T.spine.z += -0.2 * m * Math.min(1.2, speed01);
    T.head.x += -sw * 0.06 * m; T.head.z += 0.13 * m;
    for (const [side, s] of SIDES) {
      const swing = sw * s * m;
      T[`leg${side}`].z += swing * 0.95;
      T[`foot${side}`].z += -swing * 0.6 + Math.max(0, cw * s) * 0.45 * m;
      T[`arm${side}`].z += -swing * 0.8; T[`arm${side}`].x += -s * 0.12 * m;
    }
    T.tail0.z += 0.35 * m;
    for (let i = 1; i < 4; i++) T[`tail${i}`].y += Math.sin(this.phase * 0.5 - i * 0.9) * 0.18 * m;
    // Momentum: stops pitch the body forward, starts make it lag; turns bank into the curve.
    T.spine.z += clamp(ctx.accel.x * 0.022, -0.4, 0.3);
    T.hips.x += clamp(ctx.accel.z * 0.018, -0.3, 0.3);
    T.head.y += clamp(ctx.yawRate * 0.06, -0.35, 0.35);

    // Dash: superhero dive.
    const d = B.dash;
    T.spine.z += -0.62 * d; T.hips.z += -0.22 * d; T.head.z += 0.45 * d; hp.y -= 0.04 * d;
    for (const [side, s] of SIDES) { T[`arm${side}`].z += -1.25 * d; T[`arm${side}`].x += -s * 0.35 * d; T[`leg${side}`].z += -0.55 * d; }
    T.tail0.z -= 0.75 * d; earBack += 0.7 * d;

    // Airborne: arms up while rising, panicked flailing once falling. A glide or a wall cling replaces it below.
    const a = B.air * (1 - B.glide) * (1 - B.wall), up = clamp(ctx.vy / 9, -1, 1), rise = Math.max(0, up), drop = Math.max(0, -up);
    const flail = Math.min(1, this.airTime * 1.3) * drop;
    for (const [side, s] of SIDES) {
      const ph = t * 17 + s * 1.7;
      T[`arm${side}`].x += -s * (2.2 * rise + 1.3 * drop + Math.sin(ph) * 0.6 * flail) * a;
      T[`arm${side}`].z += (0.25 * rise + Math.sin(ph * 0.8) * 0.8 * flail) * a;
      T[`leg${side}`].z += (0.65 * rise + Math.sin(t * 15 + s * 1.6) * 0.75 * flail) * a;
      T[`foot${side}`].z += -0.55 * rise * a;
    }
    T.spine.z += (0.12 * drop - 0.16 * rise) * a; T.head.z += (0.2 * drop - 0.12 * rise) * a;
    T.tail0.z += (-0.55 * rise + 0.6 * drop) * a; T.tail1.z += 0.3 * drop * a;
    earBack += 0.55 * drop * a; mouth = Math.max(mouth, flail * 0.9);

    // Squirrel tail jump: push (tail pressed down under the body, body crouched over it), then release (tail whips up
    // and over, knees tuck, arms fling wide, a delighted open mouth). Physics is unchanged; only the read is bigger.
    if (this.tailJumpT > 0) {
      this.tailJumpT = Math.max(0, this.tailJumpT - dt);
      const k = 1 - this.tailJumpT / TAIL_JUMP, push = k < TAIL_PUSH ? 1 : Math.max(0, 1 - (k - TAIL_PUSH) / 0.15);
      const whip = Math.sin(Math.PI * clamp((k - TAIL_PUSH) / (1 - TAIL_PUSH), 0, 1));
      // The whip stays behind the head: the airborne pose and spring overshoot already lift the plume.
      T.tail0.z += 1.15 * push - 0.3 * whip; T.tail1.z += 0.5 * push - 0.1 * whip;
      T.tail2.z += -0.45 * push + 0.35 * whip; T.tail3.z += -0.5 * push + 0.3 * whip;
      T.spine.z += -0.25 * push + 0.12 * whip; T.head.z += 0.2 * push + 0.15 * whip;
      for (const [side, s] of SIDES) {
        T[`arm${side}`].x += -s * 1.5 * whip; T[`arm${side}`].z += 0.3 * whip;
        T[`leg${side}`].z += 0.6 * whip; T[`foot${side}`].z += -0.45 * whip;
      }
      mouth = Math.max(mouth, 0.65 * whip); earBack += 0.5 * whip;
    }

    // Pelican glide: wings spread flat with a slow, shallow beat, body tipped into the wind, legs trailing.
    const gl = B.glide;
    if (gl > 0.001) {
      const beat = Math.sin(t * 6.5 + this.seed);
      for (const [side, s] of SIDES) {
        T[`arm${side}`].x += -s * (1.45 + beat * 0.16) * gl;
        T[`arm${side}`].z += (0.12 - beat * 0.08) * gl;
        T[`leg${side}`].z += -0.55 * gl; T[`foot${side}`].z += 0.35 * gl;
      }
      T.spine.z += -0.28 * gl; T.hips.z += -0.12 * gl; T.head.z += 0.3 * gl;
      T.tail0.z += -0.4 * gl; hp.y += beat * 0.01 * gl;
    }

    // Squirrel wall cling: arms stretched up the face in a Y and clawing on, legs planted on it, tail curled up for
    // balance. The faster it slides the harder the paws scrabble, the head turns to glance down and the face strains.
    const wl = B.wall;
    this.armReach = 1 + 0.5 * wl;
    if (wl > 0.001) {
      const sl = B.slide;
      this.scrabble += dt * (7 + 24 * sl);
      const reach = 0.12 + 0.45 * sl, buzz = Math.sin(t * 47 + this.seed) * sl;
      T.spine.z += (0.06 + buzz * 0.03) * wl; T.hips.z += -0.1 * wl; T.spine.x += Math.sin(t * 41) * 0.05 * sl * wl;
      T.head.z += 0.3 * wl; T.head.y += (Math.sin(t * 1.7 + this.seed) * 0.35 * (1 - sl) + 0.8 * sl) * wl;
      hp.y += 0.03 * wl;
      for (const [side, s] of SIDES) {
        const paw = Math.sin(this.scrabble + (s > 0 ? 0 : Math.PI));
        T[`arm${side}`].x += -s * (2.3 - paw * reach * 0.6) * wl; T[`arm${side}`].z += (0.55 + paw * reach) * wl;
        T[`paw${side}`].z += -0.45 * wl;
        T[`leg${side}`].z += (0.95 - paw * reach * 0.8) * wl; T[`leg${side}`].x += -s * 0.32 * wl;
        T[`foot${side}`].z += (-0.55 + paw * 0.25 * sl) * wl;
      }
      T.tail0.z += 0.3 * wl;
      for (let i = 1; i < 4; i++) T[`tail${i}`].y += Math.sin(t * (3 + 11 * sl) - i * 0.8) * (0.12 + 0.2 * sl) * wl;
      earBack += (0.2 + 0.8 * sl) * wl;
      squint = Math.min(squint, 1 - 0.6 * sl * wl); mouth = Math.max(mouth, (0.1 + 0.8 * sl) * wl);
    }

    // Soap slip: feet fly forward, body tips back, arms windmill.
    const sl = B.slip;
    T.spine.z += 0.55 * sl; T.hips.z += 0.3 * sl; hp.y -= 0.07 * sl;
    for (const [side, s] of SIDES) {
      T[`leg${side}`].z += 1.25 * sl;
      T[`arm${side}`].x += -s * (1.7 + Math.sin(t * 20 + s) * 0.5) * sl;
    }
    mouth = Math.max(mouth, sl); squint = Math.min(squint, 1 + 0.25 * sl);

    // Electrocuted: rigid spread-eagle with every joint buzzing, tail bolt upright, eyes squeezed shut, mouth wide.
    B.shock = damp(B.shock, ctx.shock ? 1 : 0, ctx.shock ? 30 : 6, dt);
    const sh = B.shock, buzz = (rate, offset) => Math.sin(t * rate + offset + this.seed * 7);
    if (sh > 0.001) {
      T.spine.z += (0.2 + buzz(41, 0) * 0.14) * sh; T.spine.x += buzz(37, 1) * 0.12 * sh;
      T.head.z += (-0.22 + buzz(47, 2) * 0.16) * sh; T.head.x += buzz(43, 3) * 0.14 * sh;
      T.hips.x += buzz(39, 4) * 0.1 * sh; hp.y += (0.03 + Math.abs(buzz(45, 5)) * 0.03) * sh;
      for (const [side, s] of SIDES) {
        T[`arm${side}`].x += -s * (1.9 + buzz(49, s) * 0.3) * sh; T[`arm${side}`].z += (0.5 + buzz(53, s * 2) * 0.35) * sh;
        T[`leg${side}`].x += -s * (0.5 + buzz(51, s) * 0.18) * sh; T[`leg${side}`].z += buzz(55, s * 3) * 0.25 * sh;
        T[`foot${side}`].z += buzz(57, s) * 0.3 * sh;
        T[`ear${side}`].x += buzz(59, s * 4) * 0.35 * sh;
      }
      for (let i = 0; i < 4; i++) T[`tail${i}`].z += (-0.45 + buzz(44 - i * 3, i) * 0.3) * sh;
      squint = Math.min(squint, 1 - 0.9 * sh); mouth = Math.max(mouth, 0.85 * sh);
    }

    // Hit by a water jet / yanked by the hose: lean with the shove, shield the face, squeeze eyes.
    const p = B.push, pd = this.pushDir;
    T.spine.z += -pd.x * 0.55 * p; T.spine.x += pd.z * 0.45 * p; T.head.z += -pd.x * 0.3 * p;
    T.spine.x += Math.sin(t * 43) * 0.045 * p;
    hp.x += pd.x * 0.05 * p; hp.z += pd.z * 0.05 * p;
    for (const [side, s] of SIDES) { T[`arm${side}`].z += 1.5 * p; T[`arm${side}`].x += s * 0.15 * p; T[`leg${side}`].x += -s * 0.22 * p; }
    squint = Math.min(squint, 1 - 0.75 * p); mouth = Math.max(mouth, p * 0.8); earBack += 0.8 * p;

    // Carrying: lean into the load (arms are solved by IK in solveArms).
    const gun = ctx.held === 'water' ? B.hold : 0;
    T.spine.z += -0.14 * B.hold - 0.16 * gun; T.hips.z += -0.12 * gun; T.head.z += 0.08 * B.hold + 0.2 * gun;

    // Wiping / soaping: fold down to the roof and scrub in circles, rocking the hips.
    const scrub = B.wipe + B.soap, rate = (12 + 5 * B.soap / Math.max(0.001, scrub)) * this.scrubRate;
    T.spine.z += -0.72 * scrub; T.hips.z += -0.32 * scrub; T.head.z += 0.5 * scrub; hp.y -= 0.05 * scrub;
    T.hips.x += Math.sin(t * rate) * 0.12 * scrub; T.spine.y += Math.cos(t * rate) * 0.1 * scrub;
    tool.x += (Math.cos(t * rate) * 0.07 - 0.02) * scrub; tool.y += -0.3 * scrub; tool.z += Math.sin(t * rate) * 0.09 * scrub;
    for (let i = 0; i < 4; i++) T[`tail${i}`].y += Math.sin(t * 9 - i) * 0.2 * scrub;

    // Washing the towel at the basin: brisk up-down rubbing.
    const w = B.wash;
    T.spine.z += -0.25 * w; T.head.z += 0.22 * w;
    tool.y += Math.sin(t * 15) * 0.04 * w - 0.05 * w; tool.x += Math.cos(t * 15) * 0.02 * w;
    T.spine.x += Math.sin(t * 15) * 0.04 * w;

    // Hacking (versus console): hunched over the keyboard, both paws up and hammering the keys in turn, head bobbing to
    // the rhythm, ears pricked, eyes narrowed at the screen; the tail flicks with each burst of typing.
    const hk = B.hack;
    if (hk > 0.001) {
      const tap = t * 23, burst = 0.6 + 0.4 * Math.sin(t * 2.7 + this.seed);
      T.spine.z += -0.3 * hk; T.hips.z += -0.08 * hk; T.head.z += (0.3 + Math.sin(tap * 0.5) * 0.04 * burst) * hk;
      T.head.y += Math.sin(t * 1.3 + this.seed) * 0.12 * hk; hp.y -= 0.02 * hk;
      for (const [side, s] of SIDES) {
        const hit = Math.max(0, Math.sin(tap + (s > 0 ? 0 : Math.PI))) * burst;
        T[`arm${side}`].z += (1.25 - hit * 0.35) * hk; T[`arm${side}`].x += s * (0.28 + hit * 0.06) * hk;
        T[`ear${side}`].x += -s * 0.12 * hk;
      }
      for (let i = 0; i < 4; i++) T[`tail${i}`].y += Math.sin(t * 11 - i * 0.8) * 0.25 * burst * hk;
      squint = Math.min(squint, 1 - 0.4 * hk);
    }

    // Spraying: braced stance, recoil chatter, squinting into the spray.
    const sp = B.spray, chatter = Math.abs(Math.sin(t * 38));
    T.spine.z += (0.1 + chatter * 0.04) * sp; tool.x -= chatter * 0.015 * sp;
    for (const [side, s] of SIDES) T[`leg${side}`].x += -s * 0.2 * sp;
    squint = Math.min(squint, 1 - 0.3 * sp); mouth = Math.max(mouth, 0.35 * sp); earBack += 0.3 * sp;

    // Trunk jet (elephant): braced wide stance leaning back into the recoil, head up, a heavy shudder, ears blown back.
    B.trunk = damp(B.trunk, ctx.trunk || 0, (ctx.trunk || 0) > B.trunk ? 18 : 7, dt);
    const tj = B.trunk, shudder = Math.sin(t * 31) * 0.6 + Math.sin(t * 47 + 1.3) * 0.4;
    T.spine.z += (0.2 + shudder * 0.035) * tj; T.hips.z += 0.08 * tj; T.head.z += (0.06 + shudder * 0.03) * tj;
    hp.x -= 0.035 * tj; hp.y -= 0.03 * tj; hp.y += Math.abs(shudder) * 0.006 * tj;
    for (const [side, s] of SIDES) {
      T[`leg${side}`].x += -s * 0.3 * tj; T[`leg${side}`].z += -0.25 * tj;
      T[`arm${side}`].x += -s * 0.35 * tj; T[`arm${side}`].z += -0.3 * tj;
    }
    earBack += 0.9 * tj; squint = Math.min(squint, 1 - 0.45 * tj);

    // Throw wind-up: twist back and haul the tool over the shoulder.
    const c = B.charge;
    T.spine.z += 0.35 * c; T.spine.y += -0.4 * c; T.head.z += -0.12 * c; T.head.y += 0.25 * c;
    tool.x += -0.4 * c; tool.y += 0.56 * c; tool.z += 0.16 * c;

    // Release: a lunge and follow-through, then settle.
    if (this.throwT > 0) {
      const e = Math.sin(Math.PI * Math.min(1, (0.5 - this.throwT) / 0.5)) * this.throwPower;
      T.spine.z += -0.55 * e; T.spine.y += 0.45 * e; hp.x += 0.05 * e;
      T.armR.z += 2.1 * e; T.armL.z += 1.2 * e; mouth = Math.max(mouth, e * 0.7);
    }
    if (this.pickT > 0) {
      const e = Math.sin(Math.PI * this.pickT / 0.32);
      T.spine.z += -0.32 * e; hp.y -= 0.05 * e; T.head.z += 0.1 * e;
    }

    // Slap swing: wind the paw out and back (first 22%), then whip it forward and across the body with a twist and a
    // small lunge; the other paw tucks in. Springs carry the overshoot.
    if (this.slapT > 0) {
      const k = 1 - this.slapT / SLAP_SWING, side = this.slapSide, arm = side < 0 ? 'armL' : 'armR', other = side < 0 ? 'armR' : 'armL';
      const wind = k < 0.22 ? Math.sin(k / 0.22 * Math.PI / 2) : Math.max(0, 1 - (k - 0.22) / 0.14);
      const p = clamp((k - 0.22) / 0.78, 0, 1), strike = k < 0.22 ? 0 : Math.sin(Math.min(1, p * 1.6) * Math.PI / 2) * (1 - p * p);
      T[arm].x += -side * (1.4 * wind + (1.1 - 1.7 * p) * strike); T[arm].z += -0.5 * wind + 2.2 * strike;
      T[other].z += 0.5 * strike; T[other].x += side * 0.2 * strike;
      T.spine.y += side * (0.45 * wind - 0.6 * strike); T.spine.z += 0.12 * wind - 0.3 * strike; T.head.z += 0.12 * strike;
      hp.x += 0.07 * strike - 0.02 * wind;
      mouth = Math.max(mouth, 0.65 * strike); squint = Math.min(squint, 1 - 0.35 * strike); earBack += 0.4 * strike;
    }
    // Goose flap: wings flung up high, then driven down hard past the body (one beat), spine arching with it.
    if (this.flapT > 0) {
      const k = 1 - this.flapT / FLAP_BEAT, up = k < 0.3 ? Math.sin(k / 0.3 * Math.PI / 2) : 0, down = k < 0.3 ? 0 : Math.sin((k - 0.3) / 0.7 * Math.PI);
      for (const [s, sign] of SIDES) { T[`arm${s}`].x += -sign * (2.6 * up - 0.6 * down); T[`arm${s}`].z += 0.3 * up - 0.5 * down; }
      T.spine.z += 0.15 * up - 0.1 * down; hp.y += 0.04 * down; earBack += 0.5 * down;
    }
    // Slapped: a sharp hit decaying fast (the shove lean itself comes from the push blend above).
    if (this.hitT > 0) {
      const e = (this.hitT / HIT_REACT) ** 1.5, side = this.hitSide;
      T.spine.z += 0.4 * e; T.head.z += 0.35 * e; T.head.y += side * 0.55 * e; T.head.x += side * 0.25 * e;
      for (const [s, sign] of SIDES) { T[`arm${s}`].x += -sign * 1.0 * e; T[`arm${s}`].z += 0.6 * e; }
      squint = Math.min(squint, 1 - 0.95 * e); mouth = Math.max(mouth, 0.9 * e); earBack += 1.3 * e;
    }

    // Knocked off the truck: full ragdoll flop while the shared lean group tumbles.
    const f = B.fall;
    for (const [side, s] of SIDES) {
      T[`arm${side}`].x += -s * (1.4 + Math.sin(t * 9 + s) * 0.8) * f;
      T[`arm${side}`].z += Math.sin(t * 11 + s * 2) * 1.2 * f;
      T[`leg${side}`].z += Math.sin(t * 10 + s * 1.7) * 1.0 * f;
    }
    T.spine.z += Math.sin(t * 6) * 0.4 * f; T.head.z += Math.sin(t * 7.3) * 0.5 * f;
    for (let i = 0; i < 4; i++) T[`tail${i}`].z += Math.sin(t * 8 - i) * 0.5 * f;
    squint = Math.min(squint, 1 - 0.85 * f); mouth = Math.max(mouth, f); earBack += f;

    // Ears: flatten when stressed, flop from head motion, occasional twitch.
    const head = this.springs.head;
    for (const [side, s] of SIDES) {
      const ear = T[`ear${side}`];
      ear.z += 0.85 * Math.min(1, earBack) - head.v.z * 0.045;
      ear.x += s * 0.25 * Math.min(1, earBack) - head.v.x * 0.05;
    }
    // Squirrel tail flick: a sudden whip running up the plume while standing about.
    if (this.flick && (this.flickIn -= dt) <= 0) {
      this.flickIn = 1.2 + Math.random() * 2.8;
      if (grounded) { this.springs.tail0.v.z -= 8; this.springs.tail1.v.z += 10; this.springs.tail2.v.z -= 9; this.springs.tail3.v.z += 7; }
    }
    if ((this.twitchIn -= dt) <= 0) {
      this.twitchIn = 1.8 + Math.random() * 4;
      const ear = this.springs[Math.random() < 0.5 ? 'earL' : 'earR'];
      ear.v.x += (Math.random() - 0.5) * 30; ear.v.y += (Math.random() - 0.5) * 20;
    }
    // The tail inherits body motion: whips opposite to hip roll and turns.
    T.tail1.y += -this.springs.hips.x.x * 0.8 - clamp(ctx.yawRate * 0.12, -0.6, 0.6);

    if (this.bones.jaw) this.beakTargets(T, hp, dt);

    // Step springs and write transforms.
    for (const [name, spring] of Object.entries(this.springs)) {
      spring.step(T[name], dt);
      this.bones[name].rotation.set(spring.x.x, spring.x.y, spring.x.z);
    }
    this.hipsSpring.step(hp, dt);
    this.bones.hips.position.copy(this.hipsBind).add(this.hipsSpring.x);
    if (this.trunkSprings) this.poseTrunk(ctx, dt, t);

    // Face: blinks, squints, mouth.
    if ((this.blinkIn -= dt) <= 0) { this.blinkIn = 2 + Math.random() * 3.5; this.blinkT = 0.14; }
    this.blinkT = Math.max(0, this.blinkT - dt);
    const blink = this.blinkT > 0 ? Math.abs(this.blinkT / 0.07 - 1) : 1;
    const eyeY = Math.max(0.08, Math.min(blink, squint));
    for (const side of ['L', 'R']) this.bones[`eye${side}`].scale.set(1, eyeY, 1 + (1 - eyeY) * 0.15);
    this.mouth = damp(this.mouth, mouth, 14, dt);
    this.bones.mouth.scale.set(1, 0.25 + this.mouth * 1.5, 0.7 + this.mouth * 0.5);
    if (this.bones.jaw) this.poseBeak(ctx, dt, t);

    return tool;
  }

  /** Elephant trunk: idle sway and curl, swinging with the gait, flopping when falling; raised forward to spray with a recoil chatter. */
  poseTrunk(ctx, dt, t) {
    const B = this.blend, tj = B.trunk, m = B.move, rest = (1 - tj);
    this.trunkSprings.forEach((spring, i) => {
      const target = this.trunkTarget.set(0, 0, 0);
      target.z += Math.sin(t * 1.6 + this.seed * 3 - i * 0.7) * 0.09 * rest + (i === 3 ? 0.22 : 0.04) * rest;
      target.y += Math.sin(t * 1.05 + this.seed * 5 - i * 0.55) * 0.13 * rest;
      target.y += Math.sin(this.phase * 0.5 - i * 0.6) * 0.16 * m * rest; target.z += 0.12 * m * rest;
      target.z += (0.35 * B.air - 0.2 * B.fall + Math.sin(t * 9 - i) * 0.4 * B.fall) * rest;
      target.z += TRUNK_RAISE[i] * tj + Math.sin(t * 38 + i * 1.1) * 0.05 * tj;
      target.y += Math.sin(t * 23 + i) * 0.03 * tj;
      // The head's own swing drags the trunk behind it.
      target.z -= this.springs.head.v.z * 0.02 * (i + 1) * rest; target.y -= this.springs.head.v.y * 0.02 * (i + 1);
      spring.step(target, dt);
      this.bones[`trunk${i}`].rotation.set(spring.x.x, spring.x.y, spring.x.z);
    });
  }

  /** Arms reach for the tool's grip points (two-bone-free: aim + stretch, with paw counter-scale). */
  solveArms(toolMesh, kind) {
    const weight = this.blend.hold, grips = toolMesh && GRIPS[kind];
    for (const [side] of SIDES) {
      const arm = this.bones[`arm${side}`], paw = this.bones[`paw${side}`];
      if (!grips || weight < 0.01) { arm.scale.set(1, this.armReach, 1); paw.scale.set(1, 1 / this.armReach, 1); continue; }
      const target = toolMesh.localToWorld(this._target.copy(grips[side]));
      arm.parent.worldToLocal(target);
      const dir = this._dir.copy(target).sub(arm.position), dist = dir.length();
      this._q.setFromUnitVectors(DOWN, dir.normalize());
      arm.quaternion.slerp(this._q, weight);
      const stretch = 1 + (clamp(dist / RIG.ARM_LEN, 0.75, 2.1) - 1) * weight;
      arm.scale.set(1, stretch, 1); paw.scale.set(1, 1 / stretch, 1);
    }
  }
}

const DOWN = new THREE.Vector3(0, -1, 0);
