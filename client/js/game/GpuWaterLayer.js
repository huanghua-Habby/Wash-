/** One instanced draw. Birth buffers change on emission; the GPU owns all particle motion. */
import * as THREE from 'three';
import puff from '../../assets/unity/water-puff.json';
import { WASH_CONFIG as C } from '../../../shared/sim/washConfig.js';

const vertexShader = `
  uniform float uTime;
  uniform float uKind;
  uniform float uGravity;
  attribute vec3 aOrigin;
  attribute vec3 aVelocity;
  attribute vec3 aAxis;
  attribute vec4 aLife;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vAlive;
  varying float vTint;
  float hash(float seed) { return fract(sin(seed * 12.9898 + 78.233) * 43758.5453); }
  void main() {
    float rawAge = uTime - aLife.x;
    float age = clamp(rawAge, 0.0, max(aLife.y, 0.001));
    float t = age / max(aLife.y, 0.001);
    vAlive = step(0.0, rawAge) * (1.0 - step(aLife.y, rawAge)) * step(0.001, aLife.z);
    vTint = hash(aLife.w + 5.0);
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 axis = normalize(aAxis + vec3(0.00001));
    vec3 right = normalize(cross(abs(axis.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : up, axis));
    vec3 side = cross(axis, right);
    vec3 velocity = aVelocity;
    float curve;
    vec3 stretch = vec3(1.0);
    if (uKind < 0.5) {
      curve = t < 0.732 ? mix(0.423, 1.0, t / 0.732) : (1.0 - t) / 0.268;
      stretch.y = 1.35;
    } else if (uKind < 1.5) {
      float angle = mod(aLife.w, 12.0) / 12.0 * 6.2831853 + hash(aLife.w) * 0.4;
      float speed = mix(4.5, 8.0, hash(aLife.w + 7.0));
      velocity = (right * cos(angle) + side * sin(angle)) * speed + axis * mix(2.3, 4.5, hash(aLife.w + 9.0));
      curve = t < 0.393 ? t / 0.393 : (1.0 - t) / 0.607;
    } else {
      velocity = vec3(0.0);
      curve = t < 0.126 ? t / 0.126 : (1.0 - t) / 0.874;
      stretch = vec3(1.5, 0.75, 1.5);
    }
    float gravity = uKind > 1.5 ? 0.0 : uGravity;
    vec3 center = aOrigin + velocity * age - up * (0.5 * gravity * age * age);
    if (uKind < 1.5) axis = normalize(velocity - up * gravity * age + vec3(0.00001));
    right = normalize(cross(abs(axis.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : up, axis));
    side = cross(axis, right);
    float spin = aLife.w * 1.7 + age * (uKind < 0.5 ? 1.0 : 9.0);
    mat3 rotation = mat3(right * cos(spin) + side * sin(spin), axis, side * cos(spin) - right * sin(spin));
    float size = aLife.z * max(0.0, curve);
    vec3 transformed = center + rotation * (position * stretch * size);
    vec4 world = modelMatrix * vec4(transformed, 1.0);
    vNormal = normalize(mat3(modelMatrix) * rotation * (normal / stretch));
    vView = cameraPosition - world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
const fragmentShader = `
  uniform vec3 uBlue;
  uniform vec3 uWhite;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vAlive;
  varying float vTint;
  void main() {
    if (vAlive < 0.5) discard;
    vec3 normal = normalize(vNormal);
    vec3 light = normalize(vec3(-0.3, 0.85, 0.4));
    float shade = 0.75 + 0.25 * max(0.0, dot(normal, light));
    float highlight = pow(max(0.0, dot(normal, normalize(light + normalize(vView)))), 12.0) * 0.13;
    vec3 color = mix(uBlue, uWhite, smoothstep(0.68, 1.0, vTint));
    gl_FragColor = vec4(color * shade + vec3(highlight), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class GpuWaterLayer {
  constructor(root, time, capacity, kind) {
    this.capacity = capacity; this.count = 0; this.dirty = false;
    this.expires = new Float64Array(capacity);
    this.lastExpiry = 0; this.compactTime = -Infinity;
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(puff.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(puff.normals, 3));
    geometry.setIndex(puff.indices); geometry.instanceCount = 0;
    this.attributes = {};
    for (const [name, dimensions] of [['aOrigin', 3], ['aVelocity', 3], ['aAxis', 3], ['aLife', 4]]) {
      const attribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * dimensions), dimensions);
      attribute.setUsage(THREE.DynamicDrawUsage); geometry.setAttribute(name, attribute); this.attributes[name] = attribute;
    }
    const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: {
      uTime: time, uKind: { value: kind }, uGravity: { value: C.sprayGravity },
      uBlue: { value: new THREE.Color('#bce8ff') }, uWhite: { value: new THREE.Color('#efffff') },
    } });
    this.mesh = new THREE.Mesh(geometry, material); this.mesh.frustumCulled = false; this.mesh.visible = false;
    this.mesh.userData.gpuParticle = true;
    root.add(this.mesh);
  }
  /** Repack immutable birth records only when emitting, at most once per effect tick. No CPU particle motion. */
  compact() {
    const now = this.mesh.material.uniforms.uTime.value;
    if (this.compactTime === now) return;
    this.compactTime = now;
    let next = 0;
    this.lastExpiry = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.expires[i] <= now) continue;
      if (next !== i) {
        for (const attribute of Object.values(this.attributes)) {
          const size = attribute.itemSize;
          attribute.array.copyWithin(next * size, i * size, (i + 1) * size);
        }
        this.dirty = true;
      }
      this.expires[next] = this.expires[i];
      this.lastExpiry = Math.max(this.lastExpiry, this.expires[next]);
      next++;
    }
    this.count = next;
  }
  emit(origin, velocity, axis, birth, life, size, seed) {
    this.compact();
    if (this.count === this.capacity) return false;
    const slot = this.count++;
    this.attributes.aOrigin.setXYZ(slot, origin.x, origin.y, origin.z);
    this.attributes.aVelocity.setXYZ(slot, velocity.x, velocity.y, velocity.z);
    this.attributes.aAxis.setXYZ(slot, axis.x, axis.y, axis.z);
    this.attributes.aLife.setXYZW(slot, birth, life, size, seed);
    this.expires[slot] = birth + life;
    this.lastExpiry = Math.max(this.lastExpiry, this.expires[slot]);
    this.dirty = true;
    return true;
  }
  flush() {
    // Drain the final short-lived batch without scanning or rewriting instance buffers on idle frames.
    if (this.mesh.material.uniforms.uTime.value >= this.lastExpiry) this.count = 0;
    this.mesh.geometry.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    if (!this.dirty) return;
    for (const attribute of Object.values(this.attributes)) attribute.needsUpdate = true;
    this.dirty = false;
  }
  reset() {
    this.count = 0; this.lastExpiry = 0; this.compactTime = -Infinity; this.dirty = false;
    this.expires.fill(0); this.attributes.aLife.array.fill(0); this.attributes.aLife.needsUpdate = true;
    this.mesh.geometry.instanceCount = 0; this.mesh.visible = false;
  }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
