import * as THREE from 'three';
import { CFG, LOOK } from '../core/config.js';

// 后处理管线：
//  1. 场景渲染到 HalfFloat + 4xMSAA 的 RT（线性 HDR）
//  2. 速度遮罩：只渲染“跟着镜头走”的物体（卡车/玩家/风线，layer 1），它们保持锐利
//  3. 移轴景深：半分辨率可变半径高斯（横、竖两 pass），半径随离焦点车中线的横向距离增大，遮罩物体不渗色
//  4. Bloom：阈值+软膝预过滤（Karis 平均抑制闪烁）→ 13-tap 逐级降采样 → 3x3 tent 逐级升采样（scatter 混合）
//  5. 合成：移轴景深 → 动态模糊 → 叠加 Bloom → 曝光 + 色调映射 → sRGB → 调色 → 速度线 → 暗角 → 颗粒
// 所有参数来自 CFG.post，每个效果都有单独开关
const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// ---------- 移轴景深 ----------
// 清晰带沿道路方向穿过焦点车；离中线的屏幕横向距离决定模糊程度（0 清晰 → 1 最模糊）
const TILT_COC = /* glsl */ `
uniform vec2 uTiltCenter;   // 焦点车中线上的点（宽高比校正后的屏幕坐标，中心为 0）
uniform vec2 uTiltNormal;   // 垂直于道路的屏幕方向
uniform vec2 uTiltBand;     // 清晰带半宽、完全模糊处的距离
float tiltCoc(vec2 uv, float aspect) {
  float d = abs(dot((uv - 0.5) * vec2(aspect, 1.0) - uTiltCenter, uTiltNormal));
  return smoothstep(uTiltBand.x, uTiltBand.y, d);
}
`;

const TILT_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform sampler2D tMask;
uniform vec2 uStep;         // 单个输出像素的 uv 步长 × 方向
uniform float uRadius;      // 最大模糊半径（输出像素）
uniform float uAspect;
uniform float uMaskSharp;
varying vec2 vUv;
${TILT_COC}
void main() {
  vec3 c0 = texture2D(tSrc, vUv).rgb;
  float coc = tiltCoc(vUv, uAspect);
  if (coc < 0.002) { gl_FragColor = vec4(c0, 1.0); return; }
  vec2 st = uStep * coc * uRadius * 0.25;
  vec3 acc = vec3(0.0);
  float ws = 0.0;
  for (int i = -4; i <= 4; i++) {
    float x = float(i);
    vec2 suv = vUv + st * x;
    float w = exp(-x * x * 0.125) * (1.0 - texture2D(tMask, suv).r * uMaskSharp);   // 不把车辆颜色晕进背景
    acc += texture2D(tSrc, suv).rgb * w;
    ws += w;
  }
  gl_FragColor = vec4(ws > 0.001 ? acc / ws : c0, 1.0);
}
`;

// ---------- Bloom：降采样 ----------
const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uPrefilter;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;

vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float karis(vec3 c) { return 1.0 / (1.0 + luma(c)); }

vec3 threshold(vec3 c) {
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-5);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-5);
  return c * contrib;
}

void main() {
  vec3 a = s(vec2(-2.0, 2.0)), b = s(vec2(0.0, 2.0)), c = s(vec2(2.0, 2.0));
  vec3 d = s(vec2(-2.0, 0.0)), e = s(vec2(0.0, 0.0)), f = s(vec2(2.0, 0.0));
  vec3 g = s(vec2(-2.0, -2.0)), h = s(vec2(0.0, -2.0)), i = s(vec2(2.0, -2.0));
  vec3 j = s(vec2(-1.0, 1.0)), k = s(vec2(1.0, 1.0)), l = s(vec2(-1.0, -1.0)), m = s(vec2(1.0, -1.0));
  vec3 res;
  if (uPrefilter > 0.5) {
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25;
    vec3 g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25;
    vec3 g4 = (j + k + l + m) * 0.25;
    float w0 = 0.125 * karis(g0), w1 = 0.125 * karis(g1), w2 = 0.125 * karis(g2), w3 = 0.125 * karis(g3), w4 = 0.5 * karis(g4);
    res = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
    res = threshold(min(res, vec3(32.0)));
  } else {
    res = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(res, 1.0);
}
`;

