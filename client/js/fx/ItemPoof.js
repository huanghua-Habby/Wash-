import * as THREE from 'three';
import { GpuInstancePool } from './GpuInstancePool.js';

/** An item return seen this late (s) was missed while hidden or reconnecting; only the baseline updates. */
const LATE = 0.5;
/** Ten puffs per poof, two poofs per return; room for several returns at once. */
const CAPACITY = 96, PUFFS = 10;
/** The returned item stays hidden inside the home poof, then pops in with an overshoot. */
const HIDE = 0.1, POP = 0.26;
const _at = new THREE.Vector3();

/**
 * "Pa!" — a cream smoke poof where a thrown item touches the road (drifting away with the road), and a second one on
 * the home vehicle that covers the item reappearing. Triggered by a new shared `returnSerial` (the authority's road
 * landing); it never moves or returns items itself. Motion, growth and fade live in the shader.
 * Budget: 80-triangle icosphere, 20 records per return for ≤0.7 s (1.6k triangles, 1 draw); idle submits zero instances/draws.
 */
export class ItemPoof {
  constructor(scene, game) {
    this.game = game;
    const material = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false,
      vertexShader: `
        uniform float uTime;
        attribute vec3 aOrigin;
        attribute vec4 aMotion; // xyz burst velocity, w carried road speed along x
        attribute vec4 aLife;   // birth, life, size, unused
        varying vec3 vNormal; varying float vAlpha; varying float vAlive;
        void main() {
          float age = uTime - aLife.x;
          vAlive = step(0.0, age) * (1.0 - step(aLife.y, age));
          if (vAlive < .5) { vNormal = vec3(0., 1., 0.); vAlpha = 0.; gl_Position = vec4(2., 2., 2., 1.); return; }
          float k = age / aLife.y;
          vec3 center = aOrigin + aMotion.xyz * (1.0 - exp(-7.0 * age)) / 7.0 + vec3(aMotion.w * age, 0.0, 0.0);
          // Pops to full size with an overshoot in a few frames ("pa!"), then swells softly and fades.
          float pop = clamp(k * 9.0, 0.0, 1.0) - 1.0;
          float size = aLife.z * (1.0 + 2.7 * pop * pop * pop + 1.7 * pop * pop) * (1.0 + .5 * k);
          vAlpha = (1.0 - smoothstep(.35, 1.0, k)) * .95;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(center + position * size, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vNormal; varying float vAlpha; varying float vAlive;
        void main() {
          if (vAlive < .5) discard;
          float shade = .78 + .22 * max(0., dot(normalize(vNormal), normalize(vec3(10., 30., 7.))));
          gl_FragColor = vec4(vec3(.97, .95, .89) * shade, vAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
    this.pool = new GpuInstancePool(scene, new THREE.IcosahedronGeometry(1, 1), CAPACITY, { aOrigin: 3, aMotion: 4, aLife: 4 }, material);
    this.mesh = this.pool.mesh;
    this.reset();
  }

  /** One poof at `position`; `carry` is the road speed it drifts with (0 on a vehicle). */
  burst(position, carry = 0, scale = 1) {
    const now = this.pool.time.value;
    for (let i = 0; i < PUFFS; i++) {
      const core = i < 2, angle = i * Math.PI * 2 / (PUFFS - 2) + Math.random() * .35, speed = core ? .4 : 2.2 + Math.random() * 1.2;
      const life = .45 + Math.random() * .2;
      this.pool.emit({
        aOrigin: [position.x + (core ? 0 : Math.cos(angle) * .16), position.y + .1 + (core ? .12 * i : 0), position.z + (core ? 0 : Math.sin(angle) * .16)],
        aMotion: [Math.cos(angle) * speed, (core ? .9 : .6 + Math.random() * .8), Math.sin(angle) * speed, carry],
        aLife: [now, life, (core ? .43 : .23 + Math.random() * .11) * scale, 0],
      }, life);
    }
    this.until = Math.max(this.until, now + .7);
    // Submit only up to the last live record (scanned on emission only); expired slots are reused first.
    let count = 0;
    for (let i = 0; i < CAPACITY; i++) if (this.pool.expires[i] > now) count = i + 1;
    this.mesh.geometry.instanceCount = count; this.mesh.visible = count > 0;
  }

  update(dt) {
    const game = this.game;
    for (const tool of game.tools || []) {
      const serial = tool.returnSerial || 0, seen = this.records.get(tool.id);
      if (seen === serial) continue;
      this.records.set(tool.id, serial);
      // First sight of a tool only sets the baseline; stale snapshots never replay.
      if (seen === undefined || !serial || tool.returnAge >= LATE) continue;
      this.burst(tool.returnFrom, -(game.base || 0));
      if (tool.kind !== 'soap' && tool.mesh.parent) {
        this.burst(tool.worldPosition(_at), 0, 1.1);
        this.popping.set(tool, { t: 0, scale: tool.mesh.scale.x || 1 });
      }
    }
    // The item reappears inside the home poof: hidden for a beat, then an overshooting pop back to its size.
    for (const [tool, state] of this.popping) {
      state.t += dt;
      const k = Math.max(0, state.t - HIDE) / POP, back = k >= 1 ? 1 : 1 + 2.7 * (k - 1) ** 3 + 1.7 * (k - 1) ** 2;
      tool.mesh.scale.setScalar(state.scale * Math.max(0.001, back));
      if (k >= 1 || tool.holder || tool.flight) { tool.mesh.scale.setScalar(state.scale); this.popping.delete(tool); }
    }
    // The clock only runs while a poof is alive, so quiet frames never upload instance data.
    if (this.pool.time.value < this.until) this.pool.time.value += dt;
    else if (this.mesh.visible) { this.mesh.geometry.instanceCount = 0; this.mesh.visible = false; }
    this.pool.flush();
  }

  reset() {
    for (const [tool, state] of this.popping || []) tool.mesh.scale.setScalar(state.scale);
    this.pool.reset(); this.pool.time.value = 0; this.until = 0;
    this.mesh.geometry.instanceCount = 0; this.mesh.visible = false;
    this.records = new Map((this.game.tools || []).map(tool => [tool.id, tool.returnSerial || 0]));
    this.popping = new Map();
  }

  dispose() { this.reset(); this.pool.dispose(); this.records.clear(); }
}
