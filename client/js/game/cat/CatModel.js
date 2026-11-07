/**
 * Procedural plush cat: chubby body, oversized head, stubby limbs and a fluffy tail on one skeleton.
 * Faces +x, stands on y = 0, roughly 1 unit tall (matches the 0.2/0.6/1.0 spray hit spheres).
 * Other animals (DogModel) reuse the skeleton names, fur material and builders with their own species shape.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createFurMaterial, createShellGeometry, setShellCount } from './FurMaterial.js';
import { CFG } from '../../core/config.js';
import { FUR_STATUS, normalizeFurShells } from '../../core/furSettings.js';

export const FUR = { shells: 20, length: 0.034, density: 105 }; // Allocated capacity, including internal Extra; release default is 12.
const MASK_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xffffff });

// The velocity mask needs only the skinned silhouette, not the layered fur shells.
// Keep just the attributes required by the override material's skinning path.
function maskGeometry(geometries) {
  const parts = geometries.map((source) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(source.index);
    for (const name of ['position', 'skinIndex', 'skinWeight']) geometry.setAttribute(name, source.attributes[name]);
    return geometry;
  });
  return mergeGeometries(parts);
}

export const COATS = {
  ginger: { base: '#efa25f', stripe: '#d3753c', white: '#fff4e4', inner: '#f5b3ae', nose: '#e8868a' },
  grey: { base: '#aeb2bd', stripe: '#787c8b', white: '#f7f5f2', inner: '#f2b2b4', nose: '#d98b94' },
  cream: { base: '#f5e4c6', stripe: '#e4c393', white: '#fffaf1', inner: '#f6bdb2', nose: '#e7999a' },
  tuxedo: { base: '#4a4452', stripe: '#3e3946', white: '#fbf7f1', inner: '#e9a7ad', nose: '#d58891' },
};

export const HEAD_C = new THREE.Vector3(0.04, 0.72, 0);
export const HEAD_R = new THREE.Vector3(0.29, 0.265, 0.325);
export const ARM_X = 0.09, ARM_Y = 0.45, ARM_Z = 0.175, ARM_LEN = 0.19;
export const RIG = { ARM_LEN };
const MOUTH = new THREE.Vector3(HEAD_C.x + HEAD_R.x - 0.012, HEAD_C.y - 0.128, 0);

export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const hash = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };

function makeBones(species) {
  const bones = [], index = {};
  const bone = (name, parent, x, y, z) => {
    const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z);
    parent?.add(b); index[name] = bones.length; bones.push(b); return b;
  };
  const root = bone('root', null, 0, 0, 0);
  const hips = bone('hips', root, 0, 0.27, 0);
  const spine = bone('spine', hips, 0, 0.1, 0);
  const head = bone('head', spine, 0.03, 0.2, 0);
  for (const [side, s] of [['L', -1], ['R', 1]]) {
    const [ex, ey, ez] = species.earOrigin(s);
    bone(`ear${side}`, head, ex - 0.03, ey - 0.57, ez);
    bone(`arm${side}`, spine, ARM_X, ARM_Y - 0.37, ARM_Z * s);
    bone(`paw${side}`, bones[index[`arm${side}`]], 0, -ARM_LEN, 0);
    bone(`leg${side}`, hips, 0, -0.05, 0.12 * s);
    bone(`foot${side}`, bones[index[`leg${side}`]], 0, -0.15, 0);
  }
  // Tail chain offsets follow the species' bind-pose tail joints.
  let parent = hips;
  species.tail.slice(0, 4).forEach((joint, i) => {
    const [x, y] = i ? [joint.x - species.tail[i - 1].x, joint.y - species.tail[i - 1].y] : [joint.x, joint.y - hips.position.y];
    parent = bone(`tail${i}`, parent, x, y, 0);
  });
  // Species-only bones (e.g. the pelican's jaw and pouch), offsets relative to their parent in bind pose.
  for (const [name, parentName, x, y, z] of species.extraBones || []) bone(name, bones[index[parentName]], x, y, z);
  root.updateMatrixWorld(true);
  return { bones, index, root };
}

/** Collects skinned parts in bind (mesh) space, then merges them into one geometry. */
export class SkinBuilder {
  constructor(index) { this.index = index; this.parts = []; }
  add(geometry, { bone, weights, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], color, fur = 1 }) {
    const g = geometry;
    g.deleteAttribute('uv');
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s)));
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3), skinIndex = new Uint16Array(n * 4), skinWeight = new Float32Array(n * 4), mask = new Float32Array(n);
    const pos = new THREE.Vector3(), normal = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      pos.fromBufferAttribute(g.attributes.position, i); normal.fromBufferAttribute(g.attributes.normal, i);
      c.set(typeof color === 'function' ? color(pos, normal, i) : color); c.toArray(colors, i * 3);
      mask[i] = typeof fur === 'function' ? fur(pos, normal, i) : fur;
      const list = weights ? weights(pos, i) : [[bone, 1]];
      list.forEach(([name, w], k) => { skinIndex[i * 4 + k] = this.index[name]; skinWeight[i * 4 + k] = w; });
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
    g.setAttribute('furMask', new THREE.BufferAttribute(mask, 1));
    g.setAttribute('furRest', g.attributes.position.clone());
    this.parts.push(g);
    return this;
  }
  build() { return mergeGeometries(this.parts); }
}

