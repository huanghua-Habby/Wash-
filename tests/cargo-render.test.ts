import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildWoodCrate, buildWoodPile, CARGO_BUILDERS } from '../client/js/world/Cargo/index.js';

function meshes(root: THREE.Object3D) {
  const found: THREE.Mesh[] = [];
  root.traverse((node) => { if ((node as THREE.Mesh).isMesh) found.push(node as THREE.Mesh); });
  return found;
}

function bounds(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root);
}

test('cargo folder exports standalone wood pile and crate models', () => {
  assert.equal(CARGO_BUILDERS.woodPile, buildWoodPile);
  assert.equal(CARGO_BUILDERS.woodCrate, buildWoodCrate);
  for (const model of [buildWoodPile(), buildWoodCrate()]) {
    const drawMeshes = meshes(model);
    assert.ok(drawMeshes.length >= 2, 'model has merged solid and outline geometry');
    assert.ok(drawMeshes.every((mesh) => mesh.castShadow && mesh.receiveShadow));
    assert.ok(drawMeshes.every((mesh) => mesh.layers.isEnabled(1)));
  }
});

test('wood pile is a low, long strapped bundle', () => {
  const model = buildWoodPile();
  const box = bounds(model), size = box.getSize(new THREE.Vector3());
  assert.equal(model.userData.cargoType, 'wood-pile');
  assert.ok(size.x > size.z * 1.4, `wood pile is longer than wide: ${size.toArray()}`);
  assert.ok(size.y < size.x * 0.65, `wood pile stays squat: ${size.toArray()}`);
  assert.ok(box.min.y >= -0.06, `origin sits near floor: ${box.min.y}`);
});

test('wood crate is roughly cubical with merged detail', () => {
  const model = buildWoodCrate();
  const box = bounds(model), size = box.getSize(new THREE.Vector3());
  assert.equal(model.userData.cargoType, 'wood-crate');
  assert.ok(Math.abs(size.x - size.z) < 0.25, `crate footprint is square: ${size.toArray()}`);
  assert.ok(Math.abs(size.y - size.x) < 0.45, `crate is roughly cubical: ${size.toArray()}`);
  assert.ok(box.min.y >= -0.06, `origin sits near floor: ${box.min.y}`);
});
