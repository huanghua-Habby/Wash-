import * as THREE from 'three';
import { GpuInstancePool } from './GpuInstancePool.js';

/** 9 sparks per hit; room for every player slapped about twice inside one spark life. */
const CAPACITY = 144, SPARKS = 9;

/**
 * Versus slap (VERSUS_RULES.md §10): a burst of warm star sparks at the struck side of the player who was hit.
 * Triggered by a rising shared `slappedSerial` (host-confirmed); it never moves anyone. The push direction comes from
 * the shared `externalVelocity`. Motion, spin, shrink and fade live in the shader.
 * Budget: 20-triangle icosahedron, 9 records per hit for ≤0.38 s (180 triangles, 1 draw); 8-player peak about
 * 16 bursts alive = 144 records (2.9k triangles, 1 draw); idle submits zero instances/draws.
 */
export class SlapHit {
  constructor(scene, game) {
    this.game = game;
    const material = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false,
      vertexShader: `
        uniform float uTime;
        attribute vec3 aOrigin;
        attribute vec4 aMotion; // xyz velocity, w seed
        attribute vec4 aLife;   // birth, life, size, tint (0 gold, 1 white)
        attribute vec2 aCarry;  // platform velocity (xz)
        varying float vAlpha; varying float vTint;
        void main() {
          float age = uTime - aLife.x;
          if (age < 0.0 || age >= aLife.y) { vAlpha = 0.; gl_Position = vec4(2., 2., 2., 1.); return; }
          float k = age / aLife.y; vTint = aLife.w;
          vec3 center = aOrigin + vec3(aCarry.x, 0.0, aCarry.y) * age + aMotion.xyz * (1.0 - exp(-9.0 * age)) / 9.0;
          // Pop out big, then shrink to nothing; a quick spin flattens the sphere into a star-like flicker.
          float size = aLife.z * (1.0 - k) * (0.6 + 1.6 * clamp(k * 10.0, 0.0, 1.0));
          float a = aMotion.w * 6.2831 + age * 22.0; mat2 r = mat2(cos(a), -sin(a), sin(a), cos(a));
          vec3 p = position; p.xy = r * p.xy; p.y *= 0.45;
          vAlpha = 1.0 - smoothstep(0.55, 1.0, k);
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(center + p * size, 1.0);
        }`,
      fragmentShader: `
        varying float vAlpha; varying float vTint;
        void main() {
          if (vAlpha <= 0.0) discard;
          gl_FragColor = vec4(mix(vec3(1.0, 0.82, 0.3), vec3(1.0, 0.98, 0.9), vTint) * 1.6, vAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
    this.pool = new GpuInstancePool(scene, new THREE.IcosahedronGeometry(1, 0), CAPACITY, { aOrigin: 3, aMotion: 4, aLife: 4, aCarry: 2 }, material);
    this.mesh = this.pool.mesh;
    this.reset();
  }

  /** Sparks fly out from the struck side, mostly back toward the slapper and up. `push` is the unit shove (xz). */
  burst(position, px, pz, carryX = 0, carryZ = 0) {
    const now = this.pool.time.value, ox = position.x - px * 0.32, oz = position.z - pz * 0.32, oy = position.y + 0.62;
    for (let i = 0; i < SPARKS; i++) {
      const angle = Math.random() * Math.PI * 2, out = 1.6 + Math.random() * 1.8, life = 0.24 + Math.random() * 0.14;
      this.pool.emit({
        aOrigin: [ox, oy, oz],
        aMotion: [Math.cos(angle) * out - px * 1.4, 0.6 + Math.random() * 2.2, Math.sin(angle) * out - pz * 1.4, Math.random()],
        aLife: [now, life, 0.06 + Math.random() * 0.06, i % 3 === 0 ? 1 : 0], aCarry: [carryX, carryZ],
      }, life);
    }
  }

  update(dt) {
    const game = this.game, players = game.players || [];
    players.forEach((player, i) => {
      const serial = player.slappedSerial || 0, seen = this.seen[i];
      if (serial > seen) this.seen[i] = serial; else return;
      if (player.occupied === false || !player.root.visible) return;
      const push = player.externalVelocity, length = Math.hypot(push?.x || 0, push?.z || 0) || 1;
      const truck = player.state === 'ground' ? player.ground?.truck : null;
      this.burst(player.root.position, (push?.x || 0) / length, (push?.z || 0) / length, truck ? truck.vel.x : 0, truck ? truck.vel.z : 0);
    });
    // The tutorial dummy: sparks off the struck side of its head, flying back toward the slapper.
    const dummy = game.dummy, hits = dummy?.hitSerial || 0;
    if (dummy && hits !== this.dummySeen) {
      if (hits > this.dummySeen && dummy.group.visible) {
        const at = dummy.worldPosition(), [dx, dz] = dummy.hitDirection, home = game.homeTruck;
        at.y += 0.45; this.burst(at, dx, dz, home?.vel.x || 0, home?.vel.z || 0);
      }
      this.dummySeen = hits;
    }
    // The clock only runs while a burst is alive, so quiet frames never upload instance data.
    if (this.pool.time.value < this.pool.until) this.pool.time.value += dt;
    this.pool.flush();
  }

  reset() {
    this.pool.reset(); this.pool.time.value = 0;
    this.seen = (this.game.players || []).map(player => player.slappedSerial || 0);
    this.dummySeen = this.game.dummy?.hitSerial || 0;
  }

  dispose() { this.pool.reset(); this.pool.dispose(); }
}
