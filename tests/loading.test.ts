import test from 'node:test';
import assert from 'node:assert/strict';
import { IrisTransition } from '../client/js/ui/IrisTransition.js';
import { SceneReadiness } from '../client/js/render/SceneReadiness.js';
import { CFG } from '../client/js/core/config.js';
import * as THREE from 'three';

class TransitionSurface extends EventTarget {
  open = false;
  show() { this.open = true; }
  showModal() { this.open = true; }
  close() { this.open = false; }
}

test('iris stays fully black until asynchronous commit completes; startup only opens', async () => {
  const previous = globalThis.document;
  const layer = { hidden: true, dataset: {}, style: {}, removeAttribute() { this.hidden = false; }, setAttribute() { this.hidden = true; } }, cutout = { setAttribute() {} };
  const surface = new TransitionSurface();
  (globalThis as any).document = { getElementById: (id: string) => id === 'wash-iris-layer' ? surface : id === 'wash-iris' ? layer : cutout };
  try {
    const iris = new IrisTransition(); let ready!: () => void, committed = false, done = false;
    const gate = new Promise<void>((resolve) => { ready = resolve; });
    iris.start(async () => { await gate; committed = true; }, () => { done = true; });
    assert.equal(surface.open, true);
    const cancel = new Event('cancel', { cancelable: true }); surface.dispatchEvent(cancel);
    assert.equal(cancel.defaultPrevented, true, 'Escape cannot uncover a pending transaction');
    iris.update(0.7); await Promise.resolve();
    assert.equal(iris.phase, 'wait'); iris.update(10);
    assert.equal(iris.phase, 'wait'); assert.equal(committed, false); assert.equal(done, false);
    assert.equal(layer.hidden, false); assert.equal((layer.style as any).opacity, 1);
    ready(); await new Promise((resolve) => setImmediate(resolve));
    assert.equal(iris.phase, 'open'); iris.update(0.7);
    assert.equal(done, true); assert.equal(layer.hidden, true);
    assert.equal(surface.open, false);
    iris.reveal(() => { done = false; }); assert.equal(iris.phase, 'open');
    iris.update(0.7); assert.equal(done, false);
  } finally { (globalThis as any).document = previous; }
});

test('disabled UI motion covers immediately but still waits for asynchronous scene readiness', async () => {
  const previous = globalThis.document;
  const layer = { hidden: true, dataset: {}, style: {} as any, removeAttribute() { this.hidden = false; }, setAttribute() { this.hidden = true; } };
  (globalThis as any).document = { getElementById: (id: string) => id === 'wash-iris-layer' ? new TransitionSurface() : id === 'wash-iris' ? layer : { setAttribute() {} } };
  try {
    const iris = new IrisTransition({ motionEnabled: () => false });
    let ready!: () => void, done = false;
    const gate = new Promise<void>(resolve => { ready = resolve; });
    iris.start(() => gate, () => { done = true; });
    assert.equal(layer.style.opacity, 1);
    iris.update(0); await Promise.resolve();
    assert.equal(iris.phase, 'wait'); assert.equal(done, false);
    iris.update(10); assert.equal(layer.hidden, false);
    ready(); await new Promise(resolve => setImmediate(resolve));
    iris.update(0); assert.equal(layer.hidden, true); assert.equal(done, true);
  } finally { (globalThis as any).document = previous; }
});

test('disposing a covered transition releases the top layer and ignores a late scene completion', async () => {
  const previous = globalThis.document, surface = new TransitionSurface();
  const layer = { dataset: {}, style: {}, removeAttribute() {}, setAttribute() {} };
  (globalThis as any).document = { getElementById: (id: string) => id === 'wash-iris-layer' ? surface : id === 'wash-iris' ? layer : { setAttribute() {} } };
  try {
    const iris = new IrisTransition(); let release!: () => void, done = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    iris.start(() => gate, () => { done = true; }); iris.update(.7); await Promise.resolve();
    iris.dispose(); release(); await new Promise(resolve => setImmediate(resolve)); iris.update(1);
    assert.equal(surface.open, false); assert.equal(iris.active, false); assert.equal(iris.phase, 'idle'); assert.equal(done, false);
  } finally { (globalThis as any).document = previous; }
});

test('warmup awaits assets, includes hidden empty instance batches and restores state before readiness', async () => {
  const oldFrame = globalThis.requestAnimationFrame;
  (globalThis as any).requestAnimationFrame = (callback: any) => setImmediate(callback);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 3);
  mesh.visible = false; mesh.count = 0; scene.add(mesh);
  const geometry = new THREE.InstancedBufferGeometry(); geometry.instanceCount = 0;
  const empty = new THREE.Mesh(geometry, mesh.material), shared = new THREE.Mesh(geometry, mesh.material);
  empty.visible = shared.visible = false; scene.add(empty, shared);
  let assetDone!: () => void, compiled = 0, rendered = 0;
  const asset = new Promise<void>((resolve) => { assetDone = resolve; });
  const progress: number[] = [];
  const postFlag = CFG.post.enabled;
  const readiness = new SceneReadiness({ scene, camera,
    renderer: { async compileAsync() { compiled++; assert.equal(mesh.visible, true); assert.equal(mesh.count, 1); assert.equal(mesh.frustumCulled, false);
      assert.equal(empty.visible, true); assert.equal(geometry.instanceCount, 1); } },
    post: { view: 1, render() { rendered++; assert.equal(mesh.visible, true); assert.equal(geometry.instanceCount, 1); } } });
  readiness.addAsset('test asset', asset);
  try {
    const ready = readiness.prepare((_label: string, value: number) => progress.push(value));
    await Promise.resolve(); assert.equal(compiled, 0); assetDone(); await ready;
    assert.equal(compiled, 1); assert.equal(rendered, 3);
    assert.equal(mesh.visible, false); assert.equal(mesh.count, 0); assert.equal(mesh.frustumCulled, true);
    assert.equal(empty.visible, false); assert.equal(shared.visible, false); assert.equal(geometry.instanceCount, 0);
    assert.equal(CFG.post.enabled, postFlag); assert.equal(progress.at(-1), 1);
    await readiness.prepare(); assert.equal(compiled, 1, 'return reuses warmed resources');
  } finally { globalThis.requestAnimationFrame = oldFrame; mesh.geometry.dispose(); geometry.dispose(); mesh.material.dispose(); }
});
