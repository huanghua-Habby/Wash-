/**
 * Procedural plush pelican on the shared skeleton, fur material and animator: a round feathered body, a small head
 * with a crest, an absurdly long beak whose throat pouch swells when it swallows something, stubby wings and webbed feet.
 * Extra `jaw` and `pouch` bones open the beak and inflate the pouch; the arms are the wings.
 * All four breeds share one topology; selection only swaps prepared vertex colors and the crest size.
 */
import * as THREE from 'three';
import { CatModel, SkinBuilder, sphere, smooth, addTail, addCollar, ARM_X, ARM_Y, ARM_Z, ARM_LEN } from '../cat/CatModel.js';

export const PELICAN_COATS = {
  white: {
    body: '#f7f3ee', shade: '#e3dbd2', head: '#fbf8f3', crown: '#fbf8f3', wingtip: '#36313a', crest: '#fffaf2',
    beak: '#f4c04a', tip: '#e8743b', pouch: '#f6b24a', leg: '#f2a24b', eye: '#2a2230', ring: '#f7dc8c', crestSize: 1,
  },
  brown: {
    body: '#8f857c', shade: '#625a54', head: '#f6efd9', crown: '#f0cf6e', wingtip: '#3b342f', crest: '#f3e7c4',
    beak: '#c9a27a', tip: '#d8643a', pouch: '#57545c', leg: '#45403c', eye: '#2a2230', ring: '#dfe6ee', crestSize: 0.8,
  },
  pink: {
    body: '#f8dcd8', shade: '#ebb9b3', head: '#fbe7e4', crown: '#fbe7e4', wingtip: '#5a4a50', crest: '#fff0ee',
    beak: '#f5c25b', tip: '#ee7a4a', pouch: '#f59a8e', leg: '#f39a7e', eye: '#2a2230', ring: '#f7cfa0', crestSize: 0.9,
  },
  dalmatian: {
    body: '#e4e6ea', shade: '#bfc4cc', head: '#eceef1', crown: '#eceef1', wingtip: '#3d4048', crest: '#f4f5f7',
    beak: '#d9c36a', tip: '#e86a3a', pouch: '#ef6f3f', leg: '#7d8590', eye: '#e9d36b', ring: '#f2f1ea', crestSize: 1.7,
  },
};

const HEAD_C = new THREE.Vector3(0.08, 0.8, 0);
const HEAD_R = new THREE.Vector3(0.165, 0.165, 0.155);
const BEAK_Y = HEAD_C.y - 0.025, BEAK_X0 = HEAD_C.x + 0.12, BEAK_LEN = 0.38;
const JAW = new THREE.Vector3(BEAK_X0 + 0.01, BEAK_Y - 0.02, 0);
const POUCH = new THREE.Vector3(BEAK_X0 + 0.16, BEAK_Y - 0.035, 0);
const MOUTH = new THREE.Vector3(BEAK_X0, BEAK_Y - 0.015, 0);
const HEAD_BONE = new THREE.Vector3(0.03, 0.57, 0);
const PELICAN_TAIL = [[-0.2, 0.27], [-0.27, 0.29], [-0.32, 0.31], [-0.36, 0.32], [-0.39, 0.33]].map(([x, y]) => new THREE.Vector3(x, y, 0));

// Crest feathers ride the ear bones at the back of the head and flop with the cat's ear springs.
function earOrigin(s) { return [HEAD_C.x - 0.09, HEAD_C.y + 0.1, 0.04 * s]; }
const CREST_TILT = (s) => [0.25 * s, 0, 0.95];

function pelicanPainter(coat) {
  const out = new THREE.Color(), body = new THREE.Color(coat.body), shade = new THREE.Color(coat.shade);
  const head = new THREE.Color(coat.head), crown = new THREE.Color(coat.crown), wingtip = new THREE.Color(coat.wingtip);
  return {
    body: (p, n) => out.copy(body).lerp(shade, smooth(0.1, -0.5, n.x) * smooth(0.15, 0.45, p.y) * 0.65),
    neck: () => out.copy(body).lerp(head, 0.5),
    head: (p, n) => out.copy(head).lerp(crown, smooth(0.45, 0.85, n.y)),
    wing: (p) => out.copy(body).lerp(shade, 0.4).lerp(wingtip, smooth(0.36, 0.27, p.y)),
    tail: (t) => out.copy(shade).lerp(wingtip, smooth(0.5, 1, t) * 0.7),
  };
}

