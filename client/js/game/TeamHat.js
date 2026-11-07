/**
 * Red/blue team hat (art test): a soft bucket hat with a white band, in the team color.
 * Rides the head bone of any species model, so it follows every head animation (bobs, gulps, trunk kicks).
 * Built once and parented at boot; recoloring only uploads a cached color buffer.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { smooth } from './cat/CatModel.js';
import { DEFAULTS } from '../core/config.js';

/** Default team colors; the in-game test (CFG.team) may retune them, and the hat recolors without rebuilding. */
export const TEAM_COLORS = {
  red: { main: DEFAULTS.team.red, name: '红队' },
  blue: { main: DEFAULTS.team.blue, name: '蓝队' },
};
export const TEAMS = Object.keys(TEAM_COLORS);
/** Presentation-only team split by room slot, so every client derives the same teams without sync. */
/** Felt shades for one team color: the brim and its stitching are darker. */
export function teamPalette(main) {
  const base = new THREE.Color(main), hsl = { h: 0, s: 0, l: 0 }; base.getHSL(hsl);
  return {
    main: `#${base.getHexString()}`,
    dark: `#${new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 1.05), hsl.l * 0.78).getHexString()}`,
    light: `#${base.clone().lerp(new THREE.Color('#ffffff'), 0.45).getHexString()}`,
  };
}
/** Raised so the drooping brim clears the round head and its fur. */
const HAT_LIFT = 0.05;

const WHITE = new THREE.Color('#fbf6ec');
// Head bone position in bind space (shared skeleton: hips 0.27 + spine 0.1 + head 0.2, x 0.03).
const HEAD_BONE = new THREE.Vector3(0.03, 0.57, 0);
/** Where each species wears its hat, in bind space: crown position, forward tilt (rad) and size. */
const MOUNTS = {
  cat: { p: [0.085, 0.955, 0], tilt: -0.2, scale: 1.1 },
  dog: { p: [0.09, 0.95, 0], tilt: -0.22, scale: 1.1 },
  pelican: { p: [0.09, 0.94, 0], tilt: -0.14, scale: 0.74 },
  elephant: { p: [0.085, 0.93, 0], tilt: -0.08, scale: 1.04 },
  squirrel: { p: [0.075, 0.95, 0], tilt: -0.18, scale: 0.95 },
  goose: { p: [0.1, 0.99, 0], tilt: -0.1, scale: 0.8 },
  kangaroo: { p: [0.07, 0.94, 0], tilt: -0.16, scale: 0.9 },
};

const _c = new THREE.Color();
const felt = (p) => 1 + (Math.sin(p.x * 173 + p.z * 91) * Math.sin(p.y * 157 - p.z * 67)) * 0.025;

/** Collects non-indexed parts with a team-dependent color function; builds both colorings once. */
class HatBuilder {
  constructor() { this.parts = []; }
  add(geometry, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], color }) {
    let g = geometry.index ? geometry.toNonIndexed() : geometry;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s)));
    this.parts.push({ g, color });
    return g;
  }
  /** Merged geometry plus a painter that fills a full color buffer for any team color (cached per color). */
  build() {
    const cache = new Map(), parts = this.parts;
    const paint = (main) => {
      if (cache.has(main)) return cache.get(main);
      const palette = teamPalette(main), total = parts.reduce((sum, { g }) => sum + g.attributes.position.count, 0);
      const out = new Float32Array(total * 3), pos = new THREE.Vector3(), normal = new THREE.Vector3();
      let i = 0;
      for (const { g, color } of parts) {
        for (let k = 0; k < g.attributes.position.count; k++, i++) {
          pos.fromBufferAttribute(g.attributes.position, k); normal.fromBufferAttribute(g.attributes.normal, k);
          (typeof color === 'function' ? color(palette, pos, normal) : _c.set(palette[color] || color)).toArray(out, i * 3);
        }
      }
      cache.set(main, out);
      return out;
    };
    for (const { g } of parts) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
    return { geometry: mergeGeometries(parts.map(({ g }) => g)), paint };
  }
}