export const sphere = (w = 32, h = 22) => new THREE.SphereGeometry(1, w, h);

/** Fluffy tail tube along the bind-pose tail joints; ring vertices blend across neighbouring tail bones.
 * `bone` names another four-bone chain with the same layout (the elephant's trunk). */
export function addTail(b, joints, { radius, color, fur = 0.9, bone = 'tail' }) {
  const curve = new THREE.CatmullRomCurve3(joints);
  const rings = 28, radial = 12, tube = new THREE.TubeGeometry(curve, rings, 1, radial, false);
  const position = tube.attributes.position, centerAt = curve.getSpacedPoints(rings), tParam = [];
  for (let ring = 0; ring <= rings; ring++) {
    const t = ring / rings, r = radius(t);
    for (let j = 0; j <= radial; j++) {
      const i = ring * (radial + 1) + j, v = new THREE.Vector3().fromBufferAttribute(position, i);
      v.sub(centerAt[ring]).normalize().multiplyScalar(r).add(centerAt[ring]); position.setXYZ(i, v.x, v.y, v.z);
      tParam[i] = t;
    }
  }
  tube.computeVertexNormals();
  const tailWeights = (t) => {
    const u = Math.min(3.999, t * 4), a = Math.floor(u), f = u - a, list = [[`${bone}${a}`, 1]];
    if (a < 3 && f > 0.5) { const w = smooth(0.5, 1, f) * 0.5; list[0][1] = 1 - w; list.push([`${bone}${a + 1}`, w]); }
    if (a > 0 && f < 0.5) { const w = (1 - smooth(0, 0.5, f)) * 0.5; list[0][1] = 1 - w; list.push([`${bone}${a - 1}`, w]); }
    return list;
  };
  return b.add(tube, { weights: (p, i) => tailWeights(tParam[i]), color: (p, n, i) => color(tParam[i]), fur });
}

/** A point on the head ellipsoid's front, `lift` along its normal. */
export function pointOnHead(dy, dz, lift) {
  const dx = HEAD_R.x * Math.sqrt(Math.max(0, 1 - (dy / HEAD_R.y) ** 2 - (dz / HEAD_R.z) ** 2));
  const normal = new THREE.Vector3(dx / HEAD_R.x ** 2, dy / HEAD_R.y ** 2, dz / HEAD_R.z ** 2).normalize();
  return { point: new THREE.Vector3(HEAD_C.x + dx, HEAD_C.y + dy, dz).addScaledVector(normal, lift), normal };
}

