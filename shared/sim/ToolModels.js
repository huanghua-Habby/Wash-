/** Procedural wash-tool meshes: station, supply tap, soap crate, soap bar and towel.
 * Pure Three scene graph (no WebGL), so the host authority, peers and tests build the same objects.
 * Parts sharing a material are merged into one mesh: each model costs one draw call per material. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHARACTER_SCALE as K } from './characterScale.js';

const lambert = (color, options = {}) => new THREE.MeshLambertMaterial({ color, ...options });
const gloss = (color, shininess = 60) => new THREE.MeshPhongMaterial({ color, shininess, specular: new THREE.Color('#5a5a5a') });
// Shared palette; only the towel cloth needs a per-instance material (durability tint).
const M = {
  cabinet: lambert('#d5d6b7'), cabinetDark: lambert('#b9bb98'), panel: lambert('#e3e4c8'),
  counter: lambert('#fff5dc'), basin: lambert('#f7fbf8', { side: THREE.DoubleSide }),
  water: gloss('#86c9d5', 90), foam: lambert('#ffffff'),
  chrome: gloss('#b8c8c8', 110), steel: lambert('#607b7c'),
  hot: lambert('#ef9a9a'), cold: lambert('#86c9d5'),
  tapBody: lambert('#86cddc'), tapDark: lambert('#5fa9b9'), tapYellow: lambert('#f0cf76'), tapCream: lambert('#fff5dc'),
  crate: lambert('#e7b6c6'), crateDark: lambert('#cf97aa'), crateRim: lambert('#fff1e6'),
  soap: lambert('#f0a9bd'), soapMint: lambert('#a9dcc6'), soapLemon: lambert('#f6dc8c'), stamp: lambert('#fff1e6'),
  stripe: lambert('#86c9d5'),
  wood: lambert('#c9935c'), woodDark: lambert('#9a6a3f'), sack: lambert('#e3cfa4'), sackDark: lambert('#c8b083'),
  bandana: lambert('#d1544a'), paint: lambert('#3b2a22'), cheek: lambert('#f0a08e'),
};
// Stable part identities let client palettes preserve merged model details.
for (const [part, material] of Object.entries(M)) material.userData.toolPart = part;

// Module-lived templates are borrowed by every room/view. Identity tracking keeps
// per-instance cloth materials and cloned palettes owned by their actual creator.
const sharedToolResources = new WeakSet(Object.values(M));
export function isSharedToolResource(resource) { return sharedToolResources.has(resource); }
/** Client-prepared tool templates follow the same context-owned lifetime as the procedural sources. */
export function shareToolResource(resource) { sharedToolResources.add(resource); return resource; }
function cacheGeometry(geometry) { sharedToolResources.add(geometry); return geometry; }

/** Collects transformed part geometries per material, then merges each list into one mesh. */
class Kit {
  constructor() { this.parts = new Map(); this.matrix = new THREE.Matrix4(); }
  add(material, geometry, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
    this.matrix.compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s));
    const g = (geometry.index ? geometry.toNonIndexed() : geometry).applyMatrix4(this.matrix);
    if (geometry.index) geometry.dispose();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!this.parts.has(material)) this.parts.set(material, []);
    this.parts.get(material).push(g);
    return this;
  }
  /** Merged geometries keyed by material; callers that pool items keep these as shared templates. */
  geometries() {
    return [...this.parts].map(([material, list]) => {
      const merged = mergeGeometries(list); list.forEach((g) => g.dispose());
      merged.computeBoundingSphere(); return [material, merged];
    });
  }
  build(group = new THREE.Group()) {
    for (const [material, geometry] of this.geometries()) group.add(new THREE.Mesh(geometry, material));
    return finish(group);
  }
}

function finish(group) {
  group.traverse((node) => { node.layers.enable(1); if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
  return group;
}

const rbox = (w, h, d, r, segments = 3) => new RoundedBoxGeometry(w, h, d, segments, Math.min(r, w / 2, h / 2, d / 2) - 1e-4);
const lathe = (points, segments = 28) => new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
const cyl = (top, bottom, height, segments = 20) => new THREE.CylinderGeometry(top, bottom, height, segments);
const sphere = (radius, w = 14, h = 10) => new THREE.SphereGeometry(radius, w, h);

/** Rounded rectangle path centred on the origin (Shape coordinates). */
function roundedRect(path, w, h, r) {
  const x = -w / 2, y = -h / 2;
  path.moveTo(x + r, y); path.lineTo(x + w - r, y); path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r); path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h); path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r); path.quadraticCurveTo(x, y, x + r, y);
  return path;
}

