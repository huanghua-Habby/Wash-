/** Client hover-vehicle geometry and textures; shared standing-platform rules. */
import * as THREE from 'three';
import { PAL } from '../../../shared/sim/palette.js';
import { Builder, outlineColor } from '../render/Builder.js';
import { logoTexture } from '../render/textures.js';
import { TruckState } from '../../../shared/sim/TruckState.js';
import { GLOW } from '../render/GlowMaterials.js';
import { LOOK } from '../core/config.js';

// 车灯用 HDR 颜色（>1），让 Bloom 只在发光体上产生光晕
const tail = new THREE.Color(PAL.tail).multiplyScalar(2.6);
const head = new THREE.Color(PAL.headlight).multiplyScalar(3.2);
const lamp = (b, w, h, d, color, base, p) => b.box(w, h, d, color, { p, oc: outlineColor(base) });

// Blue emissive parts are collected separately and drawn with the shared adjustable HDR material.
let glowParts = null;
const glow = (w, h, d, p) => glowParts.box(w, h, d, '#ffffff', { p, outline: false });

/** Downward thruster pod: dark housing plus a glowing nozzle ring under the hull. */
function thruster(b, x, z, r) {
  b.cyl(r, r * 0.7, 0.24, 10, PAL.thruster, { p: [x, 0.04, z] });
  glowParts.cyl(r * 0.62, r * 0.62, 0.05, 10, '#ffffff', { p: [x, -0.1, z], outline: false });
}

function hoverKit(b, spec, xs, z, r) {
  // 推进器收在车底内侧，侧面看不到“轮子”轮廓
  for (const x of xs) for (const side of [1, -1]) thruster(b, x, side * Math.min(z, spec.width / 2 - r - 0.15), r);
  // 车底两侧的悬浮光带
  const length = spec.x1 - spec.x0 - 0.8, cx = (spec.x0 + spec.x1) / 2;
  for (const side of [1, -1]) glow(length, 0.05, 0.04, [cx, 0.16, side * (spec.width / 2 - 0.12)]);
}