// ---------- Bloom：升采样 ----------
const UP_FRAG = /* glsl */ `
uniform sampler2D tLow;
uniform sampler2D tHigh;
uniform vec2 uTexel;
uniform float uScatter;
varying vec2 vUv;
vec3 s(vec2 o) { return texture2D(tLow, vUv + o * uTexel).rgb; }
void main() {
  vec3 up = (s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0)) + s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0))
          + 2.0 * (s(vec2(0.0, 1.0)) + s(vec2(-1.0, 0.0)) + s(vec2(1.0, 0.0)) + s(vec2(0.0, -1.0)))
          + 4.0 * s(vec2(0.0))) / 16.0;
  gl_FragColor = vec4(mix(texture2D(tHigh, vUv).rgb, up, uScatter), 1.0);
}
`;

// ---------- 合成 ----------
const FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tMask;
uniform sampler2D tBloom;
uniform sampler2D tTilt;
uniform float uTilt;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uBlurDir;
uniform float uView;        // 0 最终 1 原始 2 遮罩 3 泛光 4 移轴景深
uniform float uBlurOn;
uniform float uFxaa;
uniform float uBlurCenter;
uniform float uBlurEdge;
uniform float uSamples;
uniform float uMaskSharp;
uniform float uBloom;
uniform vec3 uBloomTint;
uniform float uTonemap;     // 0 无 1 ACES 2 AgX 3 Neutral 4 Reinhard
uniform float uExposure;
uniform float uPunch;   // knock-off feedback 0..1: push-in, chromatic split, punchier grade, warm edge flash
uniform float uDesat;   // local player waiting to respawn 0..1 (StatusGrade): about half the colour drains
uniform float uShock;   // local player shock-stunned 0..1: white / pale sky-blue electric shimmer on the edges
uniform float uDeath;   // local death 0..1: a short, soft red edge flash
uniform float uDown;    // local knockdown 0..1: a soft, steady white rim
uniform float uGradeOn;
uniform float uSat;
uniform float uContrast;
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uSplit;
uniform float uLines;
uniform float uLinesDensity;
uniform float uLinesBands;
uniform float uLinesSpeed;
uniform float uLinesLength;
uniform float uLinesRadius;
uniform float uVig;
uniform float uVigInner;
uniform float uVigOuter;
uniform vec3 uVigColor;
uniform float uGrain;
varying vec2 vUv;
${TILT_COC}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

// FXAA（精简版）：在没有 MSAA 时平滑几何边缘，只多 4~8 次采样
vec3 fxaa(vec2 uv) {
  vec2 px = 1.0 / uRes;
  const vec3 L = vec3(0.299, 0.587, 0.114);
  vec3 m = texture2D(tColor, uv).rgb;
  float lNW = dot(min(texture2D(tColor, uv + vec2(-1.0, -1.0) * px).rgb, 1.0), L);
  float lNE = dot(min(texture2D(tColor, uv + vec2(1.0, -1.0) * px).rgb, 1.0), L);
  float lSW = dot(min(texture2D(tColor, uv + vec2(-1.0, 1.0) * px).rgb, 1.0), L);
  float lSE = dot(min(texture2D(tColor, uv + vec2(1.0, 1.0) * px).rgb, 1.0), L);
  float lM = dot(min(m, 1.0), L);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.0312, lMax * 0.125)) return m;
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + reduce), -8.0, 8.0) * px;
  vec3 a = 0.5 * (texture2D(tColor, uv - dir / 6.0).rgb + texture2D(tColor, uv + dir / 6.0).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(tColor, uv - dir * 0.5).rgb + texture2D(tColor, uv + dir * 0.5).rgb);
  float lB = dot(min(b, 1.0), L);
  return (lB < lMin || lB > lMax) ? a : b;
}

vec3 toSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// ACES Filmic（Stephen Hill 拟合）
vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 acesFilmic(vec3 c) {
  const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c = IN * (c / 0.6);
  c = RRTAndODTFit(c);
  return clamp(OUT * c, 0.0, 1.0);
}

// AgX（Blender 默认视图变换的近似）
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x, x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 c) {
  const mat3 INSET = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
                          vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
                          vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 OUTSET = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
                           vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
                           vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  const float MIN_EV = -12.47393, MAX_EV = 4.026069;
  c = INSET * c;
  c = clamp((log2(max(c, 1e-10)) - MIN_EV) / (MAX_EV - MIN_EV), 0.0, 1.0);
  c = agxContrast(c);
  c = OUTSET * c;
  return clamp(pow(max(c, vec3(0.0)), vec3(2.2)), 0.0, 1.0);
}

