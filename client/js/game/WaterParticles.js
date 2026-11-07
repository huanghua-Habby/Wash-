/** Emit immutable birth records. Flight, scatter, growth and expiry run entirely on the GPU. */
import * as THREE from 'three';
import { WASH_CONFIG as C } from '../../../shared/sim/washConfig.js';
import { GUN_BALLISTICS } from '../../../shared/sim/WaterGun.js';
import { GpuWaterLayer } from './GpuWaterLayer.js';
const UP = new THREE.Vector3(0, 1, 0), ZERO = new THREE.Vector3(), RATE = 60;
// Keep the established stream; six spread-out droplets at 10 impacts/s replace twelve at 30 impacts/s.
const IMPACT_INTERVAL = 6, SPLASH_COUNT = 6, MAX_PENDING_IMPACTS = 8;
const random = (seed) => Math.abs(Math.sin(seed * 12.9898 + 78.233)) % 1;

export class WaterParticles {
  constructor(root, game) {
    this.game = game; this.time = { value: 0 }; this.accumulator = 0; this.serial = 0;
    this.stream = new GpuWaterLayer(root, this.time, 32, 0);
    // Extra headroom lets nearby hits overtake older distant hits without evicting their live tails.
    this.splash = new GpuWaterLayer(root, this.time, 48, 1);
    this.fill = new GpuWaterLayer(root, this.time, 8, 2);
    // One bounded hit event waits for arrival, rather than drawing a future batch of invisible mesh particles.
    this.pendingImpacts = [];
  }
  reset() {
    this.time.value = 0; this.accumulator = 0; this.serial = 0; this.pendingImpacts.length = 0;
    this.stream.reset(); this.splash.reset(); this.fill.reset();
  }
  dispose() { this.stream.dispose(); this.splash.dispose(); this.fill.dispose(); }
  /** Jets differ only in ballistics and droplet size: guns use GUN_BALLISTICS, elephant trunks their own heavier jet.
   * Both follow the synced hose pressure: a weak jet is thinner, slower and lands short, exactly like the rule trace. */
  emit(gun, age) {
    const pressure = gun.pressure ?? 1, { speed, range, lift } = gun.jetBallistics?.() || gun.ballistics || GUN_BALLISTICS;
    const size = (gun.jetScale || 1) * (0.6 + 0.4 * pressure);
    const position = gun.nozzle(), direction = gun.direction();
    const path = gun.sprayNodes, first = path[0], last = path.at(-1);
    const stop = Math.min(range / speed, Math.hypot(last.x - first.x, last.z - first.z) / speed);
    const serial = this.serial++, birth = this.time.value - age;
    const velocity = direction.multiplyScalar(speed); velocity.y = lift;
    this.stream.emit(position, velocity, UP, birth, stop, (0.1 + random(serial + 3) * 0.04) * size, serial);
    // Weak jets splash less: every IMPACT_INTERVAL-th droplet at full pressure, half as often near the cutoff.
    if (serial % (pressure > 0.6 ? IMPACT_INTERVAL : IMPACT_INTERVAL * 2) !== 0 || stop >= range / speed - 0.005) return;
    const impact = position.clone().addScaledVector(velocity, stop); impact.y -= 0.5 * C.sprayGravity * stop * stop;
    const normal = UP.clone();
    if (this.game.players.some((player) => player.occupied !== false && player !== gun.holder &&
        Math.hypot(last.x - player.pos.x, last.z - player.pos.z) < 0.85 && last.y > player.pos.y + 0.12 && last.y < player.pos.y + 1.45)) {
      normal.copy(velocity).setY(0).negate().normalize().addScaledVector(UP, 0.35).normalize();
    }
    if (this.pendingImpacts.length < MAX_PENDING_IMPACTS) {
      this.pendingImpacts.push({ impact, normal, birth: birth + stop, size, pressure, serial });
      // The hit distance can change abruptly; arrival order need not match emission order.
      this.pendingImpacts.sort((a, b) => a.birth - b.birth);
    }
  }
  emitImpact({ impact, normal, birth, size, pressure, serial }) {
    this.fill.emit(impact, ZERO, normal, birth, 0.3, (0.23 + random(serial + 5) * 0.08) * size, serial);
    // Weaker jets throw fewer droplets (3 near the cutoff, SPLASH_COUNT at full pressure).
    for (let i = 0, count = Math.round(SPLASH_COUNT * (0.5 + 0.5 * pressure)); i < count; i++) {
      // Cover the whole ring with six droplets, rotating successive bursts instead of keeping one quadrant.
      const seed = serial * 12 + i * 2 + (serial / IMPACT_INTERVAL) % 2;
      this.splash.emit(impact, ZERO, normal, birth, 0.2 + random(seed + 2) * 0.045,
        (0.09 + random(seed + 4) * 0.06) * Math.sqrt(size), seed);
    }
  }
  update(dt, gun) {
    dt = Math.max(0, Math.min(0.05, dt));
    this.time.value += dt;
    if (gun.spraying && gun.sprayNodes.length > 1) {
      this.accumulator += dt;
      while (this.accumulator >= 1 / RATE) { this.accumulator -= 1 / RATE; this.emit(gun, this.accumulator); }
    } else this.accumulator = 0;
    while (this.pendingImpacts.length && this.pendingImpacts[0].birth <= this.time.value) {
      this.emitImpact(this.pendingImpacts.shift());
    }
    this.stream.flush(); this.splash.flush(); this.fill.flush();
  }
}
