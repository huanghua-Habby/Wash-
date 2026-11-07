/**
 * Procedural plush dog on the cat's skeleton, fur material and animator: same chubby body and stubby limbs,
 * plus a muzzle with a big nose, upright ears, a curled-over tail and a tongue that shows when the mouth opens.
 * All four breeds share one topology; selection only swaps prepared vertex colors and the ear size.
 */
import * as THREE from 'three';
import {
  CatModel, SkinBuilder, sphere, smooth, hash, addTail, addCollar, pointOnHead,
  HEAD_C, HEAD_R, ARM_X, ARM_Y, ARM_Z, ARM_LEN,
} from '../cat/CatModel.js';

/**
 * Pattern weights per breed: saddle darkens the back, mask/peak/goggles draw the husky face,
 * urajiro whitens the lower face and throat, brows add pale dots above the eyes, blaze is the corgi stripe.
 */
export const DOG_COATS = {
  corgi: {
    base: '#e8994e', dark: '#c46f35', white: '#fff6ea', inner: '#f3b6a8', nose: '#2b2326', eye: '#2a2230',
    saddle: 0.25, mask: 0, peak: 0, goggles: 0, urajiro: 1, brows: 0, blaze: 1, bib: 1, legWhite: 0.5, tailTip: 0, earDark: 0.15, muzzleTip: 0, ears: 1.28,
  },
  husky: {
    base: '#a1a6b0', dark: '#4b505b', white: '#fbfaf6', inner: '#eeb3b5', nose: '#2b2326', eye: '#4f97d3',
    saddle: 1, mask: 1, peak: 1, goggles: 1, urajiro: 1, brows: 0.6, blaze: 0, bib: 1, legWhite: 0.9, tailTip: 1, earDark: 1, muzzleTip: 0, ears: 1,
  },
  shiba: {
    base: '#e3a056', dark: '#b8743a', white: '#fff5e6', inner: '#f2b3a3', nose: '#2b2326', eye: '#2a2230',
    saddle: 0.35, mask: 0, peak: 0, goggles: 0, urajiro: 1, brows: 1, blaze: 0, bib: 1, legWhite: 0.35, tailTip: 0.6, earDark: 0.2, muzzleTip: 0, ears: 0.9,
  },
  tugou: {
    base: '#d8ad62', dark: '#9c733e', white: '#f6e3bb', inner: '#efb5a2', nose: '#2b2326', eye: '#2a2230',
    saddle: 0.3, mask: 0, peak: 0, goggles: 0, urajiro: 0.75, brows: 0, blaze: 0, bib: 0.85, legWhite: 0.4, tailTip: 0.2, earDark: 0.35, muzzleTip: 0.45, ears: 1.05,
  },
};

const MUZZLE_C = new THREE.Vector3(HEAD_C.x + HEAD_R.x - 0.05, HEAD_C.y - 0.085, 0);
const MUZZLE_R = new THREE.Vector3(0.14, 0.092, 0.125);
const MOUTH = new THREE.Vector3(MUZZLE_C.x + 0.118, MUZZLE_C.y - 0.05, 0);
const EYE_Y = 0.035, EYE_Z = 0.108;
const DOG_TAIL = [[-0.21, 0.27], [-0.31, 0.34], [-0.35, 0.45], [-0.31, 0.55], [-0.22, 0.58]].map(([x, y]) => new THREE.Vector3(x, y, 0));

function earOrigin(s) { return [HEAD_C.x - 0.07, HEAD_C.y + 0.17, 0.165 * s]; }
const EAR_TILT = (s) => [0.38 * s, 0, 0.05];