// Khronos PBR Neutral：几乎不改变 <0.8 的颜色，只柔和压缩高光
vec3 neutral(vec3 c) {
  const float START = 0.76, DESAT = 0.15;
  float x = min(c.r, min(c.g, c.b));
  float off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  c -= off;
  float peak = max(c.r, max(c.g, c.b));
  if (peak < START) return c;
  float d = 1.0 - START;
  float np = 1.0 - d * d / (peak + d - START);
  c *= np / peak;
  float g = 1.0 - 1.0 / (DESAT * (peak - np) + 1.0);
  return mix(c, vec3(np), g);
}

vec3 tonemap(vec3 c) {
  c *= uExposure * (1.0 + 0.16 * uPunch);
  if (uTonemap > 3.5) return c / (1.0 + c);
  if (uTonemap > 2.5) return neutral(c);
  if (uTonemap > 1.5) return agx(c);
  if (uTonemap > 0.5) return acesFilmic(c);
  return c;
}

void main() {
  // Knock-off punch: the whole frame pushes in a touch toward the centre and springs back.
  vec2 uv = 0.5 + (vUv - 0.5) * (1.0 - 0.03 * uPunch);
  float aspect = uRes.x / uRes.y;
  vec2 cuv = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(cuv);

  vec3 sharp = uFxaa > 0.5 ? fxaa(uv) : texture2D(tColor, uv).rgb;
  if (uView > 0.5 && uView < 1.5) { gl_FragColor = vec4(toSRGB(sharp), 1.0); return; }

  float m = texture2D(tMask, uv).r * uMaskSharp;
  if (uView > 1.5 && uView < 2.5) { gl_FragColor = vec4(mix(toSRGB(sharp) * 0.35, vec3(1.0, 0.45, 0.4), m), 1.0); return; }

  vec3 bloom = texture2D(tBloom, uv).rgb * uBloomTint * uBloom;
  if (uView > 2.5 && uView < 3.5) { gl_FragColor = vec4(toSRGB(tonemap(bloom)), 1.0); return; }

  // ---- 移轴景深 ----
  float k = uTilt > 0.5 ? tiltCoc(uv, aspect) : 0.0;
  vec3 col = k > 0.0 ? mix(sharp, texture2D(tTilt, uv).rgb, k) : sharp;
  if (uView > 3.5) { gl_FragColor = vec4(mix(toSRGB(col), vec3(0.35, 0.7, 1.0), k * 0.45 * (1.0 - m)), 1.0); return; }

  // ---- 动态模糊 ----
  if (uBlurOn > 0.5 && length(uBlurDir * uRes) * (uBlurCenter + uBlurEdge) > 1.0) {
    float edge = smoothstep(0.08, 0.9, r);
    vec2 dir = uBlurDir * (uBlurCenter + uBlurEdge * edge * edge);
    // 自适应采样：每 1.5 像素一个样本，模糊很短的屏幕中心只需少量采样
    float lenPx = length(dir * uRes);
    float n = clamp(ceil(lenPx / 1.5), 1.0, uSamples);
    float j = ign(gl_FragCoord.xy + fract(uTime * 7.0) * 113.0);
    vec3 acc = vec3(0.0);
    float ws = 0.0;
    for (int i = 0; i < 32; i++) {
      if (float(i) >= n) break;
      float f = (float(i) + j) / n - 0.5;
      vec2 suv = uv + dir * f;
      float w = 1.0 - texture2D(tMask, suv).r * uMaskSharp;   // 不把卡车颜色拖进背景
      vec3 c = texture2D(tColor, suv).rgb;
      if (k > 0.0) c = mix(c, texture2D(tTilt, suv).rgb, k);
      acc += c * w;
      ws += w;
    }
    if (ws > 0.001) col = acc / ws;
  }
  col = mix(col, sharp, smoothstep(0.25, 0.75, m));
  if (uPunch > 0.001) {
    // Red and blue pulled apart radially, strongest at the edges, gone by the time the punch fades.
    vec2 split = (uv - 0.5) * 0.014 * uPunch;
    col.r = mix(col.r, texture2D(tColor, uv + split).r, 0.85);
    col.b = mix(col.b, texture2D(tColor, uv - split).b, 0.85);
  }

  // ---- Bloom + 色调映射（线性 HDR） ----
  col += bloom;
  col = tonemap(col);

  // ---- 调色（在 sRGB 感知空间里做） ----
  col = toSRGB(col);
  if (uGradeOn > 0.5) {
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(l), col, uSat * (1.0 + 0.4 * uPunch));
    col = (col - 0.5) * (uContrast * (1.0 + 0.12 * uPunch)) + 0.5;
    col = col * uGain + uLift * (1.0 - col);
    col += (vec3(-0.012, 0.0, 0.016) * (1.0 - l) + vec3(0.014, 0.006, -0.012) * l) * uSplit;
  }

  // ---- 速度线（屏幕边缘，沿运动方向） ----
  if (uLines > 0.0) {
    vec2 dA = normalize(uBlurDir * vec2(aspect, 1.0) + vec2(1e-6));
    vec2 pA = vec2(-dA.y, dA.x);
    float along = dot(cuv, dA);
    float across = dot(cuv, pA);
    float bi = floor(across * uLinesBands);
    float rnd = hash(vec2(bi, 3.1));
    float fa = fract(across * uLinesBands);
    float thin = 1.0 - smoothstep(0.0, 0.16, abs(fa - 0.5));
    float ph = fract(along * 0.8 - uTime * uLinesSpeed * (1.1 + rnd * 1.6) + rnd * 17.0);
    float seg = smoothstep(0.0, uLinesLength, ph) * (1.0 - smoothstep(uLinesLength, uLinesLength + 0.04, ph));
    float lines = step(1.0 - uLinesDensity, rnd) * thin * seg
                * smoothstep(uLinesRadius, uLinesRadius + 0.46, r) * (1.0 - m) * uLines;
    col = mix(col, vec3(1.0, 0.99, 0.95), clamp(lines * 0.5, 0.0, 1.0));
  }

  // ---- 带色暗角（压向深青绿，不压黑） ----
  float vig = smoothstep(uVigInner, uVigOuter, r);
  col = mix(col, col * uVigColor, vig * uVig);
  // A warm comic flash rimming the screen edges.
  col = mix(col, vec3(1.0, 0.92, 0.7), smoothstep(0.5, 1.05, r) * 0.32 * uPunch);
  // Own-state grade (StatusGrade): respawn wait drains colour; shocks shimmer white-blue; a death flashes a soft red rim.
  float rim = smoothstep(0.55, 1.08, r);
  col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), 0.55 * uDesat);
  float crackle = 0.7 + 0.3 * sin(uTime * 37.0 + r * 21.0) * sin(uTime * 23.0 - uv.x * 13.0);
  col = mix(col, mix(vec3(1.0), vec3(0.72, 0.9, 1.0), 0.5 + 0.5 * sin(uTime * 17.0 + uv.y * 9.0)), rim * 0.38 * uShock * crackle);
  col = mix(col, vec3(0.9, 0.36, 0.32), rim * 0.26 * uDeath);
  col = mix(col, vec3(1.0, 0.99, 0.96), rim * 0.24 * uDown);

  // ---- 颗粒 ----
  col += (hash(uv * uRes + fract(uTime) * 100.0) - 0.5) * uGrain;

  gl_FragColor = vec4(col, 1.0);
}
`;

/** Pelican pouch view: a narrow, dark-throated vignette. */
const SWALLOW_VIGNETTE = { strength: 1, inner: 0.16, outer: 0.78, color: new THREE.Color(0.16, 0.07, 0.08) };

export const TONEMAPS = { None: 0, ACES: 1, AgX: 2, Neutral: 3, Reinhard: 4 };
const MAX_LEVELS = 8;

// 后处理在 sRGB 空间计算，颜色不做线性化
const rawColor = (target, hex) => {
  if (target.userData === hex) return target;   // 未变化时跳过字符串解析，避免每帧产生垃圾
  target.userData = hex;
  return target.setHex(parseInt(hex.slice(1), 16), THREE.LinearSRGBColorSpace);
};

export class PostFX {
  constructor(renderer, clearColor) {
    this.renderer = renderer;
    this.clearColor = new THREE.Color(clearColor);
    this.view = 0;
    if (location.search.includes('post=0')) CFG.post.enabled = false;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: this.msaaSamples() });
    this.maskRT = new THREE.WebGLRenderTarget(Math.max(1, size.x >> 1), Math.max(1, size.y >> 1));
    this.maskMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    // Bloom mip 链（降采样链 + 升采样链）
    const opts = { type: THREE.HalfFloatType, depthBuffer: false };
    this.down = Array.from({ length: MAX_LEVELS }, () => new THREE.WebGLRenderTarget(1, 1, opts));
    this.up = Array.from({ length: MAX_LEVELS }, () => new THREE.WebGLRenderTarget(1, 1, opts));
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.black.needsUpdate = true;
    this.tiltA = new THREE.WebGLRenderTarget(1, 1, opts);
    this.tiltB = new THREE.WebGLRenderTarget(1, 1, opts);

    const f = (v) => ({ value: v });
    this.downMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: DOWN_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tSrc: f(null), uTexel: f(new THREE.Vector2()), uPrefilter: f(0), uThreshold: f(1), uKnee: f(0.4) },
    });
    this.upMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: UP_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tLow: f(null), tHigh: f(null), uTexel: f(new THREE.Vector2()), uScatter: f(0.7) },
    });
    // 清晰带几何由 setTiltFocus 每帧更新，两个模糊 pass 与合成共用同一组对象
    const tiltFocus = { uTiltCenter: f(new THREE.Vector2()), uTiltNormal: f(new THREE.Vector2(1, 0)), uTiltBand: f(new THREE.Vector2(0.2, 0.6)) };
    this.tiltMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: TILT_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tSrc: f(null), tMask: f(null), uStep: f(new THREE.Vector2()), uRadius: f(0), uAspect: f(16 / 9), uMaskSharp: f(1), ...tiltFocus },
    });

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tColor: f(this.rt.texture),
        tMask: f(this.maskRT.texture),
        tBloom: f(this.black),
        tTilt: f(this.black), uTilt: f(0), ...tiltFocus,
        uRes: f(size.clone()),
        uTime: f(0),
        uBlurDir: f(new THREE.Vector2(0.01, 0)),
        uView: f(0),
        uBlurOn: f(1), uFxaa: f(0), uBlurCenter: f(0), uBlurEdge: f(0), uSamples: f(14), uMaskSharp: f(1),
        uBloom: f(0), uBloomTint: f(new THREE.Color(1, 1, 1)),
        uTonemap: f(0), uExposure: f(1), uPunch: f(0), uDesat: f(0), uShock: f(0), uDeath: f(0), uDown: f(0),
        uGradeOn: f(1), uSat: f(1), uContrast: f(1),
        uLift: f(new THREE.Color()), uGain: f(new THREE.Color()), uSplit: f(1),
        uLines: f(1), uLinesDensity: f(0.13), uLinesBands: f(85), uLinesSpeed: f(1),
        uLinesLength: f(0.3), uLinesRadius: f(0.42),
        uVig: f(0), uVigInner: f(0.4), uVigOuter: f(1), uVigColor: f(new THREE.Color()),
        uGrain: f(0),
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.setSize();
  }

  // 高像素比时像素已经很密，2x MSAA 足够，能省下大量显存带宽
  msaaSamples() {
    const m = CFG.render.msaa;
    if (m === 'auto') {
      // 按屏幕判断（不随自动降分辨率变化，避免来回重建）：
      // 2x 屏像素已经很密，MSAA 换成 FXAA；在 Apple GPU 上 MSAA + 多 pass Bloom 带宽开销很大
      const dpr = window.devicePixelRatio || 1;
      return dpr >= 2 ? 0 : dpr >= 1.5 ? 2 : 4;
    }
    return Number(m) || 0;
  }

  get enabled() { return CFG.post.enabled; }
  set enabled(v) { CFG.post.enabled = v; }

  dispose() {
    if (this.disposed) return;
    for (const target of [this.rt, this.maskRT, this.tiltA, this.tiltB, ...this.down, ...this.up]) target.dispose();
    for (const material of [this.maskMat, this.downMat, this.upMat, this.tiltMat, this.material]) material.dispose();
    this.black.dispose(); this.quad.geometry.dispose(); this.quadScene.clear(); this.disposed = true;
  }

  setSize() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const samples = this.msaaSamples();
    if (this.rt.samples !== samples) {
      this.rt.samples = samples;
      this.rt.dispose();
    }
    this.rt.setSize(size.x, size.y);
    this.maskRT.setSize(Math.max(1, size.x >> 1), Math.max(1, size.y >> 1));
    this.tiltA.setSize(Math.max(1, size.x >> 1), Math.max(1, size.y >> 1));
    this.tiltB.setSize(Math.max(1, size.x >> 1), Math.max(1, size.y >> 1));
    this.material.uniforms.uRes.value.copy(size);
    let w = size.x, h = size.y;
    this.maxLevels = 0;
    for (let i = 0; i < MAX_LEVELS; i++) {
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
      this.down[i].setSize(w, h);
      this.up[i].setSize(w, h);
      if (Math.min(w, h) >= 4) this.maxLevels = i + 1;
    }
  }

  pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
    this.passCount++;
  }

  renderBloom() {
    const P = LOOK.post; // day-cycle blended Bloom
    const n = Math.max(1, Math.min(Math.round(P.bloomLevels), this.maxLevels));
    const du = this.downMat.uniforms, uu = this.upMat.uniforms;
    du.uThreshold.value = P.bloomThreshold;
    du.uKnee.value = Math.max(1e-3, P.bloomKnee);

    let src = this.rt.texture, srcW = this.rt.width, srcH = this.rt.height;
    for (let i = 0; i < n; i++) {
      du.tSrc.value = src;
      du.uTexel.value.set(1 / srcW, 1 / srcH);
      du.uPrefilter.value = i === 0 ? 1 : 0;
      this.pass(this.downMat, this.down[i]);
      src = this.down[i].texture; srcW = this.down[i].width; srcH = this.down[i].height;
    }
    let low = this.down[n - 1];
    uu.uScatter.value = P.bloomScatter;
    for (let i = n - 2; i >= 0; i--) {
      uu.tLow.value = low.texture;
      uu.tHigh.value = this.down[i].texture;
      uu.uTexel.value.set(1 / low.width, 1 / low.height);
      this.pass(this.upMat, this.up[i]);
      low = this.up[i];
    }
    return low.texture;
  }

  // 焦点车中线（屏幕坐标，宽高比校正）、垂直道路的方向与清晰带范围；由 RenderPipeline 按镜头投影计算
  setTiltFocus(center, normal, near, far) {
    const u = this.tiltMat.uniforms;
    u.uTiltCenter.value.copy(center);
    u.uTiltNormal.value.copy(normal);
    u.uTiltBand.value.set(near, Math.max(far, near + 1e-3));
  }

  renderTilt(maskTexture) {
    const P = LOOK.post;
    const u = this.tiltMat.uniforms, a = this.tiltA, b = this.tiltB;
    u.tMask.value = maskTexture;
    u.uMaskSharp.value = P.maskSharp ? 1 : 0;
    u.uAspect.value = this.rt.width / this.rt.height;
    u.uRadius.value = P.tilt * 0.012 * a.height;
    u.tSrc.value = this.rt.texture;
    u.uStep.value.set(1 / a.width, 0);
    this.pass(this.tiltMat, a);
    u.tSrc.value = a.texture;
    u.uStep.value.set(0, 1 / b.height);
    this.pass(this.tiltMat, b);
    return b.texture;
  }

  /** `punch` 0..1 is the knock-off feedback (push-in, chromatic split, punchier grade, warm edge flash).
   * `swallow` 0..1 closes a dark throat vignette over the base grade while the local player sits in a pelican pouch. */
  syncUniforms(lines, swallow = 0, punch = 0, status = null) {
    const u = this.material.uniforms;
    // Knock-off feedback envelope (SceneCamera.punch); off with the post stack.
    const graded = CFG.post.enabled && this.view !== 1;
    u.uPunch.value = graded ? punch : 0;
    // Own-state grade (StatusGrade), off with the post stack too.
    u.uDesat.value = graded && status ? status.desat : 0; u.uShock.value = graded && status ? status.shock : 0; u.uDeath.value = graded && status ? status.death : 0; u.uDown.value = graded && status ? status.down : 0;
    const P = LOOK.post;
    u.uView.value = P.enabled ? this.view : 1;
    u.uBlurOn.value = P.blurOn ? 1 : 0;
    const fx = CFG.render.fxaa;
    u.uFxaa.value = (fx === 'on' || (fx === 'auto' && this.rt.samples === 0)) ? 1 : 0;
    u.uBlurCenter.value = P.blurCenter;
    u.uBlurEdge.value = P.blurEdge;
    u.uSamples.value = Math.max(1, Math.round(P.blurSamples));
    u.uMaskSharp.value = P.maskSharp ? 1 : 0;
    u.uBloom.value = P.bloomOn ? P.bloom : 0;
    rawColor(u.uBloomTint.value, P.bloomTint);
    u.uTonemap.value = TONEMAPS[P.tonemap] ?? 0;
    u.uExposure.value = P.exposure;
    u.uGradeOn.value = P.gradeOn ? 1 : 0;
    u.uSat.value = P.saturation;
    u.uContrast.value = P.contrast;
    if (this._lift !== P.liftColor + P.liftAmount) {
      this._lift = P.liftColor + P.liftAmount;
      u.uLift.value.userData = null;
      rawColor(u.uLift.value, P.liftColor).multiplyScalar(P.liftAmount);
    }
    rawColor(u.uGain.value, P.gainColor);
    u.uSplit.value = P.splitTone;
    u.uLines.value = P.linesOn ? P.lines * lines : 0;
    u.uLinesDensity.value = P.linesDensity;
    u.uLinesBands.value = P.linesBands;
    u.uLinesSpeed.value = P.linesSpeed;
    u.uLinesLength.value = P.linesLength;
    u.uLinesRadius.value = P.linesRadius;
    const base = P.vignetteOn ? P.vignette : 0, s = swallow;
    u.uVig.value = base + (SWALLOW_VIGNETTE.strength - base) * s;
    u.uVigInner.value = P.vigInner + (SWALLOW_VIGNETTE.inner - P.vigInner) * s;
    u.uVigOuter.value = P.vigOuter + (SWALLOW_VIGNETTE.outer - P.vigOuter) * s;
    rawColor(u.uVigColor.value, P.vigColor);
    // The tint mutates the cached grade colour, so force the next frame to re-read it.
    if (s > 0) { u.uVigColor.value.lerp(SWALLOW_VIGNETTE.color, s); u.uVigColor.value.userData = null; }
    u.uGrain.value = P.grainOn ? P.grain : 0;
  }

  render(scene, camera, { time, blurDir, lines, swallow = 0, punch = 0, status = null }) {
    const r = this.renderer;
    const u = this.material.uniforms;
    const P = CFG.post;
    const active = P.enabled && this.view !== 1;

    this.passCount = 0;
    const blurVisible = P.blurOn && Math.hypot(blurDir.x * this.rt.width, blurDir.y * this.rt.height) * (P.blurCenter + P.blurEdge) > 1;
    const linesVisible = P.linesOn && P.lines * lines > 0;
    const tiltVisible = active && (this.view === 4 || P.tiltOn && LOOK.post.tilt > 0);
    const needsMask = active && (this.view === 2 || P.maskSharp && (blurVisible || linesVisible || tiltVisible));
    u.tMask.value = needsMask ? this.maskRT.texture : this.black;

    // 1) 主场景
    r.setRenderTarget(this.rt);
    r.setClearColor(this.clearColor, 1);
    r.render(scene, camera); this.passCount++;

    // 2) 速度遮罩（复用阴影贴图）：动态模糊、速度线或遮罩视图需要
    if (needsMask) {
      r.shadowMap.autoUpdate = false;
      camera.layers.set(1);
      scene.overrideMaterial = this.maskMat;
      r.setRenderTarget(this.maskRT);
      r.setClearColor(0x000000, 1);
      try { r.render(scene, camera); this.passCount++; }
      finally {
        scene.overrideMaterial = null;
        camera.layers.set(0);
        r.shadowMap.autoUpdate = true;
      }
    }

    // 3) 移轴景深（读取遮罩，必须在遮罩之后）
    u.tTilt.value = tiltVisible ? this.renderTilt(u.tMask.value) : this.black;
    u.uTilt.value = tiltVisible ? 1 : 0;

    // 4) Bloom
    u.tBloom.value = active && (this.view === 3 || P.bloomOn && P.bloom > 0) ? this.renderBloom() : this.black;

    // 5) 合成到屏幕
    this.syncUniforms(lines, swallow, punch, status);
    if (this.view === 3) u.uBloom.value = P.bloom;
    u.uTime.value = time;
    u.uBlurDir.value.copy(blurDir);
    this.quad.material = this.material;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam); this.passCount++;
  }
}
