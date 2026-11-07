import * as THREE from 'three';
import { GpuInstancePool } from './GpuInstancePool.js';

/** 14 soap bubbles + 6 foam puffs per slip; room for every player slipping at once. */
const CAPACITY = 80, BUBBLES = 14, FOAM = 6;
const KIND_BUBBLE = 0, KIND_FOAM = 1;

/**
 * "Whoops!" — iridescent soap bubbles fly up from under the feet and a ring of white foam splats out when a player
 * steps on soap. Triggered by a new shared `slipRemaining` timer (the authority's slip); it never moves players.
 * Bubbles drift up with a wobble and pop; foam puffs pop out and fade. Motion, growth and fade live in the shader.
 * Budget: 80-triangle icosphere, 20 records per slip for ≤1.3 s (1.6k triangles, 1 draw); idle submits zero instances/draws.
 */
export class SoapSlip {
  constructor(scene, game) {
    this.game = game;
    const material = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false,
      vertexShader: `
        uniform float uTime;
        attribute vec3 aOrigin;
        attribute vec4 aMotion; // xyz burst velocity, w seed
        attribute vec4 aLife;   // birth, life, size, kind (0 bubble, 1 foam)
        attribute vec2 aCarry;  // platform/road velocity the burst drifts with (xz)
        varying vec3 vNormal; varying vec3 vView; varying float vAlpha; varying float vKind; varying float vSeed;
        void main() {
          float age = uTime - aLife.x;
          if (age < 0.0 || age >= aLife.y) { vAlpha = 0.; gl_Position = vec4(2., 2., 2., 1.); return; }
          float k = age / aLife.y; vKind = aLife.w; vSeed = aMotion.w;
          vec3 center = aOrigin + vec3(aCarry.x, 0.0, aCarry.y) * age;
          float size;
          if (aLife.w < 0.5) {
            // Bubble: thrown out, air drag, then floats up with a sideways wobble; swells a touch and pops at the end.
            center += aMotion.xyz * (1.0 - exp(-4.0 * age)) / 4.0 + vec3(0.0, 0.35 * age, 0.0);
            center.xz += vec2(sin(age * 9.0 + aMotion.w * 6.3), cos(age * 7.0 + aMotion.w * 4.1)) * 0.05 * k;
            float grow = clamp(k * 8.0, 0.0, 1.0), pop = smoothstep(0.88, 1.0, k);
            size = aLife.z * grow * (1.0 + 0.15 * k + 0.5 * pop) * (1.0 - step(0.985, k));
            vAlpha = 1.0 - pop;
          } else {
            // Foam: low splat that pops to size with an overshoot, settles and fades.
            center += aMotion.xyz * (1.0 - exp(-8.0 * age)) / 8.0;
            float pop = clamp(k * 7.0, 0.0, 1.0) - 1.0;
            size = aLife.z * (1.0 + 2.7 * pop * pop * pop + 1.7 * pop * pop) * (1.0 + .3 * k);
            vAlpha = (1.0 - smoothstep(.4, 1.0, k)) * .95;
          }
          vec4 world = modelMatrix * vec4(center + position * size, 1.0);
          vNormal = normalize(mat3(modelMatrix) * normal); vView = cameraPosition - world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: `
        varying vec3 vNormal; varying vec3 vView; varying float vAlpha; varying float vKind; varying float vSeed;
        void main() {
          if (vAlpha <= 0.0) discard;
          vec3 n = normalize(vNormal), v = normalize(vView);
          if (vKind < 0.5) {
            // Thin film: clear centre, rainbow rim and a small window highlight.
            float rim = 1.0 - max(dot(n, v), 0.0);
            vec3 film = 0.6 + 0.4 * cos(6.2831 * (rim * 1.4 + vSeed + vec3(0.0, 0.33, 0.67)));
            float spec = pow(max(dot(reflect(-v, n), normalize(vec3(0.3, 1.0, 0.2))), 0.0), 40.0);
            gl_FragColor = vec4(mix(vec3(1.0), film, 0.75) + spec, (0.2 + 0.75 * pow(rim, 2.0) + spec) * vAlpha);
          } else {
            float shade = .82 + .18 * max(0., dot(n, normalize(vec3(10., 30., 7.))));
            gl_FragColor = vec4(vec3(.98, .99, 1.0) * shade, vAlpha);
          }
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
    this.pool = new GpuInstancePool(scene, new THREE.IcosahedronGeometry(1, 1), CAPACITY, { aOrigin: 3, aMotion: 4, aLife: 4, aCarry: 2 }, material);
    this.mesh = this.pool.mesh;
    this.reset();
  }

  /** One slip burst at the feet; (fx, fz) is the skid direction, `carry` the xz drift velocity. */
  burst(position, fx, fz, carryX = 0, carryZ = 0) {
    const now = this.pool.time.value;
    for (let i = 0; i < BUBBLES + FOAM; i++) {
      const bubble = i < BUBBLES, seed = Math.random();
      let vx, vy, vz, life, size;
      if (bubble) {
        // Mostly up and back from the skidding feet, some to the sides.
        const angle = Math.random() * Math.PI * 2, out = 0.6 + Math.random() * 1.1;
        vx = Math.cos(angle) * out - fx * 0.8; vz = Math.sin(angle) * out - fz * 0.8; vy = 1.3 + Math.random() * 1.6;
        life = 0.8 + Math.random() * 0.5; size = 0.07 + Math.random() * 0.08;
      } else {
        const angle = (i - BUBBLES) * Math.PI * 2 / FOAM + Math.random() * 0.5, out = 1.6 + Math.random() * 0.8;
        vx = Math.cos(angle) * out; vz = Math.sin(angle) * out; vy = 0.15 + Math.random() * 0.3;
        life = 0.4 + Math.random() * 0.15; size = 0.1 + Math.random() * 0.06;
      }
      this.pool.emit({
        aOrigin: [position.x + (Math.random() - 0.5) * 0.2, position.y + (bubble ? 0.12 : 0.05), position.z + (Math.random() - 0.5) * 0.2],
        aMotion: [vx, vy, vz, seed], aLife: [now, life, size, bubble ? KIND_BUBBLE : KIND_FOAM], aCarry: [carryX, carryZ],
      }, life);
    }
  }

  update(dt) {
    const game = this.game, players = game.players || [];
    players.forEach((player, i) => {
      const slip = player.slipRemaining || 0, seen = this.seen[i];
      this.seen[i] = slip;
      // A slip timer that jumps back up is a new slip (host rule or snapshot alike).
      if (slip <= seen + 0.02 || player.occupied === false || !player.root.visible) return;
      const truck = player.state === 'ground' ? player.ground?.truck : null, skid = player.dashDirection;
      this.burst(player.root.position, skid?.x || 0, skid?.z || 0, truck ? truck.vel.x : player.state === 'ground' ? -(game.base || 0) : 0, truck ? truck.vel.z : 0);
    });
    // The clock only runs while a burst is alive, so quiet frames never upload instance data.
    if (this.pool.time.value < this.pool.until) this.pool.time.value += dt;
    this.pool.flush();
  }

  reset() {
    this.pool.reset(); this.pool.time.value = 0;
    this.seen = (this.game.players || []).map(player => player.slipRemaining || 0);
  }

  dispose() { this.pool.reset(); this.pool.dispose(); }
}
