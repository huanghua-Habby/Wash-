/**
 * Procedural plush Canadian goose on the shared skeleton, fur material and animator, styled as the cast's bad boy:
 * a chunky barred body with a puffed-out chest, a black neck and head with the white chinstrap, a short stout black
 * beak, a slicked-back quiff on the ear bones, flat-topped wraparound shades, a neckerchief in the player's color and
 * a chain with a medallion hanging over the chest. The arms are the wings, the tail is a short dark fan.
 * All four breeds share one topology; selection only swaps prepared vertex colors and the chain size.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { CatModel, SkinBuilder, sphere, smooth, hash, addTail, ARM_X, ARM_Y, ARM_Z, ARM_LEN } from '../cat/CatModel.js';

/** strap: chinstrap white, chest/under: pale chest and white under-tail, lens/frame/glint: the shades, chain: metal. */
export const GOOSE_COATS = {
  canada: {
    body: '#80705f', shade: '#584a3f', edge: '#b3a28c', chest: '#d6c7ae', under: '#f8f4ec', head: '#1e1b1f', strap: '#f7f3ea',
    wingtip: '#2c2725', beak: '#262427', leg: '#2a2628', lens: '#141318', frame: '#d3d8de', glint: '#6fc4ff',
    chain: '#dfe3e8', medal: '#c8ced6', chainSize: 1,
  },
  midnight: {
    body: '#3c3941', shade: '#252329', edge: '#5d5864', chest: '#6c6672', under: '#c9c6d0', head: '#111013', strap: '#e9e7f0',
    wingtip: '#141316', beak: '#18171a', leg: '#151416', lens: '#0a0a0d', frame: '#9a78e0', glint: '#b77bff',
    chain: '#d9dce3', medal: '#b9bdc8', chainSize: 1,
  },
  snow: {
    body: '#d9d6d1', shade: '#b3afa9', edge: '#f1efeb', chest: '#f3f1ed', under: '#ffffff', head: '#1c1a1e', strap: '#ffffff',
    wingtip: '#6f6b67', beak: '#29272a', leg: '#2d292b', lens: '#16161b', frame: '#f4f3f0', glint: '#8fe6ff',
    chain: '#e3e6ea', medal: '#cdd3da', chainSize: 1,
  },
  boss: {
    body: '#9c7149', shade: '#6c4a2e', edge: '#c9a170', chest: '#e6c897', under: '#fbf3e3', head: '#1f1a18', strap: '#fbf4e6',
    wingtip: '#3a2a1f', beak: '#231f1e', leg: '#2b2420', lens: '#120f0c', frame: '#e3b23c', glint: '#ffd36b',
    chain: '#f2c447', medal: '#ffd75e', chainSize: 1.18,
  },
};

const HEAD_C = new THREE.Vector3(0.11, 0.875, 0);
const HEAD_R = new THREE.Vector3(0.17, 0.155, 0.15);
const BEAK_X0 = HEAD_C.x + 0.13, BEAK_Y = HEAD_C.y - 0.035, BEAK_LEN = 0.14;
const MOUTH = new THREE.Vector3(BEAK_X0 + 0.03, BEAK_Y - 0.03, 0);
// Chain bone sits on the spine at the neck base, so its scale grows the loop around the chest.
const CHAIN = new THREE.Vector3(0.03, 0.49, 0);
const SPINE_BONE = new THREE.Vector3(0, 0.37, 0);
const GOOSE_TAIL = [[-0.2, 0.25], [-0.26, 0.27], [-0.31, 0.3], [-0.35, 0.33], [-0.38, 0.36]].map(([x, y]) => new THREE.Vector3(x, y, 0));

// The slicked-back quiff rides the ear bones on the crown and bounces with the cat's ear springs.
function earOrigin(s) { return [HEAD_C.x + 0.02, HEAD_C.y + 0.14, 0.03 * s]; }
const QUIFF_TILT = (s) => [0.15 * s, 0, 1.4];

/** A point on the head ellipsoid along `normal` (normalized), `lift` further out. */
function onHead(normal, lift) {
  const n = normal.clone().normalize();
  return new THREE.Vector3(HEAD_C.x + HEAD_R.x * n.x, HEAD_C.y + HEAD_R.y * n.y, HEAD_R.z * n.z).addScaledVector(n, lift);
}

