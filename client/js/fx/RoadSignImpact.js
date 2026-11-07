import * as THREE from 'three';
import { GpuInstancePool } from './GpuInstancePool.js';
import { roadSignFrame, roadSignTone } from '../../../shared/sim/RoadSigns.js';
import { ROAD_SIGN_PALETTE } from '../world/roadSignPalette.js';

const SMOKE = 0, SPARK = 1, SPARK_GLOW = 2.4;

/** Comic smoke poof plus tone-coloured HDR sparks where a road sign flattens a cat.
 * Triggered by a new confirmed `roadSignAttachment` id (the authority's hit); never decides a hit itself.
 * Smoke is dragged a little along the sign's travel, then lingers; motion, size and fade live in the shader.
 */
export class RoadSignImpact {
  constructor(scene, game) {
    this.game = game;
    const material = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false,
      vertexShader: `
        uniform float uTime;
        attribute vec3 aOrigin;
        attribute vec4 aMotion; // xyz launch velocity, w drag
        attribute vec4 aLife;   // birth, life, size, kind (0 smoke, 1 spark)
        attribute vec3 aColor;
        varying vec3 vNormal; varying vec3 vColor; varying float vAlpha; varying float vKind; varying float vAlive;
        void main() {
          float age = uTime - aLife.x;
          vAlive = step(0.0, age) * (1.0 - step(aLife.y, age));
          if (vAlive < .5) { vNormal = vec3(0., 1., 0.); vColor = vec3(0.); vAlpha = 0.; vKind = 0.; gl_Position = vec4(2., 2., 2., 1.); return; }
          float k = age / aLife.y, spark = step(.5, aLife.w);
          vec3 center = aOrigin + aMotion.xyz * (1.0 - exp(-aMotion.w * age)) / aMotion.w;
          center.y -= spark * 5.5 * age * age;
          // Smoke pops with an overshoot and keeps swelling; sparks start full and shrink away.
          float pop = clamp(k * 7.0, 0.0, 1.0) - 1.0;
          float puff = (1.0 + 2.7 * pop * pop * pop + 1.7 * pop * pop) * (1.0 + .55 * k);
          float size = aLife.z * mix(puff, 1.0 - k * k, spark);
          vAlpha = mix((1.0 - smoothstep(.4, 1.0, k)) * .95, 1.0, spark);
          float a = aLife.x * 37.0 + age * 6.0; float c = cos(a), s = sin(a);
          mat3 spin = mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0);
          vNormal = normalize(mat3(modelMatrix) * spin * normal); vColor = aColor; vKind = spark;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(center + spin * position * size, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vNormal; varying vec3 vColor; varying float vAlpha; varying float vKind; varying float vAlive;
        void main() {
          if (vAlive < .5) discard;
          float shade = .76 + .24 * max(0., dot(normalize(vNormal), normalize(vec3(10., 30., 7.))));
          gl_FragColor = vec4(mix(vColor * shade, vColor * ${SPARK_GLOW.toFixed(2)}, vKind), vAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
    this.pool = new GpuInstancePool(scene, new THREE.IcosahedronGeometry(1, 1), 128, { aOrigin: 3, aMotion: 4, aLife: 4, aColor: 3 }, material);
    this.mesh = this.pool.mesh;
    this.smoke = [new THREE.Color('#fbf6e8'), new THREE.Color('#e9ece2'), new THREE.Color('#fff4d9')];
    this.spark = new THREE.Color(); this.at = new THREE.Vector3(); this.offset = new THREE.Vector3();
    this.reset();
  }

  /** One hit at the flattened cat; `tone` picks the spark colour. */
  burst(position, tone) {
    const now = this.pool.time.value, drag = -26;
    this.spark.set((ROAD_SIGN_PALETTE[tone] || ROAD_SIGN_PALETTE.blue).spark);
    for (let i = 0; i < 16; i++) {
      // A ring in the sign's face plane (y-z), shoved along the sign's travel (-x).
      const angle = i * Math.PI * 2 / 16 + Math.random() * .3, speed = 2.2 + Math.random() * 1.8, life = .55 + Math.random() * .25;
      const color = this.smoke[i % 3], center = i < 3;
      this.pool.emit({
        aOrigin: [position.x - .1, position.y + .45 + (center ? 0 : Math.sin(angle) * .2), position.z + (center ? 0 : Math.cos(angle) * .2)],
        aMotion: [drag * (center ? .45 : .2 + Math.random() * .25), Math.sin(angle) * speed * (center ? .2 : 1) + .9, Math.cos(angle) * speed * (center ? .2 : 1), 5],
        aLife: [now, life, center ? .48 + Math.random() * .1 : .24 + Math.random() * .14, SMOKE],
        aColor: [color.r, color.g, color.b],
      }, life);
    }
    for (let i = 0; i < 10; i++) {
      const angle = i * Math.PI * 2 / 10 + Math.random() * .5, speed = 6 + Math.random() * 4, life = .32 + Math.random() * .16;
      this.pool.emit({
        aOrigin: [position.x - .15, position.y + .5, position.z],
        aMotion: [drag * .15 - Math.random() * 3, Math.sin(angle) * speed + 2, Math.cos(angle) * speed, 6],
        aLife: [now, life, .06 + Math.random() * .04, SPARK],
        aColor: [this.spark.r, this.spark.g, this.spark.b],
      }, life);
    }
    this.until = now + .85;
  }

  update(dt) {
    const game = this.game, entries = game.roadSigns.entries();
    game.players.forEach((player, slot) => {
      const id = player.roadSignAttachment?.id || null;
      if (id === this.records[slot]) return;
      this.records[slot] = id;
      const entry = id && player.occupied !== false && entries.find(entry => entry.id === id);
      const frame = entry && roadSignFrame(entry, game.roadSigns.presentationTime(), game.homeTruck, game.level.road);
      // Stale snapshots (the sign already gone) only update the baseline.
      if (frame?.phase !== 'passing') return;
      this.burst(this.at.set(frame.x, frame.y, frame.z).add(this.offset.fromArray(player.roadSignAttachment.offset)), roadSignTone(game.roadSigns.definitions, id));
    });
    // The clock only runs while a burst is alive, so quiet frames never upload instance data.
    if (this.pool.time.value < this.until) this.pool.time.value += dt;
    this.pool.flush();
  }

  reset() {
    this.pool.reset(); this.pool.time.value = 0; this.until = 0;
    this.records = this.game.players.map(player => player.roadSignAttachment?.id || null);
  }

  dispose() { this.pool.dispose(); this.records = []; }
}
