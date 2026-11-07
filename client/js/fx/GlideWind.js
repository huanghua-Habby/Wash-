import * as THREE from 'three';
import { GpuInstancePool } from './GpuInstancePool.js';

/** Streaks per wingtip per second, their life, the wind speed past the wing and how far a streak's tail lags its head. */
const RATE = 36, LIFE = 0.42, WIND = 4.2, TAIL_LAG = 0.16, WIDTH = 0.07;
/** 8 gliders (geese or pelicans) × 2 tips × RATE × LIFE ≈ 242 live records at the absolute peak. */
const CAPACITY = 256;
const _tip = new THREE.Vector3();
const GLIDERS = ['goose', 'pelican'];

/**
 * Glide wind lines (goose and pelican): thin white streaks peel off both wingtips while a bird glides (shared `gliding`, host-confirmed
 * or predicted like the pose). Each record is born at a wingtip, rides the goose's current velocity (`vel`) and
 * a steady wind blowing back past the wing; its tail lags the head, so the stream reads as flowing wind lines.
 * Pale sky-blue so it reads over cream roofs too. Motion, taper and fade live in the shader; the CPU only writes birth records while gliding.
 * Budget: 2-triangle camera-facing ribbon; 2 tips × 36/s × 0.42 s ≈ 30 records per goose (60 triangles, 1 draw);
 * 8-goose peak ≈ 242 records (≈ 484 triangles, 1 draw), pool 256; idle submits zero instances/draws.
 */
export class GlideWind {
  constructor(scene, game) {
    this.game = game;
    const material = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `
        uniform float uTime;
        attribute vec3 aOrigin;
        attribute vec3 aCarry; // the goose's velocity at birth
        attribute vec3 aWind;  // wind past the wing (relative to the goose)
        attribute vec4 aLife;  // birth, life, width, seed
        varying float vT; varying float vK;
        void main() {
          float age = uTime - aLife.x;
          vK = age / aLife.y;
          if (age < 0.0 || age >= aLife.y) { vK = 2.0; gl_Position = vec4(2., 2., 2., 1.); return; }
          vec3 base = aOrigin + aCarry * age;
          vec3 head = base + aWind * age, tail = base + aWind * max(0.0, age - ${TAIL_LAG.toFixed(3)});
          vT = position.x + 0.5;
          vec3 axis = head - tail, p = mix(tail, head, vT);
          vec3 side = cross(axis, cameraPosition - p);
          float len = length(side);
          side = len > 1e-5 ? side / len : vec3(0.0);
          // Slight wobble so neighbouring streaks do not stack into one rigid line.
          p.y += sin(aLife.w * 6.2831 + age * 11.0) * 0.02 * vK;
          // The ribbon only has vertices at its two ends, so the width stays constant here; the taper is in the alpha.
          p += side * position.y * aLife.z * (1.0 - 0.5 * vK);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        varying float vT; varying float vK;
        void main() {
          if (vK > 1.0) discard;
          float alpha = 0.85 * sin(3.14159 * vT) * (1.0 - smoothstep(0.35, 1.0, vK)) * smoothstep(0.0, 0.08, vK);
          if (alpha < 0.01) discard;
          // A pale sky blue reads on both the green verge and the cream roofs (pure white vanished against the roofs).
          gl_FragColor = vec4(vec3(0.82, 0.93, 1.0) * 1.1, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
    this.pool = new GpuInstancePool(scene, new THREE.PlaneGeometry(1, 1), CAPACITY, { aOrigin: 3, aCarry: 3, aWind: 3, aLife: 4 }, material);
    this.mesh = this.pool.mesh;
    this.reset();
  }

  update(dt) {
    const players = this.game.players || [];
    players.forEach((player, i) => {
      // Both gliders are built on the cat skeleton: their wings are the arms, wingtips the paw bones.
      const body = GLIDERS.includes(player.animal) ? player.bodies?.[player.animal] : null;
      if (!body || !player.gliding || player.state !== 'air' || player.occupied === false || !player.root?.visible) { this.debt[i] = 0; return; }
      this.debt[i] += RATE * dt;
      const now = this.pool.time.value, fx = Math.cos(player.yaw), fz = -Math.sin(player.yaw);
      // Ride the goose's actual velocity (carried air speed, steering and the glide sink), so the lines stay on the wingtips.
      const v = player.vel, carry = [v.x, v.y, v.z], wind = [-fx * WIND, 0.25, -fz * WIND];
      while (this.debt[i] >= 1) {
        this.debt[i] -= 1;
        for (const side of ['L', 'R']) {
          body.bones[`paw${side}`].getWorldPosition(_tip);
          this.pool.emit({ aOrigin: [_tip.x, _tip.y, _tip.z], aCarry: carry, aWind: wind, aLife: [now, LIFE * (0.85 + Math.random() * 0.3), WIDTH, Math.random()] }, LIFE * 1.15);
        }
      }
    });
    // The clock only runs while a streak is alive, so quiet frames never upload instance data.
    if (this.pool.time.value < this.pool.until) this.pool.time.value += dt;
    this.pool.flush();
  }

  reset() {
    this.pool.reset(); this.pool.time.value = 0;
    this.debt = (this.game.players || []).map(() => 0);
  }

  dispose() { this.pool.reset(); this.pool.dispose(); }
}
