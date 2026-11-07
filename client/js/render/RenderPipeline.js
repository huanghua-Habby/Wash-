import * as THREE from 'three';
import { PAL } from '../../../shared/sim/palette.js';
import { clamp, damp } from '../../../shared/sim/util.js';
import { CFG } from '../core/config.js';
import { Perf } from '../core/perf.js';
import { viewportSize } from '../core/viewport.js';
import { GpuTimer } from './GpuTimer.js';
import { PostFX } from './PostFX.js';
import { Resolution } from './Resolution.js';
import { FurQuality } from './FurQuality.js';

/** Renderer setup, screen-space post effects and CPU/GPU instrumentation. No frame scheduling. */
export class RenderPipeline {
  constructor() {
    const canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Resolution.baseRatio() * CFG.render.scale);
    const viewport = viewportSize(); this.renderer.setSize(viewport.width, viewport.height, false);
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene(); this.camera = new THREE.PerspectiveCamera(29, 16 / 9, .5, 400);
    this.post = new PostFX(this.renderer, PAL.bg); this.resolution = new Resolution(this.renderer, this.post);
    this.perf = new Perf(); this.gpuTimer = new GpuTimer(this.renderer); this.renderer.info.autoReset = false;
    this.furQuality = new FurQuality(); this.lastCpuMs = null;
    this.p0 = new THREE.Vector3(); this.p1 = new THREE.Vector3(); this.p2 = new THREE.Vector3();
    this.tiltCenter = new THREE.Vector2(); this.tiltNormal = new THREE.Vector2(); this.tiltAcross = new THREE.Vector2();
    this.renderOptions = { time: 0, blurDir: new THREE.Vector2(), lines: 1, swallow: 0, punch: 0, status: null };
  }
  readinessOptions() { return { renderer: this.renderer, scene: this.scene, camera: this.camera, post: this.post }; }
  resize() { this.camera.aspect = 16 / 9; this.camera.updateProjectionMatrix(); this.resolution.apply(); }
  handleShortcuts(input) { if (input.hit('KeyP')) this.post.enabled = !this.post.enabled; }
  updateResolution(real, eligible = true) {
    this.furQuality.update(real, { eligible, cpuMs: this.lastCpuMs, gpuMs: this.gpuTimer.lastMs,
      gpuId: this.gpuTimer.sampleId, fullResolution: this.resolution.scale >= CFG.render.scale - .001 });
    if (eligible) this.resolution.update(real, { deferDrop: this.furQuality.deferResolutionDrop });
  }
  beginFrame() { const started = performance.now(); this.renderer.info.reset(); return started; }
  /** Tilt-shift band: runs along the road (world X) through the focus vehicle; widths are metres across the road (world Z). */
  updateTilt(focus) {
    const cam = this.camera, half = .5 * cam.aspect, P = CFG.post;
    this.p0.copy(focus).project(cam); this.p1.copy(focus); this.p1.x += 1; this.p1.project(cam);
    this.p2.copy(focus); this.p2.z += 1; this.p2.project(cam);
    this.tiltCenter.set(this.p0.x * half, this.p0.y * .5);
    this.tiltNormal.set(-(this.p1.y - this.p0.y) * .5, (this.p1.x - this.p0.x) * half).normalize();
    const metre = Math.abs(this.tiltAcross.set((this.p2.x - this.p0.x) * half, (this.p2.y - this.p0.y) * .5).dot(this.tiltNormal));
    this.post.setTiltFocus(this.tiltCenter, this.tiltNormal, P.tiltFocus * metre, (P.tiltFocus + P.tiltRange) * metre);
  }
  drawFirst(time, focus) { this.updateTilt(focus); this.renderOptions.time = time; this.renderOptions.lines = 1; this.renderOptions.swallow = 0; this.renderOptions.punch = 0; this.renderOptions.status = null; this.post.render(this.scene, this.camera, this.renderOptions); }
  /** `swallowed` is the local player's authoritative pouch state; the vignette eases in and out over wall time.
   * `punch` 0..1 is the knock-off feedback envelope (SceneCamera.punch); `status` the own-state grade (StatusGrade). */
  draw({ time, base, target, focus, dt = 0, swallowed = false, punch = 0, status = null }) {
    this.renderOptions.punch = punch; this.renderOptions.status = status;
    this.renderOptions.swallow = damp(this.renderOptions.swallow, swallowed ? 1 : 0, swallowed ? 9 : 6, dt);
    if (this.renderOptions.swallow < 1e-3) this.renderOptions.swallow = 0;
    this.updateTilt(focus);
    this.p0.copy(target).project(this.camera); this.p1.copy(target); this.p1.x -= 1; this.p1.project(this.camera);
    this.renderOptions.blurDir.set(this.p1.x - this.p0.x, this.p1.y - this.p0.y).multiplyScalar(.5 * base * CFG.post.blur);
    this.renderOptions.time = time; this.renderOptions.lines = .55 + clamp((base - 26) / 8, 0, 1) * .45;
    this.gpuTimer.begin();
    try { this.post.render(this.scene, this.camera, this.renderOptions); } finally { this.gpuTimer.end(); }
  }
  recordFrame(real, started) {
    this.lastCpuMs = performance.now() - started;
    this.perf.stats.gpuMs = this.gpuTimer.ext ? this.gpuTimer.lastMs === null ? '等待结果' : this.gpuTimer.lastMs.toFixed(2) : '不支持';
    this.perf.stats.passes = this.post.passCount; this.perf.record(real, this.lastCpuMs, this.renderer.info);
  }
  dispose() { this.gpuTimer.clear(); this.post.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss(); }
}
