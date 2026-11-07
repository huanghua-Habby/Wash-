/**
 * Procedural plush baby elephant on the shared skeleton, fur material and animator: a heavy barrel body, a big round
 * head with flappy disc ears on the ear bones, column legs with toenails, a thin tufted tail and a wrinkled trunk on four
 * extra `trunk` bones (plus `trunkTip`, the drawn nozzle). The animator raises the trunk to spray (TrunkSpray).
 * All four breeds share one topology; selection only swaps prepared vertex colors.
 */
import * as THREE from 'three';
import { CatModel, SkinBuilder, sphere, smooth, hash, addTail, ARM_X, ARM_Y, ARM_Z, ARM_LEN } from '../cat/CatModel.js';

export const ELEPHANT_COATS = {
  grey: { base: '#a9b1bc', shade: '#8a929f', belly: '#c6ccd4', inner: '#f0aeb8', blush: '#f2a6b0', tuft: '#5f6570', nail: '#f6efe2', tusk: '#fffaf0', eye: '#2a2230' },
  pink: { base: '#f2bccb', shade: '#df9bb0', belly: '#fbd9e2', inner: '#f47f9c', blush: '#ff8aa5', tuft: '#c46b86', nail: '#fff6ee', tusk: '#fffaf2', eye: '#2a2230' },
  snow: { base: '#efebe4', shade: '#d4cec4', belly: '#fbf9f4', inner: '#f3b2ba', blush: '#f6aeb4', tuft: '#b4ada2', nail: '#ffffff', tusk: '#fff8e8', eye: '#2a2230' },
  sky: { base: '#9dc4e6', shade: '#78a3cd', belly: '#d0e4f5', inner: '#f5b1c2', blush: '#f7a3bb', tuft: '#5a83b0', nail: '#fffaf0', tusk: '#fffaf0', eye: '#2a2230' },
};

const HEAD_C = new THREE.Vector3(0.12, 0.72, 0);
const HEAD_R = new THREE.Vector3(0.235, 0.225, 0.25);
const HEAD_BONE = new THREE.Vector3(0.03, 0.57, 0);
// Bind-pose trunk: hangs from the face and curls slightly forward at the tip.
const TRUNK = [[0.31, 0.68], [0.39, 0.575], [0.43, 0.465], [0.45, 0.37], [0.49, 0.29]].map(([x, y]) => new THREE.Vector3(x, y, 0));
const MOUTH = new THREE.Vector3(HEAD_C.x + 0.17, HEAD_C.y - 0.15, 0);
const ELEPHANT_TAIL = [[-0.27, 0.31], [-0.32, 0.29], [-0.355, 0.255], [-0.37, 0.215], [-0.375, 0.17]].map(([x, y]) => new THREE.Vector3(x, y, 0));

function earOrigin(s) { return [HEAD_C.x - 0.07, HEAD_C.y + 0.03, 0.17 * s]; }

/** A thin disc ear spreading outward from its bone, its outer edge swept back. */
function earGeometry(s, scale = 1) {
  return sphere(24, 16).scale(0.032 * scale, 0.205 * scale, 0.17 * scale).translate(0, -0.015, 0.14 * s).rotateY(-0.32 * s);
}

/** A point on the head ellipsoid in direction (dy, dz) from the front, `lift` along its normal. */
function onHead(dy, dz, lift) {
  const dx = HEAD_R.x * Math.sqrt(Math.max(0, 1 - (dy / HEAD_R.y) ** 2 - (dz / HEAD_R.z) ** 2));
  const normal = new THREE.Vector3(dx / HEAD_R.x ** 2, dy / HEAD_R.y ** 2, dz / HEAD_R.z ** 2).normalize();
  return { point: new THREE.Vector3(HEAD_C.x + dx, HEAD_C.y + dy, dz).addScaledVector(normal, lift), normal };
}

