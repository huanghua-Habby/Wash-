import * as THREE from 'three';
import { PAL } from '../../../shared/sim/palette.js';
import { GpuInstancePool } from './GpuInstancePool.js';

const PUFF = 0, CHIP = 1;

// Shared GPU motion: every record rides along with its vehicle (aCarry) so marks stay on the moving hull.
const VERTEX_HEAD = `
  uniform float uTime;
  attribute vec3 aOrigin;
  attribute vec4 aMotion; // velocity xyz, kind
  attribute vec3 aCarry;  // vehicle velocity
  attribute vec4 aLife;   // birth, life, size, seed
  attribute vec3 aColor;
  varying vec3 vColor; varying vec3 vNormal; varying float vAlive; varying float vFade;
  mat3 spinMatrix(float a) { float c = cos(a), s = sin(a); return mat3(c, s * 0.6, -s, -s * 0.6, c, 0.3 * s, s, -0.3 * s, c); }
`;

/**
 * Squirrel wall-cling feedback. The CPU writes birth records only when a squirrel grabs, kicks off or slides;
 * motion, size curves and fading run on the GPU, and both pools stop drawing once their records expire.
 * - `bits` (opaque): cartoon dust puffs that splash flat along the wall on a grab or kick, plus claw chips that flick off and fall.
 * - `mist` (soft, translucent): friction haze left on the face under the scrabbling paws, denser the faster the slide.
 */