/** Flat slab in XZ with optional holes, soft bevelled edges; `y` is the slab's top surface. */
function slab(shape, thickness, bevel, y) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 18 });
  // Shape x → x, shape y → -z; extrusion runs along +y.
  g.rotateX(-Math.PI / 2); g.translate(0, y - thickness + bevel, 0);
  return g;
}

/** Wash station footprint in its truck-local frame: counter half extents (towel rail included) and tap height. */
export const STATION_SOLID = Object.freeze({ hx: 0.52, hz: 0.55, height: 1.05 });
/** Soap crate with its rim (buildSoapBox): solid sides and a standable top. */
export const SOAP_BOX_SOLID = Object.freeze({ hx: 0.45, hz: 0.35, height: 0.55 });
/** Body radius against solid roof props (PlayerMotion.resolveSolids); a little under the player-to-player radius. */
export const SOLID_RADIUS = 0.36 * K;

/** Wash station: panelled cabinet, bevelled counter with a sunken basin, gooseneck tap and a pump bottle. */
export function buildWashStation() {
  const kit = new Kit();
  // Cabinet on a recessed plinth; door panels on the front (+z) and side panels on both long faces.
  // The cabinet stops below the basin; a skirt with the same cut-out fills up to the counter.
  const basinZ = 0.05, rx = 0.29, rz = 0.33;
  const opening = () => new THREE.Path().absellipse(0, -basinZ, rx, rz, 0, Math.PI * 2, true);
  kit.add(M.cabinetDark, rbox(0.78, 0.07, 0.9, 0.03), { p: [0, 0.035, 0] });
  kit.add(M.cabinet, rbox(0.86, 0.42, 0.98, 0.06, 4), { p: [0, 0.27, 0] });
  const skirt = roundedRect(new THREE.Shape(), 0.86, 0.98, 0.06); skirt.holes.push(opening());
  kit.add(M.cabinet, slab(skirt, 0.18, 0.012, 0.64));
  for (const x of [-0.19, 0.19]) {
    kit.add(M.panel, rbox(0.34, 0.36, 0.04, 0.03), { p: [x, 0.28, 0.49] });
    kit.add(M.chrome, sphere(0.028), { p: [x - Math.sign(x) * 0.12, 0.38, 0.52] });
  }
  kit.add(M.panel, rbox(0.72, 0.1, 0.04, 0.03), { p: [0, 0.56, 0.49] });
  kit.add(M.chrome, rbox(0.16, 0.025, 0.03, 0.012), { p: [0, 0.56, 0.52] });
  for (const side of [-1, 1]) for (const z of [-0.22, 0.22]) kit.add(M.panel, rbox(0.04, 0.4, 0.38, 0.03), { p: [side * 0.43, 0.32, z] });
  // Towel rail on the +x side.
  for (const z of [-0.28, 0.28]) kit.add(M.chrome, cyl(0.014, 0.014, 0.07, 10), { p: [0.465, 0.5, z], r: [0, 0, Math.PI / 2] });
  kit.add(M.chrome, cyl(0.013, 0.013, 0.62, 12), { p: [0.5, 0.5, 0], r: [Math.PI / 2, 0, 0] });
  // Counter: one bevelled slab with an oval cut-out, the basin bowl hangs beneath it.
  const counter = roundedRect(new THREE.Shape(), 0.98, 1.1, 0.07); counter.holes.push(opening());
  kit.add(M.counter, slab(counter, 0.1, 0.025, 0.72));
  const bowl = lathe([[1, 0], [0.98, -0.06], [0.9, -0.13], [0.74, -0.19], [0.5, -0.225], [0.2, -0.24], [0, -0.242]], 36);
  kit.add(M.basin, bowl, { p: [0, 0.72, basinZ], s: [rx, 0.8, rz] });
  kit.add(M.water, new THREE.CircleGeometry(1, 36), { p: [0, 0.6, basinZ], r: [-Math.PI / 2, 0, 0], s: [rx * 0.84, rz * 0.84, 1] });
  for (const [x, z, r] of [[-0.08, 0.12, 0.035], [-0.03, 0.15, 0.025], [0.09, -0.02, 0.03], [0.05, 0.02, 0.02]]) {
    kit.add(M.foam, sphere(r, 10, 8), { p: [x, 0.6, basinZ + z], s: [1, 0.7, 1] });
  }
  // Backsplash with a teal tile band.
  kit.add(M.counter, rbox(0.98, 0.3, 0.07, 0.03), { p: [0, 0.85, -0.515] });
  kit.add(M.cold, rbox(0.9, 0.05, 0.02, 0.01), { p: [0, 0.86, -0.475] });
  // Gooseneck tap with hot/cold cross handles.
  kit.add(M.chrome, lathe([[0, 0], [0.06, 0], [0.065, 0.015], [0.05, 0.04], [0.035, 0.05], [0, 0.05]], 20), { p: [0, 0.72, -0.37] });
  const neck = new THREE.CatmullRomCurve3([[0, 0.76, -0.37], [0, 0.98, -0.37], [0, 1.07, -0.3], [0, 1.04, -0.2], [0, 0.97, -0.17]].map((v) => new THREE.Vector3(...v)));
  kit.add(M.chrome, new THREE.TubeGeometry(neck, 24, 0.024, 12, false));
  kit.add(M.chrome, lathe([[0, -0.03], [0.034, -0.03], [0.03, 0.01], [0.024, 0.02], [0, 0.02]], 16), { p: [0, 0.96, -0.17] });
  kit.add(M.chrome, sphere(0.024, 12, 8), { p: [0, 0.98, -0.37] });
  for (const [x, cap] of [[-0.15, M.hot], [0.15, M.cold]]) {
    kit.add(M.chrome, cyl(0.03, 0.04, 0.06, 16), { p: [x, 0.75, -0.37] });
    kit.add(M.chrome, rbox(0.12, 0.022, 0.03, 0.01), { p: [x, 0.79, -0.37] });
    kit.add(M.chrome, rbox(0.03, 0.022, 0.12, 0.01), { p: [x, 0.79, -0.37] });
    kit.add(cap, lathe([[0, 0], [0.022, 0], [0.02, 0.012], [0, 0.018]], 14), { p: [x, 0.8, -0.37] });
  }
  // Pump soap bottle on the front-right corner of the counter.
  kit.add(M.hot, lathe([[0, 0], [0.06, 0], [0.068, 0.02], [0.068, 0.11], [0.05, 0.14], [0.026, 0.15], [0, 0.15]], 20), { p: [0.37, 0.72, 0.4] });
  kit.add(M.counter, cyl(0.012, 0.012, 0.06, 10), { p: [0.37, 0.9, 0.4] });
  kit.add(M.counter, rbox(0.06, 0.02, 0.03, 0.009), { p: [0.385, 0.93, 0.4] });
  return kit.build();
}

