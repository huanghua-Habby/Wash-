import * as THREE from 'three';
import { PAL } from '../../../shared/sim/palette.js';
import { mulberry32 } from '../../../shared/sim/util.js';
import { WORLD_LEN } from '../core/scroll.js';
import { CFG } from '../core/config.js';

// GPU 草叶：实例化 + 顶点着色器里做循环滚动、风吹摇摆、卡车尾流
const COMMON = /* glsl */ `
uniform float uTime;
uniform float uScroll;
uniform float uLen;
uniform float uWind;
uniform float uTruckX;
uniform float uSway;
uniform float uGust;
uniform float uWake;
uniform float uRoadExtraWidth;
float wrapX(float x) { return mod(x - uScroll + uLen * 0.5, uLen) - uLen * 0.5; }
`;

const GRASS_VERT = /* glsl */ `
${COMMON}
attribute vec4 aInst;   // x, z, 旋转, 随机
attribute vec2 aSize;   // 高, 宽
varying float vH;
varying float vR;
void main() {
  vec3 p = position;
  float h = p.y;
  p.x *= aSize.y;
  p.y *= aSize.x;
  float c = cos(aInst.z), s = sin(aInst.z);
  p.xz = vec2(c * p.x - s * p.z, s * p.x + c * p.z);

  float wx = wrapX(aInst.x);
  vec3 w = vec3(wx, 0.0, aInst.y + sign(aInst.y) * uRoadExtraWidth) + p;

  float ph = aInst.w * 6.2831;
  float sway = sin(uTime * 2.3 + wx * 0.3 + aInst.y * 0.25 + ph) * 0.13
             + sin(uTime * 6.1 + wx * 1.1 + ph) * 0.05;
  sway *= uSway;
  float gust = uGust * uWind * (0.24 + 0.14 * sin(uTime * 1.7 + wx * 0.12 + aInst.y * 0.07));
  float road = exp(-pow(max(abs(aInst.y) - 4.6, 0.0) / 2.4, 2.0));
  float nearTruck = exp(-pow((wx - uTruckX) / 9.0, 2.0));
  float wake = uWake * uWind * road * (0.25 + 0.9 * nearTruck) * (0.65 + 0.35 * sin(uTime * 17.0 + wx * 2.0 + ph));

  float bend = (sway + gust + wake * 0.8) * h * h;
  w.x -= bend * aSize.x * 1.5;
  w.z += sign(aInst.y) * wake * 0.4 * h * h * aSize.x;
  w.y -= abs(bend) * 0.4 * aSize.x * h;

  vH = h;
  vR = aInst.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

const GRASS_FRAG = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uTip;
uniform vec3 uDark;
uniform float uDeepRatio;
varying float vH;
varying float vR;
void main() {
  vec3 base = mix(uBase, uDark, step(1.0 - uDeepRatio, vR) * 0.85);
  float tipAmt = smoothstep(0.1, 1.0, vH) * (0.5 + 0.5 * fract(vR * 7.31));
  gl_FragColor = vec4(mix(base, uTip, tipAmt), 1.0);
}
`;