/** Collar in the player's color (recolored in place) plus a charm; returns the collar's vertex range. */
export function addCollar(b, accent, charm) {
  const collarStart = b.parts.reduce((sum, part) => sum + part.attributes.position.count, 0);
  b.add(new THREE.TorusGeometry(0.17, 0.024, 8, 36), { bone: 'spine', p: [0.012, 0.505, 0], r: [Math.PI / 2, 0.16, 0], s: [0.98, 1.08, 1], color: accent });
  const collarCount = b.parts.at(-1).attributes.position.count;
  b.add(sphere(14, 10), { bone: 'spine', p: [0.19, 0.465, 0], s: charm, color: '#f2cf63' });
  return { collarStart, collarCount };
}

function coatPainter(coat) {
  const base = new THREE.Color(coat.base), stripe = new THREE.Color(coat.stripe), white = new THREE.Color(coat.white);
  const out = new THREE.Color();
  const mix = (stripeAmount, whiteAmount) => out.copy(base).lerp(stripe, stripeAmount).lerp(white, whiteAmount);
  return {
    body: (p, n) => {
      const wobble = (hash(Math.round(p.x * 40), Math.round(p.y * 40), Math.round(p.z * 40)) - 0.5) * 0.12;
      const bib = smooth(0.5, 0.8, n.x + wobble) * smooth(0.14, 0.22, p.y) * smooth(0.54, 0.46, p.y);
      const belly = smooth(-0.3, -0.75, n.y);
      const dorsal = smooth(0.15, -0.45, n.x);
      const bands = smooth(0.58, 0.82, Math.sin(p.y * 36 + Math.sin(p.z * 13) * 1.4) * 0.5 + 0.5);
      return mix(bands * dorsal, Math.max(bib, belly));
    },
    head: (p, n) => {
      const local = p.clone().sub(HEAD_C);
      // Forehead "M": three short vertical strokes above the eyes.
      const brow = smooth(0.25, 0.6, n.x) * smooth(0.07, 0.15, local.y);
      let strokes = 0;
      for (const z of [-0.075, 0, 0.075]) strokes = Math.max(strokes, Math.exp(-((local.z - z) ** 2) / 0.00045));
      const crown = smooth(0.35, 0.75, n.y) * smooth(0.3, -0.1, n.x) * smooth(0.6, 0.85, Math.sin(local.x * 42) * 0.5 + 0.5);
      const cheek = smooth(0.62, 0.85, Math.abs(n.z)) * smooth(0.25, -0.15, n.y) * smooth(0.55, 0.8, Math.sin(local.y * 62 + 1.3) * 0.5 + 0.5);
      const chin = smooth(-0.35, -0.7, n.y) * smooth(0.0, 0.5, n.x);
      return mix(Math.max(brow * strokes, crown, cheek * 0.85), chin);
    },
    limb: (p, n) => mix(smooth(0.55, 0.8, Math.sin(p.y * 46) * 0.5 + 0.5) * smooth(0.1, -0.4, n.x) * 0.9, 0),
    tail: (t) => mix(smooth(0.5, 0.75, Math.sin(t * 30) * 0.5 + 0.5), 0),
    solid: (color) => out.set(color),
  };
}

