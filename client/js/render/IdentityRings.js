import * as THREE from 'three';
import { MAX_PLAYER_SLOTS } from '../../../shared/levels.js';
import { CFG } from '../core/config.js';

const batches = new WeakMap();
/** Height above the feet. Players lean less than the roof, so VehicleSuspension tilts the ring to the roof slope. */
export const RING_LIFT = 0.045;
export const RING_BASE = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

class RingHandle {
  constructor(color) {
    this.node = new THREE.Object3D();
    // Appearance state stays outside the scene graph, so Three never compiles a phantom per-player material.
    // style 0: thin identity ring; style 1: team ring (thicker band, light rim, soft inner glow).
    this.material = { color: new THREE.Color(color), opacity: 0.55, style: 0 };
    this.node.rotation.x = -Math.PI / 2; this.node.position.y = RING_LIFT;
  }
  get visible() { return this.node.visible; }
  set visible(value) { this.node.visible = value; }
  get name() { return this.node.name; }
  set name(value) { this.node.name = value; }
}

/** One transparent draw per scene, including the separate Customize preview scene. No gameplay state. */
export class IdentityRings {
  constructor(scene) {
    // One ring per prepared character slot (eight for versus); the instance count still follows visible rings.
    this.scene = scene; this.handles = []; this.capacity = MAX_PLAYER_SLOTS.length;
    // The quad annulus covers both looks and every tuned team size; the fragment shader cuts the band by radius.
    const geometry = new THREE.RingGeometry(0.1, 1.5, 96, 1);
    this.opacity = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1).setUsage(THREE.DynamicDrawUsage);
    this.style = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('ringOpacity', this.opacity); geometry.setAttribute('ringStyle', this.style);
    // Pulled toward the camera in depth, so a roof that bobs or leans slightly cannot hide part of the ring.
    const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
    material.customProgramCacheKey = () => 'identity-rings';
    // Team ring shape from CFG.team (debug-tunable): x inner radius, y band width, z rim width, w glow width; look: glow, opacity.
    this.teamShape = { value: new THREE.Vector4() }; this.teamLook = { value: new THREE.Vector2() };
    material.onBeforeCompile = shader => {
      shader.uniforms.teamShape = this.teamShape; shader.uniforms.teamLook = this.teamLook;
      shader.vertexShader = shader.vertexShader.replace('#include <common>',
        '#include <common>\nattribute float ringOpacity; attribute float ringStyle; varying float vRingOpacity; varying float vRingStyle; varying vec2 vRingPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRingOpacity = ringOpacity; vRingStyle = ringStyle; vRingPos = position.xy;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying float vRingOpacity; varying float vRingStyle; varying vec2 vRingPos;
uniform vec4 teamShape; uniform vec2 teamLook;
float ringBand(float r, float a, float b, float w) { return smoothstep(a - w, a + w, r) * (1.0 - smoothstep(b - w, b + w, r)); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
float r = length(vRingPos), w = max(fwidth(r) * 0.75, 0.002);
float alpha;
if (vRingStyle < 0.5) {
  alpha = ringBand(r, 0.54, 0.65, w);
} else {
  // Team ring: soft glow pooling toward the band, a solid band, then a light rim that reads on dark asphalt.
  float inner = teamShape.x, outer = teamShape.x + teamShape.y, edge = outer + teamShape.z;
  float glow = smoothstep(inner - teamShape.w, inner, r) * (1.0 - smoothstep(inner - w, inner + w, r)) * teamLook.x;
  float band = ringBand(r, inner, outer, w), rim = teamShape.z > 0.0 ? ringBand(r, outer, edge, w) : 0.0;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.9, 0.86), rim);
  alpha = max(glow, max(band, rim * 0.95)) * teamLook.y;
}
diffuseColor.a *= min(1.0, alpha * vRingOpacity);`);
    };
    this.mesh = new THREE.InstancedMesh(geometry, material, this.capacity);
    this.mesh.name = 'player-identity-rings'; this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.capacity; i++) this.mesh.setColorAt(i, new THREE.Color('#ffffff'));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage); this.mesh.count = 0;
    this.previousRender = scene.onBeforeRender;
    this.beforeRender = (renderer, currentScene, camera, ...args) => {
      this.previousRender.call(scene, renderer, currentScene, camera, ...args);
      if (!this.disposed && camera.layers.isEnabled(0)) this.sync(camera);
    };
    // Prepare instance data before Three uploads buffers while building the render list.
    scene.onBeforeRender = this.beforeRender;
    this.matrix = new THREE.Matrix4(); this.inverse = new THREE.Matrix4(); this.point = new THREE.Vector3();
    this.visibleHandles = []; scene.add(this.mesh);
  }
  create(color) {
    if (this.handles.length === this.capacity) throw new Error('Identity ring capacity exceeded');
    const handle = new RingHandle(color); this.handles.push(handle); return handle;
  }
  sync(camera) {
    const T = CFG.team;
    this.teamShape.value.set(T.ringRadius, T.ringWidth, T.rimWidth, T.glowSpread); this.teamLook.value.set(T.glow, T.ringOpacity);
    const visible = this.visibleHandles; visible.length = 0;
    for (const handle of this.handles) {
      let shown = true;
      for (let node = handle.node; node; node = node.parent) if (!node.visible) { shown = false; break; }
      if (!shown || !handle.node.parent) continue;
      handle.node.updateWorldMatrix(true, false);
      handle.depth = this.point.setFromMatrixPosition(handle.node.matrixWorld).applyMatrix4(camera.matrixWorldInverse).z;
      visible.push(handle);
    }
    // Keep the previous per-object back-to-front alpha order within the single batch.
    visible.sort((a, b) => a.depth - b.depth);
    this.inverse.copy(this.mesh.matrixWorld).invert();
    let matrices = false, colors = false, opacity = false, style = false;
    for (let i = 0; i < visible.length; i++) {
      const handle = visible[i], color = handle.material.color;
      this.matrix.multiplyMatrices(this.inverse, handle.node.matrixWorld);
      for (let j = 0; j < 16; j++) if (this.mesh.instanceMatrix.array[i * 16 + j] !== Math.fround(this.matrix.elements[j])) { this.mesh.setMatrixAt(i, this.matrix); matrices = true; break; }
      const rgb = this.mesh.instanceColor.array;
      if (rgb[i * 3] !== Math.fround(color.r) || rgb[i * 3 + 1] !== Math.fround(color.g) || rgb[i * 3 + 2] !== Math.fround(color.b)) { this.mesh.setColorAt(i, color); colors = true; }
      if (this.opacity.getX(i) !== Math.fround(handle.material.opacity)) { this.opacity.setX(i, handle.material.opacity); opacity = true; }
      if (this.style.getX(i) !== handle.material.style) { this.style.setX(i, handle.material.style); style = true; }
    }
    this.mesh.count = visible.length;
    if (matrices) this.mesh.instanceMatrix.needsUpdate = true;
    if (colors) this.mesh.instanceColor.needsUpdate = true;
    if (opacity) this.opacity.needsUpdate = true;
    if (style) this.style.needsUpdate = true;
  }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    if (this.scene.onBeforeRender === this.beforeRender) this.scene.onBeforeRender = this.previousRender;
    this.mesh.removeFromParent(); this.mesh.dispose(); this.mesh.geometry.dispose(); this.mesh.material.dispose();
    batches.delete(this.scene);
  }
}

export function identityRings(scene) {
  if (!batches.has(scene)) batches.set(scene, new IdentityRings(scene));
  return batches.get(scene);
}
