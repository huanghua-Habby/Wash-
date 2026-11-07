import * as THREE from 'three';
import { GpuInstancePool } from './GpuInstancePool.js';

const POOF = 0, FEATHER = 1, SUCTION = 2;

/**
 * Pelican gulp/spit feedback: cartoon smoke puffs, puffs sucked into the beak and tumbling feathers.
 * Everything moves on the GPU from birth records; particles inherit the carrier's velocity so they stay with
 * the moving vehicle. The CPU only writes records when a gulp or spit is presented.
 */
export class PelicanBurst {
  constructor(scene, count = 200) {
    const material = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } },
      vertexShader: `
        uniform float uTime;
        attribute vec3 aOrigin;
        attribute vec4 aMotion; // velocity xyz, kind (0 poof, 1 feather, 2 suction)
        attribute vec3 aCarry;  // vehicle velocity the burst rides along with
        attribute vec4 aLife;   // birth, life, size, seed
        attribute vec3 aColor;
        varying vec3 vColor; varying vec3 vNormal; varying float vAlive;
        void main() {
          float age = uTime - aLife.x;
          vAlive = step(0.0, age) * (1.0 - step(aLife.y, age));
          if (vAlive < 0.5) { vColor = vec3(0.0); vNormal = vec3(0.0, 1.0, 0.0); gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          float k = age / aLife.y, kind = aMotion.w, seed = aLife.w;
          vec3 center; vec3 shape = vec3(1.0); float size;
          float a = seed + age * (kind == 1.0 ? 9.0 : 3.0); float c = cos(a), s = sin(a);
          mat3 spin = mat3(c, s * 0.6, -s, -s * 0.6, c, 0.3 * s, s, -0.3 * s, c);
          if (kind == 1.0) {
            // Feathers: thrown out, then drift down while swaying side to side.
            vec3 travel = aMotion.xyz * (1.0 - exp(-4.0 * age)) / 4.0;
            float sway = sin(age * 7.0 + seed) * 0.12 * k;
            center = aOrigin + travel + vec3(sway, -0.55 * age * age, sway * 0.6);
            shape = vec3(1.7, 0.12, 0.55);
            size = aLife.z * min(1.0, k * 12.0) * (1.0 - k * k * k);
          } else if (kind == 2.0) {
            // Suction: puffs rush into the beak (velocity points at it) and shrink as they arrive.
            center = aOrigin + aMotion.xyz * (1.0 - exp(-9.0 * age)) / 9.0;
            size = aLife.z * min(1.0, k * 8.0) * (1.0 - k);
          } else {
            // Poof: fast ease-out spread, gentle rise, overshoot pop then a slow shrink.
            center = aOrigin + aMotion.xyz * (1.0 - exp(-6.0 * age)) / 6.0 + vec3(0.0, 0.35 * age, 0.0);
            float pop = clamp(k * 5.0, 0.0, 1.0) - 1.0;
            size = aLife.z * (1.0 + 2.7 * pop * pop * pop + 1.7 * pop * pop) * (1.0 - k * k) * (1.0 + 0.8 * k);
          }
          center += aCarry * age;
          vNormal = normalize(mat3(modelMatrix) * spin * normal); vColor = aColor;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(center + spin * (position * shape) * size, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vColor; varying vec3 vNormal; varying float vAlive;
        void main() {
          if (vAlive < 0.5) discard;
          float shade = 0.78 + 0.22 * max(0.0, dot(normalize(vNormal), normalize(vec3(10.0, 30.0, 7.0))));
          gl_FragColor = vec4(vColor * shade, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
    this.pool = new GpuInstancePool(scene, new THREE.IcosahedronGeometry(1, 1), count, { aOrigin: 3, aMotion: 4, aCarry: 3, aLife: 4, aColor: 3 }, material);
    this.mesh = this.pool.mesh;
    this._smoke = [new THREE.Color('#fbf7ee'), new THREE.Color('#e9e3d6'), new THREE.Color('#d8d2c6')];
    this._feather = new THREE.Color();
  }

  emit(kind, origin, velocity, carry, size, life, color) {
    this.pool.emit({ aOrigin: [origin.x, origin.y, origin.z], aMotion: [velocity.x, velocity.y, velocity.z, kind], aCarry: [carry.x, carry.y, carry.z],
      aLife: [this.pool.time.value, life, size, Math.random() * 6], aColor: [color.r, color.g, color.b] }, life);
  }

  /**
   * `mouth` is the beak tip, `forward` the facing direction (unit, horizontal), `carry` the vehicle velocity,
   * `feather` the pelican's body color. A gulp sucks smoke into the beak and ends in a poof; a spit blasts a cone forward.
   */
  burst(type, mouth, forward, carry, feather) {
    const v = new THREE.Vector3(), o = new THREE.Vector3(), side = new THREE.Vector3(-forward.z, 0, forward.x);
    this._feather.set(feather);
    if (type === 'gulp') {
      for (let i = 0; i < 14; i++) {
        const angle = (i / 14) * Math.PI * 2 + Math.random() * 0.4, r = 0.75 + Math.random() * 0.35;
        o.copy(mouth).addScaledVector(forward, 0.35 + Math.random() * 0.2).addScaledVector(side, Math.cos(angle) * r);
        o.y += Math.sin(angle) * r * 0.7;
        v.copy(mouth).sub(o).multiplyScalar(9);
        this.emit(SUCTION, o, v, carry, 0.13 + Math.random() * 0.08, 0.32 + Math.random() * 0.08, this._smoke[i % 3]);
      }
      for (let i = 0; i < 10; i++) {
        const angle = Math.random() * Math.PI * 2;
        v.set(Math.cos(angle) * 2.4, 0.8 + Math.random() * 1.6, Math.sin(angle) * 2.4);
        this.emit(POOF, mouth, v, carry, 0.15 + Math.random() * 0.1, 0.5 + Math.random() * 0.2, this._smoke[i % 3]);
      }
      for (let i = 0; i < 5; i++) {
        v.set((Math.random() - 0.5) * 3, 1.8 + Math.random() * 1.2, (Math.random() - 0.5) * 3);
        this.emit(FEATHER, mouth, v, carry, 0.11, 1.1 + Math.random() * 0.4, this._feather);
      }
      return;
    }
    // Spit: a big cone of smoke out of the beak, a ring puff around it and a flurry of feathers.
    for (let i = 0; i < 22; i++) {
      const spread = (Math.random() - 0.5) * 1.3, lift = (Math.random() - 0.3) * 0.9, speed = 4 + Math.random() * 5;
      v.copy(forward).multiplyScalar(speed).addScaledVector(side, spread * speed * 0.5); v.y = lift * speed * 0.5;
      this.emit(POOF, mouth, v, carry, 0.16 + Math.random() * 0.14, 0.6 + Math.random() * 0.3, this._smoke[i % 3]);
    }
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2;
      v.copy(side).multiplyScalar(Math.cos(angle) * 3); v.y = Math.sin(angle) * 3;
      this.emit(POOF, mouth, v, carry, 0.13, 0.45, this._smoke[0]);
    }
    for (let i = 0; i < 8; i++) {
      v.copy(forward).multiplyScalar(1 + Math.random() * 2.5).addScaledVector(side, (Math.random() - 0.5) * 3); v.y = 1.5 + Math.random() * 1.5;
      this.emit(FEATHER, mouth, v, carry, 0.12, 1.2 + Math.random() * 0.5, this._feather);
    }
  }

  update(dt) { this.pool.time.value += dt; this.pool.flush(); }
  reset() { this.pool.reset(); this.pool.time.value = 0; }
  dispose() { this.pool.dispose(); }
}