function buildFurGeometry(index, coat) {
  const paint = coatPainter(coat);
  const b = new SkinBuilder(index);
  // Pear-shaped body, bending between hips and spine.
  const profile = [[0, 0.1], [0.1, 0.112], [0.17, 0.14], [0.222, 0.19], [0.243, 0.26], [0.236, 0.33], [0.21, 0.41], [0.172, 0.48], [0.125, 0.53], [0.05, 0.565], [0, 0.572]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  b.add(new THREE.LatheGeometry(profile, 40), {
    s: [0.95, 1, 1], color: paint.body,
    fur: (p, n) => 1 + smooth(0.3, 0.8, n.x) * 0.25,
    weights: (p) => { const w = smooth(0.24, 0.46, p.y); return [['hips', 1 - w], ['spine', w]]; },
  });
  b.add(sphere(20, 14), { bone: 'spine', p: [0.15, 0.43, 0], s: [0.08, 0.1, 0.12], color: coat.white, fur: 1.3 });
  // Head with puffy cheeks and a white muzzle.
  b.add(sphere(40, 28), {
    bone: 'head', p: HEAD_C.toArray(), s: HEAD_R.toArray(), color: paint.head,
    fur: (p, n) => 0.55 + 0.6 * smooth(0.7, 0.1, n.x) - 0.15 * smooth(0.8, 1, n.x),
  });
  for (const s of [-1, 1]) {
    b.add(sphere(18, 12), { bone: 'head', p: [HEAD_C.x + 0.03, HEAD_C.y - 0.09, 0.235 * s], s: [0.1, 0.09, 0.1], color: paint.head, fur: 1.35 });
    b.add(sphere(18, 12), { bone: 'head', p: [HEAD_C.x + HEAD_R.x - 0.068, HEAD_C.y - 0.09, 0.054 * s], s: [0.062, 0.06, 0.07], color: coat.white, fur: 0.35 });
    // Ears: rounded triangles, tilted outward; pivot at the base for flicks.
    const ear = `ear${s < 0 ? 'L' : 'R'}`;
    b.add(new THREE.ConeGeometry(0.135, 0.245, 14, 1).translate(0, 0.11, 0), { bone: ear, p: earOrigin(s), r: [0.32 * s, 0, 0.1], s: [0.55, 1, 1], color: paint.head(new THREE.Vector3(0, 0.95, 0), new THREE.Vector3(0, 1, 0)).getHex(), fur: 0.4 });
    // Arms + mitten paws.
    const side = s < 0 ? 'L' : 'R';
    const shoulder = [ARM_X, ARM_Y, ARM_Z * s];
    b.add(new THREE.CapsuleGeometry(0.058, 0.12, 6, 14), { bone: `arm${side}`, p: [shoulder[0], shoulder[1] - 0.09, shoulder[2]], color: paint.limb, fur: 0.9 });
    b.add(sphere(18, 12), { bone: `paw${side}`, p: [shoulder[0], shoulder[1] - ARM_LEN, shoulder[2]], s: [0.068, 0.062, 0.066], color: coat.white, fur: 0.55 });
    // Stubby legs + big feet.
    b.add(new THREE.CapsuleGeometry(0.072, 0.06, 6, 14), { bone: `leg${side}`, p: [0, 0.16, 0.12 * s], color: paint.limb, fur: 0.85 });
    b.add(sphere(20, 12), { bone: `foot${side}`, p: [0.035, 0.068, 0.12 * s], s: [0.1, 0.062, 0.08], color: coat.white, fur: 0.5 });
  }
  // Fluffy tail along the bind-pose bone chain.
  addTail(b, CAT_TAIL, { radius: (t) => 0.056 + 0.016 * Math.sin(t * Math.PI) + 0.01 * t, color: paint.tail });
  b.add(sphere(14, 10), { bone: 'tail3', p: [-0.4, 0.66, 0], s: [0.075, 0.075, 0.075], color: coat.stripe, fur: 0.9 });
  return b.build();
}

function earOrigin(s) { return [HEAD_C.x - 0.05, HEAD_C.y + 0.165, 0.175 * s]; }
const CAT_TAIL = [[-0.21, 0.27], [-0.32, 0.33], [-0.39, 0.43], [-0.41, 0.54], [-0.4, 0.66]].map(([x, y]) => new THREE.Vector3(x, y, 0));

/** Glossy, fur-free details: eyes, nose, mouth, inner ears and the player-colored collar. */
function buildDetailGeometry(index, coat, accent) {
  const b = new SkinBuilder(index);
  const eyes = {};
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R';
    const { point, normal } = pointOnHead(0.01, 0.112 * s, 0.014);
    eyes[side] = point;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), normal);
    const r = new THREE.Euler().setFromQuaternion(q).toArray().slice(0, 3);
    b.add(sphere(20, 16), { bone: `eye${side}`, p: point.toArray(), r, s: [0.03, 0.064, 0.048], color: '#2a2230' });
    const glint = point.clone().addScaledVector(normal, 0.024).add(new THREE.Vector3(0, 0.026, -0.014 * s));
    b.add(sphere(10, 8), { bone: `eye${side}`, p: glint.toArray(), s: [0.012, 0.017, 0.014], color: '#ffffff' });
    const glint2 = point.clone().addScaledVector(normal, 0.024).add(new THREE.Vector3(0, -0.022, 0.012 * s));
    b.add(sphere(8, 6), { bone: `eye${side}`, p: glint2.toArray(), s: [0.006, 0.007, 0.007], color: '#ffffff' });
    const [ex, ey, ez] = earOrigin(s);
    b.add(new THREE.ConeGeometry(0.09, 0.17, 12, 1).translate(0, 0.085, 0), { bone: `ear${side}`, p: [ex + 0.03, ey + 0.005, ez], r: [0.32 * s, 0, 0.1], s: [0.3, 1, 1], color: coat.inner });
  }
  b.add(sphere(14, 10), { bone: 'head', p: [HEAD_C.x + HEAD_R.x + 0.003, HEAD_C.y - 0.045, 0], s: [0.024, 0.02, 0.032], color: coat.nose });
  b.add(sphere(14, 10), { bone: 'mouth', p: MOUTH.toArray(), s: [0.016, 0.026, 0.03], color: '#5b2f3a' });
  // Collar + bell in the player's color, so teammates read at a glance.
  const collar = addCollar(b, accent, [0.034, 0.034, 0.034]);
  return { geometry: b.build(), eyes, ...collar };
}