/** Tutorial slap dummy (TrainingDummy): the "enemy" sack puppet on a post. The returned group's origin is the base on
 * the roof; its child `pivot` (also at the base) is what the client wobbles when it is hit. */
export const DUMMY_SOLID = Object.freeze({ hx: 0.26, hz: 0.26, height: 1.25 });
export function buildTrainingDummy() {
  const kit = new Kit();
  // Weighted round base and a post.
  kit.add(M.woodDark, lathe([[0, 0], [0.3, 0], [0.31, 0.03], [0.27, 0.09], [0.12, 0.12], [0, 0.12]], 24));
  kit.add(M.wood, cyl(0.05, 0.06, 0.5, 12), { p: [0, 0.35, 0] });
  // Stuffed sack body with stitched belts and stubby arms on a cross bar.
  kit.add(M.sack, lathe([[0, 0], [0.2, 0.02], [0.27, 0.14], [0.28, 0.3], [0.24, 0.44], [0.12, 0.5], [0, 0.5]], 24), { p: [0, 0.48, 0] });
  for (const y of [0.6, 0.8]) kit.add(M.sackDark, new THREE.TorusGeometry(0.275, 0.016, 8, 28), { p: [0, y, 0], r: [Math.PI / 2, 0, 0] });
  kit.add(M.wood, cyl(0.035, 0.035, 0.86, 10), { p: [0, 0.78, 0], r: [Math.PI / 2, 0, 0] });
  for (const z of [-1, 1]) kit.add(M.sack, sphere(0.09, 12, 9), { p: [0, 0.78, z * 0.44] });
  // Round head with a red "enemy" bandana, angry painted brows, eyes and a frown (front is +x).
  kit.add(M.sack, sphere(0.22, 18, 14), { p: [0, 1.12, 0] });
  kit.add(M.bandana, lathe([[0.215, 0], [0.23, 0.04], [0.22, 0.09], [0.2, 0.1]], 24), { p: [0, 1.13, 0] });
  kit.add(M.bandana, sphere(0.05, 10, 8), { p: [-0.2, 1.17, 0.08], s: [1, 0.8, 0.6] });
  kit.add(M.bandana, rbox(0.03, 0.13, 0.06, 0.012), { p: [-0.23, 1.09, 0.12], r: [0.5, 0, 0] });
  for (const z of [-1, 1]) {
    kit.add(M.paint, sphere(0.032, 10, 8), { p: [0.2, 1.08, z * 0.075], s: [0.5, 1.2, 1] });
    kit.add(M.paint, rbox(0.02, 0.022, 0.1, 0.008), { p: [0.205, 1.14, z * 0.07], r: [z * 0.45, 0, 0] });
    kit.add(M.cheek, sphere(0.03, 8, 6), { p: [0.19, 1.03, z * 0.12], s: [0.4, 0.7, 1] });
  }
  kit.add(M.paint, new THREE.TorusGeometry(0.05, 0.011, 6, 14, Math.PI), { p: [0.205, 0.98, 0], r: [0, Math.PI / 2, 0] });
  const pivot = kit.build(); pivot.name = 'training-dummy-pivot';
  const group = new THREE.Group(); group.name = 'training-dummy'; group.add(pivot); group.userData.pivot = pivot;
  return group;
}

