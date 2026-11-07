/**
 * Procedural plush boxer kangaroo on the shared skeleton, fur material and animator: a bottom-heavy pear body with a
 * pale belly and a little pouch, a smallish head with a long snout, tall upright ears, short forearms in red boxing
 * gloves, big haunches with long feet and a thick tapering tail that rests near the ground behind (the jump spring:
 * `tailJump` makes the shared animator slam it down on take-off). All four breeds share one topology; selection only
 * swaps prepared vertex colors plus the ear size and drawn body size (presentation only: hit volumes are unchanged).
 */
import * as THREE from 'three';
import { CatModel, SkinBuilder, sphere, smooth, hash, addTail, addCollar, ARM_X, ARM_Y, ARM_Z, ARM_LEN } from '../cat/CatModel.js';

/** dark: back, snout tip and tail tip; ears: ear size; size: drawn body size (the wallaby is a little smaller). */
export const KANGAROO_COATS = {
  red: {
    base: '#cf6a3c', dark: '#97462a', belly: '#fbe9d4', inner: '#f2aaa2', nose: '#3a2a2e', eye: '#2a2230',
    ears: 1, size: 1,
  },
  grey: {
    base: '#a19a94', dark: '#6c6560', belly: '#f3eee6', inner: '#eeaaaa', nose: '#33292e', eye: '#2a2230',
    ears: 1.04, size: 1,
  },
  wallaby: {
    base: '#cfa577', dark: '#7d5b40', belly: '#fbf0de', inner: '#f2b5a6', nose: '#3d2c2a', eye: '#2a2230',
    ears: 0.9, size: 0.9,
  },
  albino: {
    base: '#f7f1e8', dark: '#e2d5c6', belly: '#fffbf5', inner: '#f7a3b6', nose: '#f095a6', eye: '#7c3446',
    ears: 1, size: 1,
  },
};

const HEAD_C = new THREE.Vector3(0.05, 0.74, 0);
const HEAD_R = new THREE.Vector3(0.235, 0.225, 0.255);
// Long snout reaching well past the face.
const MUZZLE_C = new THREE.Vector3(HEAD_C.x + 0.215, HEAD_C.y - 0.065, 0);
const MUZZLE_R = new THREE.Vector3(0.15, 0.085, 0.098);
const MOUTH = new THREE.Vector3(MUZZLE_C.x + 0.115, MUZZLE_C.y - 0.055, 0);
const EYE_Y = 0.045, EYE_Z = 0.115;
// Thick tail from the hips sweeping back and down, its tip lifting just off the ground.
const KANGAROO_TAIL = [[-0.17, 0.25], [-0.33, 0.17], [-0.48, 0.1], [-0.62, 0.075], [-0.74, 0.1]].map(([x, y]) => new THREE.Vector3(x, y, 0));
// Boxing guard: gloves raised in front of the chest, ahead of the paw bones.
const GLOVE = (s) => [ARM_X + 0.12, ARM_Y - ARM_LEN + 0.08, (ARM_Z + 0.025) * s];
const GLOVE_RED = '#e23a3c', GLOVE_SHADE = '#b92a31', CUFF = '#fff8ee';

function earOrigin(s) { return [HEAD_C.x - 0.05, HEAD_C.y + 0.16, 0.12 * s]; }
const EAR_TILT = (s) => [0.2 * s, 0, 0.12];

/** A point on the head ellipsoid in direction (dy, dz) from the front, `lift` along its normal. */
function onHead(dy, dz, lift) {
  const dx = HEAD_R.x * Math.sqrt(Math.max(0, 1 - (dy / HEAD_R.y) ** 2 - (dz / HEAD_R.z) ** 2));
  const normal = new THREE.Vector3(dx / HEAD_R.x ** 2, dy / HEAD_R.y ** 2, dz / HEAD_R.z ** 2).normalize();
  return { point: new THREE.Vector3(HEAD_C.x + dx, HEAD_C.y + dy, dz).addScaledVector(normal, lift), normal };
}

