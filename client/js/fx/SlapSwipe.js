import * as THREE from 'three';
import { GpuInstancePool } from './GpuInstancePool.js';
import { CHARACTER_SCALE } from '../../../shared/sim/characterScale.js';

/** One swipe per swing; room for every player swinging at the fastest cadence (goose, 1/3 s) inside one swipe life. */
const CAPACITY = 16, LIFE = 0.2, HALF_ARC = 1.15;

/**
 * Slap swing trail (VERSUS_RULES.md §10): a warm comic crescent that sweeps across in front of the slapper, on hits and
 * misses alike. Triggered by a rising shared `slapSerial` (host-confirmed); it never decides a hit. Sweep, taper and fade
 * live in the shader; the side alternates with the paw (odd swings right, even left), matching CatAnimator.slap.
 * Budget: 20×1 ring = 40 triangles, 1 record per swing for 0.2 s (1 draw); 8-player peak ≤ 8 live records
 * (320 triangles, 1 draw); idle submits zero instances/draws.
 */
export class SlapSwipe {
  constructor(scene, game) {
    this.game = game;
    const material = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `
        uniform float uTime;
        attribute vec3 aOrigin;
        attribute vec4 aLife;  // birth, life, yaw, side (±1)
        attribute vec2 aCarry; // platform velocity (xz)
        varying float vU; varying float vR; varying float vK;
        void main() {
          float age = uTime - aLife.x;
          if (age < 0.0 || age >= aLife.y) { vK = 2.0; gl_Position = vec4(2., 2., 2., 1.); return; }
          vK = age / aLife.y;
          float a = atan(position.y, position.x);
          // 0 where the paw starts (its own side), 1 where it ends (across the body).
          vU = clamp((a * aLife.w + ${HALF_ARC.toFixed(3)}) / ${(2 * HALF_ARC).toFixed(3)}, 0.0, 1.0);
          vR = clamp((length(position.xy) - 0.5) / 0.32, 0.0, 1.0);
          vec3 f = vec3(cos(aLife.z), 0.0, -sin(aLife.z)), l = vec3(-sin(aLife.z), 0.0, -cos(aLife.z));
          // Forward along +x of the ring, left along +y; the arc dips from shoulder height toward the far side.
          vec3 p = f * position.x + l * position.y + vec3(0.0, 0.18 - 0.22 * vU, 0.0);
          gl_Position = projectionMatrix * viewMatrix * vec4(aOrigin + vec3(aCarry.x, 0.0, aCarry.y) * age + p * (0.9 + 0.25 * vK), 1.0);
        }`,
      fragmentShader: `
        varying float vU; varying float vR; varying float vK;
        void main() {
          if (vK > 1.0) discard;
          // The bright head races across in the first 60% of the life; a tapering tail trails behind it.
          float head = min(1.0, vK / 0.6) * 1.25;
          float trail = smoothstep(head - 0.75, head, vU) * (1.0 - smoothstep(head, head + 0.04, vU));
          // Thick at the head, thinning to a point along the tail.
          float along = clamp((vU - head + 0.75) / 0.75, 0.0, 1.0), edge = 0.2 + 0.65 * along;
          float width = 1.0 - smoothstep(edge, edge + 0.15, abs(vR * 2.0 - 1.0));
          float alpha = trail * width * (1.0 - smoothstep(0.55, 1.0, vK)) * 0.9;
          if (alpha < 0.01) discard;
          vec3 color = mix(vec3(1.0, 0.78, 0.36), vec3(1.0, 0.98, 0.92), smoothstep(0.2, 0.9, trail));
          gl_FragColor = vec4(color * 1.25, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
    const ring = new THREE.RingGeometry(0.5, 0.82, 20, 1, -HALF_ARC, 2 * HALF_ARC);
    this.pool = new GpuInstancePool(scene, ring, CAPACITY, { aOrigin: 3, aLife: 4, aCarry: 2 }, material);
    this.mesh = this.pool.mesh;
    this.reset();
  }

  swing(position, yaw, side, carryX = 0, carryZ = 0) {
    const now = this.pool.time.value;
    this.pool.emit({ aOrigin: [position.x, position.y + 0.55 * CHARACTER_SCALE, position.z], aLife: [now, LIFE, yaw, side], aCarry: [carryX, carryZ] }, LIFE);
  }

  update(dt) {
    const players = this.game.players || [];
    players.forEach((player, i) => {
      const serial = player.slapSerial || 0, seen = this.seen[i];
      this.seen[i] = serial;
      if (serial <= seen || player.occupied === false || !player.root.visible || player.state === 'fallen') return;
      const truck = player.state === 'ground' ? player.ground?.truck : null;
      this.swing(player.root.position, player.yaw, serial % 2 ? 1 : -1, truck ? truck.vel.x : 0, truck ? truck.vel.z : 0);
    });
    // The clock only runs while a swipe is alive, so quiet frames never upload instance data.
    if (this.pool.time.value < this.pool.until) this.pool.time.value += dt;
    this.pool.flush();
  }

  reset() {
    this.pool.reset(); this.pool.time.value = 0;
    this.seen = (this.game.players || []).map(player => player.slapSerial || 0);
  }

  dispose() { this.pool.reset(); this.pool.dispose(); }
}