/** Water supply hydrant; the origin is the hose anchor at the outlet, the base sits 0.77 below it. */
export function buildSupplyPoint(height = 0.77) {
  const kit = new Kit(), floor = -height;
  kit.add(M.tapDark, lathe([[0, 0], [0.27, 0], [0.28, 0.02], [0.25, 0.06], [0.2, 0.07], [0, 0.07]], 28), { p: [0, floor, 0] });
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + Math.PI / 6;
    kit.add(M.tapYellow, cyl(0.022, 0.022, 0.025, 10), { p: [Math.cos(a) * 0.22, floor + 0.075, Math.sin(a) * 0.22] });
  }
  // Barrel: soft waist, rounded shoulders and a domed cap above the outlet.
  kit.add(M.tapBody, lathe([[0, 0], [0.17, 0], [0.16, 0.2], [0.15, 0.45], [0.165, 0.62], [0.17, 0.74], [0.16, 0.8], [0.13, 0.86], [0.07, 0.9], [0, 0.91]], 32), { p: [0, floor + 0.06, 0] });
  for (const y of [0.18, 0.62]) kit.add(M.tapCream, new THREE.TorusGeometry(0.16, 0.02, 10, 32), { p: [0, floor + y, 0], r: [Math.PI / 2, 0, 0] });
  // Outlet spout towards +z with a hex nut; the hose leaves from its mouth.
  kit.add(M.tapYellow, cyl(0.075, 0.085, 0.2, 20), { p: [0, 0, 0.12], r: [Math.PI / 2, 0, 0] });
  kit.add(M.tapDark, cyl(0.095, 0.095, 0.05, 6), { p: [0, 0, 0.2], r: [Math.PI / 2, 0, 0] });
  kit.add(M.tapYellow, new THREE.TorusGeometry(0.07, 0.018, 8, 20), { p: [0, 0, 0.23] });
  // Valve wheel on top.
  const top = floor + 0.97;
  kit.add(M.steel, cyl(0.022, 0.022, 0.08, 10), { p: [0, top, 0] });
  kit.add(M.hot, new THREE.TorusGeometry(0.11, 0.02, 10, 28), { p: [0, top + 0.04, 0], r: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 3; i++) kit.add(M.hot, cyl(0.012, 0.012, 0.22, 8), { p: [0, top + 0.04, 0], r: [Math.PI / 2, 0, i / 3 * Math.PI] });
  kit.add(M.tapCream, sphere(0.03), { p: [0, top + 0.05, 0] });
  return kit.build();
}

