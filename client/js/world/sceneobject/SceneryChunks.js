import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { wrap } from '../../../../shared/sim/util.js';

/** Bake unique scenery into short road sections; retain per-section frustum culling. */
export class SceneryChunks {
  constructor(scene, items, loopLength) {
    this.loopLength = loopLength;
    this.chunks = [];
    this.objectCount = items.length;
    const columns = Math.max(1, Math.ceil(loopLength / 20));
    const width = loopLength / columns;
    const buckets = new Map();
    const originals = new Set();
    for (const { obj, x } of items) {
      const column = Math.min(columns - 1, Math.floor((x + loopLength / 2) / width));
      const key = `${column}:${Math.floor(obj.position.z / 20)}`;
      if (!buckets.has(key)) buckets.set(key, {
        x: -loopLength / 2 + (column + 0.5) * width, batches: new Map(),
      });
      const bucket = buckets.get(key);
      obj.updateWorldMatrix(true, true);
      obj.traverse((mesh) => {
        if (!mesh.isMesh) return;
        // Props passes only Builder's single-material natural scenery here.
        const batchKey = `${mesh.material.uuid}:${mesh.castShadow}:${mesh.receiveShadow}:${mesh.layers.mask}`;
        if (!bucket.batches.has(batchKey)) bucket.batches.set(batchKey, { source: mesh, geometries: [] });
        const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
        geometry.translate(-bucket.x, 0, 0);
        bucket.batches.get(batchKey).geometries.push(geometry);
        originals.add(mesh.geometry);
      });
      obj.removeFromParent();
    }
    for (const bucket of buckets.values()) {
      const prototype = new THREE.Group();
      for (const { source, geometries } of bucket.batches.values()) {
        const geometry = mergeGeometries(geometries);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, source.material);
        mesh.castShadow = source.castShadow;
        mesh.receiveShadow = source.receiveShadow;
        mesh.layers.mask = source.layers.mask;
        prototype.add(mesh);
        for (const part of geometries) part.dispose();
      }
      // Adjacent periodic copies share buffers. At the loop seam, a chunk's
      // tail remains visible while its next copy enters; no per-vertex uploads.
      const copies = [-1, 0, 1].map((period) => {
        const group = prototype.clone();
        group.name = `scenery-chunk-${bucket.x}-${period}`;
        scene.add(group);
        return { group, period };
      });
      this.chunks.push({ x: bucket.x, copies });
    }
    for (const geometry of originals) geometry.dispose();
    this.update(0);
  }

  set visible(visible) {
    for (const { copies } of this.chunks) for (const { group } of copies) group.visible = visible;
  }

  /** Release the baked buffers (shared by the periodic copies); materials belong to Builder and stay prepared. */
  dispose() {
    for (const { copies } of this.chunks) {
      copies[0].group.traverse((mesh) => mesh.geometry?.dispose());
      for (const { group } of copies) group.removeFromParent();
    }
    this.chunks = [];
  }

    update(scroll) {
    for (const { x, copies } of this.chunks) {
      const center = wrap(x - scroll, this.loopLength);
      for (const { group, period } of copies) group.position.x = center + period * this.loopLength;
    }
  }
}
