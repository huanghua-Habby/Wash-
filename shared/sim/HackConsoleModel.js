/** Versus hack console art (HackConsole.js): a chunky low-poly terminal on the home truck's rear deck. Pure Three
 * scene graph like ToolModels, so the host, peers and tests build the same object; the client paints the two screens
 * (canvas texture) and drives the glow colours (HackConsoleView.js). Origin: deck surface under the console centre;
 * in model space the keyboard and the main screen face +x (the hacker's side) and a back screen faces -x.
 * HackConsole turns it half round so the main screen faces the tail of the truck and the camera. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Kit, rbox, cyl, finish } from './ToolModels.js';

/** Solid footprint (PlayerMotion.resolveSolids): players bump around it and can hop onto the plinth-height top. */
export const HACK_CONSOLE_SOLID = Object.freeze({ hx: 0.34, hz: 0.5, height: 1.25 });
/** Screen canvas aspect (width / height) shared with the client painter. */
export const HACK_SCREEN = Object.freeze({ width: 0.86, height: 0.5 });

// Faceted Lambert keeps the low-poly read under the scene lights; one instance per console, owned by its room.
const facet = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
// Unlit HDR parts: colour × intensity above the Bloom threshold glows (GlowMaterials.js convention). The view recolours them.
const glow = (color, intensity) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) });

