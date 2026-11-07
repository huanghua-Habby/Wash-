import * as THREE from 'three';
import { PAL } from '../../../shared/sim/palette.js';
import { LOOK } from '../core/config.js';

// 柔和的“绘本光”：强半球环境光 + 偏弱的暖色主光。
// 顶面亮、侧面略暗、阴影浅而带色，避免任何死黑。
export class Lighting {
  constructor(scene) {
    this.hemi = new THREE.HemisphereLight(PAL.light.sky, PAL.light.ground, 2.15);
    this.sun = new THREE.DirectionalLight(PAL.light.sun, 1.05);
    this.offset = new THREE.Vector3(10, 30, 7);

    const s = this.sun.shadow;
    this.sun.castShadow = true;
    s.mapSize.set(2048, 2048);
    s.camera.left = -24; s.camera.right = 24;
    s.camera.top = 24; s.camera.bottom = -24;
    s.camera.near = 1; s.camera.far = 90;
    s.bias = -0.0004;
    s.normalBias = 0.03;

    scene.add(this.hemi, this.sun, this.sun.target);
  }

  sync() {
    const L = LOOK.light;
    this.offset.set(...LOOK.sunOffset);
    this.hemi.intensity = L.hemi;
    this.hemi.color.set(L.sky);
    this.hemi.groundColor.set(L.ground);
    this.sun.intensity = L.sun;
    this.sun.color.set(L.sunColor);
    this.sun.castShadow = L.shadows;
  }

  follow(focus) {
    // 吸附到阴影贴图纹素，减少移动时的阴影闪烁
    const texel = 48 / 2048;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx, 0, fz).add(this.offset);
  }

  // 平地上 Lambert 的光照系数（给不受光照的自定义 shader 匹配亮度用）
  groundFactor() {
    const ndl = this.offset.clone().normalize().y;
    const c = this.hemi.color.clone().multiplyScalar(this.hemi.intensity);
    c.add(this.sun.color.clone().multiplyScalar(this.sun.intensity * ndl));
    return c.multiplyScalar(1 / Math.PI);
  }
}