function elephantPainter(coat) {
  const out = new THREE.Color(), base = new THREE.Color(coat.base), shade = new THREE.Color(coat.shade);
  const belly = new THREE.Color(coat.belly), blush = new THREE.Color(coat.blush);
  return {
    body: (p, n) => {
      const wobble = (hash(Math.round(p.x * 30), Math.round(p.y * 30), Math.round(p.z * 30)) - 0.5) * 0.06;
      return out.copy(base).lerp(shade, smooth(0.0, -0.6, n.x) * smooth(0.2, 0.5, p.y) * 0.55 + wobble).lerp(belly, smooth(-0.35, -0.8, n.y) * 0.8);
    },
    head: (p, n) => {
      const local = p.clone().sub(HEAD_C);
      let cheek = 0;
      for (const s of [-1, 1]) cheek = Math.max(cheek, Math.exp(-((local.y + 0.06) ** 2 + (local.z - 0.16 * s) ** 2) / 0.0028) * smooth(0.1, 0.5, n.x));
      return out.copy(base).lerp(shade, smooth(0.4, 0.95, n.y) * 0.25).lerp(blush, cheek * 0.55);
    },
    // Darker creases ring the trunk; the tip stays a touch paler.
    trunk: (t) => out.copy(base).lerp(shade, smooth(0.62, 0.9, Math.sin(t * 46) * 0.5 + 0.5) * 0.45 * smooth(0.05, 0.25, t)).lerp(belly, smooth(0.85, 1, t) * 0.4),
    ear: () => out.copy(base).lerp(shade, 0.2).getHex(),
    limb: (p, n) => out.copy(base).lerp(shade, smooth(0.1, -0.5, n.x) * 0.3),
    foot: () => out.copy(base).lerp(belly, 0.35).getHex(),
    tail: (t) => out.copy(base).lerp(shade, 0.3 + 0.3 * t),
  };
}

function buildFurGeometry(index, coat) {
  const paint = elephantPainter(coat);
  const b = new SkinBuilder(index);
  // Barrel body: wider and rounder than the cat, short plush fuzz instead of long fur.
  const profile = [[0, 0.1], [0.12, 0.11], [0.2, 0.14], [0.258, 0.2], [0.28, 0.27], [0.274, 0.34], [0.25, 0.42], [0.2, 0.49], [0.14, 0.54], [0.06, 0.568], [0, 0.574]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  b.add(new THREE.LatheGeometry(profile, 40), {
    s: [1.12, 1, 1.05], color: paint.body, fur: 0.32,
    weights: (p) => { const w = smooth(0.24, 0.46, p.y); return [['hips', 1 - w], ['spine', w]]; },
  });
  b.add(sphere(40, 28), { bone: 'head', p: HEAD_C.toArray(), s: HEAD_R.toArray(), color: paint.head, fur: (p, n) => 0.22 + 0.3 * smooth(0.7, -0.2, n.x) });
  // Forehead dome above the trunk root.
  b.add(sphere(24, 16), { bone: 'head', p: [HEAD_C.x + 0.12, HEAD_C.y + 0.06, 0], s: [0.13, 0.13, 0.15], color: paint.head, fur: 0.2 });
  addTail(b, TRUNK, { bone: 'trunk', radius: (t) => 0.074 - 0.03 * t + 0.0035 * Math.sin(t * 46), color: paint.trunk, fur: 0.12 });
  b.add(sphere(14, 10), { bone: 'trunk3', p: TRUNK.at(-1).toArray(), s: [0.047, 0.045, 0.047], color: paint.trunk(1).getHex(), fur: 0.1 });
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    b.add(earGeometry(s), { bone: `ear${side}`, p: earOrigin(s), color: paint.ear(), fur: 0.35 });
    // Front legs on the arm bones: thick columns ending in round, nailed feet.
    const shoulder = [ARM_X + 0.02, ARM_Y, (ARM_Z + 0.03) * s];
    b.add(new THREE.CapsuleGeometry(0.078, 0.12, 6, 14), { bone: `arm${side}`, p: [shoulder[0], shoulder[1] - 0.09, shoulder[2]], color: paint.limb, fur: 0.3 });
    b.add(new THREE.CylinderGeometry(0.075, 0.082, 0.07, 18), { bone: `paw${side}`, p: [shoulder[0], shoulder[1] - ARM_LEN - 0.01, shoulder[2]], color: paint.foot(), fur: 0.15 });
    b.add(new THREE.CapsuleGeometry(0.1, 0.07, 6, 16), { bone: `leg${side}`, p: [0, 0.15, 0.135 * s], color: paint.limb, fur: 0.3 });
    b.add(new THREE.CylinderGeometry(0.1, 0.108, 0.08, 20), { bone: `foot${side}`, p: [0.02, 0.045, 0.135 * s], color: paint.foot(), fur: 0.15 });
  }
  addTail(b, ELEPHANT_TAIL, { radius: (t) => 0.026 - 0.008 * t, color: paint.tail, fur: 0.2 });
  b.add(sphere(12, 8), { bone: 'tail3', p: ELEPHANT_TAIL.at(-1).toArray(), s: [0.035, 0.05, 0.035], color: coat.tuft, fur: 1.5 });
  return b.build();
}