function kangarooPainter(coat) {
  const base = new THREE.Color(coat.base), dark = new THREE.Color(coat.dark), belly = new THREE.Color(coat.belly), out = new THREE.Color();
  const mix = (darkAmount, bellyAmount) => out.copy(base).lerp(dark, Math.min(1, darkAmount)).lerp(belly, Math.min(1, bellyAmount));
  return {
    body: (p, n) => {
      const wobble = (hash(Math.round(p.x * 40), Math.round(p.y * 40), Math.round(p.z * 40)) - 0.5) * 0.1;
      const front = smooth(0.2, 0.65, n.x + wobble) * smooth(0.12, 0.2, p.y), under = smooth(-0.3, -0.75, n.y);
      return mix(smooth(0.1, -0.6, n.x) * 0.3, Math.max(front, under) * 0.95);
    },
    head: (p, n) => {
      const local = p.clone().sub(HEAD_C);
      const lower = smooth(-0.03, -0.12, local.y) * smooth(0.1, 0.6, n.x), throat = smooth(-0.35, -0.7, n.y);
      return mix(smooth(0.5, 0.9, n.y) * 0.22, Math.max(lower, throat) * 0.9);
    },
    // Pale snout with a darker bridge toward the nose.
    muzzle: (p, n) => mix(smooth(0.4, 0.9, n.y) * smooth(-0.02, 0.08, p.x - MUZZLE_C.x) * 0.45, 0.55 * smooth(0.6, -0.2, n.y)),
    // The pouch: pale fur with a darker lip along its upper rim.
    pouch: (p, n) => mix(smooth(0.42, 0.62, n.y) * 1.2, 0.95 * smooth(0.6, 0.35, n.y)),
    limb: (p, n) => mix(smooth(0.1, -0.5, n.x) * 0.25, smooth(0.3, 0.9, n.x) * 0.35),
    foot: () => mix(0.3, 0.15).getHex(),
    // Dark tip on the tail, the back of it a shade darker than the body.
    tail: (t) => mix(0.15 + 0.75 * smooth(0.7, 1, t), 0),
    ear: () => mix(0.2, 0).getHex(),
    earTip: () => mix(0.8, 0).getHex(),
  };
}

function buildFurGeometry(index, coat) {
  const paint = kangarooPainter(coat);
  const b = new SkinBuilder(index);
  // Bottom-heavy pear: broad hips, a narrower chest.
  const profile = [[0, 0.1], [0.11, 0.11], [0.19, 0.14], [0.24, 0.19], [0.255, 0.25], [0.24, 0.32], [0.205, 0.4], [0.168, 0.47], [0.122, 0.525], [0.05, 0.562], [0, 0.57]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  b.add(new THREE.LatheGeometry(profile, 40), {
    s: [0.95, 1, 0.95], color: paint.body,
    fur: (p, n) => 0.85 + smooth(0.3, 0.8, n.x) * 0.2,
    weights: (p) => { const w = smooth(0.24, 0.46, p.y); return [['hips', 1 - w], ['spine', w]]; },
  });
  // The pouch on the lower belly.
  b.add(sphere(20, 14), { bone: 'hips', p: [0.185, 0.195, 0], s: [0.095, 0.09, 0.145], color: paint.pouch, fur: 0.4 });
  b.add(sphere(40, 28), {
    bone: 'head', p: HEAD_C.toArray(), s: HEAD_R.toArray(), color: paint.head,
    fur: (p, n) => 0.5 + 0.5 * smooth(0.7, 0.1, n.x) - 0.15 * smooth(0.8, 1, n.x),
  });
  b.add(sphere(26, 18), { bone: 'head', p: MUZZLE_C.toArray(), s: MUZZLE_R.toArray(), color: paint.muzzle, fur: 0.3 });
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    // Tall upright ears with darker tips; the ear bone scale sets each breed's ear size.
    const ear = sphere(16, 12).translate(0, 1, 0).scale(0.042, 0.17, 0.075);
    b.add(ear, { bone: `ear${side}`, p: earOrigin(s), r: EAR_TILT(s), color: (p) => (p.y > HEAD_C.y + 0.4 ? paint.earTip() : paint.ear()), fur: 0.45 });
    // Short forearms reaching forward into the gloves (drawn as details).
    const shoulder = new THREE.Vector3(ARM_X, ARM_Y, ARM_Z * s), glove = new THREE.Vector3(...GLOVE(s));
    const mid = shoulder.clone().lerp(glove, 0.45), dir = glove.clone().sub(shoulder).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.negate());
    b.add(new THREE.CapsuleGeometry(0.046, 0.1, 6, 12), { bone: `arm${side}`, p: mid.toArray(), r: new THREE.Euler().setFromQuaternion(q).toArray().slice(0, 3), color: paint.limb, fur: 0.8 });
    // Big haunches and long hind feet.
    b.add(sphere(22, 16), { bone: `leg${side}`, p: [-0.02, 0.19, 0.14 * s], s: [0.15, 0.14, 0.1], color: paint.limb, fur: 0.85 });
    b.add(sphere(20, 12), { bone: `foot${side}`, p: [0.075, 0.042, 0.125 * s], s: [0.175, 0.045, 0.07], color: paint.foot(), fur: 0.45 });
  }
  // The spring tail: thick at the root, tapering to a dark tip.
  addTail(b, KANGAROO_TAIL, { radius: (t) => 0.095 - 0.068 * t, color: paint.tail, fur: 0.55 });
  b.add(sphere(12, 8), { bone: 'tail3', p: KANGAROO_TAIL.at(-1).toArray(), s: [0.028, 0.028, 0.028], color: paint.tail(1).getHex(), fur: 0.5 });
  return b.build();
}

