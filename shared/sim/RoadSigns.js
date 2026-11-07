/** Geometry and timing shared by authority, prepared scenery and warning HUD. */
import { chaosSigns } from './RoadSignChaos.js';
export const ROAD_SIGN = Object.freeze({ warningSeconds: 2, speed: 60, startX: 24, endX: -24, maxLifetimeSeconds: 2,
  widthRatio: .92, width: 4.14, height: 1.5, bottom: .12, thickness: .18, playerRadius: .24, playerHeight: 1.05 });
export const ROAD_SIGN_PASS_SECONDS = Math.min(ROAD_SIGN.maxLifetimeSeconds, (ROAD_SIGN.startX - ROAD_SIGN.endX) / ROAD_SIGN.speed);
export const ROAD_SIGN_TONES = Object.freeze(['blue', 'red', 'yellow']);

/** Presentation colour only: an entry's optional `tone`, otherwise cycled by schedule order so every peer agrees. */
export function roadSignTone(entries = [], id) {
  const index = entries.findIndex(entry => entry.id === id);
  return entries[index]?.tone ?? ROAD_SIGN_TONES[Math.max(0, index) % ROAD_SIGN_TONES.length];
}

/** Script events are the only schedule for scripted levels; a versus level's `roadSignChaos` is generated from the frozen
 * match settings (RoadSignChaos.js). Legacy mechanics fixtures use roadSigns. */
export function roadSignDefinitions(level, settings = null) {
  if (level.roadSignChaos) return chaosSigns(level.roadSignChaos, settings?.timeLimit ?? null, ROAD_SIGN_TONES);
  return level.script ? (level.script.events || []).filter(event => event.type === 'roadSign').map(event => ({
    id: event.id, side: event.params.side, tone: event.params.tone, atMinutes: event.at === undefined ? null : (event.at + ROAD_SIGN.warningSeconds) / 60,
  })) : level.roadSigns || [];
}
export function validateRoadSigns(entries, max = 32) {
  const ids = new Set(); let previous = -Infinity;
  if (entries.length > max) throw new Error('Road signs require a bounded event list');
  for (const entry of entries) {
    if (typeof entry.id !== 'string' || !entry.id || ids.has(entry.id) || ![-1, 1].includes(entry.side) ||
        (entry.tone !== undefined && !ROAD_SIGN_TONES.includes(entry.tone)) ||
        entry.atMinutes !== null && (!Number.isFinite(entry.atMinutes) || entry.atMinutes * 60 < ROAD_SIGN.warningSeconds ||
        entry.atMinutes * 60 - previous < ROAD_SIGN.warningSeconds + ROAD_SIGN_PASS_SECONDS - 1e-9))
      throw new Error('Road signs require unique ids, valid sides and separated launch times');
    ids.add(entry.id); if (entry.atMinutes !== null) previous = entry.atMinutes * 60;
  }
}

/** atMinutes is the launch time on the round clock, after the complete two-second warning. */
export function roadSignFrame(entry, elapsed, home, road = { laneWidth: 4.5, laneCount: 2 }) {
  const age = elapsed - entry.atMinutes * 60;
  if (age < -ROAD_SIGN.warningSeconds || age >= ROAD_SIGN_PASS_SECONDS-1e-9) return null;
  return { id: entry.id, side: entry.side, phase: age < 0 ? 'warning' : 'passing',
    x: home.pos.x + ROAD_SIGN.startX - Math.max(0, age) * ROAD_SIGN.speed,
    y: home.topY + ROAD_SIGN.bottom, z: entry.side * road.laneWidth * (road.laneCount === 2 ? .5 : 1),
    width: road.laneWidth * ROAD_SIGN.widthRatio,
    remaining: Math.max(0, -age) };
}

/** Segment against an expanded box, including relative motion: fast signs cannot skip players between ticks. */
function sweep(a, b, half) {
  let enter = 0, exit = 1;
  for (let i = 0; i < 3; i++) {
    const d = b[i] - a[i];
    if (Math.abs(d) < 1e-9) { if (Math.abs(a[i]) > half[i]) return false; continue; }
    const t0 = (-half[i] - a[i]) / d, t1 = (half[i] - a[i]) / d;
    enter = Math.max(enter, Math.min(t0, t1)); exit = Math.min(exit, Math.max(t0, t1));
    if (enter > exit) return false;
  }
  return true;
}