export class WallClingFx {
  constructor(scene, { bits = 96, mist = 96 } = {}) {
    const bitsMaterial = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } },
      vertexShader: `${VERTEX_HEAD}
        void main() {
          float age = uTime - aLife.x;
          vAlive = step(0.0, age) * (1.0 - step(aLife.y, age)); vFade = 1.0;
          if (vAlive < 0.5) { vColor = vec3(0.0); vNormal = vec3(0.0, 1.0, 0.0); gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          float k = age / aLife.y, seed = aLife.w;
          vec3 center; vec3 shape = vec3(1.0); float size;
          mat3 spin = spinMatrix(seed + age * (aMotion.w == 1.0 ? 14.0 : 3.0));
          if (aMotion.w == 1.0) {
            // Claw chip: flicked off the face, then dropping under gravity while tumbling.
            center = aOrigin + aMotion.xyz * age + vec3(0.0, -4.5 * age * age, 0.0);
            shape = vec3(1.0, 0.3, 0.7);
            size = aLife.z * (1.0 - smoothstep(0.6, 1.0, k));
          } else {
            // Puff: ease-out splash along the face, a gentle rise, an overshoot pop then a slow shrink.
            center = aOrigin + aMotion.xyz * (1.0 - exp(-7.0 * age)) / 7.0 + vec3(0.0, 0.3 * age, 0.0);
            float pop = clamp(k * 5.0, 0.0, 1.0) - 1.0;
            size = aLife.z * (1.0 + 2.7 * pop * pop * pop + 1.7 * pop * pop) * (1.0 - k * k) * (1.0 + 0.7 * k);
          }
          center += aCarry * age;
          vNormal = normalize(mat3(modelMatrix) * spin * normal); vColor = aColor;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(center + spin * (position * shape) * size, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vColor; varying vec3 vNormal; varying float vAlive; varying float vFade;
        void main() {
          if (vAlive < 0.5) discard;
          float shade = 0.76 + 0.24 * max(0.0, dot(normalize(vNormal), normalize(vec3(10.0, 30.0, 7.0))));
          gl_FragColor = vec4(vColor * shade, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
    const mistMaterial = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false,
      vertexShader: `${VERTEX_HEAD}
        varying vec3 vView;
        void main() {
          float age = uTime - aLife.x;
          vAlive = step(0.0, age) * (1.0 - step(aLife.y, age));
          if (vAlive < 0.5) { vColor = vec3(0.0); vNormal = vec3(0.0, 1.0, 0.0); vView = vNormal; vFade = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          float k = age / aLife.y;
          // Haze: drifts off the face and upward (the squirrel slides on down), swelling as it thins out.
          vec3 center = aOrigin + aMotion.xyz * (1.0 - exp(-3.0 * age)) / 3.0 + vec3(0.0, 0.22 * age, 0.0) + aCarry * age;
          float size = aLife.z * (0.45 + 1.35 * sqrt(k));
          vFade = smoothstep(0.0, 0.12, k) * pow(1.0 - k, 1.6) * 0.62;
          vec4 world = modelMatrix * vec4(center + position * size, 1.0);
          vNormal = normalize(mat3(modelMatrix) * normal); vView = normalize(cameraPosition - world.xyz); vColor = aColor;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: `
        varying vec3 vColor; varying vec3 vNormal; varying float vAlive; varying float vFade; varying vec3 vView;
        void main() {
          if (vAlive < 0.5) discard;
          // Soft ball: dense in the middle, feathered toward the silhouette.
          float facing = abs(dot(normalize(vNormal), normalize(vView)));
          gl_FragColor = vec4(vColor * (0.9 + 0.1 * facing), vFade * facing * facing);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
    const dimensions = { aOrigin: 3, aMotion: 4, aCarry: 3, aLife: 4, aColor: 3 };
    this.bits = new GpuInstancePool(scene, new THREE.IcosahedronGeometry(1, 0), bits, dimensions, bitsMaterial);
    this.mist = new GpuInstancePool(scene, new THREE.IcosahedronGeometry(1, 1), mist, dimensions, mistMaterial);
    this.mist.mesh.renderOrder = 2;
    this.pools = [this.bits, this.mist]; this.meshes = this.pools.map(pool => pool.mesh);
    this._dust = [new THREE.Color(PAL.dust), new THREE.Color(PAL.puff), new THREE.Color('#f3efe6')];
    this._chips = [new THREE.Color('#8b8f98'), new THREE.Color('#c9c3b5')];
    this._haze = new THREE.Color('#f6f3ec');
    this._o = new THREE.Vector3(); this._v = new THREE.Vector3();
  }

  record(pool, kind, origin, velocity, carry, size, life, color) {
    return pool.emit({ aOrigin: [origin.x, origin.y, origin.z], aMotion: [velocity.x, velocity.y, velocity.z, kind], aCarry: [carry.x, carry.y, carry.z],
      aLife: [pool.time.value, life, size, Math.random() * 6], aColor: [color.r, color.g, color.b] }, life);
  }

  /**
   * `type` grab | kick | slide | slip. `contact` is the face point under the paws, `normal` the face's outward unit
   * normal ({x, z}), `carry` the vehicle velocity and `strength` 0..1 (slide speed for `slide`).
   */
  play({ type, contact, normal, carry, strength = 1 }) {
    const o = this._o, v = this._v, nx = normal.x, nz = normal.z, tx = -nz, tz = nx;
    if (type === 'slide') {
      // One haze puff per call, with an occasional claw chip once the slide gets fast.
      o.set(contact.x + nx * 0.05 + tx * (Math.random() - 0.5) * 0.3, contact.y + (Math.random() - 0.5) * 0.12, contact.z + nz * 0.05 + tz * (Math.random() - 0.5) * 0.3);
      v.set(nx * (0.5 + Math.random() * 0.5) + tx * (Math.random() - 0.5) * 0.6, 0.35 + strength * 0.9, nz * (0.5 + Math.random() * 0.5) + tz * (Math.random() - 0.5) * 0.6);
      this.record(this.mist, PUFF, o, v, carry, 0.07 + 0.07 * strength + Math.random() * 0.03, 0.5 + Math.random() * 0.25, this._haze);
      if (Math.random() < strength * 0.45) {
        v.set(nx * (1.2 + Math.random()) + tx * (Math.random() - 0.5) * 1.6, 0.8 + Math.random() * 1.4, nz * (1.2 + Math.random()) + tz * (Math.random() - 0.5) * 1.6);
        this.record(this.bits, CHIP, o, v, carry, 0.022 + Math.random() * 0.014, 0.45 + Math.random() * 0.2, this._chips[Math.random() < 0.5 ? 0 : 1]);
      }
      return;
    }
    // Grab / kick / slip: a ring of puffs splashing flat along the face, some haze and a few chips.
    const n = type === 'kick' ? 12 : type === 'grab' ? Math.round(6 + 6 * strength) : 7, out = type === 'kick' ? 1.6 : 0.7;
    for (let i = 0; i < n; i++) {
      const angle = (i / n + Math.random() * 0.25) * Math.PI * 2, speed = (2.2 + Math.random() * 1.8) * (type === 'slip' ? 0.7 : 1);
      const along = Math.cos(angle) * speed, up = Math.sin(angle) * speed * (type === 'slip' ? 0.5 : 0.8);
      v.set(tx * along + nx * out * (0.6 + Math.random()), up, tz * along + nz * out * (0.6 + Math.random()));
      o.set(contact.x + nx * 0.08 + tx * Math.cos(angle) * 0.15, contact.y + Math.sin(angle) * 0.15, contact.z + nz * 0.08 + tz * Math.cos(angle) * 0.15);
      this.record(this.bits, PUFF, o, v, carry, 0.08 + Math.random() * 0.06, 0.4 + Math.random() * 0.25, this._dust[i % 3]);
    }
    for (let i = 0; i < 3; i++) {
      v.set(nx * (0.8 + Math.random() * 0.6) + tx * (Math.random() - 0.5), 0.2 + Math.random() * 0.4, nz * (0.8 + Math.random() * 0.6) + tz * (Math.random() - 0.5));
      this.record(this.mist, PUFF, contact, v, carry, 0.13 + Math.random() * 0.05, 0.55 + Math.random() * 0.2, this._haze);
    }
    for (let i = 0; i < (type === 'kick' ? 5 : 3); i++) {
      v.set(nx * (1.5 + Math.random() * 1.5) + tx * (Math.random() - 0.5) * 2, 1 + Math.random() * 1.5, nz * (1.5 + Math.random() * 1.5) + tz * (Math.random() - 0.5) * 2);
      this.record(this.bits, CHIP, contact, v, carry, 0.024 + Math.random() * 0.012, 0.5 + Math.random() * 0.25, this._chips[i % 2]);
    }
  }

  update(dt) { for (const pool of this.pools) { pool.time.value += dt; pool.flush(); } }
  reset() { for (const pool of this.pools) { pool.reset(); pool.time.value = 0; } }
  dispose() { for (const pool of this.pools) pool.dispose(); }
}