/** Soap crate: rounded tub with rim, side handles, a bubble label and bars piled under foam.
 * The origin is the crate centre, 0.3 above the roof, matching interaction range and HUD badge. */
export function buildSoapBox() {
  const kit = new Kit(), floor = -0.3;
  kit.add(M.crate, rbox(0.85, 0.5, 0.65, 0.08, 4), { p: [0, floor + 0.25, 0] });
  kit.add(M.crateDark, rbox(0.8, 0.05, 0.6, 0.025), { p: [0, floor + 0.025, 0] });
  const rim = roundedRect(new THREE.Shape(), 0.9, 0.7, 0.1);
  rim.holes.push(roundedRect(new THREE.Path(), 0.72, 0.52, 0.06));
  kit.add(M.crateRim, slab(rim, 0.06, 0.02, floor + 0.53));
  kit.add(M.crateDark, rbox(0.74, 0.03, 0.54, 0.015), { p: [0, floor + 0.45, 0] });
  // Ribs on the long faces, loop handles on the short faces.
  for (const z of [-1, 1]) for (const x of [-0.3, 0.3]) kit.add(M.crateDark, rbox(0.05, 0.3, 0.03, 0.012), { p: [x, floor + 0.24, z * 0.33] });
  for (const x of [-1, 1]) {
    kit.add(M.crateRim, new THREE.TorusGeometry(0.09, 0.022, 10, 20, Math.PI), { p: [x * 0.43, floor + 0.36, 0], r: [0, 0, -x * Math.PI / 2] });
  }
  // Front label with a bubble mark.
  kit.add(M.crateRim, rbox(0.34, 0.16, 0.03, 0.03), { p: [0, floor + 0.28, 0.335] });
  for (const [x, y, r] of [[-0.05, 0.27, 0.04], [0.04, 0.3, 0.028], [0.07, 0.25, 0.02]]) kit.add(M.stripe, sphere(r, 10, 8), { p: [x, floor + y, 0.35], s: [1, 1, 0.35] });
  // Bars piled inside, tumbling at different angles, half-buried in foam.
  for (const [mat, x, z, ry, rz, y] of [[M.soap, -0.18, -0.08, 0.3, 0.12, 0.5], [M.soapMint, 0.12, 0.1, -0.5, -0.1, 0.51], [M.soapLemon, 0.2, -0.12, 0.9, 0.25, 0.55], [M.soap, -0.05, 0.13, 1.3, -0.2, 0.56]]) {
    kit.add(mat, rbox(0.26, 0.08, 0.16, 0.035), { p: [x, floor + y, z], r: [0.1, ry, rz] });
  }
  for (const [x, z, r] of [[-0.25, 0.14, 0.07], [-0.12, 0.17, 0.05], [0.02, -0.15, 0.06], [0.27, 0.12, 0.055], [0.3, -0.17, 0.045], [-0.28, -0.16, 0.05], [0.07, -0.02, 0.04]]) {
    kit.add(M.foam, sphere(r, 12, 9), { p: [x, floor + 0.5, z], s: [1, 0.8, 1] });
  }
  return kit.build();
}

/** Shared bar templates: pooled soaps reuse these geometries and materials. */
let soapParts;
export function buildSoapBar() {
  soapParts ||= (() => {
    const kit = new Kit();
    // Pillowy bar: rounded box squashed at the top edge, with an embossed heart.
    kit.add(M.soap, rbox(0.62, 0.18, 0.38, 0.085, 5));
    const heart = new THREE.Shape();
    heart.moveTo(0, -0.07); heart.bezierCurveTo(0.03, -0.04, 0.09, -0.01, 0.075, 0.035);
    heart.bezierCurveTo(0.065, 0.07, 0.02, 0.07, 0, 0.035);
    heart.bezierCurveTo(-0.02, 0.07, -0.065, 0.07, -0.075, 0.035);
    heart.bezierCurveTo(-0.09, -0.01, -0.03, -0.04, 0, -0.07);
    const emboss = new THREE.ExtrudeGeometry(heart, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.008, bevelSegments: 2, curveSegments: 12 });
    // Lobes towards -z on the bar's top face.
    kit.add(M.stamp, emboss, { p: [0, 0.088, 0], r: [-Math.PI / 2, 0, 0], s: [1.25, 1.25, 1] });
    return kit.geometries().map(([material, geometry]) => [material, cacheGeometry(geometry)]);
  })();
  return finish(new THREE.Group().add(...soapParts.map(([material, geometry]) => new THREE.Mesh(geometry, material))));
}