// Each builder draws one type in body space (origin at the hull underside, +x forward) and
// returns the side logo panel, or null. Roof heights must equal the shared spec `top`.
const MODELS = {
  washer(b, C, spec) {
    b.box(12, 0.6, 3.1, PAL.chassis, { p: [-0.3, 0.4, 0] });                      // 下壳
    b.box(8.9, 2.3, 3.4, C.trailer, { p: [-1.85, 1.85, 0] });                       // 作业舱 / 车顶甲板
    b.box(8.92, 0.34, 3.42, C.stripe, { p: [-1.85, 1, 0], outline: false });
    b.box(8.92, 0.1, 3.42, C.accent, { p: [-1.85, 1.22, 0], outline: false });
    b.box(8.92, 0.08, 3.42, C.accent, { p: [-1.85, 2.95, 0], outline: false });     // 甲板包边
    b.box(0.05, 1.7, 3, C.door, { p: [-6.32, 1.95, 0] });
    lamp(b, 0.08, 0.18, 0.9, tail, PAL.tail, [-6.36, 1.02, 1.1]);
    lamp(b, 0.08, 0.18, 0.9, tail, PAL.tail, [-6.36, 1.02, -1.1]);
    // 侧面喷淋管
    for (const side of [1, -1]) b.cyl(0.08, 0.08, 8.4, 8, PAL.chrome, { p: [-1.85, 0.78, side * 1.74], r: [0, 0, Math.PI / 2] });
    // 驾驶舱
    b.tag('cab', () => b.box(3, 2.6, 2.9, C.cab, { p: [4.2, 1.7, 0] }));
    b.box(3.02, 0.24, 2.92, C.accent, { p: [4.2, 1.1, 0], outline: false });
    b.box(0.05, 1, 2.5, PAL.glass, { p: [5.72, 2.25, 0] });
    b.box(1.4, 0.8, 0.04, PAL.glass, { p: [4.5, 2.3, 1.46] });
    b.box(1.4, 0.8, 0.04, PAL.glass, { p: [4.5, 2.3, -1.46] });
    b.box(0.5, 0.5, 2.7, PAL.chassis, { p: [5.9, 0.85, 0] });                       // 前导流
    lamp(b, 0.06, 0.14, 2.2, head, PAL.headlight, [6.16, 0.95, 0]);
    glow(0.22, 0.07, 2.1, [5.35, 3.03, 0]);                                         // 车顶示廓灯
    hoverKit(b, spec, [-5.2, -2, 1.4, 4.4], 1.2, 0.42);
    return { x: -1.85, y: 2.15, w: 5.4, h: 1.35 };
  },
  washer2(b, C, spec) {
    const ladder = '#4D6176';
    const lowDeckSurface = '#F1E5D0';
    const lowTop = spec.platforms.find((platform) => platform.name === 'low-deck')?.y ?? spec.top;
    const chassisTop = 0.7, lowDeckBottom = Math.max(chassisTop, lowTop - 0.16);
    const rearFillHeight = Math.max(0.06, lowDeckBottom - chassisTop);
    const ladderHeight = spec.top - lowTop + 0.24;
    b.box(12, 0.6, 3.1, PAL.chassis, { p: [-0.3, 0.4, 0] });                      // 下壳
    b.box(3.9, rearFillHeight, 3.28, C.trailer, { p: [-4.35, chassisTop + rearFillHeight / 2, 0] });
    b.box(3.9, 0.14, 3.3, C.stripe, { p: [-4.35, lowTop - 0.22, 0], outline: false });
    b.box(3.9, 0.06, 3.3, C.accent, { p: [-4.35, lowTop - 0.11, 0], outline: false });
    b.box(3.9, 0.16, 3.36, lowDeckSurface, { p: [-4.35, lowTop - 0.08, 0], outline: false }); // 降低后的后平台
    b.box(4.55, 2.3, 3.4, C.trailer, { p: [-0.1, 1.85, 0] });                      // 缩短后的货箱
    b.box(4.57, 0.34, 3.42, C.stripe, { p: [-0.1, 1, 0], outline: false });
    b.box(4.57, 0.1, 3.42, C.accent, { p: [-0.1, 1.22, 0], outline: false });
    b.box(4.57, 0.08, 3.42, C.accent, { p: [-0.1, 2.95, 0], outline: false });     // 甲板包边
    b.box(0.05, 1.7, 3, C.door, { p: [-2.4, 1.95, 0] });
    lamp(b, 0.08, 0.18, 0.9, tail, PAL.tail, [-6.36, 1.02, 1.1]);
    lamp(b, 0.08, 0.18, 0.9, tail, PAL.tail, [-6.36, 1.02, -1.1]);
    // 侧面喷淋管
    for (const side of [1, -1]) b.cyl(0.08, 0.08, 8.4, 8, PAL.chrome, { p: [-1.85, 0.78, side * 1.74], r: [0, 0, Math.PI / 2] });
    // 货箱梯子：只保留高低平台之间的中间梯子。
    for (const z of [-0.23, 0.23]) b.cyl(0.035, 0.035, ladderHeight, 8, ladder, { p: [-2.46, (lowTop + spec.top) / 2, z] });
    for (let y = lowTop + 0.22; y < spec.top - 0.08; y += 0.36) b.cyl(0.028, 0.028, 0.56, 8, ladder, { p: [-2.49, y, 0], r: [Math.PI / 2, 0, 0] });
    // 驾驶舱
    b.box(3, 2.6, 2.9, C.cab, { p: [4.2, 1.7, 0] });
    b.box(3.02, 0.24, 2.92, C.accent, { p: [4.2, 1.1, 0], outline: false });
    b.box(0.05, 1, 2.5, PAL.glass, { p: [5.72, 2.25, 0] });
    b.box(1.4, 0.8, 0.04, PAL.glass, { p: [4.5, 2.3, 1.46] });
    b.box(1.4, 0.8, 0.04, PAL.glass, { p: [4.5, 2.3, -1.46] });
    b.box(0.5, 0.5, 2.7, PAL.chassis, { p: [5.9, 0.85, 0] });                       // 前导流
    lamp(b, 0.06, 0.14, 2.2, head, PAL.headlight, [6.16, 0.95, 0]);
    glow(0.22, 0.07, 2.1, [5.35, 3.03, 0]);                                         // 车顶示廓灯
    hoverKit(b, spec, [-5.2, -2, 1.4, 4.4], 1.2, 0.42);
    return { x: -0.1, y: 2.15, z: 1.86, w: 3.7, h: 1.35 };
  },
  cargo(b, C, spec) {
    b.box(10.2, 0.45, 2.2, PAL.chassis, { p: [-0.3, 0.42, 0] });
    b.box(7.6, 2.25, 2.6, C.trailer, { p: [-1.6, 1.775, 0] });
    b.box(7.62, 0.3, 2.62, C.stripe, { p: [-1.6, 0.95, 0], outline: false });
    b.box(7.62, 0.1, 2.62, C.accent, { p: [-1.6, 1.17, 0], outline: false });
    b.box(0.05, 2, 2.4, C.door, { p: [-5.42, 1.8, 0] });
    lamp(b, 0.08, 0.2, 0.32, tail, PAL.tail, [-5.45, 1, 0.95]);
    lamp(b, 0.08, 0.2, 0.32, tail, PAL.tail, [-5.45, 1, -0.95]);
    b.tag('cab', () => b.box(2.3, 2.45, 2.2, C.cab, { p: [3.65, 1.675, 0] }));
    b.box(2.32, 0.22, 2.22, C.accent, { p: [3.65, 1.15, 0], outline: false });
    b.box(0.05, 0.9, 1.9, PAL.glass, { p: [4.82, 2.2, 0] });
    b.box(0.9, 0.7, 0.04, PAL.glass, { p: [4.1, 2.25, 1.11] });
    b.box(0.9, 0.7, 0.04, PAL.glass, { p: [4.1, 2.25, -1.11] });
    b.box(0.3, 0.35, 2.3, PAL.chassis, { p: [4.95, 0.75, 0] });
    lamp(b, 0.06, 0.18, 0.42, head, PAL.headlight, [5.12, 0.85, 0.75]);
    lamp(b, 0.06, 0.18, 0.42, head, PAL.headlight, [5.12, 0.85, -0.75]);
    hoverKit(b, spec, [-4.3, -1, 3.6], 0.85, 0.36);
    return { x: -1.6, y: 2.05, w: 5, h: 1.2 };
  },
  pod(b, C, spec) {
    b.tag('cab', () => b.box(4.8, 0.7, 2.2, C.cab, { p: [-0.1, 0.5, 0] }));
    b.box(4.82, 0.14, 2.22, C.stripe, { p: [-0.1, 0.62, 0], outline: false });
    b.box(3.4, 0.5, 2, PAL.glass, { p: [-0.2, 1.1, 0] });                           // 玻璃座舱
    b.box(3.7, 0.15, 2.1, C.trailer, { p: [-0.2, 1.425, 0] });                      // 车顶
    lamp(b, 0.06, 0.12, 1.4, head, PAL.headlight, [2.32, 0.6, 0]);
    lamp(b, 0.06, 0.12, 1.6, tail, PAL.tail, [-2.53, 0.68, 0]);
    hoverKit(b, spec, [-1.7, 1.5], 0.75, 0.32);
    return null;
  },
  sedan(b, C, spec) {
    b.tag('cab', () => b.box(7.2, 0.75, 2.5, C.cab, { p: [-0.05, 0.5, 0] }));
    b.box(7.22, 0.12, 2.52, C.stripe, { p: [-0.05, 0.62, 0], outline: false });
    b.box(4, 0.6, 2.2, PAL.glass, { p: [-0.4, 1.17, 0] });
    b.box(4.4, 0.28, 2.3, C.trailer, { p: [-0.4, 1.61, 0] });                       // 车顶
    b.box(1.4, 0.06, 1.6, C.accent, { p: [2.6, 0.9, 0], outline: false });
    b.box(0.5, 0.08, 2.3, C.stripe, { p: [-3.35, 1.18, 0] });                      // 尾翼
    b.box(0.1, 0.3, 0.1, C.stripe, { p: [-3.35, 1, 0.8] });
    b.box(0.1, 0.3, 0.1, C.stripe, { p: [-3.35, 1, -0.8] });
    lamp(b, 0.06, 0.1, 2, head, PAL.headlight, [3.57, 0.7, 0]);
    lamp(b, 0.06, 0.1, 2.2, tail, PAL.tail, [-3.67, 0.75, 0]);
    hoverKit(b, spec, [-2.6, 2.4], 0.9, 0.36);
    return null;
  },
  bus(b, C, spec) {
    b.box(12.2, 3.3, 2.9, C.trailer, { p: [-0.2, 2.05, 0] });
    b.tag('cab', () => b.box(12.22, 0.6, 2.92, C.cab, { p: [-0.2, 0.7, 0], outline: false }));
    b.box(10.6, 0.75, 2.94, PAL.glass, { p: [-0.6, 1.75, 0], outline: false });
    b.box(10.6, 0.75, 2.94, PAL.glass, { p: [-0.6, 2.95, 0], outline: false });
    b.box(12.22, 0.16, 2.92, C.stripe, { p: [-0.2, 2.35, 0], outline: false });
    b.box(0.05, 2.2, 2.5, PAL.glass, { p: [5.92, 2.3, 0] });
    b.box(0.06, 0.3, 1.6, C.accent, { p: [5.94, 3.42, 0], outline: false });        // 线路牌
    lamp(b, 0.06, 0.2, 0.5, head, PAL.headlight, [5.95, 0.85, 1]);
    lamp(b, 0.06, 0.2, 0.5, head, PAL.headlight, [5.95, 0.85, -1]);
    lamp(b, 0.06, 0.22, 0.4, tail, PAL.tail, [-6.32, 0.95, 1.05]);
    lamp(b, 0.06, 0.22, 0.4, tail, PAL.tail, [-6.32, 0.95, -1.05]);
    hoverKit(b, spec, [-4.8, -1.6, 1.6, 4.6], 1, 0.4);
    return null;
  },
  hauler(b, C, spec) {
    b.box(12, 0.5, 2.8, PAL.chassis, { p: [-0.85, 0.45, 0] });                      // 低底板
    b.box(8.4, 1.55, 2.8, C.trailer, { p: [-2.4, 1.475, 0] });
    for (let x = -6.1; x < 1.6; x += 1.4) b.box(0.08, 1.5, 2.84, C.stripe, { p: [x, 1.475, 0], outline: false });
    b.tag('cab', () => b.box(2.4, 1.95, 2.4, C.cab, { p: [3.8, 1.275, 0] }));
    b.box(0.05, 0.8, 2.1, PAL.glass, { p: [5.02, 1.75, 0] });
    b.box(0.9, 0.6, 0.04, PAL.glass, { p: [4.2, 1.75, 1.21] });
    b.box(0.9, 0.6, 0.04, PAL.glass, { p: [4.2, 1.75, -1.21] });
    lamp(b, 0.06, 0.16, 0.5, head, PAL.headlight, [5.05, 0.7, 0.8]);
    lamp(b, 0.06, 0.16, 0.5, head, PAL.headlight, [5.05, 0.7, -0.8]);
    lamp(b, 0.06, 0.16, 0.4, tail, PAL.tail, [-6.87, 0.5, 1.05]);
    lamp(b, 0.06, 0.16, 0.4, tail, PAL.tail, [-6.87, 0.5, -1.05]);
    hoverKit(b, spec, [-5.6, -2.6, 0.6, 3.8], 1, 0.38);
    return { x: -2.4, y: 1.5, w: 4.4, h: 1 };
  },
  flatbed(b, C, spec) {
    const lowTop = spec.platforms.find((platform) => platform.name === 'low-bed')?.y ?? spec.top;
    const rail = '#5A89BE';
    b.box(12, 0.5, 2.8, PAL.chassis, { p: [-0.85, 0.45, 0] });                      // 低底板
    b.box(8.4, 0.28, 2.72, C.trailer, { p: [-2.4, lowTop - 0.14, 0] });             // 低平板车斗
    b.box(8.35, 0.06, 2.25, C.door, { p: [-2.4, lowTop + 0.04, 0], outline: false });
    for (const side of [1, -1]) {
      b.box(8.45, 0.16, 0.08, C.trailer, { p: [-2.4, lowTop + 0.16, side * 1.43] });
      for (let x = -6.25; x < 1.75; x += 1.35) b.box(0.08, 0.42, 0.1, rail, { p: [x, lowTop + 0.2, side * 1.43] });
    }
    b.box(0.12, 0.16, 2.78, C.trailer, { p: [-6.62, lowTop + 0.16, 0] });
    b.box(0.12, 0.16, 2.78, C.trailer, { p: [1.82, lowTop + 0.16, 0] });
    b.box(0.12, 1.32, 0.08, C.trailer, { p: [2.04, 1.62, 1.34], r: [0, 0, -0.35] });
    b.box(0.12, 1.32, 0.08, C.trailer, { p: [2.04, 1.62, -1.34], r: [0, 0, -0.35] });
    b.box(1.9, 0.14, 2.64, C.trailer, { p: [2.22, 2.28, 0] });
    b.box(2.4, 1.95, 2.4, C.cab, { p: [3.8, 1.275, 0] });
    b.box(0.05, 0.8, 2.1, PAL.glass, { p: [5.02, 1.75, 0] });
    b.box(0.9, 0.6, 0.04, PAL.glass, { p: [4.2, 1.75, 1.21] });
    b.box(0.9, 0.6, 0.04, PAL.glass, { p: [4.2, 1.75, -1.21] });
    lamp(b, 0.06, 0.16, 0.5, head, PAL.headlight, [5.05, 0.7, 0.8]);
    lamp(b, 0.06, 0.16, 0.5, head, PAL.headlight, [5.05, 0.7, -0.8]);
    lamp(b, 0.06, 0.16, 0.4, tail, PAL.tail, [-6.87, 0.5, 1.05]);
    lamp(b, 0.06, 0.16, 0.4, tail, PAL.tail, [-6.87, 0.5, -1.05]);
    hoverKit(b, spec, [-5.6, -2.6, 0.6, 3.8], 1, 0.38);
    return null;
  },
};