export function buildHackConsole() {
  const M = {
    shell: facet('#4c5a70'), shellDark: facet('#2f3848'), trim: facet('#f0cf76'), cream: facet('#fff5dc'),
    key: facet('#e3e4c8'), rubber: facet('#262b33'), bezel: facet('#252c38'),
  };
  const G = { strip: glow('#7fe3f0', 2.4), keys: glow('#7fe3f0', 2.2), tip: glow('#ff6f61', 3) };
  const group = new THREE.Group(), kit = new Kit();
  // Plinth with a mustard hazard band on the front and back, and a glowing underlight strip around its top edge.
  kit.add(M.shellDark, rbox(0.66, 0.1, 0.96, 0.03, 1), { p: [0, 0.05, 0] });
  for (const x of [-0.335, 0.335]) for (let i = 0; i < 6; i++) {
    kit.add(i % 2 ? M.rubber : M.trim, new THREE.BoxGeometry(0.012, 0.06, 0.14), { p: [x, 0.05, -0.35 + i * 0.14] });
  }
  kit.add(G.strip, new THREE.BoxGeometry(0.6, 0.022, 0.9), { p: [0, 0.111, 0] });
  // Tapered cabinet: a four-sided frustum turned square to the axes reads as a faceted box that narrows upward.
  const cabinet = new THREE.CylinderGeometry(0.33, 0.4, 0.5, 4, 1); cabinet.rotateY(Math.PI / 4);
  kit.add(M.shell, cabinet, { p: [0, 0.37, 0], s: [0.78, 1, 1.13] });
  // Side vents and mustard corner bumpers.
  for (const z of [-0.42, 0.42]) for (const y of [0.3, 0.38, 0.46]) kit.add(M.shellDark, new THREE.BoxGeometry(0.22, 0.025, 0.02), { p: [0, y, z * 0.93] });
  for (const x of [-0.24, 0.24]) for (const z of [-0.4, 0.4]) kit.add(M.trim, new THREE.BoxGeometry(0.06, 0.5, 0.06), { p: [x * 0.92, 0.37, z * 0.92] });
  // Cream lid with the slanted keyboard deck on its +x half.
  kit.add(M.cream, rbox(0.5, 0.06, 0.8, 0.02, 1), { p: [0, 0.645, 0] });
  const tilt = -0.42, deck = [0.1, 0.71], keyAt = (u, h) => [deck[0] + u * Math.cos(tilt) - h * Math.sin(tilt), deck[1] + u * Math.sin(tilt) + h * Math.cos(tilt)];
  kit.add(M.shellDark, new THREE.BoxGeometry(0.3, 0.05, 0.74), { p: [...keyAt(0, 0), 0], r: [0, 0, tilt] });
  // Three rows of keycaps; a handful glow so the deck sparkles while someone types.
  for (let row = 0; row < 3; row++) for (let col = 0; col < 8; col++) {
    const lit = (row * 8 + col) % 5 === 2, [x, y] = keyAt(-0.09 + row * 0.09, 0.035);
    kit.add(lit ? G.keys : M.key, new THREE.BoxGeometry(0.065, 0.025, 0.07), { p: [x, y, -0.3 + col * 0.0857], r: [0, 0, tilt] });
  }
  // Spacebar and a big red "enter" button.
  { const [x, y] = keyAt(0.12, 0.035); kit.add(M.key, new THREE.BoxGeometry(0.06, 0.025, 0.36), { p: [x, y, -0.05], r: [0, 0, tilt] }); }
  { const [x, y] = keyAt(0.115, 0.04); kit.add(G.tip, cyl(0.035, 0.04, 0.04, 6), { p: [x, y, 0.26], r: [0, 0, tilt] }); }
  // Neck from the lid's back half up to the monitor.
  kit.add(M.shellDark, cyl(0.05, 0.065, 0.42, 6), { p: [-0.15, 0.86, 0] });
  // Two fat cables off the back, curling down onto the deck.
  for (const z of [-0.18, 0.2]) {
    const curve = new THREE.CatmullRomCurve3([[-0.25, 0.5, z], [-0.42, 0.42, z * 1.2], [-0.48, 0.12, z * 1.5], [-0.62, 0.03, z * 1.9]].map((v) => new THREE.Vector3(...v)));
    kit.add(M.rubber, new THREE.TubeGeometry(curve, 10, 0.03, 5, false));
  }

  // Monitor: its own group so the bezel, screens and antenna share one backward tilt. The gameplay camera looks down
  // steeply from behind the truck; leaning the main screen back ~25° turns it toward that view.
  const monitor = new THREE.Matrix4().compose(new THREE.Vector3(-0.17, 1.2, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.44)), new THREE.Vector3(1, 1, 1));
  const frame = new Kit();
  frame.add(M.bezel, rbox(0.12, 0.62, 1.0, 0.04, 1));
  for (const y of [-0.29, 0.29]) for (const z of [-0.48, 0.48]) frame.add(M.trim, new THREE.BoxGeometry(0.14, 0.07, 0.07), { p: [0, y, z] });
  // Antenna with a blinking low-poly tip and two little "ears" (a nod to the cast of animals).
  frame.add(M.shellDark, cyl(0.012, 0.016, 0.3, 5), { p: [0, 0.46, 0.34] });
  frame.add(G.tip, new THREE.IcosahedronGeometry(0.045, 0), { p: [0, 0.63, 0.34] });
  for (const z of [-0.36, -0.2]) frame.add(M.shell, new THREE.ConeGeometry(0.06, 0.12, 4), { p: [0, 0.35, z] });
  frame.add(G.strip, new THREE.BoxGeometry(0.125, 0.018, 0.8), { p: [0, -0.285, 0] });

  // Draw-call budget (the user: as few as possible): every flat-coloured part of the body and the monitor (baked into
  // its tilt) is one vertex-coloured mesh; the glow parts the view recolours stay one mesh per glow (strip, keys, tip);
  // both screens are one mesh. Five draws, and only the body casts a shadow.
  const glows = new Set(Object.values(G)), facets = [], glowParts = new Map();
  for (const [material, geometry] of [...kit.geometries(), ...frame.geometries().map(([m, g]) => [m, g.applyMatrix4(monitor)])]) {
    if (glows.has(material)) { if (!glowParts.has(material)) glowParts.set(material, []); glowParts.get(material).push(geometry); continue; }
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = material.color.r; colors[i + 1] = material.color.g; colors[i + 2] = material.color.b; }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); facets.push(geometry);
  }
  for (const material of Object.values(M)) material.dispose();
  const body = new THREE.Mesh(mergeGeometries(facets), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  facets.forEach((g) => g.dispose()); group.add(body);
  const glowMeshes = [...glowParts].map(([material, list]) => {
    const mesh = new THREE.Mesh(mergeGeometries(list), material); list.forEach((g) => g.dispose()); group.add(mesh); return mesh;
  });
  // Screens: one on each face of the monitor, both showing the same canvas. A plane faces +z; a quarter turn about y
  // faces it ±x and keeps the text reading left to right for a viewer on that side.
  const screenGeometry = mergeGeometries([1, -1].map((side) => new THREE.PlaneGeometry(HACK_SCREEN.width, HACK_SCREEN.height)
    .applyMatrix4(new THREE.Matrix4().makeRotationY(side * Math.PI / 2).setPosition(side * 0.062, 0.01, 0)).applyMatrix4(monitor)));
  const screen = new THREE.Mesh(screenGeometry, new THREE.MeshBasicMaterial({ color: '#0f2a2c' }));
  group.add(screen);
  finish(group);
  for (const mesh of [...glowMeshes, screen]) mesh.castShadow = false;
  group.userData.hack = { screens: [screen], glow: G };
  return group;
}
