import { shadowSamples } from './ShadowWarmup.js';
import { CFG } from '../core/config.js';
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** Asset promises + hidden/instanced variants + real shadow/post frames, behind black. */
export class SceneReadiness {
  constructor({ renderer, scene, camera, post }) {
    Object.assign(this, { renderer, scene, camera, post });
    this.assets = []; this.samples = []; this.ready = null;
  }
  addAsset(name, promise) { this.assets.push({ name, promise }); promise.catch(() => {}); }
  addSample(object) { this.samples.push(object); }
  prepare(onProgress = (_label, _progress) => {}) {
    this.ready ||= this.run(onProgress);
    return this.ready;
  }
  async run(onProgress) {
    let loaded = 0;
    await Promise.all(this.assets.map(async ({ name, promise }) => {
      await promise; loaded++;
      onProgress('准备游戏资源', 0.35 * loaded / Math.max(1, this.assets.length));
    }));
    const saved = [], emptyGeometries = new Map(), flags = { enabled: CFG.post.enabled, bloomOn: CFG.post.bloomOn, blurOn: CFG.post.blurOn, linesOn: CFG.post.linesOn, tiltOn: CFG.post.tiltOn };
    const originalView = this.post.view;
    for (const sample of this.samples) if (!sample.parent) this.scene.add(sample);
    this.scene.traverse((object) => {
      saved.push({ object, visible: object.visible, culled: object.frustumCulled, count: object.isInstancedMesh ? object.count : null });
      object.visible = true; object.frustumCulled = false;
      if (object.isInstancedMesh && object.count === 0) object.count = 1;
      const geometry = object.geometry;
      if (geometry?.isInstancedBufferGeometry && geometry.instanceCount === 0) {
        emptyGeometries.set(geometry, 0); geometry.instanceCount = 1;
      }
    });
    try {
      this.scene.updateMatrixWorld(true);
      onProgress('准备游戏画面', 0.35); await nextFrame();
      const depthScene = shadowSamples(this.scene);
      const target = this.renderer.getRenderTarget?.();
      // Render-target color space participates in program keys. Shadows use linear output.
      this.renderer.setRenderTarget?.(this.post.rt || null);
      const compile = (scene, targetScene) => this.renderer.compileAsync
        ? this.renderer.compileAsync(scene, this.camera, targetScene)
        : Promise.resolve(this.renderer.compile(scene, this.camera, targetScene));
      try {
        // Both compilations start now; awaiting yields to the browser, never spin-waits.
        await Promise.all([compile(this.scene, this.scene),
          ...(depthScene.children.length ? [compile(depthScene, this.scene)] : [])]);
      } finally { this.renderer.setRenderTarget?.(target || null); }
      depthScene.clear();
      onProgress('准备游戏画面', 0.7); await nextFrame();
      Object.assign(CFG.post, { enabled: true, bloomOn: true, blurOn: true, linesOn: true, tiltOn: true }); this.post.view = 0;
      for (let i = 0; i < 3; i++) {
        this.post.render(this.scene, this.camera, { time: 0, blurDir: { x: 0, y: 0 }, lines: 1 });
        onProgress('整理画面', 0.7 + 0.1 * (i + 1)); await nextFrame();
      }
    } finally {
      for (const { object, visible, culled, count } of saved) {
        object.visible = visible; object.frustumCulled = culled;
        if (count !== null) object.count = count;
      }
      for (const [geometry, count] of emptyGeometries) geometry.instanceCount = count;
      Object.assign(CFG.post, flags); this.post.view = originalView;
      // Retain the bounded startup samples: disposing their materials would release
      // the only reference to a future entity's prepared program and force recompilation.
      for (const sample of this.samples) sample.removeFromParent();
    }
  }
}