let groundGlowTexture = null;
function glowTexture() {
  if (groundGlowTexture) return groundGlowTexture;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.55, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  groundGlowTexture = new THREE.CanvasTexture(c);
  return groundGlowTexture;
}

export class Truck extends TruckState {
  constructor(colors, { name, logo, sub, icon, phase = 0, type = 'cargo' }) {
    super(colors, { name, phase, type });
    const C = colors, spec = this.spec;
    // Rider-weight suspension (VehicleSuspension.js): group → loadPivot (roll/pitch/sink about a low centre) → body.
    // Everything parented to the body — roof stains, tools, wet marks — leans with it; topY stays the untilted roof.
    this.loadPivot = new THREE.Group();
    this.loadPivot.position.set((spec.x0 + spec.x1) / 2, spec.top * 0.35, 0);
    this.loadInner = new THREE.Group();
    this.loadInner.position.copy(this.loadPivot.position).negate();
    this.group.remove(this.body);
    this.group.add(this.loadPivot);
    this.loadPivot.add(this.loadInner);
    this.loadInner.add(this.body);
    const b = new Builder(0.04);
    glowParts = new Builder(0);
    const panel = MODELS[type](b, C, spec);
    this.hullView = b.build(); this.body.add(this.hullView);
    this.cabColor = C.cab;
    const emissive = glowParts.build({ cast: false, receive: false, material: GLOW.vehicle });
    this.emissiveView = emissive;
    glowParts = null;
    this.body.add(emissive);

    // 侧面 logo（两侧）
    if (panel && logo) {
      const tex = logoTexture(logo, sub || 'WASH', C.stripe, icon || 'cloud');
      const logoMat = new THREE.MeshLambertMaterial({
        map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
      });
      const sideOffset = panel.z ?? spec.width / 2;
      for (const side of [1, -1]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(panel.w, panel.w / 4), logoMat);
        m.position.set(panel.x, panel.y, side * (sideOffset + 0.012));
        if (side < 0) m.rotation.y = Math.PI;
        this.body.add(m);
      }
    }