/** Rounded dome on a lathe; `shape(t)` returns [radius, height] from rim (t = 0) to top (t = 1). */
function dome(shape, steps = 14, segments = 36) {
  const points = [];
  for (let i = 0; i <= steps; i++) { const [r, y] = shape(i / steps); points.push(new THREE.Vector2(Math.max(0, r), y)); }
  return new THREE.LatheGeometry(points, segments);
}

function buildBucket() {
  const b = new HatBuilder();
  const R = 0.128, H = 0.09;
  // Soft crown: slightly tapered sides, rounded top.
  b.add(dome((t) => {
    if (t < 0.6) { const u = t / 0.6; return [R - 0.022 * u, H * 0.72 * u]; }
    const a = (t - 0.6) / 0.4 * Math.PI / 2; return [(R - 0.022) * Math.cos(a), H * 0.72 + H * 0.28 * Math.sin(a)];
  }, 18, 40), { color: (palette, p) => _c.set(palette.main).multiplyScalar(felt(p)) });
  // White band with a little team-colored bow tag.
  b.add(new THREE.CylinderGeometry(R - 0.004, R + 0.002, 0.024, 40, 1, true), { p: [0, 0.018, 0], color: () => _c.copy(WHITE) });
  // Drooping brim, stitched with rings.
  const ring = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; ring.push(new THREE.Vector2(R + 0.085 * t, -0.03 * t * t - 0.004 * t)); }
  for (let i = 8; i >= 0; i--) { const t = i / 8; ring.push(new THREE.Vector2(R + 0.085 * t - 0.002, -0.03 * t * t - 0.004 * t - 0.012 - 0.002 * (1 - t))); }
  ring.push(ring[0].clone());
  b.add(new THREE.LatheGeometry(ring, 48), { color: (palette, p) => { const r = Math.hypot(p.x, p.z); return _c.set(palette.dark).lerp(_c.clone().set(palette.main), 0.35 * smooth(0.6, 1, Math.sin((r - R) * 190) * 0.5 + 0.5)).multiplyScalar(felt(p)); } });
  b.add(new THREE.SphereGeometry(0.022, 12, 8), { p: [-0.02, 0.02, R + 0.002], s: [1.3, 0.8, 0.5], r: [0, 0, 0.3], color: 'dark' });
  b.add(new THREE.SphereGeometry(0.022, 12, 8), { p: [-0.05, 0.016, R - 0.008], s: [1.3, 0.8, 0.5], r: [0, -0.3, -0.4], color: 'dark' });
  return b.build();
}

let geometry = null;
/** Built once per page; every hat shares the shape and owns only its color buffer. */
const hatShape = () => geometry ||= buildBucket();

// One shared program for every hat on the page; colors live in per-hat vertex buffers.
let material = null;
const hatMaterial = () => material ||= new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 14, specular: new THREE.Color('#2a2a2a') });

export class TeamHat {
  constructor({ team = 'red' } = {}) {
    const shape = hatShape();
    this.group = new THREE.Group(); this.group.name = 'team-hat';
    this.mesh = new THREE.Mesh(shape.geometry.clone(), hatMaterial());
    this.mesh.position.y = HAT_LIFT; this.mesh.castShadow = true; this.paint = shape.paint;
    // Also drawn into the velocity mask (layer 1), so motion blur keeps the hat as sharp as its wearer.
    this.mesh.layers.enable(1);
    this.group.add(this.mesh);
    this.setTeam(team);
  }

  /** Team color for the felt; `color` overrides the team's default shade. */
  setTeam(team, color = TEAM_COLORS[team]?.main) {
    this.team = TEAM_COLORS[team] ? team : 'red';
    const main = color || TEAM_COLORS[this.team].main;
    if (main === this.color) return;
    this.color = main;
    const attr = this.mesh.geometry.attributes.color; attr.array.set(this.paint(main)); attr.needsUpdate = true;
  }

  /** Seat the hat on a species model's head bone. */
  attach(body) {
    const mount = MOUNTS[body.species.id] || MOUNTS.cat;
    this.group.position.set(...mount.p).sub(HEAD_BONE);
    this.group.rotation.set(0, 0, mount.tilt);
    this.group.scale.setScalar(mount.scale);
    body.bones.head.add(this.group);
  }
}
