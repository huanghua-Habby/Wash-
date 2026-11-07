import * as THREE from 'three';
import { GpuInstancePool } from './GpuInstancePool.js';
import { teamColor } from '../core/teamColors.js';

/** Two hacks in flight at most: 44 shards on the victim truck + 12 at the console each. */
const CAPACITY = 112, LIFE = 1.6;

/** A finished versus hack (shared `hackConsole.serial` rising): glowing low-poly "data shards" erupt from the victim
 * truck's roof in the hacker's team colour and a smaller spray leaves the console; the "blast" effect also fires the
 * charger short-circuit explosion there. Read-only: the host already applied the effect.
 * Budget: 12-triangle box shards, 56 records per hack for ≤ 1.6 s (≈ 670 triangles, 1 draw); idle draws nothing. */
export class HackBurst {
  constructor(scene, game, blast = null) {
    this.game = game; this.blast = blast;
    const material = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false,
      vertexShader: `
        uniform float uTime;
        attribute vec3 aOrigin;
        attribute vec4 aMotion; // xyz launch velocity, w gravity
        attribute vec4 aLife;   // birth, life, size, spin seed
        attribute vec3 aColor;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float age = uTime - aLife.x;
          if (age < 0.0 || age > aLife.y) { vColor = vec3(0.); vAlpha = 0.; gl_Position = vec4(2., 2., 2., 1.); return; }
          float k = age / aLife.y;
          // Thrown out fast, braked by drag, then drifting down; the shard spins and shrinks away at the end.
          vec3 center = aOrigin + aMotion.xyz * (1.0 - exp(-3.2 * age)) / 3.2;
          center.y -= aMotion.w * age * age;
          float a = aLife.w + age * (6.0 + aLife.w), c = cos(a), s = sin(a);
          mat3 spin = mat3(c, s * .6, s * .8, -s, c * .6, c * .8, 0., -.8, .6);
          float size = aLife.z * (1.0 - k * k) * min(1.0, age * 18.0);
          vAlpha = 1.0 - smoothstep(.65, 1.0, k);
          // Flicker like a glitching pixel.
          vColor = aColor * (0.75 + 0.5 * step(0.5, fract(age * 13.0 + aLife.w)));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(center + spin * position * size, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          if (vAlpha <= 0.0) discard;
          gl_FragColor = vec4(vColor, vAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
    this.pool = new GpuInstancePool(scene, new THREE.BoxGeometry(1, 1, 1), CAPACITY, { aOrigin: 3, aMotion: 4, aLife: 4, aColor: 3 }, material);
    this.mesh = this.pool.mesh;
    this.color = new THREE.Color(); this.cyan = new THREE.Color('#7fe3f0'); this.at = new THREE.Vector3();
    this.reset();
  }
  /** `count` shards from `origin`, fanned upward; `spread` widens the fountain. HDR colours (×3–4.5) feed Bloom. */
  spray(origin, count, speed, spread, size) {
    const now = this.pool.time.value;
    for (let i = 0; i < count; i++) {
      const theta = i * 2.39996 + Math.random() * 0.4, up = 0.55 + Math.random() * 0.45, v = speed * (0.6 + Math.random() * 0.6);
      const color = i % 4 === 0 ? this.cyan : this.color, hdr = 3 + Math.random() * 1.5;
      this.pool.emit({
        aOrigin: [origin.x + Math.cos(theta) * 0.3 * spread, origin.y + 0.2, origin.z + Math.sin(theta) * 0.3 * spread],
        aMotion: [Math.cos(theta) * v * spread * (1 - up * 0.5), up * v * 1.4, Math.sin(theta) * v * spread * (1 - up * 0.5), 2.2],
        aLife: [now + Math.random() * 0.12, LIFE * (0.6 + Math.random() * 0.4), size * (0.6 + Math.random() * 0.8), Math.random() * 6.28],
        aColor: [color.r * hdr, color.g * hdr, color.b * hdr],
      }, LIFE + 0.15);
    }
  }
  burst(last) {
    this.color.set(teamColor(last.team) || '#7fe3f0');
    this.spray(this.at.fromArray(last.at), 44, 7, 1.6, 0.16);
    this.game.hackConsole.worldPosition(this.at); this.at.y += 1.1;
    this.spray(this.at, 12, 3.5, 0.6, 0.08);
    if (last.effect === 'blast' && this.blast) this.blast.burst(this.at.fromArray(last.at));
  }
  update(dt) {
    const hack = this.game.hackConsole;
    if (hack.serial !== this.record) {
      // Only a hack seen happening plays; a jump on a fresh snapshot (join, rejoin) just moves the baseline.
      if (hack.serial === this.record + 1 && hack.last.effect) this.burst(hack.last);
      this.record = hack.serial;
    }
    if (this.pool.time.value < this.pool.until) this.pool.time.value += dt;
    this.pool.flush();
  }
  reset() { this.pool.reset(); this.pool.time.value = 0; this.record = this.game.hackConsole?.serial || 0; }
  dispose() { this.pool.dispose(); }
}