function dogPainter(coat) {
  const base = new THREE.Color(coat.base), dark = new THREE.Color(coat.dark), white = new THREE.Color(coat.white);
  const out = new THREE.Color();
  const mix = (darkAmount, whiteAmount) => out.copy(base).lerp(dark, Math.min(1, darkAmount)).lerp(white, Math.min(1, whiteAmount));
  const spot = (y, z, cy, cz, size) => Math.exp(-((y - cy) ** 2 + (z - cz) ** 2) / size);
  return {
    body: (p, n) => {
      const wobble = (hash(Math.round(p.x * 40), Math.round(p.y * 40), Math.round(p.z * 40)) - 0.5) * 0.12;
      const bib = smooth(0.45, 0.8, n.x + wobble) * smooth(0.16, 0.24, p.y) * smooth(0.56, 0.44, p.y);
      const belly = smooth(-0.3, -0.75, n.y);
      const saddle = Math.min(1, smooth(0.1, -0.5, n.x) * smooth(0.2, 0.4, p.y) + smooth(0.55, 0.9, n.y) * 0.8);
      return mix(saddle * coat.saddle, Math.max(bib, belly) * coat.bib);
    },
    head: (p, n) => {
      const local = p.clone().sub(HEAD_C), front = smooth(0.3, 0.7, n.x);
      const lower = smooth(0.0, -0.09, local.y) * smooth(0.1, 0.55, n.x), throat = smooth(-0.35, -0.7, n.y);
      let eyes = 0, brows = 0;
      for (const s of [-1, 1]) {
        eyes = Math.max(eyes, spot(local.y, local.z, EYE_Y, EYE_Z * s, 0.0035) * front);
        brows = Math.max(brows, spot(local.y, local.z, 0.105, 0.085 * s, 0.0006) * front);
      }
      const blaze = Math.exp(-(local.z ** 2) / 0.0015) * front * smooth(-0.05, 0.05, local.y);
      const peak = Math.exp(-(local.z ** 2) / 0.0012) * smooth(0.2, 0.6, n.x) * smooth(0.0, 0.1, local.y);
      const cap = smooth(-0.04, 0.08, local.y);
      const crown = smooth(0.4, 0.9, n.y) * (1 - front) * coat.saddle * 0.45;
      const darkAmount = coat.mask * Math.max(cap * (1 - eyes * coat.goggles), peak * coat.peak) + crown;
      const whiteAmount = Math.max((lower + throat) * coat.urajiro, brows * coat.brows, blaze * coat.blaze, eyes * coat.goggles * 0.9);
      return mix(darkAmount * (1 - brows * coat.brows), whiteAmount);
    },
    muzzle: (p, n) => mix(smooth(0.55, 0.95, n.x) * smooth(-0.2, 0.3, n.y) * coat.muzzleTip, coat.urajiro),
    limb: (p, n) => mix(smooth(0.1, -0.4, n.x) * coat.saddle * 0.3, coat.legWhite),
    tail: (t) => mix(coat.saddle * 0.6 * (1 - t), smooth(0.55, 0.95, t) * coat.tailTip),
    ear: () => mix(coat.earDark, 0).getHex(),
  };
}

