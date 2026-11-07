import * as THREE from 'three';
import { PAL } from '../../../shared/sim/palette.js';
import { GpuInstancePool } from './GpuInstancePool.js';

/**
 * Ground-impact dust: a ring of small balls that pops out with an ease-out curve, hops a little,
 * settles and shrinks away while the treadmill road carries it back. Motion and size curves run on
 * the GPU; the CPU only writes birth records when a burst is emitted.
 */
export class DustBurst {
  constructor(scene, count = 96) {
    const material = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } },
      vertexShader: `
        uniform float uTime;
        attribute vec3 aOrigin;
        attribute vec4 aMotion; // xz outward speed, upward hop speed, road drift speed
        attribute vec4 aLife;   // birth, life, size, seed
        attribute vec3 aColor;
        varying vec3 vColor; varying vec3 vNormal; varying float vAlive;
        void main() {
          float rawAge = uTime - aLife.x;
          vAlive = step(0.0, rawAge) * (1.0 - step(aLife.y, rawAge));
          if (vAlive < 0.5) { vColor = vec3(0.0); vNormal = vec3(0.0, 1.0, 0.0); gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          float age = rawAge, k = age / aLife.y;
          // Burst curve: fast ease-out spread, short hop under gravity, resting on the road.
          vec2 spread = aMotion.xy * (1.0 - exp(-7.0 * age)) / 7.0;
          float hop = aMotion.z * (1.0 - exp(-5.0 * age)) / 5.0 - 3.2 * age * age;
          vec3 center = aOrigin + vec3(spread.x + aMotion.w * age, max(0.0, hop), spread.y);
          // Size: quick overshoot pop (ease-out-back), then an ease-in shrink to nothing.
          float pop = clamp(k * 6.0, 0.0, 1.0) - 1.0;
          float grow = 1.0 + 2.7 * pop * pop * pop + 1.7 * pop * pop;
          float size = aLife.z * grow * (1.0 - k * k) * (1.0 + 0.6 * k);
          float a = aLife.w + age * 4.0; float c = cos(a), s = sin(a);
          mat3 rotate = mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
          vNormal = normalize(mat3(modelMatrix) * rotate * normal); vColor = aColor;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(center + rotate * position * size, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vColor; varying vec3 vNormal; varying float vAlive;
        void main() {
          if (vAlive < 0.5) discard;
          float shade = 0.74 + 0.26 * max(0.0, dot(normalize(vNormal), normalize(vec3(10.0, 30.0, 7.0))));
          gl_FragColor = vec4(vColor * shade, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
    this.pool = new GpuInstancePool(scene, new THREE.IcosahedronGeometry(1, 0), count, { aOrigin: 3, aMotion: 4, aLife: 4, aColor: 3 }, material);
    this.mesh = this.pool.mesh;
    this._colors = [new THREE.Color(PAL.dust), new THREE.Color(PAL.puff), new THREE.Color(PAL.rock)];
  }

  /** One impact ring at the surface height. `strength` 0–1 scales count, size and speed; `drift` is road speed (negative x). */
  burst(position, strength, drift) {
    const n = Math.round(4 + 10 * strength), now = this.pool.time.value;
    for (let i = 0; i < n; i++) {
      const angle = (i / n + Math.random() * 0.35) * Math.PI * 2, speed = (2.2 + Math.random() * 2.6) * (0.55 + strength * 0.6);
      const life = 0.45 + Math.random() * 0.3 + strength * 0.15, color = this._colors[i % 3];
      this.pool.emit({
        aOrigin: [position.x + Math.cos(angle) * 0.25, position.y + 0.08, position.z + Math.sin(angle) * 0.25],
        aMotion: [Math.cos(angle) * speed, Math.sin(angle) * speed, 1.2 + Math.random() * 2.2 * strength, drift],
        aLife: [now, life, (0.09 + Math.random() * 0.08) * (0.7 + strength * 0.5), Math.random() * 6],
        aColor: [color.r, color.g, color.b],
      }, life);
    }
  }

  update(dt) { this.pool.time.value += dt; this.pool.flush(); }
  reset() { this.pool.reset(); this.pool.time.value = 0; }
  dispose() { this.pool.dispose(); }
}