/** Euler that turns +z toward `normal` with +y kept up. */
function faceToward(normal) {
  const m = new THREE.Matrix4().lookAt(normal, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  return new THREE.Euler().setFromRotationMatrix(m).toArray().slice(0, 3);
}

function goosePainter(coat) {
  const out = new THREE.Color(), body = new THREE.Color(coat.body), shade = new THREE.Color(coat.shade), edge = new THREE.Color(coat.edge);
  const chest = new THREE.Color(coat.chest), under = new THREE.Color(coat.under), head = new THREE.Color(coat.head), strap = new THREE.Color(coat.strap);
  const wingtip = new THREE.Color(coat.wingtip);
  // Pale feather edges in rows: the goose's barred back and wings.
  const bars = (p, freq) => smooth(0.72, 0.92, Math.sin(p.y * freq + Math.sin(p.z * 22 + p.x * 9) * 0.9) * 0.5 + 0.5);
  return {
    body: (p, n) => {
      const wobble = (hash(Math.round(p.x * 40), Math.round(p.y * 40), Math.round(p.z * 40)) - 0.5) * 0.12;
      const back = smooth(0.15, -0.5, n.x);
      out.copy(body).lerp(shade, back * smooth(0.2, 0.5, p.y) * 0.55).lerp(edge, bars(p, 44) * smooth(0.35, -0.2, n.x) * 0.55);
      // Pale chest in front, white belly underneath and white under-tail at the rear.
      const front = smooth(0.2, 0.6, n.x + wobble) * smooth(0.13, 0.22, p.y);
      out.lerp(chest, front);
      const belly = Math.max(smooth(-0.35, -0.8, n.y), smooth(0.24, 0.15, p.y) * smooth(0.1, -0.5, n.x));
      return out.lerp(under, belly);
    },
    chest: (p, n) => out.copy(chest).lerp(under, smooth(0.0, -0.8, n.y) * 0.7),
    neck: () => out.copy(head),
    // Black head with the bold white chinstrap wrapping from cheek to cheek under the chin.
    head: (p, n) => {
      const local = p.clone().sub(HEAD_C);
      const k = smooth(0.4, 0.2, n.y + local.x * 1.2) * smooth(-0.45, -0.2, n.x) * smooth(0.5, 0.28, n.x);
      return out.copy(head).lerp(strap, k);
    },
    wing: (p, n) => out.copy(body).lerp(shade, 0.25).lerp(edge, bars(p, 52) * 0.7).lerp(wingtip, smooth(0.36, 0.27, p.y)),
    tail: (t) => out.copy(under).lerp(wingtip, smooth(0.15, 0.4, t)),
  };
}

function buildFurGeometry(index, coat) {
  const paint = goosePainter(coat);
  const b = new SkinBuilder(index);
  // Chunky egg body, wider than tall, leaning its chest forward.
  const profile = [[0, 0.09], [0.11, 0.1], [0.19, 0.13], [0.24, 0.19], [0.26, 0.26], [0.252, 0.33], [0.222, 0.41], [0.175, 0.48], [0.12, 0.53], [0.05, 0.565], [0, 0.572]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  b.add(new THREE.LatheGeometry(profile, 40), {
    s: [1.04, 1, 0.98], color: paint.body, fur: 0.9,
    weights: (p) => { const w = smooth(0.24, 0.46, p.y); return [['hips', 1 - w], ['spine', w]]; },
  });
  // Swaggering puffed-out chest.
  b.add(sphere(22, 16), { bone: 'spine', p: [0.15, 0.4, 0], s: [0.13, 0.14, 0.17], color: paint.chest, fur: 1 });
  // Black neck, blending from the spine into the head so head turns bend it.
  b.add(new THREE.CapsuleGeometry(0.085, 0.19, 6, 16), {
    p: [0.078, 0.69, 0], r: [0, 0, -0.18], s: [1.05, 1, 1], color: paint.neck, fur: 0.75,
    weights: (p) => { const w = smooth(0.6, 0.8, p.y); return [['spine', 1 - w], ['head', w]]; },
  });
  b.add(sphere(32, 22), { bone: 'head', p: HEAD_C.toArray(), s: HEAD_R.toArray(), color: paint.head, fur: (p, n) => 0.5 + 0.3 * smooth(0.6, -0.2, n.x) });
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    b.add(new THREE.ConeGeometry(0.06, 0.17, 10, 1).translate(0, 0.075, 0), { bone: `ear${side}`, p: earOrigin(s), r: QUIFF_TILT(s), s: [0.75, 1, 0.65], color: coat.head, fur: 0.9 });
    // Broad folded wings with barred coverts and dark primaries.
    const shoulder = [ARM_X - 0.03, ARM_Y + 0.01, (ARM_Z + 0.045) * s];
    b.add(new THREE.CapsuleGeometry(0.078, 0.14, 6, 14), { bone: `arm${side}`, p: [shoulder[0], shoulder[1] - 0.09, shoulder[2]], s: [1.25, 1, 0.55], color: paint.wing, fur: 0.75 });
    b.add(sphere(16, 10), { bone: `paw${side}`, p: [shoulder[0] - 0.015, shoulder[1] - ARM_LEN, shoulder[2]], s: [0.085, 0.065, 0.042], color: coat.wingtip, fur: 0.6 });
    // Black legs and wide webbed feet, bare of feathers.
    b.add(new THREE.CapsuleGeometry(0.045, 0.07, 6, 10), { bone: `leg${side}`, p: [0, 0.15, 0.115 * s], color: coat.leg, fur: 0 });
    b.add(sphere(20, 10), { bone: `foot${side}`, p: [0.055, 0.04, 0.115 * s], s: [0.125, 0.035, 0.1], color: coat.leg, fur: 0 });
  }
  // Short tail: white under-tail coverts at the root, a dark fan at the tip.
  addTail(b, GOOSE_TAIL, { radius: (t) => 0.07 - 0.03 * t, color: paint.tail, fur: 0.9 });
  b.add(sphere(12, 8), { bone: 'tail3', p: GOOSE_TAIL.at(-1).toArray(), s: [0.05, 0.03, 0.065], color: coat.wingtip, fur: 0.7 });
  return b.build();
}

const LENS_W = 0.125, LENS_H = 0.078, LENS_DIP = 0.024;

/** Flat-topped lens outline in its own xy plane; +x is the outer side, the inner corner dips for a mean scowl. */
function lensGeometry() {
  const w = LENS_W, h = LENS_H, shape = new THREE.Shape();
  shape.moveTo(-w / 2, h / 2 - LENS_DIP);
  shape.lineTo(w / 2, h / 2);
  shape.bezierCurveTo(w / 2 + 0.008, -h * 0.2, w * 0.32, -h / 2, 0, -h / 2);
  shape.bezierCurveTo(-w * 0.36, -h / 2, -w / 2 - 0.004, -h * 0.1, -w / 2, h / 2 - LENS_DIP);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.01, curveSegments: 6, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: 1 });
  g.deleteAttribute('uv');
  return mergeVertices(g.translate(0, 0, -0.005));
}

