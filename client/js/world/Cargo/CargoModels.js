import * as THREE from 'three';
import { Builder } from '../../render/Builder.js';

const COLORS = Object.freeze({
  barkA: '#9A6845',
  barkB: '#B47A4F',
  barkDark: '#6E442F',
  cutA: '#D5A764',
  cutB: '#E0B978',
  rope: '#9C8150',
  ropeDark: '#6D5A3C',
  crate: '#C99055',
  crateLight: '#DDA866',
  crateDark: '#8A5A37',
  metal: '#928B7C',
  metalDark: '#5D5A52',
});

function finish(group) {
  group.traverse((node) => {
    node.layers.enable(1);
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  return group;
}

function addTorus(builder, radius, tube, color, options) {
  return builder.add(() => new THREE.TorusGeometry(radius, tube, 8, 28), color, options);
}

function addLog(builder, { x = 0, y, z, radius, length, roll = 0, color = COLORS.barkA, cut = COLORS.cutA }) {
  const rotation = [Math.PI / 2, 0, Math.PI / 2 + roll];
  builder.cyl(radius, radius * 0.96, length, 12, color, { p: [x, y, z], r: rotation });
  for (const side of [-1, 1]) {
    const endX = x + side * (length / 2 + 0.018);
    builder.cyl(radius * 0.92, radius * 0.86, 0.04, 12, cut, { p: [endX, y, z], r: rotation, outline: false });
    builder.cyl(radius * 0.55, radius * 0.5, 0.044, 12, '#B77F4E', { p: [endX + side * 0.006, y, z], r: rotation, outline: false });
    builder.box(0.012, radius * 1.15, 0.018, COLORS.barkDark, {
      p: [endX + side * 0.028, y + radius * 0.08, z - radius * 0.1],
      r: [0, 0, 0.45],
      outline: false,
    });
  }
  for (const offset of [-0.28, 0.16, 0.46]) {
    builder.box(length * 0.74, 0.035, 0.035, '#C28A59', {
      p: [x + offset * 0.08, y + radius * 0.42, z + radius * 0.35],
      r: [0, 0, roll * 0.25],
      outline: false,
    });
  }
}

/** A strapped bundle of cut logs. Origin sits at the bundle centre on the floor. */
export function buildWoodPile() {
  const b = new Builder(0.035);
  const length = 2.6;
  const rows = [
    [-0.46, 0.28, -0.38, 0.23], [-0.16, 0.28, -0.39, 0.24], [0.16, 0.28, -0.37, 0.23], [0.46, 0.28, -0.38, 0.24],
    [-0.34, 0.63, -0.12, 0.24], [0, 0.63, -0.1, 0.25], [0.34, 0.63, -0.11, 0.24],
    [-0.2, 0.96, 0.12, 0.23], [0.2, 0.96, 0.13, 0.24],
  ];
  rows.forEach(([z, y, xOffset, radius], index) => addLog(b, {
    x: xOffset,
    y,
    z,
    radius,
    length: length + (index % 3 - 1) * 0.12,
    roll: (index - 4) * 0.035,
    color: index % 2 ? COLORS.barkA : COLORS.barkB,
    cut: index % 2 ? COLORS.cutA : COLORS.cutB,
  }));
  for (const x of [-0.78, 0.78]) {
    addTorus(b, 0.82, 0.035, COLORS.rope, { p: [x, 0.62, 0], r: [0, Math.PI / 2, 0], s: [1, 0.76, 1] });
    addTorus(b, 0.82, 0.012, COLORS.ropeDark, { p: [x + 0.035, 0.62, 0], r: [0, Math.PI / 2, 0], s: [1, 0.76, 1], outline: false });
  }
  const group = b.build();
  group.userData.cargoType = 'wood-pile';
  return finish(group);
}

function plank(builder, w, h, d, p, color = COLORS.crate, options = {}) {
  builder.box(w, h, d, color, { p, ...options });
}

/** A closed wooden shipping crate with plank sides and metal latches. Origin sits at floor centre. */
export function buildWoodCrate() {
  const b = new Builder(0.035);
  const size = 1.55;
  const half = size / 2;
  b.box(size, size, size, COLORS.crate, { p: [0, half, 0] });

  for (const x of [-0.48, 0, 0.48]) {
    plank(b, 0.04, 1.28, 0.055, [x, 0.78, half + 0.035], COLORS.crateLight, { outline: false });
    plank(b, 0.04, 1.28, 0.055, [x, 0.78, -half - 0.035], COLORS.crateDark, { outline: false });
  }
  for (const z of [-0.48, 0, 0.48]) {
    plank(b, 0.055, 1.28, 0.04, [half + 0.035, 0.78, z], COLORS.crateLight, { outline: false });
    plank(b, 0.055, 1.28, 0.04, [-half - 0.035, 0.78, z], COLORS.crateDark, { outline: false });
  }
  for (const x of [-0.42, 0, 0.42]) plank(b, 0.36, 0.055, 1.42, [x, size + 0.035, 0], COLORS.crateLight, { outline: false });

  for (const side of [-1, 1]) {
    plank(b, size + 0.14, 0.13, 0.12, [0, 1.5, side * (half + 0.07)], COLORS.crateDark);
    plank(b, size + 0.14, 0.13, 0.12, [0, 0.14, side * (half + 0.07)], COLORS.crateDark);
    plank(b, 0.13, 1.58, 0.12, [-half - 0.07, 0.79, side * (half + 0.07)], COLORS.crateDark);
    plank(b, 0.13, 1.58, 0.12, [half + 0.07, 0.79, side * (half + 0.07)], COLORS.crateDark);
    plank(b, 1.9, 0.11, 0.11, [0, 0.78, side * (half + 0.085)], COLORS.crateDark, { r: [0, 0, side > 0 ? -0.72 : 0.72] });
  }
  for (const side of [-1, 1]) {
    plank(b, 0.12, 1.58, 0.13, [side * (half + 0.075), 0.79, 0], COLORS.crateDark);
    plank(b, 0.1, 0.1, size + 0.12, [side * (half + 0.075), 1.5, 0], COLORS.crateDark);
    plank(b, 0.1, 0.1, size + 0.12, [side * (half + 0.075), 0.14, 0], COLORS.crateDark);
  }
  for (const x of [-half - 0.02, half + 0.02]) for (const z of [-half - 0.02, half + 0.02]) {
    b.box(0.18, 0.18, 0.18, COLORS.crateDark, { p: [x, size + 0.06, z] });
  }
  for (const x of [-0.38, 0.38]) {
    b.box(0.2, 0.34, 0.035, COLORS.metal, { p: [x, 1.22, half + 0.12] });
    b.box(0.05, 0.12, 0.045, COLORS.metalDark, { p: [x + 0.035, 1.17, half + 0.145], outline: false });
    b.box(0.2, 0.34, 0.035, COLORS.metal, { p: [x, 1.22, -half - 0.12] });
  }
  const group = b.build();
  group.userData.cargoType = 'wood-crate';
  return finish(group);
}

export const CARGO_BUILDERS = Object.freeze({
  woodPile: buildWoodPile,
  woodCrate: buildWoodCrate,
});