/** Shared towel templates; `cloth` is the per-towel tinted material. */
let towelParts;
export function buildTowel(cloth) {
  towelParts ||= (() => {
    // Two folded layers joined by a rolled edge at -x; stripes near the open end.
    const fabric = new Kit(), trim = new Kit();
    fabric.add(M.foam, rbox(0.6, 0.075, 0.43, 0.035, 3), { p: [0, 0, 0] });
    fabric.add(M.foam, rbox(0.5, 0.07, 0.42, 0.033, 3), { p: [0.03, 0.07, 0] });
    fabric.add(M.foam, new THREE.CylinderGeometry(0.07, 0.07, 0.42, 20, 1, false, Math.PI, Math.PI), { p: [-0.23, 0.035, 0], r: [Math.PI / 2, 0, 0], s: [0.75, 1, 1] });
    for (const x of [0.18, 0.23]) trim.add(M.stripe, rbox(0.025, 0.012, 0.425, 0.005), { p: [x, 0.105, 0] });
    const parts = { fabric: cacheGeometry(fabric.geometries()[0][1]), trim: trim.geometries()[0] };
    cacheGeometry(parts.trim[1]);
    return parts;
  })();
  const group = new THREE.Group().add(new THREE.Mesh(towelParts.fabric, cloth), new THREE.Mesh(towelParts.trim[1], towelParts.trim[0]));
  return finish(group);
}

// EV charging set: a home-vehicle charging post, a connector "gun" and order-vehicle charge ports.
// Glossy cream shells, dark rubber, metal contacts and mint indicator lights; per-instance lights keep their own material.
const EV = {
  shell: gloss('#f6f3ec', 50), shellShade: lambert('#dfe2dc'), rubber: lambert('#2e353b'), rubberSoft: lambert('#3d464d'),
  metal: gloss('#c7d1d4', 120), contact: gloss('#e8c66a', 120), accent: lambert('#62c9a0'), screen: gloss('#20303a', 90),
  bolt: lambert('#f3c94c', { emissive: new THREE.Color('#5a4300') }),
};
for (const [part, material] of Object.entries(EV)) material.userData.toolPart = `ev-${part}`;
// Module-lived like M: rooms and views borrow them, so disposal must skip them.
for (const material of Object.values(EV)) sharedToolResources.add(material);
/** Zig-zag lightning badge in the XY plane, `size` tall, extruded slightly toward +z. */
function boltGeometry(size) {
  const k = size / 10, shape = new THREE.Shape();
  [[1, 5], [-2.5, -0.5], [-0.3, -0.5], [-1, -5], [2.5, 0.8], [0.3, 0.8]].forEach(([x, y], i) => i ? shape.lineTo(x * k, y * k) : shape.moveTo(x * k, y * k));
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 0.004, bevelEnabled: false });
}
const evLight = (color = '#7be3b4') => new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.55) });

/** Connector face toward +x: pin sockets in a rounded black face inside a metal rim, centred at (x, y, 0). */
function connectorFace(kit, x, radius, y = 0) {
  kit.add(EV.metal, new THREE.TorusGeometry(radius, radius * 0.12, 8, 28), { p: [x, y, 0], r: [0, Math.PI / 2, 0] });
  kit.add(EV.rubber, cyl(radius * 0.92, radius * 0.92, 0.02, 28), { p: [x - 0.006, y, 0], r: [0, 0, Math.PI / 2] });
  // Two large DC pins below, five small AC pins above, like a combo plug.
  for (const z of [-0.36, 0.36]) kit.add(EV.contact, cyl(radius * 0.16, radius * 0.16, 0.012, 12), { p: [x + 0.004, y - radius * 0.42, z * radius], r: [0, 0, Math.PI / 2] });
  for (const [v, z] of [[0.38, 0], [0.22, -0.4], [0.22, 0.4], [0, -0.22], [0, 0.22]]) {
    kit.add(EV.contact, cyl(radius * 0.09, radius * 0.09, 0.012, 10), { p: [x + 0.004, y + v * radius, z * radius], r: [0, 0, Math.PI / 2] });
  }
}