const FLOWER_VERT = /* glsl */ `
${COMMON}
attribute vec3 aInst;   // x, z, 随机
attribute vec3 aColor;
varying vec3 vColor;
void main() {
  float wx = wrapX(aInst.x);
  float ph = aInst.z * 6.2831;
  vec3 p = position * (0.75 + aInst.z * 0.5);
  float sway = sin(uTime * 2.3 + wx * 0.3 + ph) * 0.05 * uSway - uWind * 0.06 * uGust;
  vec3 w = vec3(wx + sway, 0.1 + aInst.z * 0.18, aInst.y + sign(aInst.y) * uRoadExtraWidth) + p;
  vColor = aColor;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

const FLOWER_FRAG = /* glsl */ `
uniform vec3 uLight;
varying vec3 vColor;
void main() { gl_FragColor = vec4(vColor * uLight, 1.0); }
`;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Fisher–Yates over units (blade clumps / flower patches) with its own seed, so the layout rng is untouched; returns ends[k] = instances covered by the first k units.
function shuffledUnits(starts, count, rng, copy) {
  const order = starts.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const ends = [0];
  let to = 0;
  for (const u of order) {
    const end = u + 1 < starts.length ? starts[u + 1] : count;
    for (let from = starts[u]; from < end; from++) copy(from, to++);
    ends.push(to);
  }
  return ends;
}

export class Grass {
  constructor(scene, lighting) {
    const L = WORLD_LEN;
    const rng = mulberry32(7);
    const light = lighting.groundFactor();
    const lit = (hex) => new THREE.Color(hex).multiply(light);

    this.uniforms = {
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uLen: { value: L },
      uWind: { value: 1 },
      uTruckX: { value: 0 },
      uSway: { value: 1 },
      uGust: { value: 1 },
      uWake: { value: 1 },
      uRoadExtraWidth: { value: 0 },
    };

    // ---------- 草叶分布 ----------
    // 每株零散草或每个草丛是一个单元；单元打乱后按密度只绘制前面一段，均匀稀疏且不需重建缓冲
    const blades = [], bladeUnits = [];
    const unit = () => bladeUnits.push(blades.length / 6);
    const add = (x, z, hm = 1) =>
      blades.push(x, z, rng() * Math.PI, rng(), (0.32 + rng() * 0.45) * hm, 0.09 + rng() * 0.06);
    const rx = () => rng() * L - L / 2;
    const pickZ = () => (rng() < 0.42 ? 5.8 + rng() * 24 : -(6.3 + rng() * 34));

    // 路缘边的锯齿草边（手绘感的锯齿草边）
    for (const side of [1, -1]) {
      for (let i = 0; i < L * 24; i++) unit(), add(rx(), side * (4.78 + Math.pow(rng(), 1.7) * 1.0), 0.75 + rng() * 0.5);
    }
    // 栅栏脚下
    for (let i = 0; i < L * 10; i++) unit(), add(rx(), 8.5 + (rng() - 0.5) * 0.8, 0.9 + rng() * 0.6);
    // 草丛团簇
    for (let i = 0; i < 750; i++) {
      const cx = rx(), cz = pickZ(), n = 6 + Math.floor(rng() * 14);
      unit();
      for (let j = 0; j < n; j++) {
        const r = Math.sqrt(rng()) * 0.55, a = rng() * Math.PI * 2;
        add(cx + Math.cos(a) * r, cz + Math.sin(a) * r * 0.6, 1.1);
      }
    }
    // 零散
    for (let i = 0; i < 3500; i++) unit(), add(rx(), pickZ(), 0.8);

    const count = blades.length / 6;
    const inst = new Float32Array(count * 4);
    const size = new Float32Array(count * 2);
    this.bladeEnds = shuffledUnits(bladeUnits, count, mulberry32(71), (from, to) => {
      const o = from * 6;
      inst.set([blades[o], blades[o + 1], blades[o + 2], blades[o + 3]], to * 4);
      size.set([blades[o + 4], blades[o + 5]], to * 2);
    });

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(
      [-0.5, 0, 0, 0.5, 0, 0, -0.32, 0.45, 0, 0.32, 0.45, 0, 0, 1, 0], 3));
    geo.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
    geo.setAttribute('aInst', new THREE.InstancedBufferAttribute(inst, 4));
    geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 2));
    geo.instanceCount = count;

    const mat = new THREE.ShaderMaterial({
      vertexShader: GRASS_VERT,
      fragmentShader: GRASS_FRAG,
      side: THREE.DoubleSide,
      uniforms: {
        ...this.uniforms,
        uBase: { value: lit(PAL.grass) },
        uTip: { value: lit(PAL.grassTip) },
        uDark: { value: lit(PAL.grassDeep) },
        uDeepRatio: { value: CFG.grass.deepRatio },
      },
    });
    this.mat = mat;
    this.bladeGeo = geo;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    scene.add(mesh);

    // ---------- 小野花 ----------
    const flowers = [], flowerUnits = [];
    const colors = [];
    for (let i = 0; i < 300; i++) {
      const cx = rx(), cz = pickZ(), n = 3 + Math.floor(rng() * 6);
      flowerUnits.push(flowers.length / 3);
      const col = new THREE.Color(PAL.flower[Math.floor(rng() * PAL.flower.length)]);
      for (let j = 0; j < n; j++) {
        flowers.push(cx + (rng() - 0.5) * 1.2, cz + (rng() - 0.5) * 0.8, rng());
        colors.push(col.r, col.g, col.b);
      }
    }
    const fgeo = new THREE.InstancedBufferGeometry();
    const disc = new THREE.CircleGeometry(0.1, 6).rotateX(-Math.PI / 2);
    fgeo.index = disc.index;
    fgeo.setAttribute('position', disc.attributes.position);
    const flowerCount = flowers.length / 3;
    const flowerInst = new Float32Array(flowers.length), flowerColor = new Float32Array(colors.length);
    this.flowerEnds = shuffledUnits(flowerUnits, flowerCount, mulberry32(72), (from, to) => {
      flowerInst.set(flowers.slice(from * 3, from * 3 + 3), to * 3);
      flowerColor.set(colors.slice(from * 3, from * 3 + 3), to * 3);
    });
    fgeo.setAttribute('aInst', new THREE.InstancedBufferAttribute(flowerInst, 3));
    fgeo.setAttribute('aColor', new THREE.InstancedBufferAttribute(flowerColor, 3));
    fgeo.instanceCount = flowers.length / 3;
    const fmat = new THREE.ShaderMaterial({
      vertexShader: FLOWER_VERT,
      fragmentShader: FLOWER_FRAG,
      side: THREE.DoubleSide,
      uniforms: { ...this.uniforms, uLight: { value: light.clone().multiplyScalar(1.05) } },
    });
    this.fmat = fmat;
    this.flowerGeo = fgeo;
    this.syncDensity();
    const fmesh = new THREE.Mesh(fgeo, fmat);
    fmesh.frustumCulled = false;
    scene.add(fmesh);
  }

  /** Preserve the prepared instance buffers; road clearance shifts entirely on the GPU. */
  setRoad(road) { this.uniforms.uRoadExtraWidth.value = road.laneCount * road.laneWidth / 2 - 4.5; }

  /** Home uses CFG.grass densities; an active round uses CFG.play. */
  setPlaying(playing) {
    if (this.playing === playing) return;
    this.playing = playing; this.syncDensity();
  }

  /** Density only shortens the drawn prefix of the shuffled units; buffers and shaders stay prepared. */
  syncDensity() {
    const G = CFG.grass, prefix = (ends, amount) => ends[Math.round(clamp01(amount) * (ends.length - 1))];
    this.bladeGeo.instanceCount = prefix(this.bladeEnds, this.playing ? CFG.play.grass : G.density);
    this.flowerGeo.instanceCount = prefix(this.flowerEnds, this.playing ? CFG.play.flowers : G.flowers);
    this.mat.uniforms.uDeepRatio.value = G.deepRatio;
  }

  update(t, scroll, wind, truckX) {
    const u = this.uniforms;
    u.uTime.value = t;
    u.uScroll.value = scroll;
    u.uWind.value = wind;
    u.uTruckX.value = truckX;
    u.uSway.value = CFG.grass.sway;
    u.uGust.value = CFG.grass.gust;
    u.uWake.value = CFG.grass.wake;
  }

  // 光照或草色改变后重新计算（草叶 shader 不受光照，需要手动匹配地面亮度）
  refresh(lighting) {
    const light = lighting.groundFactor();
    const G = CFG.grass;
    const u = this.mat.uniforms;
    u.uBase.value.set(G.base).multiply(light);
    u.uTip.value.set(G.tip).multiply(light);
    u.uDark.value.set(G.deep).multiply(light);
    this.fmat.uniforms.uLight.value.copy(light).multiplyScalar(1.05);
  }
}
