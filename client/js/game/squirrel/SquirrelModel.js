/**
 * Procedural plush squirrel on the shared skeleton, fur material and animator: a small pear body with a cream belly,
 * a round head with chubby cheek pouches, a short snout with buck teeth, tall pointed ears and a huge bushy tail that
 * sweeps up behind the back and curls over at the top. All four breeds share one topology; selection only swaps
 * prepared vertex colors and the ear size. The whole model is drawn at SQUIRREL_BODY scale while the tail keeps its
 * full size, so a small squirrel carries a huge plume (presentation only: shared motion and hit volumes are unchanged).
 */
import * as THREE from 'three';
import { CatModel, SkinBuilder, sphere, smooth, hash, addTail, addCollar, ARM_X, ARM_Y, ARM_Z, ARM_LEN } from '../cat/CatModel.js';

/** stripes: chipmunk back stripes, mask: dark stripe through the eyes, ring: pale eye ring, ears: ear size. */
export const SQUIRREL_COATS = {
  red: {
    base: '#d9733a', dark: '#a9512a', belly: '#fff0da', inner: '#f2b3a3', nose: '#e2868c', eye: '#2a2230',
    stripes: 0, mask: 0, ring: 0.65, ears: 1.1,
  },
  grey: {
    base: '#9ea1a9', dark: '#6f727c', belly: '#f8f5ef', inner: '#f0b3b4', nose: '#d98b94', eye: '#2a2230',
    stripes: 0, mask: 0, ring: 0.8, ears: 1, warm: '#b49378',
  },
  chipmunk: {
    base: '#cf8f53', dark: '#4b3527', belly: '#fff3e2', inner: '#f3b6a6', nose: '#d9878c', eye: '#2a2230',
    stripes: 1, mask: 1, ring: 0.9, ears: 0.92,
  },
  black: {
    base: '#4b434a', dark: '#2e2a31', belly: '#7c665a', inner: '#e3a3aa', nose: '#d58891', eye: '#18141c',
    stripes: 0, mask: 0, ring: 0.55, ears: 1.05,
  },
};

/** Drawn body size relative to the other animals; the tail root bone gets the inverse so the plume stays full size. */
export const SQUIRREL_BODY = 0.8;

const HEAD_C = new THREE.Vector3(0.05, 0.71, 0);
const HEAD_R = new THREE.Vector3(0.27, 0.25, 0.3);
const MUZZLE_C = new THREE.Vector3(HEAD_C.x + HEAD_R.x - 0.07, HEAD_C.y - 0.075, 0);
const MUZZLE_R = new THREE.Vector3(0.1, 0.078, 0.1);
const MOUTH = new THREE.Vector3(MUZZLE_C.x + 0.085, MUZZLE_C.y - 0.045, 0);
const EYE_Y = 0.03, EYE_Z = 0.118;
// The bushy tail rises from the hips behind the back and curls forward at the top, clear of the head.
const SQUIRREL_TAIL = [[-0.2, 0.24], [-0.4, 0.31], [-0.5, 0.52], [-0.48, 0.79], [-0.33, 0.97]].map(([x, y]) => new THREE.Vector3(x, y, 0));

function earOrigin(s) { return [HEAD_C.x - 0.06, HEAD_C.y + 0.18, 0.15 * s]; }
const EAR_TILT = (s) => [0.24 * s, 0, 0.06];

/** A point on the head ellipsoid in direction (dy, dz) from the front, `lift` along its normal. */
function onHead(dy, dz, lift) {
  const dx = HEAD_R.x * Math.sqrt(Math.max(0, 1 - (dy / HEAD_R.y) ** 2 - (dz / HEAD_R.z) ** 2));
  const normal = new THREE.Vector3(dx / HEAD_R.x ** 2, dy / HEAD_R.y ** 2, dz / HEAD_R.z ** 2).normalize();
  return { point: new THREE.Vector3(HEAD_C.x + dx, HEAD_C.y + dy, dz).addScaledVector(normal, lift), normal };
}

