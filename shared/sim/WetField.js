import { wetCoverage, dryWetMark } from './wetCoverage.js';

/** Live-water flood fill re-check while nothing else changes (0.1 s); see electrify. */
const RECHECK_TICKS = 6;
const empty = () => ({ id: 0, x: 0, z: 0, birth: 0, seed: 0, radius: 0, stretch: 1, dry: 0, angle: 0, platform: -1, live: false });

/** Authority-owned copies of the ORIGINAL splash parameters, never a replacement rendering shape.
 * Same bounded pools, proximity refresh, scatter and drying as WetSurfaces; paw prints stay cosmetic. */
export class WetField {
  constructor(trucks) { this.trucks = trucks; this.random = Math.random; this.reset(); }
  reset() {
    this.tick = this.scroll = this.revision = this.liveRevision = this.nextId = 0;
    this.dryRevision = 0; // Host-only urgent-send bookkeeping; existing marks carry the whole result.
    this.checkedTick = -1; this.checkedRevision = -1; this.sourceSignature = '';
    this.surfaces = Array.from({ length: this.trucks.length + 1 }, (_, i) => ({
      generation: 0, cursor: 0, marks: Array.from({ length: i ? 112 : 160 }, empty),
    }));
  }
  clearTruck(truck) {
    const surface = this.surfaces[this.trucks.indexOf(truck) + 1];
    if (!surface) return;
    surface.generation++; surface.cursor = 0; surface.marks.forEach(mark => Object.assign(mark, empty()));
    this.revision++; this.liveRevision++;
  }
  advance(dt, speed) {
    this.tick += Math.round(dt * 60); this.scroll += dt * speed;
    for (const surface of this.surfaces) for (const mark of surface.marks) {
      if (!mark.id || this.tick / 60 < mark.birth + mark.dry) continue;
      if (mark.live) this.liveRevision++;
      Object.assign(mark, empty()); this.revision++;
    }
  }
  splash(truck, x, z) {
    const index = truck ? this.trucks.indexOf(truck) + 1 : 0;
    if (truck && index === 0) return;
    const surface = this.surfaces[index], time = this.tick / 60, radius = truck ? 0.5 : 0.55;
    if (!truck) x += this.scroll;
    const nearby = surface.marks.find(mark => mark.id && time - mark.birth < mark.dry * 0.45 && Math.hypot(mark.x - x, mark.z - z) < radius * 0.55);
    if (nearby) {
      nearby.birth = time - Math.min(time - nearby.birth, 0.1);
      nearby.radius = Math.min(radius * 1.7, nearby.radius + 0.035);
    } else {
      const mark = surface.marks[surface.cursor++ % surface.marks.length];
      const px = x + (this.random() - 0.5) * 0.18, pz = z + (this.random() - 0.5) * 0.18;
      Object.assign(mark, { id: ++this.nextId, x: px, z: pz, birth: time,
        radius: radius * (0.85 + this.random() * 0.3), stretch: truck ? 1 : 1.7,
        dry: truck ? 8 + this.random() * 3 : 5 + this.random() * 2,
        angle: truck ? this.random() * Math.PI * 2 : (this.random() - 0.5) * 0.3,
        seed: this.random() * 10, live: false,
        platform: truck ? truck.platforms.findIndex(p => x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) : -1 });
    }
    this.revision++;
  }
  localPoint(truck, x, z) { return truck ? [x - truck.pos.x, z - truck.pos.z] : [x + this.scroll, z]; }
  dryNear(truck, worldX, worldZ, radius = .55, seconds = .45) {
    const index = this.trucks.indexOf(truck), platform = truck?.platforms.indexOf(truck.platformAt(worldX, worldZ, 0));
    if (index < 0 || platform < 0) return 0;
    let count = 0;
    const x = worldX - truck.pos.x, z = worldZ - truck.pos.z;
    for (const mark of this.surfaces[index + 1].marks) {
      if (mark.platform !== platform || Math.hypot(mark.x - x, mark.z - z) > radius + mark.radius * .6) continue;
      if (dryWetMark(mark, this.tick / 60, seconds)) count++;
    }
    if (count) { this.revision++; this.dryRevision++; }
    return count;
  }
  markAt(truck, worldX, worldZ, liveOnly = false) {
    const index = truck ? this.trucks.indexOf(truck) + 1 : 0;
    if (truck && (index === 0 || !truck.platformAt(worldX, worldZ, 0))) return null;
    const [x, z] = this.localPoint(truck, worldX, worldZ), surface = this.surfaces[index];
    const platform = truck ? truck.platforms.indexOf(truck.platformAt(worldX, worldZ, 0)) : -1;
    const slot = surface.marks.findIndex(mark => mark.platform === platform && (!liveOnly || mark.live) && wetCoverage(mark, x, z, this.tick / 60) > 0.12);
    return slot < 0 ? null : { surface, mark: surface.marks[slot], slot };
  }
  overlaps(a, b) {
    if (!a.id || !b.id || a.platform !== b.platform) return false;
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    if (d > a.radius * Math.max(1, a.stretch) + b.radius * Math.max(1, b.stretch)) return false;
    // Sample the overlap, including either side of its centre line. Thin cosmetic fringe is not a bridge.
    for (let i = 0; i <= 8; i++) for (const offset of [-0.12, 0, 0.12]) {
      const t = i / 8, x = a.x + dx * t - dz / (d || 1) * offset, z = a.z + dz * t + dx / (d || 1) * offset;
      if (wetCoverage(a, x, z, this.tick / 60) > 0.12 && wetCoverage(b, x, z, this.tick / 60) > 0.12) return true;
    }
    return false;
  }
  electrify(contacts) {
    const signature = contacts.map(contact => {
      const point = this.localPoint(contact.truck, contact.x, contact.z);
      return `${this.trucks.indexOf(contact.truck)}:${point[0]}:${point[1]}`;
    }).join('|');
    // Splashes, drying and contact moves bump `revision`/the signature; otherwise only the slow drying shrink can change
    // the flood fill, so it is re-checked every RECHECK_TICKS instead of every authority tick.
    if (this.checkedRevision === this.revision && this.sourceSignature === signature && this.tick - this.checkedTick < RECHECK_TICKS
      && this.tick >= this.checkedTick) return;
    if (!contacts.length && !this.surfaces.some(surface => surface.marks.some(mark => mark.live))) {
      this.checkedTick = this.tick; this.checkedRevision = this.revision; this.sourceSignature = signature; return;
    }
    const prior = this.surfaces.map(surface => surface.marks.map(mark => mark.live));
    this.surfaces.forEach(surface => surface.marks.forEach(mark => { mark.live = false; }));
    for (const contact of contacts) {
      const found = this.markAt(contact.truck, contact.x, contact.z);
      if (!found) continue;
      const { surface } = found, queue = [found.slot], queued = new Set(queue);
      for (let n = 0; n < queue.length; n++) {
        const mark = surface.marks[queue[n]];
        if (mark.live) continue;
        mark.live = true;
        surface.marks.forEach((other, i) => { if (!other.live && !queued.has(i) && this.overlaps(mark, other)) { queued.add(i); queue.push(i); } });
      }
    }
    if (this.surfaces.some((surface, i) => surface.marks.some((mark, j) => mark.live !== prior[i][j]))) {
      this.liveRevision++; this.revision++;
    }
    this.checkedTick = this.tick; this.checkedRevision = this.revision; this.sourceSignature = signature;
  }
  capture() {
    return { tick: this.tick, scroll: this.scroll, revision: this.revision, liveRevision: this.liveRevision, nextId: this.nextId,
      surfaces: this.surfaces.map(surface => ({ generation: surface.generation, cursor: surface.cursor,
        // Keyed by ring slot (protocol 26): a new, changed or dried mark patches one key instead of resending the list.
        marks: Object.fromEntries(surface.marks.flatMap((m, slot) => m.id ? [[slot, [m.id, m.x, m.z, m.birth, m.seed, m.radius, m.stretch, m.dry, m.angle, m.platform, m.live ? 1 : 0]]] : [])) })) };
  }
  apply(state) {
    this.tick = state.tick; this.scroll = state.scroll; this.revision = state.revision; this.liveRevision = state.liveRevision; this.nextId = state.nextId;
    state.surfaces.forEach((data, i) => {
      const surface = this.surfaces[i]; surface.generation = data.generation; surface.cursor = data.cursor;
      surface.marks.forEach(mark => Object.assign(mark, empty()));
      for (const key in data.marks) {
        const [id, x, z, birth, seed, radius, stretch, dry, angle, platform, live] = data.marks[key], mark = surface.marks[Number(key)];
        if (mark) Object.assign(mark, { id, x, z, birth, seed, radius, stretch, dry, angle, platform, live: !!live });
      }
    });
  }
}