/** Handheld EV connector, nose toward +x. The cable leaves the strain-relief boot at (-0.16, -0.08, 0) (ChargingHead.connector). */
export function buildChargingGun() {
  const kit = new Kit(), light = evLight();
  // Housing: a rounded shell with a shaded underside and a mint stripe.
  kit.add(EV.shell, rbox(0.3, 0.2, 0.2, 0.07, 4), { p: [0.06, 0.16, 0] });
  kit.add(EV.shellShade, rbox(0.26, 0.05, 0.19, 0.022, 3), { p: [0.07, 0.075, 0] });
  for (const z of [-0.101, 0.101]) kit.add(EV.accent, rbox(0.12, 0.026, 0.01, 0.005), { p: [0.1, 0.17, z] });
  // Nose sleeve and connector face.
  kit.add(EV.rubber, lathe([[0, 0], [0.1, 0], [0.105, 0.03], [0.098, 0.09], [0, 0.09]], 28), { p: [0.2, 0.15, 0], r: [0, 0, -Math.PI / 2] });
  connectorFace(kit, 0.295, 0.085, 0.15);
  // Latch button on top and a lightning badge on each side.
  kit.add(EV.rubberSoft, rbox(0.09, 0.03, 0.07, 0.014), { p: [0.13, 0.265, 0], r: [0, 0, -0.12] });
  for (const z of [-1, 1]) kit.add(EV.bolt, boltGeometry(0.075), { p: [-0.025, 0.16, 0.1 * z], r: [0, z < 0 ? Math.PI : 0, 0] });
  // Pistol grip with finger ridges, then the ribbed boot where the cable enters.
  kit.add(EV.rubber, rbox(0.11, 0.27, 0.13, 0.045, 4), { p: [-0.095, 0.02, 0], r: [0, 0, -0.42] });
  for (let i = 0; i < 3; i++) kit.add(EV.rubberSoft, rbox(0.02, 0.03, 0.125, 0.009), { p: [-0.045 + i * 0.02, -0.01 - i * 0.045, 0], r: [0, 0, -0.42] });
  kit.add(EV.rubber, lathe([[0, 0], [0.05, 0], [0.045, 0.03], [0.034, 0.08], [0.028, 0.1], [0, 0.1]], 20), { p: [-0.14, -0.05, 0], r: [0, 0, 2.7] });
  for (let i = 0; i < 3; i++) kit.add(EV.rubberSoft, new THREE.TorusGeometry(0.042 - i * 0.005, 0.008, 6, 18), { p: [-0.145 - i * 0.012, -0.065 - i * 0.026, 0], r: [Math.PI / 2, 0, 2.7 - Math.PI / 2] });
  const group = kit.build();
  // Status ring around the nose; its own material so a future "charging" glow does not tint other parts.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.103, 0.01, 8, 32), light);
  ring.position.set(0.22, 0.15, 0); ring.rotation.y = Math.PI / 2; group.add(ring);
  group.userData.light = ring;
  return finish(group);
}