/** Glossy details: eyes, inner ears, tusks, nostrils, mouth, toenails and a wider player-colored collar with a bell. */
function buildDetailGeometry(index, coat, accent) {
  const b = new SkinBuilder(index);
  const eyes = {};
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    const { point, normal } = onHead(0.035, 0.125 * s, 0.01);
    eyes[side] = point;
    const r = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), normal)).toArray().slice(0, 3);
    b.add(sphere(18, 14), { bone: `eye${side}`, p: point.toArray(), r, s: [0.024, 0.046, 0.038], color: coat.eye });
    const glint = point.clone().addScaledVector(normal, 0.02).add(new THREE.Vector3(0, 0.018, -0.01 * s));
    b.add(sphere(8, 6), { bone: `eye${side}`, p: glint.toArray(), s: [0.01, 0.013, 0.011], color: '#ffffff' });
    // Pink inner ear on the front face of each disc.
    b.add(earGeometry(s, 0.78).translate(0.022, 0, 0), { bone: `ear${side}`, p: earOrigin(s), color: coat.inner });
    // Short curved tusks beside the trunk root.
    b.add(new THREE.ConeGeometry(0.022, 0.1, 10).translate(0, 0.05, 0), { bone: 'head', p: [HEAD_C.x + 0.17, HEAD_C.y - 0.11, 0.085 * s], r: [0.25 * s, 0, -1.35], color: coat.tusk });
    // Three toenails on every foot.
    for (const [bone, x, y, z, size] of [[`paw${side}`, ARM_X + 0.09, ARM_Y - ARM_LEN - 0.03, (ARM_Z + 0.03) * s, 0.022], [`foot${side}`, 0.115, 0.03, 0.135 * s, 0.027]]) {
      for (const k of [-1, 0, 1]) b.add(sphere(10, 8), { bone, p: [x - Math.abs(k) * 0.012, y, z + k * size * 1.6], s: [size * 0.7, size, size], color: coat.nail });
    }
  }
  // Nostrils on the trunk tip, facing along the trunk.
  const tip = TRUNK.at(-1), dir = tip.clone().sub(TRUNK.at(-2)).normalize();
  for (const s of [-1, 1]) b.add(sphere(8, 6), { bone: 'trunk3', p: tip.clone().addScaledVector(dir, 0.04).add(new THREE.Vector3(0, 0, 0.016 * s)).toArray(), s: [0.012, 0.012, 0.01], color: '#4a3540' });
  b.add(sphere(14, 10), { bone: 'mouth', p: MOUTH.toArray(), s: [0.03, 0.02, 0.04], color: '#c75f72' });
  // Collar sized for the thicker neck, in the player's color.
  const collarStart = b.parts.reduce((sum, part) => sum + part.attributes.position.count, 0);
  b.add(new THREE.TorusGeometry(0.205, 0.026, 8, 40), { bone: 'spine', p: [0.03, 0.525, 0], r: [Math.PI / 2, 0.12, 0], s: [1.05, 1.08, 1], color: accent });
  const collarCount = b.parts.at(-1).attributes.position.count;
  b.add(sphere(14, 10), { bone: 'spine', p: [0.25, 0.49, 0], s: [0.038, 0.038, 0.038], color: '#f2cf63' });
  return { geometry: b.build(), eyes, collarStart, collarCount };
}

export const ELEPHANT = {
  id: 'elephant', coats: ELEPHANT_COATS, earOrigin, tail: ELEPHANT_TAIL, mouth: MOUTH,
  extraBones: [
    ['trunk0', 'head', TRUNK[0].x - HEAD_BONE.x, TRUNK[0].y - HEAD_BONE.y, 0],
    ['trunk1', 'trunk0', TRUNK[1].x - TRUNK[0].x, TRUNK[1].y - TRUNK[0].y, 0],
    ['trunk2', 'trunk1', TRUNK[2].x - TRUNK[1].x, TRUNK[2].y - TRUNK[1].y, 0],
    ['trunk3', 'trunk2', TRUNK[3].x - TRUNK[2].x, TRUNK[3].y - TRUNK[2].y, 0],
    ['trunkTip', 'trunk3', TRUNK[4].x - TRUNK[3].x + 0.03, TRUNK[4].y - TRUNK[3].y - 0.02, 0],
  ],
  buildFur: buildFurGeometry, buildDetail: buildDetailGeometry,
  // Heavy: a slow tail swish, unhurried scrubbing and a stomping gait.
  idleWag: 1.1, scrubRate: 0.85, heavy: 1, colors: new Map(),
};

export class ElephantModel extends CatModel {
  constructor({ coat = ELEPHANT_COATS.grey, ...options } = {}) {
    super({ ...options, species: ELEPHANT, coat });
    this.trunkTip = this.bones.trunkTip;
  }
}
