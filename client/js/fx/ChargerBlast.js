import * as THREE from 'three';
import { GpuInstancePool } from './GpuInstancePool.js';

const SMOKE = 0, SPARK = 1, FLASH = 2;
/** A blast older than this (s) when first seen was missed while hidden or reconnecting; only the baseline updates. */
const LATE = 0.5;
/** One blast is 62 records (1 flash, 27 smoke, 34 sparks); room for two overlapping blasts. */
const CAPACITY = 128;

/** Short-circuit at a charging socket: an HDR flash, a ball of fire-tinted smoke that cools to grey and a spray of sparks.
 * Triggered by a new shared `charging.blast.id` (the authority's short-circuit); it never decides the blast itself.
 * Motion, growth, cooling and fade live in the shader; instance data is written only when a blast starts.
 * Budget: 80-triangle icosphere, 62 records per blast for ≤1.9 s (≈5k triangles, 1 draw); idle submits zero instances/draws.
 */
export class ChargerBlast {
  constructor(scene, game) {
    this.game = game;
    const material = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false,
      vertexShader: `
        uniform float uTime;
        attribute vec3 aOrigin;
        attribute vec4 aMotion; // xyz launch velocity, w drag
        attribute vec4 aLife;   // birth, life, size, kind (0 smoke, 1 spark, 2 flash)
        attribute vec3 aColor;
        varying vec3 vNormal; varying vec3 vColor; varying float vAlpha; varying float vKind; varying float vAlive; varying float vK;
        void main() {
          float age = uTime - aLife.x;
          vAlive = step(0.0, age) * (1.0 - step(aLife.y, age));
          if (vAlive < .5) { vNormal = vec3(0., 1., 0.); vColor = vec3(0.); vAlpha = 0.; vKind = 0.; vK = 0.; gl_Position = vec4(2., 2., 2., 1.); return; }
          float k = age / aLife.y, kind = aLife.w;
          float spark = step(.5, kind) * step(kind, 1.5), flash = step(1.5, kind), smoke = 1.0 - spark - flash;
          vec3 center = aOrigin + aMotion.xyz * (1.0 - exp(-aMotion.w * age)) / aMotion.w;
          center.y -= spark * 9.0 * age * age;   // sparks fall
          center.y += smoke * 0.55 * age;        // smoke rises
          // Smoke balloons out with an overshoot and keeps swelling; sparks shrink away; the flash grows fast.
          float pop = clamp(k * 6.0, 0.0, 1.0) - 1.0;
          float puff = (1.0 + 2.7 * pop * pop * pop + 1.7 * pop * pop) * (1.0 + .7 * k);
          float size = aLife.z * (smoke * puff + spark * (1.0 - k * k) + flash * (0.35 + 0.65 * sqrt(k)));
          vAlpha = smoke * (1.0 - smoothstep(.45, 1.0, k)) * .92 + spark + flash * (1.0 - k) * (1.0 - k);
          float a = aLife.x * 37.0 + age * 3.0; float c = cos(a), s = sin(a);
          mat3 spin = mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0);
          vNormal = normalize(mat3(modelMatrix) * spin * normal); vColor = aColor; vKind = kind; vK = k;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(center + spin * position * size, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vNormal; varying vec3 vColor; varying float vAlpha; varying float vKind; varying float vAlive; varying float vK;
        void main() {
          if (vAlive < .5) discard;
          float shade = .7 + .3 * max(0., dot(normalize(vNormal), normalize(vec3(10., 30., 7.))));
          // Smoke starts as glowing orange fire and cools into soft grey within the first fifth of its life.
          vec3 hot = vec3(4.2, 1.9, .55), smoke = mix(hot, vColor * shade, smoothstep(.02, .22, vK));
          vec3 color = vKind < .5 ? smoke : vColor;
          gl_FragColor = vec4(color, vAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
    this.pool = new GpuInstancePool(scene, new THREE.IcosahedronGeometry(1, 1), CAPACITY, { aOrigin: 3, aMotion: 4, aLife: 4, aColor: 3 }, material);
    this.mesh = this.pool.mesh;
    this.smoke = [new THREE.Color('#8d8a86'), new THREE.Color('#a9a49c'), new THREE.Color('#6f6c6a'), new THREE.Color('#c4beb2')];
    this.reset();
  }

  /** One short-circuit at `position` (world). */
  burst(position) {
    const now = this.pool.time.value, { x, y, z } = position;
    // Flash core: a blinding ball that pops and fades in a quarter second.
    this.pool.emit({ aOrigin: [x, y + .2, z], aMotion: [0, 0, 0, 1], aLife: [now, .26, 1.5, FLASH], aColor: [6, 5.2, 3.2] }, .26);
    // Central smoke ball plus a shell of puffs blown outward on a sphere.
    this.pool.emit({ aOrigin: [x, y + .35, z], aMotion: [0, 1.2, 0, 3], aLife: [now, 1.7, .95, SMOKE], aColor: [.62, .6, .58] }, 1.7);
    for (let i = 0; i < 26; i++) {
      const u = (i + .5) / 26, theta = i * 2.39996, phi = Math.acos(1 - 1.4 * u); // upper ~70% of a sphere, golden-angle spread
      const dx = Math.sin(phi) * Math.cos(theta), dy = Math.cos(phi), dz = Math.sin(phi) * Math.sin(theta);
      const speed = 4.5 + Math.random() * 3, life = 1.1 + Math.random() * .6, color = this.smoke[i % this.smoke.length];
      this.pool.emit({
        aOrigin: [x + dx * .25, y + .3 + dy * .2, z + dz * .25], aMotion: [dx * speed, dy * speed * .8 + .6, dz * speed, 4.2],
        aLife: [now + Math.random() * .05, life, .32 + Math.random() * .22, SMOKE], aColor: [color.r, color.g, color.b],
      }, life + .05);
    }
    // Hot sparks spraying out and arcing down.
    for (let i = 0; i < 34; i++) {
      const theta = Math.random() * Math.PI * 2, up = .3 + Math.random() * .9, speed = 7 + Math.random() * 7, life = .45 + Math.random() * .35;
      const blue = i % 4 === 0; // a few electric-blue ones among the orange
      this.pool.emit({
        aOrigin: [x, y + .25, z], aMotion: [Math.cos(theta) * speed, up * speed, Math.sin(theta) * speed, 2.2],
        aLife: [now, life, .045 + Math.random() * .035, SPARK], aColor: blue ? [1.6, 3.4, 5.5] : [5.5, 3.4, 1.1],
      }, life);
    }
    this.until = now + 1.9;
    // Submit only up to the last live record (scanned on emission only); expired slots are reused first.
    let count = 0;
    for (let i = 0; i < CAPACITY; i++) if (this.pool.expires[i] > now) count = i + 1;
    this.pool.mesh.geometry.instanceCount = count; this.pool.mesh.visible = count > 0;
  }

  update(dt) {
    const blast = this.game.charging.blast;
    if (blast.id !== this.record) {
      this.record = blast.id;
      if (blast.id && (this.game.wet.tick - blast.tick) / 60 < LATE) this.burst(this.at.fromArray(blast.at));
    }
    // The clock only runs while a blast is alive, so quiet frames never upload instance data.
    if (this.pool.time.value < this.until) this.pool.time.value += dt;
    else if (this.pool.mesh.visible) { this.pool.mesh.geometry.instanceCount = 0; this.pool.mesh.visible = false; }
    this.pool.flush();
  }

  reset() {
    this.pool.reset(); this.pool.time.value = 0; this.until = 0;
    this.pool.mesh.geometry.instanceCount = 0; this.pool.mesh.visible = false;
    this.at = new THREE.Vector3(); this.record = this.game.charging.blast.id;
  }

  dispose() { this.pool.dispose(); }
}