/** Charging post on the home vehicle. The origin is the cable outlet on its -x face; the base sits `height` below it. */
export function buildChargingPost(height = 0.25) {
  const kit = new Kit(), floor = -height, light = evLight(), screenGlow = evLight('#9ff0cf');
  const cx = 0.17, w = 0.34, d = 0.42, h = 0.92;
  // Plinth, rounded body with a mint inset panel and a sloped cap.
  kit.add(EV.rubber, rbox(w + 0.08, 0.07, d + 0.08, 0.025), { p: [cx, floor + 0.035, 0] });
  kit.add(EV.shell, rbox(w, h, d, 0.08, 4), { p: [cx, floor + 0.07 + h / 2, 0] });
  kit.add(EV.accent, rbox(0.012, h * 0.62, d * 0.62, 0.006), { p: [cx - w / 2 - 0.002, floor + 0.07 + h * 0.52, 0] });
  kit.add(EV.shellShade, rbox(w + 0.04, 0.05, d + 0.04, 0.022), { p: [cx, floor + 0.07 + h + 0.02, 0], r: [0, 0, 0.12] });
  // Screen and two buttons on the -x face, above the outlet.
  kit.add(EV.screen, rbox(0.016, 0.2, 0.28, 0.012), { p: [cx - w / 2 - 0.008, floor + 0.07 + h * 0.74, 0] });
  kit.add(EV.bolt, boltGeometry(0.1), { p: [cx - w / 2 - 0.02, floor + 0.07 + h * 0.74, 0], r: [0, -Math.PI / 2, 0] });
  for (const z of [-0.07, 0.07]) kit.add(EV.rubberSoft, cyl(0.018, 0.018, 0.016, 12), { p: [cx - w / 2 - 0.006, floor + 0.07 + h * 0.55, z], r: [0, 0, Math.PI / 2] });
  // Side holster cradle where the connector is parked when idle.
  kit.add(EV.rubber, rbox(0.12, 0.16, 0.06, 0.025), { p: [cx - 0.02, floor + 0.07 + h * 0.62, d / 2 + 0.03] });
  kit.add(EV.rubberSoft, rbox(0.08, 0.03, 0.07, 0.012), { p: [cx - 0.02, floor + 0.07 + h * 0.62 + 0.07, d / 2 + 0.05] });
  // Cable outlet: a ribbed rubber gland pointing out of the -x face.
  kit.add(EV.rubber, cyl(0.07, 0.08, 0.06, 20), { p: [0.03, 0, 0], r: [0, 0, Math.PI / 2] });
  for (let i = 0; i < 2; i++) kit.add(EV.rubberSoft, new THREE.TorusGeometry(0.06, 0.01, 6, 18), { p: [-0.005 - i * 0.02, 0, 0], r: [0, Math.PI / 2, 0] });
  const group = kit.build();
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.14), screenGlow);
  screen.position.set(cx - w / 2 - 0.0165, floor + 0.07 + h * 0.74, 0); screen.rotation.y = -Math.PI / 2;
  // Status strip across the top front edge.
  const strip = new THREE.Mesh(rbox(0.014, 0.03, d * 0.7, 0.007), light);
  strip.position.set(cx - w / 2 - 0.003, floor + 0.07 + h * 0.93, 0);
  group.add(screen, strip); group.userData.led = strip; group.userData.screen = screen;
  return finish(group);
}

/** Order-vehicle charge port: a rounded housing, an open hinged flap and a socket facing -x; `userData.led` is its own material. */
export function buildChargePort() {
  const kit = new Kit(), light = evLight('#d0c6af');
  kit.add(EV.rubber, rbox(0.38, 0.26, 0.48, 0.06, 3), { p: [0, 0, 0] });
  kit.add(EV.shellShade, rbox(0.3, 0.035, 0.4, 0.015), { p: [0, 0.135, 0] });
  // Recessed socket ring and face toward -x.
  kit.add(EV.shellShade, cyl(0.12, 0.12, 0.03, 28), { p: [-0.19, 0.0, 0], r: [0, 0, Math.PI / 2] });
  const face = new Kit(); connectorFace(face, 0, 0.09);
  for (const [material, geometry] of face.geometries()) kit.add(material, geometry, { p: [-0.205, 0, 0], r: [0, Math.PI, 0] });
  // Flap swung open toward -z, hinged on the housing edge.
  kit.add(EV.shell, rbox(0.02, 0.22, 0.24, 0.03, 3), { p: [-0.25, 0.0, -0.26], r: [0, -1.1, 0] });
  const group = kit.build();
  const led = new THREE.Mesh(rbox(0.25, 0.022, 0.32, 0.01), light);
  led.position.y = 0.16; group.add(led); group.userData.led = led;
  return finish(group);
}

/** Building blocks for other procedural props (HackConsoleModel.js). */
export { Kit, rbox, cyl, finish };