    // 推进器打在路面上的光斑：跟随车辆平面位置，贴地，越高越淡
    this.groundGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(spec.x1 - spec.x0 + 1.5, spec.width + 1.8),
      new THREE.MeshBasicMaterial({ map: glowTexture(), color: PAL.thrusterGlow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 })
    );
    this.groundGlow.rotation.x = -Math.PI / 2;
    this.groundGlow.position.x = (spec.x0 + spec.x1) / 2;
    this.group.add(this.groundGlow);

    // 进入速度遮罩层：跟随镜头的物体保持锐利
    this.group.traverse((o) => o.layers.enable(1));
  }

  /** Repaint the cab in place (vertex colors of the prepared merged mesh; no new geometry, material or shader). */
  setCabColor(color) {
    if (this.cabColor === color) return;
    this.cabColor = color;
    const { ranges, solid, hull } = this.hullView.userData || {}, spans = ranges?.cab;
    if (!spans) return;
    const paint = (mesh, list, value) => {
      if (!mesh) return;
      const attribute = mesh.geometry.attributes.color, c = new THREE.Color(value);
      for (const [start, count] of list) for (let i = start; i < start + count; i++) attribute.setXYZ(i, c.r, c.g, c.b);
      attribute.needsUpdate = true;
    };
    paint(solid, spans.solid, color); paint(hull, spans.hull, outlineColor(color));
  }

  /** Lean the drawn hull by a VehicleLoad state; standing rules keep using the untilted roof. */
  setLoad({ roll, pitch, sink }) {
    this.loadPivot.rotation.set(roll, 0, pitch);
    this.loadPivot.position.y = this.spec.top * 0.35 - sink;
  }

  /** Keep the road glow on the road surface under the current hover altitude. */
  syncHover() {
    const altitude = this.pos.y;
    this.groundGlow.position.y = 0.05 - altitude;
    this.groundGlow.material.opacity = 0.55 / (1 + altitude * 0.35);
    // The road light pool follows the adjustable thruster colour, without HDR overshoot.
    if (this._glowColor !== LOOK.glow.vehicleColor) { this._glowColor = LOOK.glow.vehicleColor; this.groundGlow.material.color.set(this._glowColor); }
  }
}