function buildFurGeometry(index, coat) {
  const paint = dogPainter(coat);
  const b = new SkinBuilder(index);
  const profile = [[0, 0.1], [0.1, 0.112], [0.17, 0.14], [0.222, 0.19], [0.243, 0.26], [0.236, 0.33], [0.21, 0.41], [0.172, 0.48], [0.125, 0.53], [0.05, 0.565], [0, 0.572]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  b.add(new THREE.LatheGeometry(profile, 40), {
    s: [0.95, 1, 1], color: paint.body,
    fur: (p, n) => 1 + smooth(0.3, 0.8, n.x) * 0.25,
    weights: (p) => { const w = smooth(0.24, 0.46, p.y); return [['hips', 1 - w], ['spine', w]]; },
  });
  b.add(sphere(20, 14), { bone: 'spine', p: [0.15, 0.43, 0], s: [0.08, 0.1, 0.12], color: coat.white, fur: 1.3 });
  b.add(sphere(40, 28), {
    bone: 'head', p: HEAD_C.toArray(), s: HEAD_R.toArray(), color: paint.head,
    fur: (p, n) => 0.55 + 0.6 * smooth(0.7, 0.1, n.x) - 0.15 * smooth(0.8, 1, n.x),
  });
  // Short-furred muzzle that carries the nose and mouth.
  b.add(sphere(28, 18), { bone: 'head', p: MUZZLE_C.toArray(), s: MUZZLE_R.toArray(), color: paint.muzzle, fur: 0.3 });
  for (const s of [-1, 1]) {
    b.add(sphere(18, 12), { bone: 'head', p: [HEAD_C.x + 0.02, HEAD_C.y - 0.08, 0.225 * s], s: [0.09, 0.08, 0.09], color: paint.head, fur: 1.25 });
    // Upright ears, flat front to back; the ear bone scale gives each breed its ear size.
    const side = s < 0 ? 'L' : 'R';
    b.add(new THREE.ConeGeometry(0.13, 0.25, 14, 1).translate(0, 0.11, 0), { bone: `ear${side}`, p: earOrigin(s), r: EAR_TILT(s), s: [0.5, 1, 1], color: paint.ear(), fur: 0.4 });
    const shoulder = [ARM_X, ARM_Y, ARM_Z * s];
    b.add(new THREE.CapsuleGeometry(0.058, 0.12, 6, 14), { bone: `arm${side}`, p: [shoulder[0], shoulder[1] - 0.09, shoulder[2]], color: paint.limb, fur: 0.9 });
    b.add(sphere(18, 12), { bone: `paw${side}`, p: [shoulder[0], shoulder[1] - ARM_LEN, shoulder[2]], s: [0.068, 0.062, 0.066], color: coat.white, fur: 0.55 });
    b.add(new THREE.CapsuleGeometry(0.072, 0.06, 6, 14), { bone: `leg${side}`, p: [0, 0.16, 0.12 * s], color: paint.limb, fur: 0.85 });
    b.add(sphere(20, 12), { bone: `foot${side}`, p: [0.035, 0.068, 0.12 * s], s: [0.1, 0.062, 0.08], color: coat.white, fur: 0.5 });
  }
  // Plump tail curling up over the back.
  addTail(b, DOG_TAIL, { radius: (t) => 0.06 + 0.026 * Math.sin(t * Math.PI), color: paint.tail, fur: 1 });
  b.add(sphere(14, 10), { bone: 'tail3', p: DOG_TAIL.at(-1).toArray(), s: [0.07, 0.07, 0.07], color: paint.tail(1).getHex(), fur: 1 });
  return b.build();
}

/** Glossy details: round eyes, inner ears, nose, mouth with tongue and the player-colored collar with a tag. */
function buildDetailGeometry(index, coat, accent) {
  const b = new SkinBuilder(index);
  const eyes = {};
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    const { point, normal } = pointOnHead(EYE_Y, EYE_Z * s, 0.012);
    eyes[side] = point;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), normal);
    const r = new THREE.Euler().setFromQuaternion(q).toArray().slice(0, 3);
    b.add(sphere(20, 16), { bone: `eye${side}`, p: point.toArray(), r, s: [0.03, 0.052, 0.05], color: coat.eye });
    const glint = point.clone().addScaledVector(normal, 0.024).add(new THREE.Vector3(0, 0.02, -0.014 * s));
    b.add(sphere(10, 8), { bone: `eye${side}`, p: glint.toArray(), s: [0.013, 0.016, 0.015], color: '#ffffff' });
    const glint2 = point.clone().addScaledVector(normal, 0.024).add(new THREE.Vector3(0, -0.018, 0.012 * s));
    b.add(sphere(8, 6), { bone: `eye${side}`, p: glint2.toArray(), s: [0.006, 0.007, 0.007], color: '#ffffff' });
    const [ex, ey, ez] = earOrigin(s);
    b.add(new THREE.ConeGeometry(0.085, 0.17, 12, 1).translate(0, 0.085, 0), { bone: `ear${side}`, p: [ex + 0.03, ey + 0.005, ez], r: EAR_TILT(s), s: [0.3, 1, 1], color: coat.inner });
  }
  b.add(sphere(16, 12), { bone: 'head', p: [MUZZLE_C.x + 0.135, MUZZLE_C.y + 0.033, 0], s: [0.032, 0.03, 0.046], color: coat.nose });
  b.add(sphere(14, 10), { bone: 'mouth', p: MOUTH.toArray(), s: [0.02, 0.022, 0.034], color: '#5b2f3a' });
  b.add(sphere(12, 8), { bone: 'mouth', p: [MOUTH.x + 0.006, MOUTH.y - 0.014, 0], s: [0.018, 0.02, 0.026], color: '#ef8a96' });
  const collar = addCollar(b, accent, [0.036, 0.036, 0.024]);
  return { geometry: b.build(), eyes, ...collar };
}

export const DOG = {
  id: 'dog', coats: DOG_COATS, earOrigin, tail: DOG_TAIL, mouth: MOUTH,
  buildFur: buildFurGeometry, buildDetail: buildDetailGeometry,
  idleWag: 13, scrubRate: 1.5, colors: new Map(),
};

export class DogModel extends CatModel {
  constructor({ coat = DOG_COATS.corgi, ...options } = {}) {
    super({ ...options, species: DOG, coat });
    this.setEars(coat.ears);
  }

  setAppearance(breed, accent) {
    super.setAppearance(breed, accent);
    if (DOG_COATS[breed]) this.setEars(DOG_COATS[breed].ears);
  }

  setEars(size) { this.bones.earL.scale.setScalar(size); this.bones.earR.scale.setScalar(size); }
}
