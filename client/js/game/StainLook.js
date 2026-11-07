/** Procedural roof stains: dust film, splattered mud and oily grease, each showing its cleaning step on the surface —
 * soap loosens the grime, the rinse erodes it into a wet residue with water spots, the towel wipes it away in swirls.
 * Client look only: stage and progress are read from the authoritative stain each frame. Every stain shares one
 * program (fixed cache key), prepared at boot through the readiness sample. */
import * as THREE from 'three';

const NOISE = /* glsl */`
float sHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sHash(i), sHash(i + vec2(1, 0)), f.x), mix(sHash(i + vec2(0, 1)), sHash(i + vec2(1, 1)), f.x), f.y);
}
float sFbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * sNoise(p); p = p * 2.07 + 13.3; a *= 0.5; } return s; }
// Distance to the nearest Voronoi cell border: thin dark lines read as cracks in dried mud.
float sCracks(vec2 p) {
  vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(x, y), o = vec2(sHash(i + g), sHash(i + g + 5.7));
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return d2 - d1;
}
vec3 stainBump(vec3 pos, vec3 n, float h) {
  vec3 sx = dFdx(pos), sy = dFdy(pos), r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1);
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - grad);
}`;

const SURFACE = /* glsl */`
  vec2 sp = vStainUv * vec2(1.3, 1.0);
  float sr = length(vStainUv);
  vec2 sq = sp + uStainSeed * 7.31;
  float sn1 = sFbm(sq * 1.6), sn2 = sFbm(sq * 4.2 + 3.7), sGrain = sNoise(sq * 24.0);
  float grime = 0.0, grimeA = 0.0, gloss = 0.0, height = 0.0;
  vec3 grimeCol = vec3(0.5);
  if (uStainKind < 0.5) {
    // Dust film: wide, soft, combed backwards by the head wind; a few dark specks.
    float streak = sFbm(vec2(sp.x * 0.5, sp.y * 1.8) * 2.5 + uStainSeed);
    float d = 1.0 - sr * 1.05 + (sn1 - 0.5) * 0.6 + (streak - 0.5) * 0.4;
    grime = smoothstep(0.0, 0.35, d);
    grimeCol = mix(vec3(0.5, 0.44, 0.35), vec3(0.68, 0.61, 0.5), sn2) * (0.88 + 0.24 * sGrain);
    grimeCol = mix(grimeCol, vec3(0.33, 0.28, 0.22), step(0.92, sNoise(sq * 17.0)) * 0.6);
    grimeA = 0.88 * grime * (0.75 + 0.25 * streak);
    height = grime * 0.15;
  } else if (uStainKind < 1.5) {
    // Mud splat: wet core, splash arms, thrown drops and a drip tail blown to the back; edges dry pale and crack.
    float ang = atan(sp.y, sp.x);
    float arms = pow(abs(sin(ang * 3.5 + uStainSeed * 5.0)), 6.0) * 0.28 * (1.0 - smoothstep(0.3, 1.0, sr));
    float d = max(0.6 - sr + (sn1 - 0.5) * 0.55, 0.42 - sr + arms + (sn1 - 0.5) * 0.3);
    vec2 g = sp * 3.0 + uStainSeed * 3.0, c = floor(g), f = fract(g) - 0.5;
    vec2 o = (vec2(sHash(c + 1.7), sHash(c + 9.2)) - 0.5) * 0.5;
    float drop = (0.08 + 0.12 * sHash(c + 4.4) - length(f - o)) * 3.0 * step(0.6, sHash(c + 2.2)) * (1.0 - smoothstep(0.45, 1.05, sr));
    float tail = (0.11 - abs(sp.y + (sn2 - 0.5) * 0.18 - 0.12)) * 4.0 * smoothstep(-1.25, -0.45, sp.x) * step(sp.x, -0.2);
    d = max(max(d, drop), tail * 0.6 - 0.04);
    grime = smoothstep(0.0, 0.05, d);
    float edge = (1.0 - smoothstep(0.0, 0.24, d));
    // Yellow clay (muted ochre): a deep, softly saturated earth tone, clearly yellower than the dark grease and stronger than
    // the pale grey-khaki dust film. Wet core darker ochre, dried rim pale sandy yellow.
    grimeCol = mix(vec3(0.41, 0.3, 0.13), vec3(0.7, 0.59, 0.38), clamp(edge * 0.9 + sn2 * 0.25, 0.0, 1.0));
    // Cracks only where the crust has dried (the pale rim), faint and irregular.
    float crack = (1.0 - smoothstep(0.0, 0.05, sCracks(sq * 3.2 + sn1 * 1.5))) * smoothstep(0.25, 0.75, edge + sn2 * 0.3);
    grimeCol *= (1.0 - crack * 0.3) * (0.85 + 0.3 * sGrain);
    // Wet core: a little darker and richer toward the middle.
    grimeCol *= mix(1.0, 0.86, smoothstep(0.1, 0.5, d));
    grimeA = grime * 0.97;
    gloss = (1.0 - edge) * 0.15;
    height = grime * (0.5 + sn1 * 0.5);
  } else {
    // Grease: tarry core, smeared streaks and a rainbow oil film where it thins out.
    float smear = sFbm(vec2(sp.x * 0.6, sp.y * 3.0) + uStainSeed);
    float d = max(0.55 - sr + (sn1 - 0.5) * 0.5, 0.42 - length(sp * vec2(0.7, 1.4)) + (smear - 0.5) * 0.6);
    vec2 g = sp * 3.6 + uStainSeed * 5.0, c = floor(g), f = fract(g) - 0.5;
    d = max(d, (0.06 + 0.1 * sHash(c + 4.4) - length(f)) * 3.0 * step(0.7, sHash(c + 2.2)) * (1.0 - smoothstep(0.5, 1.0, sr)));
    grime = smoothstep(0.0, 0.05, d);
    float core = smoothstep(0.05, 0.35, d);
    grimeCol = mix(vec3(0.22, 0.18, 0.13), vec3(0.06, 0.05, 0.045), core) * (0.9 + 0.2 * sGrain);
    vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (sn2 * 1.5 + sr * 1.2 + vec3(0.0, 0.33, 0.67)));
    grimeCol += rainbow * (1.0 - core) * grime * 0.24;
    grimeA = grime * 0.95;
    gloss = 0.55 + 0.35 * core;
    height = grime * 0.25 + core * 0.2;
  }

  // Cleaning steps. Indices are -1 when the stain does not need that step.
  float grimeK = 1.0, residueK = 0.0, front = 0.0, lift = 0.0;
  if (uWaterIdx > -0.5) {
    if (uStage > uWaterIdx + 0.5) { grimeK = 0.0; residueK = 1.0; }
    else if (uStage > uWaterIdx - 0.5) {
      // Rinse: the grime erodes in ragged channels that run back with the wind.
      float field = sFbm(vec2(sp.x * 0.7, sp.y * 2.8) + uStainSeed * 2.0) * 0.8 + sr * 0.3;
      float washed = smoothstep(field - 0.06, field + 0.06, uProgress * 1.2);
      grimeK = 1.0 - washed; residueK = washed;
    }
    if (uSoapIdx > -0.5) lift = uStage > uSoapIdx + 0.5 ? 1.0 : uStage > uSoapIdx - 0.5 ? uProgress : 0.0;
  }
  if (abs(uStage - uTowelIdx) < 0.5) {
    // Towel: swirling strokes from the middle outwards, pushing a darker line of dirt ahead of them.
    float ang = atan(sp.y, sp.x);
    float field = sr * 0.75 + (sin(ang * 2.0 + sr * 9.0 + uStainSeed * 3.0) * 0.5 + 0.5) * 0.22 + (sn2 - 0.5) * 0.18;
    float wipe = uProgress * 1.15;
    float wiped = smoothstep(field - 0.04, field + 0.04, wipe);
    front = (1.0 - smoothstep(0.0, 0.09, abs(field - wipe))) * (1.0 - wiped) * step(0.001, uProgress);
    grimeK *= 1.0 - wiped; residueK *= 1.0 - wiped;
  }
  // Soap loosens the grime: paler, sudsy streaks, slick.
  grimeCol = mix(grimeCol, grimeCol * 1.3 + 0.06, lift * 0.55);
  grimeCol = mix(grimeCol, vec3(0.93, 0.95, 0.96), lift * 0.3 * smoothstep(0.55, 0.75, sn2));
  gloss += lift * 0.35;

  // Rinse residue: thin muddy film with water-spot rings.
  vec2 wg = sq * 6.0, wc = floor(wg), wf = fract(wg) - 0.5;
  float ringR = 0.18 + 0.14 * sHash(wc + 3.1), ringD = length(wf - (vec2(sHash(wc), sHash(wc + 7.0)) - 0.5) * 0.3);
  float spots = (1.0 - smoothstep(0.0, 0.05, abs(ringD - ringR))) * step(0.55, sHash(wc + 1.9));
  float residue = smoothstep(0.0, 0.3, 0.85 - sr + (sn1 - 0.5) * 0.5);
  vec3 resCol = mix(vec3(0.5, 0.45, 0.37), vec3(0.64, 0.58, 0.5), sn2);
  float resA = residue * residueK * (0.42 + 0.2 * sn1) + spots * residue * residueK * 0.4;

  float gA = grimeA * grimeK;
  float stainA = gA + resA * (1.0 - gA);
  vec3 stainCol = (grimeCol * gA + resCol * resA * (1.0 - gA)) / max(stainA, 1e-4);
  stainCol *= 1.0 - front * 0.35;
  stainA = max(stainA, front * 0.55 * grimeA);
  // Freshly rinsed areas stay dark and glossy for a few seconds.
  stainCol *= 1.0 - 0.28 * uWet;
  // Colours above are authored in sRGB; Lambert lights in linear.
  stainCol = pow(stainCol, vec3(2.2));
  float stainGloss = gloss * gA + uWet * 0.45 * stainA;
  float stainHeight = height * grimeK + resA * 0.05;
  diffuseColor = vec4(stainCol, stainA);
  if (stainA < 0.004) discard;
`;