/** Species shape: skeleton layout, builders and coats. Every breed of a species shares one topology. */
export const CAT = {
  id: 'cat', coats: COATS, earOrigin, tail: CAT_TAIL, mouth: MOUTH,
  buildFur: buildFurGeometry, buildDetail: buildDetailGeometry, idleWag: 1.6, colors: new Map(),
};

function prepareAppearanceColors(species, index) {
  const { buildFur: buildFurGeometry, buildDetail: buildDetailGeometry } = species;
  species.preparation ||= (async () => {
    for (const [breed, coat] of Object.entries(species.coats)) {
      // Yield between breeds; preparation runs in idle slices behind the loading cover.
      await new Promise(resolve => typeof requestIdleCallback === 'function'
        ? requestIdleCallback(() => resolve(), { timeout: 100 }) : setTimeout(resolve, 0));
      const fur = buildFurGeometry(index, coat), details = buildDetailGeometry(index, coat, '#ffffff').geometry;
      species.colors.set(breed, { fur: fur.attributes.color.array.slice(), details: details.attributes.color.array.slice() });
      fur.dispose(); details.dispose();
    }
  })();
  return species.preparation;
}

export class CatModel {
  constructor({ species = CAT, coat = Object.values(species.coats)[0], accent = '#e8a592', furUniforms } = {}) {
    const { bones, index, root } = makeBones(species);
    this.species = species;
    this.group = new THREE.Group();
    this.bones = Object.fromEntries(bones.map((b) => [b.name, b]));
    // Eye and mouth bones are positioned from the head surface, then the skeleton is finalized.
    const probe = species.buildDetail({ ...index, eyeL: 0, eyeR: 0, mouth: 0 }, coat, accent);
    const head = this.bones.head;
    const headWorld = new THREE.Vector3(); head.getWorldPosition(headWorld);
    for (const side of ['L', 'R']) {
      const eye = new THREE.Bone(); eye.name = `eye${side}`;
      eye.position.copy(probe.eyes[side]).sub(headWorld); head.add(eye);
      index[eye.name] = bones.length; bones.push(eye); this.bones[eye.name] = eye;
    }
    const mouth = new THREE.Bone(); mouth.name = 'mouth';
    mouth.position.copy(species.mouth).sub(headWorld); head.add(mouth);
    index.mouth = bones.length; bones.push(mouth); this.bones.mouth = mouth;
    root.updateMatrixWorld(true);
    probe.geometry.dispose();

    this.skeleton = new THREE.Skeleton(bones);
    const furGeometry = species.buildFur(index, coat);
    // Shared uniforms let a second species model on the same player follow its wetness and wind.
    this.furBase = createFurMaterial({ ...FUR, shell: false, uniforms: furUniforms });
    this.furShell = createFurMaterial({ ...FUR, shell: true, uniforms: this.furBase.userData.fur });
    this.detail = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: new THREE.Color('#3a3a3a') });

    const base = new THREE.SkinnedMesh(furGeometry, this.furBase);
    const shells = new THREE.SkinnedMesh(createShellGeometry(furGeometry, FUR.shells), this.furShell);
    const detailData = species.buildDetail(index, coat, accent);
    const details = new THREE.SkinnedMesh(detailData.geometry, this.detail);
    this.collarStart = detailData.collarStart; this.collarCount = detailData.collarCount;
    base.add(root);
    for (const mesh of [base, shells, details]) {
      mesh.bind(this.skeleton, new THREE.Matrix4());
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    base.castShadow = details.castShadow = true;
    const mask = new THREE.SkinnedMesh(maskGeometry([furGeometry, details.geometry]), MASK_MATERIAL);
    mask.name = `${species.id}-velocity-mask`;
    mask.bind(this.skeleton, new THREE.Matrix4());
    mask.layers.set(1); // Mask only; never drawn by the main camera or shadow pass.
    mask.frustumCulled = false;
    this.group.add(mask);
    this.meshes = { base, shells, details, mask };
    this.applyFurQuality();
    this.appearanceReady = prepareAppearanceColors(species, index).then(() => {
      if (this.pendingAppearance) { const { breed, accent } = this.pendingAppearance; this.pendingAppearance = null; this.setAppearance(breed, accent); }
    });
  }

  /** All color arrays are prepared at boot. Selection uploads colors without rebuilding meshes or shaders. */
  setAppearance(breed, accent) {
    const colors = this.species.colors.get(breed);
    if (!colors) { this.pendingAppearance = { breed, accent }; return; }
    this.pendingAppearance = null;
    const fur = this.meshes.base.geometry.attributes.color, detail = this.meshes.details.geometry.attributes.color;
    fur.array.set(colors.fur); fur.needsUpdate = true;
    detail.array.set(colors.details);
    const color = new THREE.Color(accent);
    for (let i = this.collarStart; i < this.collarStart + this.collarCount; i++) detail.setXYZ(i, color.r, color.g, color.b);
    detail.needsUpdate = true;
  }

  /** Local visual quality only; every species reuses its prewarmed shell shader and buffers. */
  setFurShells(requested) {
    const count = setShellCount(this.meshes.shells.geometry, requested);
    this.meshes.shells.visible = count > 0;
    this.furBase.userData.fur.furShells.value = Math.max(1, count);
  }

  applyFurQuality() {
    const ceiling = normalizeFurShells(CFG.fur.shells);
    this.setFurShells(CFG.fur.auto ? Math.min(ceiling, FUR_STATUS.shells) : ceiling);
  }

  /** Gravity + motion drag for the strands, expressed in the cat's mesh space. */
  setFurForce(worldForce) {
    this.applyFurQuality();
    const inverse = this._inverse ||= new THREE.Matrix4();
    inverse.copy(this.meshes.base.matrixWorld).invert();
    this.furBase.userData.fur.furForce.value.copy(worldForce).transformDirection(inverse).multiplyScalar(Math.min(1.4, worldForce.length()));
  }
}
