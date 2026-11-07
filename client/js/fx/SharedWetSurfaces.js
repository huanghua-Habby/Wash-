import { WetSurfaces, WetDecalPool, LevelDecalPools } from './WetSurfaces.js';

/** Data adapter only. Keeps the original WetSurfaces shader, shape, palette, reflection and drying.
 * Host splash records replace local random emission; cat wetness, drips and paw prints keep their original code. */
export class SharedWetSurfaces extends WetSurfaces {
  constructor(options) {
    super(options);
    // One layer per standing level of each vehicle (multi-level roofs), routed by where each host mark lies.
    this.sharedRoofs = this.trucks.map(truck => new LevelDecalPools(truck.body, 112, this.uniforms, truck));
    this.revision = -1;
    this.towelDryTimes = this.trucks.map(() => -Infinity);
  }
  // The base landWater still handles cats and calls this hook for surfaces; those records now come from the host.
  splash() {}
  samples() { return [...super.samples(), ...(this.sharedRoofs || []).flatMap(pool => pool.meshes)]; }
  reset() {
    super.reset(); this.sharedRoofs?.forEach(pool => pool.clear());
    for (const pool of [this.road, ...(this.sharedRoofs || [])]) pool.records.forEach(record => { record.id = 0; record.radius = 0; });
    this.revision = -1;
    this.towelDryTimes?.fill(-Infinity);
  }
  dryRoof(index, local) {
    // Cosmetic paw prints still absorb water locally. Real puddles only follow
    // the host; keep the contributor's squeezed-drop feedback on their retime.
    return super.dryRoof(index, local) + (this.game.wet.tick / 60 - this.towelDryTimes[index] < .1 ? 1 : 0);
  }
  update(dt) {
    const wet = this.game.wet, running = !(this.game.paused || this.game.ended);
    if (this.revision !== wet.revision) {
      this.revision = wet.revision;
      wet.surfaces.forEach((surface, index) => {
        const pool = index ? this.sharedRoofs[index - 1] : this.road;
        surface.marks.forEach((mark, slot) => {
          const record = pool.records[slot];
          if (!mark.id) {
            if (record.radius) { pool.remove(slot); record.id = 0; }
            return;
          }
          if (record.id === mark.id && record.birth === mark.birth && record.radius === mark.radius && record.dry === mark.dry) return;
          if (index && record.id === mark.id && mark.dry < record.dry) this.towelDryTimes[index - 1] = wet.tick / 60;
          pool.write(slot, mark.x, mark.z, mark.birth, mark.seed, mark.radius, mark.stretch, mark.dry, 0, mark.angle);
          record.id = mark.id;
        });
      });
    }
    this.time = wet.tick / 60 - (running ? dt : 0);
    super.update(dt, wet.scroll);
    this.sharedRoofs.forEach(pool => pool.update(this.time));
  }
}