/** Capsule rod from `a` to `b` on `bone`. */
function rod(b, bone, a, c, radius, color) {
  const dir = c.clone().sub(a), length = dir.length();
  const r = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())).toArray().slice(0, 3);
  return b.add(new THREE.CapsuleGeometry(radius, Math.max(0.001, length - radius), 4, 8), { bone, p: a.clone().add(c).multiplyScalar(0.5).toArray(), r, color });
}

/** Gold-or-silver chain of alternating links draped around the neck base and over the chest, ending in a medallion. */
function addChain(b, coat) {
  const links = 18, X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), m = new THREE.Matrix4();
  const at = (a) => {
    const front = Math.pow((Math.cos(a) + 1) / 2, 1.3);
    return new THREE.Vector3(0.11 + 0.21 * Math.cos(a), 0.565 - 0.17 * front, 0.215 * Math.sin(a));
  };
  for (let i = 0; i < links; i++) {
    const a = ((i + 0.5) / links) * Math.PI * 2, p = at(a);
    X.copy(at(a + 0.01)).sub(at(a - 0.01)).normalize();
    // Alternate links lie flat on the body and stand on edge.
    const out = new THREE.Vector3(Math.cos(a), 0.5, Math.sin(a)).normalize();
    Z.copy(i % 2 ? new THREE.Vector3(0, 1, 0) : out); Z.addScaledVector(X, -Z.dot(X)).normalize(); Y.crossVectors(Z, X);
    m.makeBasis(X, Y, Z);
    const r = new THREE.Euler().setFromRotationMatrix(m).toArray().slice(0, 3);
    b.add(new THREE.TorusGeometry(0.02, 0.007, 5, 9), { bone: 'chain', p: p.toArray(), r, s: [1.3, 1, 1], color: coat.chain });
  }
  // Medallion over the puffed chest, tilted up toward the camera.
  const tip = at(0);
  b.add(new THREE.CylinderGeometry(0.05, 0.05, 0.016, 20, 1), { bone: 'chain', p: [tip.x + 0.025, tip.y - 0.05, 0], r: [0, 0, -1.15], color: coat.medal });
  b.add(new THREE.TorusGeometry(0.05, 0.008, 6, 20), { bone: 'chain', p: [tip.x + 0.025, tip.y - 0.05, 0], r: [0, Math.PI / 2, 1.15 - Math.PI / 2], color: coat.chain });
}

