import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 风格化模型构建器：
//  - 低多边形 + flatShading，顶点色合并为一个 Mesh（少 draw call）
//  - 每个部件自动生成“外扩背面壳”作为描边（inverted hull），颜色为本色压暗，不用纯黑
export const SOLID_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
export const HULL_MAT = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });

const _c = new THREE.Color();
const _hsl = {};

export function outlineColor(color) {
  const c = new THREE.Color(color);
  c.getHSL(_hsl, THREE.SRGBColorSpace);
  c.setHSL(_hsl.h + 0.02, Math.min(1, _hsl.s * 0.75 + 0.05), _hsl.l * 0.52, THREE.SRGBColorSpace);
  return c;
}

function prep(geo, color, matrix) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.applyMatrix4(matrix);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  _c.set(color);
  for (let i = 0; i < n; i++) {
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export class Builder {
  constructor(t = 0.04) {
    this.t = t;
    this.solid = [];
    this.hull = [];
    this.tags = {};
  }

  /** Record the parts drawn by `draw` under `name`; build() exposes their vertex ranges for in-place recoloring. */
  tag(name, draw) {
    const solid = this.solid.length, hull = this.hull.length;
    draw(this);
    (this.tags[name] ||= []).push([solid, this.solid.length, hull, this.hull.length]);
    return this;
  }

  // factory(pad) 返回几何体；pad = 0 为本体，pad > 0 为描边壳
  add(factory, color, o = {}) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...(o.p || [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(o.r || [0, 0, 0]))),
      new THREE.Vector3(...(o.s || [1, 1, 1]))
    );
    this.solid.push(prep(factory(0), color, m));
    if (o.outline !== false) {
      this.hull.push(prep(factory(o.t ?? this.t), o.oc ?? outlineColor(color), m));
    }
    return this;
  }

  box(w, h, d, color, o) {
    return this.add((p) => new THREE.BoxGeometry(w + 2 * p, h + 2 * p, d + 2 * p), color, o);
  }
  cyl(rt, rb, h, seg, color, o) {
    return this.add((p) => new THREE.CylinderGeometry(rt + p, rb + p, h + 2 * p, seg), color, o);
  }
  cone(r, h, seg, color, o) {
    return this.add((p) => new THREE.ConeGeometry(r + p, h + 2.6 * p, seg), color, o);
  }
  ico(r, color, o) {
    return this.add((p) => new THREE.IcosahedronGeometry(r + p, 0), color, o);
  }
  dodeca(r, color, o) {
    return this.add((p) => new THREE.DodecahedronGeometry(r + p, 0), color, o);
  }

  build({ cast = true, receive = true, material = SOLID_MAT } = {}) {
    const g = new THREE.Group();
    // Vertex ranges of tagged parts inside the merged buffers: { name: { solid: [[start, count]], hull: [...] } }.
    const offsets = list => list.reduce((acc, geo) => { acc.push(acc.at(-1) + geo.attributes.position.count); return acc; }, [0]);
    const solidAt = offsets(this.solid), hullAt = offsets(this.hull), ranges = {};
    for (const [name, spans] of Object.entries(this.tags)) ranges[name] = {
      solid: spans.map(([a, b]) => [solidAt[a], solidAt[b] - solidAt[a]]),
      hull: spans.map(([, , a, b]) => [hullAt[a], hullAt[b] - hullAt[a]]),
    };
    g.userData.ranges = ranges;
    if (this.solid.length) {
      const mesh = new THREE.Mesh(mergeGeometries(this.solid), material);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      g.add(mesh); g.userData.solid = mesh;
    }
    if (this.hull.length) {
      const hull = new THREE.Mesh(mergeGeometries(this.hull), HULL_MAT);
      g.add(hull); g.userData.hull = hull;
    }
    return g;
  }
}

// 实例化的小盒子（含描边壳），原点在底部
export function instancedBox(w, h, d, color, count, t = 0.035) {
  const geo = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
  const hullGeo = new THREE.BoxGeometry(w + 2 * t, h + 2 * t, d + 2 * t).translate(0, h / 2, 0);
  const solid = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color, flatShading: true }), count);
  solid.castShadow = true;
  solid.receiveShadow = true;
  const hull = new THREE.InstancedMesh(
    hullGeo,
    new THREE.MeshBasicMaterial({ color: outlineColor(color), side: THREE.BackSide }),
    count
  );
  return [solid, hull];
}