function squirrelPainter(coat) {
  const base = new THREE.Color(coat.base), dark = new THREE.Color(coat.dark), belly = new THREE.Color(coat.belly);
  const warm = new THREE.Color(coat.warm || coat.base), out = new THREE.Color();
  const mix = (darkAmount, bellyAmount) => out.copy(base).lerp(dark, Math.min(1, darkAmount)).lerp(belly, Math.min(1, bellyAmount));
  const spot = (y, z, cy, cz, size) => Math.exp(-((y - cy) ** 2 + (z - cz) ** 2) / size);
  return {
    body: (p, n) => {
      const wobble = (hash(Math.round(p.x * 40), Math.round(p.y * 40), Math.round(p.z * 40)) - 0.5) * 0.1;
      const front = smooth(0.25, 0.7, n.x + wobble) * smooth(0.12, 0.2, p.y), under = smooth(-0.3, -0.75, n.y);
      const back = smooth(0.1, -0.5, n.x);
      // Chipmunk: dark and pale stripes running down the back.
      const lines = coat.stripes * back * smooth(0.18, 0.3, p.y) * smooth(0.56, 0.46, p.y);
      const z = Math.abs(p.z), darkLine = Math.exp(-(z ** 2) / 0.0012) + Math.exp(-((z - 0.12) ** 2) / 0.0012), paleLine = Math.exp(-((z - 0.065) ** 2) / 0.0006);
      return mix(back * 0.22 + lines * darkLine * 0.9, Math.max(front, under) * 0.95 + lines * paleLine * 0.8);
    },
    head: (p, n) => {
      const local = p.clone().sub(HEAD_C), front = smooth(0.3, 0.7, n.x);
      const lower = smooth(-0.02, -0.11, local.y) * smooth(0.15, 0.6, n.x), throat = smooth(-0.35, -0.7, n.y);
      let ring = 0, eyes = 0;
      for (const s of [-1, 1]) {
        const d = spot(local.y, local.z, EYE_Y, EYE_Z * s, 0.0042) * front, core = spot(local.y, local.z, EYE_Y, EYE_Z * s, 0.0016) * front;
        ring = Math.max(ring, d - core * 0.8); eyes = Math.max(eyes, core);
      }
      // Chipmunk face: a dark stripe through each eye under a pale brow.
      const stripe = coat.mask * smooth(0.0, 0.5, n.x) * Math.exp(-((local.y - EYE_Y) ** 2) / 0.0012) * smooth(0.04, 0.09, Math.abs(local.z));
      const brow = coat.mask * smooth(0.0, 0.5, n.x) * Math.exp(-((local.y - EYE_Y - 0.06) ** 2) / 0.0008) * smooth(0.04, 0.09, Math.abs(local.z));
      const crown = smooth(0.5, 0.9, n.y) * 0.25 + coat.mask * Math.exp(-(local.z ** 2) / 0.002) * smooth(0.3, 0.8, n.y) * 0.6;
      return mix(crown + stripe * 0.85, Math.max((lower + throat) * 0.95, ring * coat.ring, brow * 0.9));
    },
    muzzle: (p, n) => mix(0, 0.85 - smooth(0.6, 1, n.y) * 0.4),
    cheek: () => mix(0, 0.75).getHex(),
    limb: (p, n) => coat.warm ? out.copy(warm).lerp(base, smooth(-0.4, 0.4, n.y)) : mix(smooth(0.1, -0.4, n.x) * 0.25, 0),
    foot: () => mix(0.1, 0.35).getHex(),
    // Frosted bushy tail: darker core along the middle, paler toward the plume.
    tail: (t) => mix(0.35 * (1 - smooth(0.2, 0.9, t)) + 0.15 * smooth(0.6, 0.85, Math.sin(t * 22) * 0.5 + 0.5), smooth(0.75, 1, t) * 0.18),
    ear: () => mix(0.15, 0).getHex(),
  };
}

function buildFurGeometry(index, coat) {
  const paint = squirrelPainter(coat);
  const b = new SkinBuilder(index);
  // A slightly smaller pear body than the cat's.
  const profile = [[0, 0.1], [0.1, 0.112], [0.17, 0.14], [0.222, 0.19], [0.243, 0.26], [0.236, 0.33], [0.21, 0.41], [0.172, 0.48], [0.125, 0.53], [0.05, 0.565], [0, 0.572]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  b.add(new THREE.LatheGeometry(profile, 40), {
    s: [0.9, 0.97, 0.92], color: paint.body,
    fur: (p, n) => 1 + smooth(0.3, 0.8, n.x) * 0.3,
    weights: (p) => { const w = smooth(0.24, 0.46, p.y); return [['hips', 1 - w], ['spine', w]]; },
  });
  b.add(sphere(20, 14), { bone: 'spine', p: [0.14, 0.42, 0], s: [0.07, 0.09, 0.11], color: coat.belly, fur: 1.4 });
  b.add(sphere(40, 28), {
    bone: 'head', p: HEAD_C.toArray(), s: HEAD_R.toArray(), color: paint.head,
    fur: (p, n) => 0.5 + 0.6 * smooth(0.7, 0.1, n.x) - 0.15 * smooth(0.8, 1, n.x),
  });
  // Short snout and chubby cheek pouches.
  b.add(sphere(26, 18), { bone: 'head', p: MUZZLE_C.toArray(), s: MUZZLE_R.toArray(), color: paint.muzzle, fur: 0.3 });
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    b.add(sphere(18, 12), { bone: 'head', p: [HEAD_C.x + 0.1, HEAD_C.y - 0.1, 0.16 * s], s: [0.11, 0.095, 0.105], color: paint.cheek(), fur: 1.15 });
    // Tall pointed ears; the ear bone scale sets each breed's ear size.
    b.add(new THREE.ConeGeometry(0.1, 0.22, 14, 1).translate(0, 0.1, 0), { bone: `ear${side}`, p: earOrigin(s), r: EAR_TILT(s), s: [0.55, 1, 1], color: paint.ear(), fur: 0.45 });
    const shoulder = [ARM_X, ARM_Y, (ARM_Z - 0.01) * s];
    b.add(new THREE.CapsuleGeometry(0.05, 0.12, 6, 14), { bone: `arm${side}`, p: [shoulder[0], shoulder[1] - 0.09, shoulder[2]], color: paint.limb, fur: 0.85 });
    b.add(sphere(18, 12), { bone: `paw${side}`, p: [shoulder[0], shoulder[1] - ARM_LEN, shoulder[2]], s: [0.058, 0.054, 0.058], color: paint.foot(), fur: 0.5 });
    // Strong hind legs with long feet for leaping.
    b.add(new THREE.CapsuleGeometry(0.078, 0.06, 6, 14), { bone: `leg${side}`, p: [0, 0.16, 0.115 * s], color: paint.limb, fur: 0.9 });
    b.add(sphere(20, 12), { bone: `foot${side}`, p: [0.05, 0.06, 0.115 * s], s: [0.125, 0.055, 0.072], color: paint.foot(), fur: 0.5 });
  }
  // The signature bushy tail: thin at the root, swelling into a big plume with long fur.
  addTail(b, SQUIRREL_TAIL, { radius: (t) => 0.055 + 0.105 * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.62) + 0.02 * t, color: paint.tail, fur: 1.75 });
  b.add(sphere(16, 12), { bone: 'tail3', p: SQUIRREL_TAIL.at(-1).toArray(), s: [0.13, 0.12, 0.13], color: paint.tail(1).getHex(), fur: 1.8 });
  return b.build();
}