/** Glossy details: the shades, the stout beak, the mouth, the neckerchief in the player's color and the chain. */
function buildDetailGeometry(index, coat, accent) {
  const b = new SkinBuilder(index);
  const eyes = {}, lens = lensGeometry(), inner = {};
  const lensColor = new THREE.Color(coat.lens), mirror = new THREE.Color(coat.glint), tint = new THREE.Color();
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    // Clubmaster shades: wraparound lenses between the front and the side of the head under a heavy browline bar.
    const normal = new THREE.Vector3(0.72, 0.14, 0.68 * s).normalize();
    const point = onHead(normal, 0.024), r = faceToward(normal), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...r));
    const local = (x, y, z = 0) => point.clone().add(new THREE.Vector3(x, y, z).applyQuaternion(q));
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    eyes[side] = local(0, 0, 0.012);
    b.add(lens.clone(), { bone: 'head', p: local(0, -0.002, -0.006).toArray(), r, s: [1.1, 1.14, 1], color: coat.frame });
    // Mirrored lens: dark at the top, fading to a tinted reflection at the bottom.
    b.add(lens.clone(), { bone: 'head', p: point.toArray(), r, color: (p) => tint.copy(lensColor).lerp(mirror, 0.45 * smooth(0.01, -0.04, p.clone().sub(point).dot(up))) });
    const top = [local(-LENS_W / 2, LENS_H / 2 - LENS_DIP + 0.004, 0.004), local(LENS_W / 2 + 0.006, LENS_H / 2 + 0.004, 0.004)];
    rod(b, 'head', top[0], top[1], 0.014, coat.frame);
    inner[side] = top[0];
    // Temple arm back along the side of the head.
    rod(b, 'head', top[1], new THREE.Vector3(HEAD_C.x - 0.11, HEAD_C.y + 0.04, (HEAD_R.z - 0.015) * s), 0.007, coat.frame);
    // A diagonal glint across each lens rides the eye bone, so it flickers when the goose blinks behind the shades.
    const glint = (x, y, length) => b.add(sphere(10, 6), {
      bone: `eye${side}`, p: eyes[side].clone().add(new THREE.Vector3(x, y, 0).applyQuaternion(q)).toArray(),
      r: new THREE.Euler().setFromQuaternion(q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.8))).toArray().slice(0, 3),
      s: [length, 0.0055, 0.003], color: '#ffffff',
    });
    glint(0.022, 0.012, 0.02); glint(0.042, -0.002, 0.008);
  }
  lens.dispose();
  // Bridge over the beak base joining the two browlines.
  rod(b, 'head', inner.L, inner.R, 0.008, coat.frame);
  // Short stout beak, wide at the base, with a rounded nail at the tip.
  b.add(new THREE.CapsuleGeometry(0.05, BEAK_LEN - 0.07, 6, 14), { bone: 'head', p: [BEAK_X0 + BEAK_LEN / 2 - 0.02, BEAK_Y, 0], r: [0, 0, -Math.PI / 2 - 0.12], s: [0.72, 1, 1.12], color: coat.beak });
  b.add(sphere(12, 8), { bone: 'head', p: [BEAK_X0 + BEAK_LEN - 0.035, BEAK_Y - 0.018, 0], s: [0.03, 0.026, 0.032], color: coat.beak });
  b.add(sphere(14, 10), { bone: 'mouth', p: MOUTH.toArray(), s: [0.04, 0.03, 0.04], color: '#5b2f3a' });
  // Neckerchief in the player's color: a band round the neck base and a triangle flap over the chest (one recolor range).
  const collarStart = b.parts.reduce((sum, part) => sum + part.attributes.position.count, 0);
  b.add(new THREE.TorusGeometry(0.1, 0.03, 8, 30), { bone: 'spine', p: [0.06, 0.6, 0], r: [Math.PI / 2, 0.3, 0], s: [1.05, 1.1, 1], color: accent });
  b.add(new THREE.ConeGeometry(0.09, 0.13, 3, 1), { bone: 'spine', p: [0.165, 0.545, 0], r: [0, 0, Math.PI - 0.35], s: [0.35, 1, 1], color: accent });
  const collarCount = b.parts.slice(-2).reduce((sum, part) => sum + part.attributes.position.count, 0);
  addChain(b, coat);
  return { geometry: b.build(), eyes, collarStart, collarCount };
}

export const GOOSE = {
  id: 'goose', coats: GOOSE_COATS, earOrigin, tail: GOOSE_TAIL, mouth: MOUTH,
  extraBones: [['chain', 'spine', CHAIN.x - SPINE_BONE.x, CHAIN.y - SPINE_BONE.y, 0]],
  buildFur: buildFurGeometry, buildDetail: buildDetailGeometry,
  // Cocky: a slow tail flick at rest and brisk scrubbing.
  idleWag: 1.4, scrubRate: 1.1, colors: new Map(),
};

export class GooseModel extends CatModel {
  constructor({ coat = GOOSE_COATS.canada, ...options } = {}) {
    super({ ...options, species: GOOSE, coat });
    this.setChain(coat.chainSize);
  }

  setAppearance(breed, accent) {
    super.setAppearance(breed, accent);
    if (GOOSE_COATS[breed]) this.setChain(GOOSE_COATS[breed].chainSize);
  }

  setChain(size) { this.bones.chain.scale.setScalar(size); }
}