function buildFurGeometry(index, coat) {
  const paint = pelicanPainter(coat);
  const b = new SkinBuilder(index);
  // Egg-shaped body, a touch plumper than the cat's.
  const profile = [[0, 0.09], [0.11, 0.1], [0.185, 0.13], [0.235, 0.19], [0.255, 0.26], [0.246, 0.33], [0.215, 0.41], [0.17, 0.48], [0.12, 0.53], [0.05, 0.565], [0, 0.572]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  b.add(new THREE.LatheGeometry(profile, 40), {
    s: [1, 1, 0.98], color: paint.body, fur: 0.9,
    weights: (p) => { const w = smooth(0.24, 0.46, p.y); return [['hips', 1 - w], ['spine', w]]; },
  });
  b.add(sphere(22, 16), { p: [0.07, 0.64, 0], s: [0.12, 0.13, 0.115], color: paint.neck, fur: 0.8, weights: () => [['spine', 0.5], ['head', 0.5]] });
  b.add(sphere(32, 22), { bone: 'head', p: HEAD_C.toArray(), s: HEAD_R.toArray(), color: paint.head, fur: (p, n) => 0.45 + 0.35 * smooth(0.6, -0.2, n.x) });
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    b.add(new THREE.ConeGeometry(0.05, 0.17, 10, 1).translate(0, 0.075, 0), { bone: `ear${side}`, p: earOrigin(s), r: CREST_TILT(s), s: [0.7, 1, 0.7], color: coat.crest, fur: 1.2 });
    // Stubby wings stand in for arms; dark primaries at the tips.
    const shoulder = [ARM_X - 0.02, ARM_Y, (ARM_Z + 0.03) * s];
    b.add(new THREE.CapsuleGeometry(0.07, 0.13, 6, 14), { bone: `arm${side}`, p: [shoulder[0], shoulder[1] - 0.09, shoulder[2]], s: [1.15, 1, 0.55], color: paint.wing, fur: 0.75 });
    b.add(sphere(16, 10), { bone: `paw${side}`, p: [shoulder[0] - 0.01, shoulder[1] - ARM_LEN, shoulder[2]], s: [0.075, 0.06, 0.04], color: coat.wingtip, fur: 0.6 });
    // Short orange legs and wide webbed feet, bare of feathers.
    b.add(new THREE.CapsuleGeometry(0.045, 0.07, 6, 10), { bone: `leg${side}`, p: [0, 0.15, 0.115 * s], color: coat.leg, fur: 0 });
    b.add(sphere(20, 10), { bone: `foot${side}`, p: [0.05, 0.04, 0.115 * s], s: [0.12, 0.035, 0.095], color: coat.leg, fur: 0 });
  }
  addTail(b, PELICAN_TAIL, { radius: (t) => 0.06 - 0.03 * t, color: paint.tail, fur: 0.9 });
  b.add(sphere(12, 8), { bone: 'tail3', p: PELICAN_TAIL.at(-1).toArray(), s: [0.04, 0.03, 0.05], color: coat.wingtip, fur: 0.7 });
  return b.build();
}

/** Glossy details: side eyes with a pale ring, the long beak with its hook, the hinged lower jaw and pouch, and the collar. */
function buildDetailGeometry(index, coat, accent) {
  const b = new SkinBuilder(index);
  const eyes = {};
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    const normal = new THREE.Vector3(0.55, 0.28, 0.79 * s).normalize();
    const point = new THREE.Vector3(HEAD_C.x + HEAD_R.x * normal.x, HEAD_C.y + HEAD_R.y * normal.y, HEAD_R.z * normal.z).addScaledVector(normal, 0.006);
    eyes[side] = point;
    const r = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), normal)).toArray().slice(0, 3);
    b.add(sphere(16, 12), { bone: `eye${side}`, p: point.toArray(), r, s: [0.012, 0.036, 0.036], color: coat.ring });
    b.add(sphere(14, 10), { bone: `eye${side}`, p: point.clone().addScaledVector(normal, 0.01).toArray(), r, s: [0.014, 0.024, 0.024], color: coat.eye });
    b.add(sphere(8, 6), { bone: `eye${side}`, p: point.clone().addScaledVector(normal, 0.022).add(new THREE.Vector3(0.004, 0.01, 0)).toArray(), s: [0.007, 0.008, 0.008], color: '#ffffff' });
  }
  // Upper beak along +x, flat and wide, ending in a hooked tip.
  const mid = BEAK_X0 + BEAK_LEN / 2;
  b.add(new THREE.CapsuleGeometry(0.04, BEAK_LEN - 0.08, 6, 14), { bone: 'head', p: [mid, BEAK_Y, 0], r: [0, 0, -Math.PI / 2], s: [0.55, 1, 1.15], color: coat.beak });
  b.add(sphere(12, 8), { bone: 'head', p: [BEAK_X0 + BEAK_LEN - 0.015, BEAK_Y - 0.012, 0], s: [0.028, 0.026, 0.026], color: coat.tip });
  // Lower jaw hinges at the beak base; the pouch hangs from it and inflates downward when the pelican swallows.
  b.add(new THREE.CapsuleGeometry(0.036, BEAK_LEN - 0.1, 6, 12), { bone: 'jaw', p: [mid - 0.01, BEAK_Y - 0.026, 0], r: [0, 0, -Math.PI / 2], s: [0.4, 1, 1.05], color: coat.beak });
  b.add(sphere(24, 14), { bone: 'pouch', p: [POUCH.x, POUCH.y - 0.042, 0], s: [0.15, 0.048, 0.058], color: coat.pouch });
  const collar = addCollar(b, accent, [0.034, 0.034, 0.034]);
  return { geometry: b.build(), eyes, ...collar };
}

export const PELICAN = {
  id: 'pelican', coats: PELICAN_COATS, earOrigin, tail: PELICAN_TAIL, mouth: MOUTH,
  extraBones: [
    ['jaw', 'head', JAW.x - HEAD_BONE.x, JAW.y - HEAD_BONE.y, 0],
    ['pouch', 'jaw', POUCH.x - JAW.x, POUCH.y - JAW.y, 0],
  ],
  buildFur: buildFurGeometry, buildDetail: buildDetailGeometry, idleWag: 2.2, colors: new Map(),
};

export class PelicanModel extends CatModel {
  constructor({ coat = PELICAN_COATS.white, ...options } = {}) {
    super({ ...options, species: PELICAN, coat });
    this.setCrest(coat.crestSize);
  }

  setAppearance(breed, accent) {
    super.setAppearance(breed, accent);
    if (PELICAN_COATS[breed]) this.setCrest(PELICAN_COATS[breed].crestSize);
  }

  setCrest(size) { this.bones.earL.scale.setScalar(size); this.bones.earR.scale.setScalar(size); }
}
