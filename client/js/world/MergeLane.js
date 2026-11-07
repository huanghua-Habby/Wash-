/** Renders the shared merge lane that each order vehicle arrives on. Shape comes from shared rules. */
import * as THREE from 'three';
import { PAL } from '../../../shared/sim/palette.js';
import { WASH_CONFIG as C } from '../../../shared/sim/washConfig.js';
import { laneShape } from '../../../shared/sim/vehicles.js';
import { smoothstep } from '../../../shared/sim/util.js';
import { GLOW } from '../render/GlowMaterials.js';

const SAMPLES = 160, U0 = -0.06, U1 = 1.6, HALF = 2.2, ARROW = 6;

function arrowTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = PAL.lane; g.fillRect(0, 0, 128, 256);
  g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, 0, 10, 256); g.fillRect(118, 0, 10, 256);
  // 行进方向箭头（v 坐标沿车道前进方向增大）
  g.strokeStyle = PAL.roadLine; g.globalAlpha = 0.55; g.lineWidth = 14; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(34, 150); g.lineTo(64, 96); g.lineTo(94, 150); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

/** Build a strip following the lane centreline. `edge(i)` returns [inner, outer] offsets and heights. */
function strip(points, normals, distances, edge, uvScale = 1) {
  const position = [], uv = [], index = [];
  points.forEach((p, i) => {
    const [[a, ay], [b, by]] = edge(i);
    position.push(p.x + normals[i].x * a, p.y + ay, p.z + normals[i].z * a, p.x + normals[i].x * b, p.y + by, p.z + normals[i].z * b);
    uv.push(0, distances[i] / uvScale, 1, distances[i] / uvScale);
    if (i) { const k = i * 2; index.push(k - 2, k, k - 1, k - 1, k, k + 1); }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index); geometry.computeVertexNormals();
  return geometry;
}

export class MergeLane {
  constructor(scene, side = -1) {
    const points = [], normals = [], widths = [], distances = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const u = U0 + (U1 - U0) * i / SAMPLES, shape = laneShape(u, { sideOffset: -side * C.laneSideOffset, height: C.laneHeight });
      // 车道在路面上方一点点，避免与主路 z-fighting
      points.push(new THREE.Vector3(-u * C.laneLength, Math.max(0.045, shape.y), shape.z));
      widths.push(HALF * smoothstep(U0, 0.05, u));
    }
    points.forEach((p, i) => {
      const a = points[Math.max(0, i - 1)], b = points[Math.min(SAMPLES, i + 1)];
      // Normal on the right of travel (+x is forward, so travel runs from high to low index).
      normals.push(new THREE.Vector3(-(a.z - b.z), 0, a.x - b.x).normalize());
      distances.push(i ? distances[i - 1] - p.distanceTo(points[i - 1]) : 0);
    });
    this.group = new THREE.Group();
    const surface = new THREE.Mesh(strip(points, normals, distances, (i) => [[-widths[i], 0], [widths[i], 0]], ARROW),
      new THREE.MeshLambertMaterial({ map: arrowTexture(), side: THREE.DoubleSide }));
    surface.receiveShadow = true;
    const skirtMat = new THREE.MeshLambertMaterial({ color: PAL.railPost, side: THREE.DoubleSide });
    const glowMat = GLOW.road;
    this.group.add(surface);
    for (const side of [1, -1]) {
      // 悬空部分的侧裙与贴边光带
      this.group.add(new THREE.Mesh(strip(points, normals, distances, (i) => [[side * widths[i], 0], [side * widths[i], -Math.min(0.32, points[i].y)]]), skirtMat));
      this.group.add(new THREE.Mesh(strip(points, normals, distances, (i) => [[side * (widths[i] - 0.14), 0.03], [side * widths[i], 0.03]]), glowMat));
    }
    this.group.traverse((o) => { o.frustumCulled = false; });
    this.group.visible = false;
    scene.add(this.group);
  }

  /** `lane` is the authoritative lane state; `x` is the rendered junction position. */
  update(lane, x) {
    this.group.visible = !!lane;
    if (lane) this.group.position.set(x, 0, lane.z);
  }
}