/** Bounded events per round; guests apply hit masks and consequences, never run collision. */
export class RoadSigns {
  constructor(game) { this.game = game; this.reset(); }
  reset() {
    const level = this.game.level;
    // Generated chaos follows the match settings, which a guest may receive after its reset: rebuilt when they change.
    this.chaosKey = level.roadSignChaos ? this.game.matchSettings?.timeLimit ?? null : undefined;
    this.definitions = roadSignDefinitions(level, this.game.matchSettings);
    validateRoadSigns(this.definitions, level.roadSignChaos?.max ?? 32);
    const entries = this.definitions;
    this.hits = entries.map(() => 0); this.presentedElapsed = null;
    for (const player of this.game.players) player.roadSignAttachment = null;
  }
  present(elapsed) { this.presentedElapsed = elapsed; }
  presentationTime() { return this.presentedElapsed ?? this.game.elapsed; }
  /** All consumers use the same invocation state, including guests and warning/model presentation. */
  entries() {
    if (this.game.level.roadSignChaos && (this.game.matchSettings?.timeLimit ?? null) !== this.chaosKey) this.reset();
    const events = this.game.level.script && this.game.levelScript.events;
    return this.definitions.flatMap((definition, index) => {
      const active = events?.active.find(event => event.id === definition.id);
      // Keep seconds on the wire: quantizing minutes would magnify timing error by 60.
      const entry = active ? { id: definition.id, tone: definition.tone, side: active.state.side, atMinutes: active.state.launchAt / 60 }
        : events?.started.includes(definition.id) ? null : definition;
      return entry && entry.atMinutes !== null ? [{ ...entry, index }] : [];
    });
  }
  capture() { return { hits: [...this.hits] }; }
  apply(data) { this.hits = this.definitions.map((_, i) => data?.hits?.[i] || 0); }
  signature() {
    const game = this.game;
    return `${game.active && !game.ended ? this.entries().map(entry => `${entry.id}:${roadSignFrame(entry, game.elapsed, game.homeTruck, game.level.road)?.phase || '-'}`).join(',') : '-'}:${this.hits.join(',')}:${game.players.map(player => player.roadSignAttachment?.id || '-').join(',')}`;
  }
  update(dt, oldPositions) {
    const game = this.game;
    if (!game.active || game.viewOnly || game.paused || game.ended || game.roundStage !== 'playing') return;
    const start = game.elapsed, end = game.clock.mode === 'unlimited' ? start + dt : Math.min(start + dt, start + game.remaining), home = game.homeTruck;
    const entries = this.entries();
    for (const entry of entries) {
      const { index } = entry;
      const launch = entry.atMinutes * 60, finish = launch + ROAD_SIGN_PASS_SECONDS;
      const from = Math.max(start, launch), to = Math.min(end, finish);
      if (to <= from+1e-9) continue;
      const a = roadSignFrame(entry, from, home, game.level.road), b = { ...a, x: a.x - (to - from) * ROAD_SIGN.speed };
      for (const [slot, player] of game.players.entries()) {
        if (this.hits[index] & (1 << slot) || player.occupied === false || player.swallowedBy || !['ground', 'air'].includes(player.state)) continue;
        const old = oldPositions[slot], alpha0 = (from-start)/dt, alpha1 = (to-start)/dt;
        const p0 = old.clone().lerp(player.pos, alpha0), p1 = old.clone().lerp(player.pos, alpha1);
        const centerY = a.y + ROAD_SIGN.height / 2;
        const relative = (p, frame) => [p.x-frame.x, p.y+ROAD_SIGN.playerHeight/2-centerY, p.z-frame.z];
        if (!sweep(relative(p0, a), relative(p1, b), [ROAD_SIGN.thickness/2+ROAD_SIGN.playerRadius,
          (ROAD_SIGN.height+ROAD_SIGN.playerHeight)/2, a.width/2+ROAD_SIGN.playerRadius])) continue;
        this.hits[index] |= 1 << slot;
        const offset = [-ROAD_SIGN.thickness/2-.14, .1,
          Math.max(-a.width/2+.35, Math.min(a.width/2-.35, player.pos.z-a.z))];
        // Death and inventory release use the same authority path as other hazards. No shove/survival state.
        player.fallOut('road-sign');
        game.releasePouch(player);
        player.roadSignAttachment = { id: entry.id, offset };
        player.pos.set(b.x+offset[0], b.y+offset[1], b.z+offset[2]);
        player.vel.set(-ROAD_SIGN.speed, 0, 0); player.yaw = Math.PI;
        player.lean.rotation.set(0, 0, 0);
        player.useAction = ''; player.throwCancelled = !!player.throwWasDown;
        if (player.heldTool) player.heldTool.charge = 0;
        player.root.position.copy(player.pos);
      }
    }
    // Leaving the play area releases the attachment, independently of respawn.
    for (const player of game.players) if (player.roadSignAttachment) {
      const entry = entries.find(entry => entry.id === player.roadSignAttachment.id);
      if (!entry || end >= entry.atMinutes*60+ROAD_SIGN_PASS_SECONDS-1e-9) {
        player.roadSignAttachment = null;
        player.vel.set(0, 0, 0);
      }
    }
  }
}