/** Glossy details: eyes, inner ears, the nose, mouth, red boxing gloves with white cuffs and the player-colored collar with a champion medal. */
function buildDetailGeometry(index, coat, accent) {
  const b = new SkinBuilder(index);
  const eyes = {};
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    const { point, normal } = onHead(EYE_Y, EYE_Z * s, 0.012);
    eyes[side] = point;
    const r = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), normal)).toArray().slice(0, 3);
    b.add(sphere(20, 16), { bone: `eye${side}`, p: point.toArray(), r, s: [0.03, 0.058, 0.048], color: coat.eye });
    const glint = point.clone().addScaledVector(normal, 0.024).add(new THREE.Vector3(0, 0.022, -0.013 * s));
    b.add(sphere(10, 8), { bone: `eye${side}`, p: glint.toArray(), s: [0.013, 0.017, 0.014], color: '#ffffff' });
    const glint2 = point.clone().addScaledVector(normal, 0.024).add(new THREE.Vector3(0, -0.019, 0.011 * s));
    b.add(sphere(8, 6), { bone: `eye${side}`, p: glint2.toArray(), s: [0.006, 0.007, 0.007], color: '#ffffff' });
    const [ex, ey, ez] = earOrigin(s);
    b.add(sphere(12, 10).translate(0, 1, 0).scale(0.012, 0.13, 0.05), { bone: `ear${side}`, p: [ex + 0.05, ey + 0.02, ez], r: EAR_TILT(s), color: coat.inner });
    // Boxing glove: a round mitt, a thumb hugging its inner side and a white cuff at the wrist.
    const paw = `paw${side}`, g = GLOVE(s);
    b.add(sphere(20, 14), { bone: paw, p: g, s: [0.096, 0.088, 0.08], color: (p, n) => (n.y < -0.55 ? GLOVE_SHADE : GLOVE_RED) });
    b.add(sphere(12, 8), { bone: paw, p: [g[0] + 0.02, g[1] + 0.04, g[2] - 0.056 * s], s: [0.044, 0.034, 0.032], color: GLOVE_RED });
    b.add(new THREE.CylinderGeometry(0.05, 0.054, 0.042, 16, 1), { bone: paw, p: [g[0] - 0.078, g[1] + 0.035, g[2] + 0.005 * s], r: [0, 0, 0.95], color: CUFF });
  }
  b.add(sphere(14, 10), { bone: 'head', p: [MUZZLE_C.x + MUZZLE_R.x - 0.004, MUZZLE_C.y + 0.03, 0], s: [0.03, 0.026, 0.044], color: coat.nose });
  b.add(sphere(14, 10), { bone: 'mouth', p: MOUTH.toArray(), s: [0.014, 0.016, 0.03], color: '#5b2f3a' });
  // Collar with a flat gold medal for the champ.
  const collar = addCollar(b, accent, [0.014, 0.042, 0.042]);
  return { geometry: b.build(), eyes, ...collar };
}

export const KANGAROO = {
  id: 'kangaroo', coats: KANGAROO_COATS, earOrigin, tail: KANGAROO_TAIL, mouth: MOUTH,
  buildFur: buildFurGeometry, buildDetail: buildDetailGeometry,
  // Bouncy: a slow sway of the heavy tail at rest, a springy hop cadence and every jump launched off the tail.
  idleWag: 1.1, cadence: 1.1, tailJump: 1, colors: new Map(),
};

export class KangarooModel extends CatModel {
  constructor({ coat = KANGAROO_COATS.red, ...options } = {}) {
    super({ ...options, species: KANGAROO, coat });
    this.setBreedShape(coat);
  }

  setAppearance(breed, accent) {
    super.setAppearance(breed, accent);
    if (KANGAROO_COATS[breed]) this.setBreedShape(KANGAROO_COATS[breed]);
  }

  setBreedShape({ ears, size }) {
    this.bones.earL.scale.setScalar(ears); this.bones.earR.scale.setScalar(ears);
    this.group.scale.setScalar(size);
  }
}
