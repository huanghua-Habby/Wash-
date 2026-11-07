/** Plush fur: one skinned base pass plus instanced, alpha-tested shells pushed out along skinned normals. */
import * as THREE from 'three';

const NOISE = /* glsl */`
float furHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1); p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float furNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(furHash(i), furHash(i + vec3(1, 0, 0)), f.x), mix(furHash(i + vec3(0, 1, 0)), furHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(furHash(i + vec3(0, 0, 1)), furHash(i + vec3(1, 0, 1)), f.x), mix(furHash(i + vec3(0, 1, 1)), furHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;

/**
 * Shared uniforms let every cat material react to one config object.
 * `force` is set per cat each frame (gravity + motion drag in mesh space).
 */
export function createFurMaterial({ shells, length, density, shell, uniforms }) {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  uniforms ||= {
    furLength: { value: length }, furShells: { value: shells }, furDensity: { value: density },
    furForce: { value: new THREE.Vector3(0, -0.6, 0) }, furSheen: { value: new THREE.Color('#fff1dc') },
    furWet: { value: 0 }, // 0 dry … 1 soaked by the water gun (WetSurfaces)
  };
  material.userData.fur = uniforms;
  if (shell) material.defines = { FUR_SHELL: 1 };
  material.customProgramCacheKey = () => (shell ? 'cat-fur-shell' : 'cat-fur-base');
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 furRest;
attribute float furMask;
#ifdef FUR_SHELL
attribute float furShell;
#endif
uniform float furLength, furShells, furWet;
uniform vec3 furForce;
varying float vFurH;
varying float vFurMask;
varying vec3 vFurRest;`)
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>
#ifdef FUR_SHELL
  vFurH = furShell / furShells;
#else
  vFurH = 0.0;
#endif
  vFurMask = furMask; vFurRest = furRest;
  // Soaked fur lies flatter and droops.
  float furLen = furLength * furMask * (1.0 - 0.45 * furWet);
  // Strands curve: straight out at the root, bending with gravity/drag toward the tip.
  transformed += normalize(objectNormal) * furLen * vFurH + (furForce + vec3(0.0, -0.9, 0.0) * furWet) * furLen * vFurH * vFurH;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float furDensity;
uniform vec3 furSheen;
uniform float furWet;
varying float vFurH;
varying float vFurMask;
varying vec3 vFurRest;
${NOISE}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
#ifdef FUR_SHELL
  // Clumped strands: fine noise for hairs, coarse noise for soft tufts. Tips taper away.
  vec3 furP = vFurRest * furDensity;
  float furN = furNoise(furP) * 0.74 + furNoise(furP * 0.43 + 11.7) * 0.26;
  // Wet strands stick together into spiky clumps.
  furN = mix(furN, furNoise(furP * 0.32 + 5.3) * 1.08, furWet * 0.65);
  if (vFurMask < 0.03 || furN < 0.2 + vFurH * 0.66) discard;
#endif`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  // Self-shadowed roots, slightly bleached tips.
  diffuseColor.rgb *= mix(0.66, 1.08, vFurH);
  // Water darkens and deepens the coat.
  // MSAA can extrapolate vertex colors below zero at triangle edges. A fractional
  // pow then produces NaN, even on dry fur (mix still evaluates both inputs),
  // contaminating the HDR target and spreading through Bloom.
  diffuseColor.rgb = mix(diffuseColor.rgb, pow(max(diffuseColor.rgb, vec3(0.0)), vec3(1.25)) * 0.68, furWet);`)
      .replace('#include <opaque_fragment>', `
  float furFresnel = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.2);
  outgoingLight += furSheen * diffuseColor.rgb * furFresnel * (0.18 + 0.45 * vFurH);
  // Wet gloss: a cool rim and tight sun glints on the clumped coat.
  vec3 wetGloss = vec3(0.75, 0.86, 1.0) * furFresnel * 0.35;
#if NUM_DIR_LIGHTS > 0
  vec3 furHalf = normalize(directionalLights[0].direction + normalize(vViewPosition));
  wetGloss += directionalLights[0].color * pow(saturate(dot(normal, furHalf)), 48.0) * 0.5;
#endif
  outgoingLight += wetGloss * furWet;
#include <opaque_fragment>`);
  };
  return material;
}

/** Same index/attributes, drawn `shells` times; instances go outermost-first so depth rejects inner work. */
export function createShellGeometry(geometry, shells) {
  const shell = new THREE.InstancedBufferGeometry();
  shell.index = geometry.index;
  for (const [name, attribute] of Object.entries(geometry.attributes)) shell.setAttribute(name, attribute);
  const order = new Float32Array(shells);
  for (let i = 0; i < shells; i++) order[i] = shells - i;
  shell.setAttribute('furShell', new THREE.InstancedBufferAttribute(order, 1));
  shell.instanceCount = shells;
  return shell;
}

/** Reuse the boot-allocated instance buffer; keep tips at full length at every quality. */
export function setShellCount(geometry, requested) {
  const attribute = geometry.getAttribute('furShell');
  const count = Number.isFinite(requested) ? Math.max(0, Math.min(attribute.count, Math.round(requested))) : attribute.count;
  if (geometry.instanceCount !== count) {
    for (let i = 0; i < count; i++) attribute.setX(i, count - i);
    attribute.needsUpdate = true;
    geometry.instanceCount = count;
  }
  return count;
}
