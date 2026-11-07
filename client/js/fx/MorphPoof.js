import * as THREE from 'three';
import { GpuInstancePool } from './GpuInstancePool.js';

/** Twelve smoke puffs and seven stars per swap; room for every slot swapping at once (the tutorial lends all at once). */
const SMOKE = 12, STARS = 7, SMOKE_CAPACITY = 96, STAR_CAPACITY = 64;

/** Five-point star, flat in xy: 10 triangles. */
function starGeometry() {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.45 : 1;
    if (i) shape.lineTo(Math.cos(a) * r, Math.sin(a) * r); else shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ShapeGeometry(shape);
}

/**
 * "Poof!" — a body swap (tutorial L lesson lends the elephant, then gives the roster animal back): a round cream smoke
 * cloud that hides the swap, with gold stars flung out and spinning. Triggered by a rising shared `morphSerial`
 * (host-applied); it never changes anyone's animal. Motion, spin, growth and fade live in the shaders.
 * Budget: smoke 80-triangle icosphere × 12 for ≤0.8 s (960 triangles), stars 10-triangle billboards × 7 for ≤0.9 s
 * (70 triangles): 2 draws per live swap; 8 swaps at once = 96 + 56 records (≈8.2k triangles, 2 draws); idle submits
 * zero instances and zero draws.
 */
export class MorphPoof {
  constructor(scene, game) {
    this.game = game;
    const smoke = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false,
      vertexShader: `
        uniform float uTime;
        attribute vec3 aOrigin;
        attribute vec4 aMotion; // xyz burst velocity, w unused
        attribute vec4 aLife;   // birth, life, size, unused
        varying vec3 vNormal; varying float vAlpha;
        void main() {
          float age = uTime - aLife.x;
          if (age < 0.0 || age >= aLife.y) { vNormal = vec3(0., 1., 0.); vAlpha = 0.; gl_Position = vec4(2., 2., 2., 1.); return; }
          float k = age / aLife.y;
          vec3 center = aOrigin + aMotion.xyz * (1.0 - exp(-6.0 * age)) / 6.0;
          // Bursts to an overshoot in a few frames ("poof!"), then swells and thins out.
          float pop = clamp(k * 8.0, 0.0, 1.0) - 1.0;
          float size = aLife.z * (1.0 + 2.7 * pop * pop * pop + 1.7 * pop * pop) * (1.0 + .6 * k);
          vAlpha = (1.0 - smoothstep(.4, 1.0, k)) * .96;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(center + position * size, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vNormal; varying float vAlpha;
        void main() {
          if (vAlpha <= 0.0) discard;
          float shade = .8 + .2 * max(0., dot(normalize(vNormal), normalize(vec3(10., 30., 7.))));
          gl_FragColor = vec4(vec3(.98, .96, .9) * shade, vAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
    const stars = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `
        uniform float uTime;
        attribute vec3 aOrigin;
        attribute vec4 aMotion; // xyz velocity, w spin seed
        attribute vec4 aLife;   // birth, life, size, tint (0 gold, 1 pale)
        varying float vAlpha; varying float vTint;
        void main() {
          float age = uTime - aLife.x;
          if (age < 0.0 || age >= aLife.y) { vAlpha = 0.; gl_Position = vec4(2., 2., 2., 1.); return; }
          float k = age / aLife.y; vTint = aLife.w;
          // Flung out fast, then drift and sink a little.
          vec3 center = aOrigin + aMotion.xyz * (1.0 - exp(-5.0 * age)) / 5.0 - vec3(0.0, 1.2 * age * age, 0.0);
          float size = aLife.z * clamp(k * 9.0, 0.0, 1.0) * (1.0 - smoothstep(.6, 1.0, k));
          float a = (aMotion.w - .5) * 9.0 * age + aMotion.w * 6.2831;
          vec2 p = mat2(cos(a), -sin(a), sin(a), cos(a)) * position.xy * size;
          // Billboard: always face the camera.
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vAlpha = 1.0 - smoothstep(.7, 1.0, k);
          gl_Position = projectionMatrix * viewMatrix * vec4(center + right * p.x + up * p.y, 1.0);
        }`,
      fragmentShader: `
        varying float vAlpha; varying float vTint;
        void main() {
          if (vAlpha <= 0.0) discard;
          gl_FragColor = vec4(mix(vec3(1.0, .8, .25), vec3(1.0, .97, .8), vTint) * 1.5, vAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
    this.smoke = new GpuInstancePool(scene, new THREE.IcosahedronGeometry(1, 1), SMOKE_CAPACITY, { aOrigin: 3, aMotion: 4, aLife: 4 }, smoke);
    this.stars = new GpuInstancePool(scene, starGeometry(), STAR_CAPACITY, { aOrigin: 3, aMotion: 4, aLife: 4 }, stars);
    // Both pools share one effect clock.
    this.stars.time = this.smoke.time; this.stars.mesh.material.uniforms.uTime = this.smoke.time;
    this.time = this.smoke.time;
    this.reset();
  }

  /** One poof around a body standing at `position`. */
  burst(position) {
    const now = this.time.value, x = position.x, y = position.y, z = position.z;
    for (let i = 0; i < SMOKE; i++) {
      const ring = i < 8, angle = i * Math.PI * 2 / 8 + Math.random() * .4, speed = ring ? 2 + Math.random() * 1.1 : .5;
      const life = .6 + Math.random() * .2;
      this.smoke.emit({
        aOrigin: [x + (ring ? Math.cos(angle) * .2 : 0), y + (ring ? .25 + (i % 3) * .3 : .45 + (i - 8) * .28), z + (ring ? Math.sin(angle) * .2 : 0)],
        aMotion: [Math.cos(angle) * speed, ring ? .7 + Math.random() * .7 : 1.1, Math.sin(angle) * speed, 0],
        aLife: [now, life, ring ? .3 + Math.random() * .12 : .5, 0],
      }, life);
    }
    for (let i = 0; i < STARS; i++) {
      const angle = i * Math.PI * 2 / STARS + Math.random() * .5, speed = 3 + Math.random() * 1.5, life = .7 + Math.random() * .2;
      this.stars.emit({
        aOrigin: [x, y + .8, z],
        aMotion: [Math.cos(angle) * speed, 2.2 + Math.random() * 1.6, Math.sin(angle) * speed, Math.random()],
        aLife: [now, life, .17 + Math.random() * .07, i % 3 === 0 ? 1 : 0],
      }, life);
    }
  }

  update(dt) {
    this.game.players.forEach((player, slot) => {
      const serial = player.morphSerial || 0, seen = this.records[slot];
      if (seen === serial) return;
      this.records[slot] = serial;
      // First sight only sets the baseline; the count only rises, so an old snapshot never replays a poof.
      if (seen === undefined || serial < seen) return;
      if (player.occupied !== false && player.root?.visible) this.burst(player.root.position);
    });
    if (this.time.value < Math.max(this.smoke.until, this.stars.until)) this.time.value += dt;
    this.smoke.flush(); this.stars.flush();
  }

  reset() {
    this.smoke.reset(); this.stars.reset(); this.time.value = 0;
    this.records = this.game.players.map(player => player.morphSerial || 0);
  }

  dispose() { this.reset(); this.smoke.dispose(); this.stars.dispose(); }
}
