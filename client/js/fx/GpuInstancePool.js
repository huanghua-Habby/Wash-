import * as THREE from 'three';

/** Immutable birth records; all animation lives in shaders. CPU scans slots only on emission. */
export class GpuInstancePool {
  constructor(scene, source, capacity, dimensions, material) {
    this.capacity = capacity; this.time = material.uniforms.uTime;
    this.expires = new Float64Array(capacity); this.dirty = false; this.until = 0;
    const geometry = new THREE.InstancedBufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute.clone());
    if (source.index) geometry.setIndex(source.index.clone());
    geometry.instanceCount = 0;
    this.attributes = {};
    for (const [name, size] of Object.entries(dimensions)) {
      const attribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, attribute); this.attributes[name] = attribute;
    }
    this.mesh = new THREE.Mesh(geometry, material); this.mesh.frustumCulled = false;
    this.mesh.userData.gpuParticle = true; this.mesh.visible = false;
    source.dispose(); scene.add(this.mesh);
  }
  emit(values, life, maximum = this.capacity) {
    const now = this.time.value;
    let slot = -1, active = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.expires[i] > now) active++;
      else if (slot < 0) slot = i;
    }
    if (slot < 0 || active >= maximum) return false;
    for (const [name, valuesForAttribute] of Object.entries(values)) {
      const attribute = this.attributes[name]; attribute.array.set(valuesForAttribute, slot * attribute.itemSize);
    }
    this.expires[slot] = now + life; this.until = Math.max(this.until, now + life); this.dirty = true; return true;
  }
  flush() {
    if (this.time.value >= this.until) {
      this.mesh.geometry.instanceCount = 0; this.mesh.visible = false;
    }
    if (!this.dirty) return;
    // Compact birth records only after emission, never scan particles on quiet frames.
    let count = 0;
    for (let slot = 0; slot < this.capacity; slot++) if (this.expires[slot] > this.time.value) {
      if (slot !== count) {
        for (const attribute of Object.values(this.attributes)) {
          const size = attribute.itemSize;
          attribute.array.copyWithin(count * size, slot * size, (slot + 1) * size);
        }
        this.expires[count] = this.expires[slot];
      }
      count++;
    }
    this.expires.fill(0, count);
    this.mesh.geometry.instanceCount = count; this.mesh.visible = count > 0;
    for (const attribute of Object.values(this.attributes)) attribute.needsUpdate = true;
    this.dirty = false;
  }
  reset() { this.until = 0; this.dirty = false; this.mesh.geometry.instanceCount = 0; this.mesh.visible = false; this.expires.fill(0); this.attributes.aLife.array.fill(0); this.attributes.aLife.needsUpdate = true; }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