let geometry = null;
const shape = () => geometry ||= new THREE.PlaneGeometry(1.36, 1.04).rotateX(-Math.PI / 2);

/** One roof stain. `steps` decides the dirt type: towel only = dust, water first = mud, soap first = grease. */
export function createStainMesh(index = 0, steps = ['towel']) {
  const uniforms = {
    uStainKind: { value: steps[0] === 'soap' ? 2 : steps[0] === 'water' ? 1 : 0 }, uStainSeed: { value: index * 1.37 },
    uStage: { value: 0 }, uProgress: { value: 0 }, uWet: { value: 0 },
    uSoapIdx: { value: steps.indexOf('soap') }, uWaterIdx: { value: steps.indexOf('water') }, uTowelIdx: { value: steps.indexOf('towel') },
  };
  const material = new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  material.userData.stain = uniforms;
  material.customProgramCacheKey = () => 'wash-stain-v1';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vStainUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vStainUv = uv * 2.0 - 1.0;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vStainUv;
uniform float uStainKind, uStainSeed, uStage, uProgress, uWet, uSoapIdx, uWaterIdx, uTowelIdx;
${NOISE}`)
      .replace('#include <map_fragment>', SURFACE)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  normal = stainBump(-vViewPosition, normal, stainHeight * 0.01);`)
      .replace('#include <opaque_fragment>', `
  float stainFres = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
  outgoingLight += vec3(0.55, 0.66, 0.82) * (0.05 + stainFres) * stainGloss * 0.15 * diffuseColor.a;
#if NUM_DIR_LIGHTS > 0
  float stainNH = saturate(dot(normal, normalize(directionalLights[0].direction + normalize(vViewPosition))));
  // Tight, broken-up glints rather than a flat sheen, so wet dirt keeps its colour.
  float stainGlint = smoothstep(0.35, 0.8, sNoise(vStainUv * 9.0 + uStainSeed));
  outgoingLight += directionalLights[0].color * (pow(stainNH, 180.0) * 0.9 * stainGlint + pow(stainNH, 20.0) * 0.025) * stainGloss * diffuseColor.a;
#endif
#include <opaque_fragment>`);
  };
  const mesh = new THREE.Mesh(shape().clone(), material);
  mesh.receiveShadow = true; mesh.renderOrder = 1;
  mesh.layers.enable(1);
  mesh.userData.look = { lastProgress: 0, lastStage: 0, wetAt: -1e9 };
  return mesh;
}

/** Mirror one authoritative stain into its material. Water progress keeps the spot wet for a few seconds. */
export function updateStainLook(stain, serial, index, time) {
  const material = stain.mesh.material, u = material.userData.stain, look = stain.mesh.userData.look;
  if (!u) return;
  const rinsing = stain.steps[stain.stage] === 'water';
  if ((rinsing && stain.progress > look.lastProgress + 1e-5) || (stain.stage > look.lastStage && stain.steps[look.lastStage] === 'water')) look.wetAt = time;
  look.lastProgress = stain.progress; look.lastStage = stain.stage;
  u.uStage.value = stain.stage; u.uProgress.value = stain.progress;
  u.uWet.value = Math.max(0, Math.min(1, 1 - (time - look.wetAt - 1.5) / 4));
  u.uStainSeed.value = ((serial * 0.618 + index * 0.37) % 1) * 10;
}