/** Glossy details: big eyes, inner ears, a pink nose, mouth, two buck teeth and the player-colored collar with an acorn charm. */
function buildDetailGeometry(index, coat, accent) {
  const b = new SkinBuilder(index);
  const eyes = {};
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    const { point, normal } = onHead(EYE_Y, EYE_Z * s, 0.012);
    eyes[side] = point;
    const r = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), normal)).toArray().slice(0, 3);
    b.add(sphere(20, 16), { bone: `eye${side}`, p: point.toArray(), r, s: [0.032, 0.062, 0.052], color: coat.eye });
    const glint = point.clone().addScaledVector(normal, 0.026).add(new THREE.Vector3(0, 0.024, -0.014 * s));
    b.add(sphere(10, 8), { bone: `eye${side}`, p: glint.toArray(), s: [0.014, 0.018, 0.015], color: '#ffffff' });
    const glint2 = point.clone().addScaledVector(normal, 0.026).add(new THREE.Vector3(0, -0.02, 0.012 * s));
    b.add(sphere(8, 6), { bone: `eye${side}`, p: glint2.toArray(), s: [0.006, 0.007, 0.007], color: '#ffffff' });
    const [ex, ey, ez] = earOrigin(s);
    b.add(new THREE.ConeGeometry(0.065, 0.15, 12, 1).translate(0, 0.075, 0), { bone: `ear${side}`, p: [ex + 0.028, ey + 0.005, ez], r: EAR_TILT(s), s: [0.3, 1, 1], color: coat.inner });
    // Buck teeth: two little white tiles under the nose.
    b.add(new THREE.BoxGeometry(0.014, 0.034, 0.02), { bone: 'head', p: [MOUTH.x + 0.004, MOUTH.y - 0.022, 0.012 * s], color: '#fffdf6' });
  }
  b.add(sphere(14, 10), { bone: 'head', p: [MUZZLE_C.x + 0.098, MUZZLE_C.y + 0.03, 0], s: [0.024, 0.02, 0.032], color: coat.nose });
  b.add(sphere(14, 10), { bone: 'mouth', p: MOUTH.toArray(), s: [0.014, 0.018, 0.026], color: '#5b2f3a' });
  const collar = addCollar(b, accent, [0.03, 0.036, 0.03]);
  // Acorn cap on the charm.
  b.add(sphere(10, 8), { bone: 'spine', p: [0.19, 0.49, 0], s: [0.034, 0.016, 0.034], color: '#8a5a35' });
  return { geometry: b.build(), eyes, ...collar };
}

export const SQUIRREL = {
  id: 'squirrel', coats: SQUIRREL_COATS, earOrigin, tail: SQUIRREL_TAIL, mouth: MOUTH,
  buildFur: buildFurGeometry, buildDetail: buildDetailGeometry,
  // Twitchy: a quick tail wave at rest, brisk scrubbing and the odd sudden tail flick. Small legs patter faster,
  // jumps spring off the tail, and the small body leans in to keep touching a wall it clings to.
  idleWag: 2.8, scrubRate: 1.2, flick: 1, cadence: 1.3, tailJump: 1, wallReach: 0.07, colors: new Map(),
};

export class SquirrelModel extends CatModel {
  constructor({ coat = SQUIRREL_COATS.red, ...options } = {}) {
    super({ ...options, species: SQUIRREL, coat });
    this.group.scale.setScalar(SQUIRREL_BODY); this.bones.tail0.scale.setScalar(1 / SQUIRREL_BODY);
    this.setEars(coat.ears);
  }

  setAppearance(breed, accent) {
    super.setAppearance(breed, accent);
    if (SQUIRREL_COATS[breed]) this.setEars(SQUIRREL_COATS[breed].ears);
  }

  setEars(size) { this.bones.earL.scale.setScalar(size); this.bones.earR.scale.setScalar(size); }
}
