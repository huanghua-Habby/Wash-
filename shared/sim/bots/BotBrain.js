/** Bot work loop (host only): choose a job from this team's orders, fetch the matching tool, reach a legal work
 * spot, hold J until the shared stain step changes, wash dirty towels, put away tools nobody needs, and wait at the
 * bot's home spot otherwise. Every outcome is read back from the shared world; nothing is decided here but inputs.
 * With a difficulty profile (BOTS.md §14) it is human: slow and varied thinking, a not-always-best job, loose
 * reservations, a drifting water aim, it slaps back at an enemy who slapped it, and with no job it makes mischief
 * (chaos mode: hunt an enemy down, or wander, hop, look around and emote) instead of standing still. */
import * as THREE from 'three';
import { WASH_CONFIG as C } from '../washConfig.js';
import { navRegions, regionAt, regionOf, clampInto, levelOf, NAV } from './BotNavigation.js';
import { SOAP_BOX_SOLID, SOLID_RADIUS } from '../ToolModels.js';
import { SLAP, slapTarget } from '../Slap.js';
import { ROAD_SIGN, roadSignFrame } from '../RoadSigns.js';

const THINK_SECONDS = 0.4, RESERVE_SECONDS = 1.2, WORK_TIMEOUT = 6, FETCH_TIMEOUT = 8, COOLDOWN_SECONDS = 4;
// Retaliation (BOTS.md §14.4): give up after this long or once the slapper is this far away.
const GRUDGE_SECONDS = 4, GRUDGE_RANGE = 6, AIM_DRIFT_SECONDS = 1.5;
// Chaos mode (BOTS.md §14.5): a hunt lasts up to this long within this range, then that target gets a breather.
const HUNT_SECONDS = 6, HUNT_RANGE = 12, HUNT_REST_SECONDS = 5;
const ANTICS = ['wander', 'hop', 'look', 'emote'], CHEERS = ['nice', 'hi', 'laugh', 'wow', 'here'];
// Distraction (BOTS.md §14.7): an enemy stepping this close to a working bot may pull it into a scuffle.
const DISTRACT_RANGE = 3;
// Road signs (BOTS.md §14.9): extra side margin around a sign's swept lane box.
const SIGN_MARGIN = 0.5;
// §14.8: a stroll lasts 5–10 s; a slap from another bot is answered half as often (breaks bot-on-bot feud chains).
const ROAM_SECONDS = [5, 10], BOT_FEUD = 0.5;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

/** Reservations shared by one team's bots: a stain step or a tool picked by one bot is skipped by the others.
 * It also records who is hunting whom, so one enemy is never mobbed by more than `huntCap` bots of the team. */
export class BotTaskBoard {
  constructor() { this.entries = new Map(); this.hunts = new Map(); this.time = 0; }
  hunt(slot, target) { if (target === null) this.hunts.delete(slot); else this.hunts.set(slot, target); }
  hunters(target, except) { let count = 0; for (const [slot, prey] of this.hunts) if (prey === target && slot !== except) count++; return count; }
  tick(dt) { this.time += dt; for (const [key, entry] of this.entries) if (entry.until < this.time) this.entries.delete(key); }
  takenByOther(key, slot) { const entry = this.entries.get(key); return !!entry && entry.slot !== slot; }
  reserve(key, slot) { if (key) this.entries.set(key, { slot, until: this.time + RESERVE_SECONDS }); }
  release(slot) { for (const [key, entry] of this.entries) if (entry.slot === slot) this.entries.delete(key); this.hunts.delete(slot); }
}

const stainKey = (order, stain) => `stain:${order.serial}:${order.generation}:${order.stains.indexOf(stain)}:${stain.stage}`;
const toolKey = (team, tool) => `tool:${team}:${tool.id}`;
/** Co-op orders and players have no team (null); versus compares red/blue. */
const sameTeam = (order, team) => (order.team ?? null) === (team ?? null);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
/** Whether a body standing at `p` is inside the box a road sign sweeps: its lane (half the board plus a margin) at a
 * height where the board and the body overlap. */
const signPath = (p, frame) => Math.abs(p.z - frame.z) < frame.width / 2 + ROAD_SIGN.playerRadius + SIGN_MARGIN &&
  p.y + ROAD_SIGN.playerHeight > frame.y && p.y < frame.y + ROAD_SIGN.height;

export class BotBrain {
  /** `profile`/`random` (BotDifficulty.js) make the bot human; without a profile it keeps the exact v1 behaviour.
   * @param {number} slot @param {BotTaskBoard} board @param {any} [profile] @param {any} [random] */
  constructor(slot, board, profile = null, random = Math.random) {
    this.slot = slot; this.board = board; this.task = null; this.think = (slot % 4) * 0.1; this.cooldown = new Map(); this.toggle = 0;
    this.profile = profile; this.random = random; this.grudge = null; this.seenSlapped = null; this.emote = '';
    this.act = null; this.rest = new Map(); // chaos act in progress; hunted slot → time it may be hunted again
    // §14.7: a job noticed during mischief waits for the act and an "oh right" pause; enemies within reach last tick.
    this.noticed = false; this.recalled = false; this.near = new Set(); this.wiping = false;
    // §14.9: road sign id → time this bot notices its warning; the sign being dodged and the safe spot.
    this.signs = new Map(); this.dodging = null;
    this.aim = { angle: 0, range: 0, toAngle: 0, toRange: 0, next: 0 };
  }

  update(player, sim, dt, motor) {
    const g = sim.game, out = { move: { x: 0, z: 0 }, jump: false, press: [], hold: [] };
    for (const [key, until] of this.cooldown) if (until < this.board.time) this.cooldown.delete(key);
    this.noticeSlap(player, sim);
    const wasWiping = this.wiping; this.wiping = false;
    if (!['ground', 'air'].includes(player.state) || !g.active || g.ended) { motor.stop(); this.task = null; this.grudge = null; this.endAct(); return out; }
    // A noticed road sign about to sweep this bot's lane beats everything else (§14.9).
    if (this.watchSigns(player, g)) { this.endAct(); return this.dodge(player, g, motor, g.activeTrucks(), dt, out); }
    if (this.grudge) { this.endAct(); return this.retaliate(player, sim, motor, g.activeTrucks(), dt, out); }
    this.think -= dt;
    if (!this.valid(player, g)) { this.choose(player, g); this.think = this.thinkTime(); }
    else if (this.think <= 0) {
      // v1 re-ranks every think; a person sticks with a job that still works and only looks again when idle.
      if (!this.profile || this.task.kind === 'idle') this.choose(player, g);
      this.think = this.thinkTime();
    }
    const task = this.task;
    if (!task) return out;
    if (task.kind !== 'idle') this.endAct(); // the hive found work: drop whatever mischief was going on
    this.noticeNear(player, sim, task, wasWiping);
    if (this.grudge) return this.retaliate(player, sim, motor, g.activeTrucks(), dt, out);
    task.age = (task.age || 0) + dt;
    this.board.reserve(task.stainKey, this.slot); this.board.reserve(task.toolKey, this.slot);
    const trucks = g.activeTrucks();
    switch (task.kind) {
      case 'fetch': return this.fetch(player, g, task, motor, trucks, dt, out);
      case 'work': return this.work(player, g, task, motor, trucks, dt, out);
      case 'wash': return this.wash(player, g, task, motor, trucks, dt, out);
      case 'drop': return this.drop(player, g, task, motor, trucks, dt, out);
      default: return this.idle(player, g, sim, motor, trucks, dt, out);
    }
  }

  /** A task stays valid while its target still exists and the bot still holds (or still lacks) the right tool. */
  valid(player, g) {
    const task = this.task;
    if (!task) return false;
    const held = player.heldTool;
    if (task.kind === 'work') return held === task.tool && this.live(task.order, task.stain, task.step, player.team);
    if (task.kind === 'fetch') return !held && (task.tool ? !task.tool.holder && task.tool.active !== false : true) && this.live(task.order, task.stain, task.step, player.team);
    if (task.kind === 'wash') return held?.kind === 'towel' && held.durability < C.towelDurability;
    if (task.kind === 'drop') return !!held;
    return true;
  }
  live(order, stain, step, team) {
    return !!order && order.mode === 'working' && sameTeam(order, team) && !stain.done && stain.steps[stain.stage] === step && order.truck.group.visible;
  }

  thinkTime() { return this.profile ? this.random.range(this.profile.think) : THINK_SECONDS; }

  /** The cheapest entry, or (human) one of the cheapest `topK` drawn with weights 1, ½, ¼… from a list sorted by cost. */
  pick(sorted) {
    if (!this.profile || sorted.length < 2) return sorted[0];
    const k = Math.min(this.profile.topK, sorted.length);
    let total = 0; for (let i = 0; i < k; i++) total += 0.5 ** i;
    let roll = this.random() * total;
    for (let i = 0; i < k; i++) { roll -= 0.5 ** i; if (roll < 0) return sorted[i]; }
    return sorted[k - 1];
  }

  choose(player, g) {
    const previous = this.task, held = player.heldTool, team = player.team;
    // Now and then a person ignores what a teammate is already doing.
    this.loose = !!this.profile && this.random() < this.profile.ignoreBoard;
    // `claimed`: steps a teammate reserved; a bot already holding the right tool may take one over (below).
    const needs = [], claimed = [];
    for (const order of g.orders) {
      if (order.mode !== 'working' || !sameTeam(order, team) || order.arrivalProgress < 1 || !order.truck.group.visible) continue;
      for (const stain of order.stains) {
        if (stain.done) continue;
        const key = stainKey(order, stain);
        if (this.cooldown.has(key)) continue;
        if (this.taken(key)) { claimed.push({ order, stain, step: stain.steps[stain.stage], key }); continue; }
        needs.push({ order, stain, step: stain.steps[stain.stage], key, at: stain.mesh.getWorldPosition(new THREE.Vector3()) });
      }
    }
    let task = null;
    if (held) {
      if (held.kind === 'towel' && held.dirty) task = { kind: 'wash' };
      else {
        let match = this.pick(needs.filter((need) => need.step === held.kind).sort((a, b) => flat(player.pos, a.at) - flat(player.pos, b.at)));
        // A teammate reserved this step but is still fetching (its hands lack the tool, e.g. the box's only soap is in
        // ours): take the step over instead of both waiting on each other.
        if (!match) {
          const over = claimed.find((need) => need.step === held.kind && g.players[this.board.entries.get(need.key)?.slot]?.heldTool?.kind !== held.kind);
          if (over) match = { ...over, at: over.stain.mesh.getWorldPosition(new THREE.Vector3()) };
        }
        if (match) task = { kind: 'work', tool: held, order: match.order, stain: match.stain, step: match.step, stainKey: match.key };
        else if (held.kind === 'towel' && held.durability < C.towelDurability) task = { kind: 'wash' };
        else task = { kind: 'drop' };
      }
    } else {
      const options = [];
      for (const need of needs) for (const source of this.sources(g, need.step, team))
        options.push({ cost: flat(player.pos, source.at) + 0.5 * flat(source.at, need.at), need, source });
      const best = this.pick(options.sort((a, b) => a.cost - b.cost));
      if (best) task = { kind: 'fetch', tool: best.source.tool, hose: best.source.hose, box: best.source.box, order: best.need.order, stain: best.need.stain,
        step: best.need.step, stainKey: best.need.key, toolKey: best.source.tool ? toolKey(team, best.source.tool) : null };
    }
    // Keep the current job unless the new one is a different job (avoids flip-flopping between equal choices).
    if (previous && task && previous.kind === task.kind && previous.stain === task.stain && previous.tool === task.tool) return;
    // Still nothing to do: keep the idle task, its chaos act and the hunt claim on the board.
    if (!task && previous?.kind === 'idle') { this.noticed = this.recalled = false; return; }
    // Absorbed in mischief (§14.7): a job waits until the current act and a moment of "oh right" are over.
    if (task && this.profile && previous?.kind === 'idle' && this.act && !this.recalled) { this.noticed = true; return; }
    this.noticed = this.recalled = false;
    if (previous && previous !== task) this.board.release(this.slot);
    this.task = task || { kind: 'idle' };
  }

  taken(key) { return !this.loose && this.board.takenByOther(key, this.slot); }

  /** Where a tool of `kind` can be had: free items on a vehicle, the soap box, or the hose post for a stray gun. */
  sources(g, kind, team) {
    const sources = [];
    for (const tool of g.tools) {
      if (tool.kind !== kind || !g.equipmentEnabled(kind) || tool.holder || tool.swallowedBy || tool.active === false) continue;
      if (kind === 'towel' && tool.dirty) continue;
      if (this.taken(toolKey(team, tool)) || this.cooldown.has(toolKey(team, tool))) continue;
      if (tool.truck && tool.truck.group.visible) sources.push({ tool, at: tool.worldPosition(new THREE.Vector3()) });
      else if (kind === 'water' && !tool.truck) {
        const hose = g.hoses[g.waterguns.indexOf(tool)];
        if (hose) sources.push({ tool, hose, at: hose.anchor(new THREE.Vector3()) });
      }
    }
    if (kind === 'soap' && g.equipmentEnabled('soap') && g.equipment.soap.enabled && g.soapAvailable)
      sources.push({ box: true, at: g.soapBox.getWorldPosition(new THREE.Vector3()) });
    return sources;
  }

  fetch(player, g, task, motor, trucks, dt, out) {
    if (task.age > FETCH_TIMEOUT) return this.giveUp(task, out);
    const home = g.homeTruck;
    const target = task.box ? g.soapBox.getWorldPosition(_v) : task.hose ? task.hose.anchor(_v) : task.tool.worldPosition(_v);
    const truck = task.box || task.hose ? home : task.tool.truck;
    if (!truck) return out;
    // The soap crate is solid: walk up to its near side instead of into its middle.
    // Stand at the middle of its long side (front or back, whichever is nearer): within reach, outside the solid.
    if (!task.offset && task.box) task.offset = { x: 0, z: Math.sign(player.pos.z - target.z || 1) * (SOAP_BOX_SOLID.hz + SOLID_RADIUS + 0.06) };
    const offset = task.offset || { x: 0, z: 0 };
    motor.setGoal(truck, target.x + offset.x - truck.pos.x, target.z + offset.z - truck.pos.z, 0.45);
    Object.assign(out, motor.update(player, trucks, dt), { press: [], hold: [] });
    const reach = task.box ? g.equipment.soap.interactionRange * 0.85 : task.hose ? task.hose.recallRange * 0.85 : C.pickupRange * 0.8;
    if (player.state === 'ground' && player.ground?.truck === truck && flat(player.pos, target) < reach) {
      // Ask the shared rule what J would take right now; a nearer item would be grabbed instead of the one wanted.
      const chosen = g.emptyHandTarget(player).tool;
      const right = task.box ? !chosen && g.nearSoapBox(player) : chosen === task.tool;
      if (right) {
        // Tap J on alternate ticks so each tap is a fresh press edge.
        this.toggle = (this.toggle + 1) % 2;
        if (this.toggle) out.press.push('KeyJ');
        out.move.x *= 0.2; out.move.z *= 0.2;
      } else if (chosen) {
        // Come at the target from the side away from the item in the way.
        const away = chosen.worldPosition(_w), dx = target.x - away.x, dz = target.z - away.z, length = Math.hypot(dx, dz) || 1;
        task.offset = { x: dx / length * 0.7, z: dz / length * 0.7 };
      }
    }
    return out;
  }

  work(player, g, task, motor, trucks, dt, out) {
    if (task.age > WORK_TIMEOUT + 4 * task.stain.steps.length) return this.giveUp(task, out);
    const truck = task.order.truck, stain = task.stain, at = stain.mesh.getWorldPosition(_v);
    if (task.step === 'water') return this.spray(player, g, task, motor, trucks, dt, out, at);
    motor.setGoal(truck, at.x - truck.pos.x, at.z - truck.pos.z, 0.55);
    Object.assign(out, motor.update(player, trucks, dt), { press: [], hold: [] });
    if (player.state === 'ground' && player.ground?.truck === truck && g.nearestStain(player)) {
      out.move.x = out.move.z = 0; out.hold.push('KeyJ'); this.wiping = true;
    }
    return out;
  }

  /** Water step: stand on a roof (the order's own, if it fits) a short way from the stain, face its current position and
   * meter the jet with J: release while the real jet overshoots, hold while it falls short. Pressure sets the reach,
   * so no fixed throw distance is assumed and a drifting order vehicle carries the bot along with its stain. */
  spray(player, g, task, motor, trucks, dt, out, at) {
    const gun = task.tool;
    if (!task.spot || task.spotAge > 4) { task.spot = this.sprayingSpot(player, g, gun, at, task.order.truck); task.spotAge = 0; }
    task.spotAge += dt;
    if (!task.spot) return this.giveUp(task, out);
    const { region } = task.spot, x = region.truck.pos.x + task.spot.lx, z = region.truck.pos.z + task.spot.lz;
    const standing = player.state === 'ground' && player.ground?.truck === region.truck;
    const distance = Math.hypot(player.pos.x - x, player.pos.z - z);
    if (!standing || distance > 0.45) {
      motor.setGoal(region.truck, task.spot.lx, task.spot.lz, 0.25);
      return Object.assign(out, motor.update(player, trucks, dt), { press: [], hold: [] });
    }
    this.wiping = true; // at the spraying spot: busy with the jet, not distracted
    const drift = this.drift(dt), dx0 = at.x - player.pos.x, dz0 = at.z - player.pos.z;
    const c = Math.cos(drift.angle), s = Math.sin(drift.angle), dx = dx0 * c - dz0 * s, dz = dx0 * s + dz0 * c;
    const facing = Math.atan2(-dz, dx), error = Math.atan2(Math.sin(facing - player.yaw), Math.cos(facing - player.yaw));
    if (Math.abs(error) > 0.12) motor.face(out, dx, dz);
    const nozzle = gun.nozzle(_w), want = Math.hypot(at.x - nozzle.x, at.z - nozzle.z) + drift.range;
    const land = Math.hypot(gun.sprayTarget.x - nozzle.x, gun.sprayTarget.z - nozzle.z);
    const flowing = gun.pressure > 0 && gun.sprayNodes.length > 1;
    if (gun.hitStain === task.stain || !flowing || land < want) out.hold.push('KeyJ');
    return out;
  }

  /** Human aim error: every ~1.5 s a new angle/range offset within the profile's limits, eased toward smoothly. */
  drift(dt) {
    const aim = this.aim;
    if (!this.profile) return aim;
    aim.next -= dt;
    if (aim.next <= 0) {
      aim.next = AIM_DRIFT_SECONDS;
      aim.toAngle = (this.random() * 2 - 1) * this.profile.aimAngle; aim.toRange = (this.random() * 2 - 1) * this.profile.aimRange;
    }
    const ease = Math.min(1, dt * 1.5);
    aim.angle += (aim.toAngle - aim.angle) * ease; aim.range += (aim.toRange - aim.range) * ease;
    return aim;
  }

  /** A standing point 1.4–2.8 m from the stain, inside a platform and the hose, preferring the stain's own vehicle. */
  sprayingSpot(player, g, gun, at, stainTruck) {
    const regions = navRegions(g.activeTrucks()), hose = g.hoses[g.waterguns.indexOf(gun)], anchor = hose?.anchor(new THREE.Vector3());
    let best = null;
    for (const reach of [1.9, 2.4, 1.5, 2.8]) for (let k = 0; k < 16; k++) {
      const angle = k * Math.PI / 8, x = at.x - Math.cos(angle) * reach, z = at.z - Math.sin(angle) * reach;
      for (const region of regions) {
        const p = clampInto(region, x, z, NAV.inset + 0.15);
        if (Math.hypot(p.x - x, p.z - z) > 0.05) continue;
        if (anchor && Math.hypot(p.x - anchor.x, p.z - anchor.z) > C.hoseLength - 1) continue;
        const cost = flat(player.pos, p) + (region.truck === stainTruck ? 0 : 3) + Math.abs(reach - 1.9);
        if (!best || cost < best.cost) best = { cost, region, lx: p.x - region.truck.pos.x, lz: p.z - region.truck.pos.z };
      }
    }
    return best;
  }

  wash(player, g, task, motor, trucks, dt, out) {
    if (!g.equipmentEnabled('station')) return this.drop(player, g, task, motor, trucks, dt, out);
    const home = g.homeTruck, station = g.station.getWorldPosition(_v);
    // Stand on the deck side of the basin, clear of its solid cabinet.
    const spot = clampInto(regionAt(navRegions(trucks), home, station.x + 1.1, station.z), station.x + 1.1, station.z, NAV.inset);
    motor.setGoal(home, spot.x - home.pos.x, spot.z - home.pos.z, 0.3);
    Object.assign(out, motor.update(player, trucks, dt), { press: [], hold: [] });
    if (player.state === 'ground' && g.nearStation(player)) { out.move.x = out.move.z = 0; out.hold.push('KeyJ'); this.wiping = true; }
    return out;
  }

  /** Put a tool nobody needs back on the central truck near where it lives, with a K tap. */
  drop(player, g, task, motor, trucks, dt, out) {
    // Back where it lives (towels by the basin, the gun by its post, soap by its box), clear of other pickups.
    const home = g.homeTruck, held = player.heldTool, origin = held.originalPosition || { x: 0, z: 0 };
    motor.setGoal(home, origin.x, origin.z, 0.45);
    Object.assign(out, motor.update(player, trucks, dt), { press: [], hold: [] });
    if (motor.status === 'arrived' && player.state === 'ground') {
      this.toggle = (this.toggle + 1) % 2;
      if (this.toggle) out.press.push('KeyK');
    }
    return out;
  }

  /** Nothing to do: an exact (v1) bot waits at its home spot on the central truck; a human bot makes mischief. */
  idle(player, g, sim, motor, trucks, dt, out) {
    if (this.profile) return this.chaos(player, g, sim, motor, trucks, dt, out);
    const home = g.homeTruck, slot = sim.level.home.playerSlots[this.slot] || [0, 0];
    motor.setGoal(home, slot[0], slot[1], 0.4);
    return Object.assign(out, motor.update(player, trucks, dt), { press: [], hold: [] });
  }

  /** Chaos mode (BOTS.md §14.5): one short act after another — a hunt (versus, by `aggression`) or an antic. */
  chaos(player, g, sim, motor, trucks, dt, out) {
    if (!this.act || this.act.done) { motor.stop(); this.act = this.nextAct(player, g, sim); } // a fresh act starts from a clean motor status
    const act = this.act;
    act.age += dt;
    if (act.kind === 'hunt') return this.hunt(player, sim, motor, trucks, dt, out, act);
    if (act.age > act.seconds) { act.done = true; return out; }
    if (act.kind === 'roam') return this.roam(player, g, motor, trucks, dt, out, act);
    if (act.kind === 'hop') {
      act.next -= dt;
      if (act.next <= 0 && player.state === 'ground') { out.jump = true; act.next = 0.45 + this.random() * 0.2; }
      return out;
    }
    if (act.kind === 'look') {
      act.next -= dt;
      if (act.next <= 0) { act.yaw = this.random() * Math.PI * 2; act.next = 0.5 + this.random() * 0.4; }
      motor.face(out, Math.cos(act.yaw), -Math.sin(act.yaw));
      return out;
    }
    // Wander (an emote starts with a cheer): stroll to a random point on the platform the bot stands on.
    if (!act.spot) {
      const here = player.state === 'ground' ? regionOf(navRegions(trucks), player) : null;
      if (!here) return out;
      const { plat, truck } = here;
      const p = clampInto(here, truck.pos.x + plat.x0 + this.random() * (plat.x1 - plat.x0), truck.pos.z + plat.z0 + this.random() * (plat.z1 - plat.z0), NAV.inset);
      act.spot = { truck, x: p.x - truck.pos.x, z: p.z - truck.pos.z };
    }
    motor.setGoal(act.spot.truck, act.spot.x, act.spot.z, 0.35);
    Object.assign(out, motor.update(player, trucks, dt), { press: [], hold: [] });
    if (motor.status === 'arrived' || motor.status === 'unreachable' || motor.status === 'stuck') act.done = true;
    return out;
  }

  /** Stroll (§14.8): walk to a random point on any settled roof — the central truck or a docked, working order — jumping
   * or climbing as needed; look around a moment on arrival, then pick another, until the stroll's time is up. */
  roam(player, g, motor, trucks, dt, out, act) {
    if (act.next > 0) { act.next -= dt; motor.face(out, Math.cos(act.yaw), -Math.sin(act.yaw)); return out; }
    if (!act.spot) {
      const settled = navRegions(trucks).filter((r) => r.truck === g.homeTruck || g.orders.some((o) => o.truck === r.truck && o.mode === 'working' && o.arrivalProgress >= 1));
      const region = settled[Math.floor(this.random() * settled.length)];
      if (!region) return out;
      const { plat, truck } = region;
      const p = clampInto(region, truck.pos.x + plat.x0 + this.random() * (plat.x1 - plat.x0), truck.pos.z + plat.z0 + this.random() * (plat.z1 - plat.z0), NAV.inset);
      act.spot = { truck, x: p.x - truck.pos.x, z: p.z - truck.pos.z };
    }
    motor.setGoal(act.spot.truck, act.spot.x, act.spot.z, 0.4);
    Object.assign(out, motor.update(player, trucks, dt), { press: [], hold: [] });
    if (['arrived', 'unreachable', 'stuck'].includes(motor.status)) {
      // Arrived (or no way there): a short look around, then somewhere else.
      if (motor.status === 'arrived') { act.next = 0.5 + this.random() * 0.5; act.yaw = this.random() * Math.PI * 2; }
      act.spot = null; motor.stop();
    }
    return out;
  }

  nextAct(player, g, sim) {
    if (this.noticed && !this.recalled) {
      // The act is over and a job is waiting: stand and look around for `recall` seconds, then take it.
      const pause = (seconds) => ({ kind: 'look', recall: true, age: 0, seconds, next: 0, yaw: 0, spot: null });
      if (!this.act?.recall) return pause(this.random.range(this.profile.recall));
      this.recalled = true; this.think = 0;
      return pause(0.5);
    }
    const versus = (player.team ?? null) !== null;
    if (versus && this.random() < this.profile.aggression) {
      const prey = this.huntTarget(player, g, sim);
      if (prey) {
        this.board.hunt(this.slot, prey.slot);
        return { kind: 'hunt', target: prey.player, slot: prey.slot, swings: 2 + Math.floor(this.random() * 3), serial: player.slapSerial, age: 0 };
      }
    }
    if (this.random() < 0.5) return { kind: 'roam', age: 0, seconds: this.random.range(ROAM_SECONDS), next: 0, yaw: 0, spot: null };
    const kind = ANTICS[Math.floor(this.random() * ANTICS.length)];
    if (kind === 'emote') this.emote = CHEERS[Math.floor(this.random() * CHEERS.length)];
    return { kind, age: 0, seconds: 2 + this.random() * 2, next: 0, yaw: 0, spot: null };
  }

  /** An enemy worth chasing: standing on a roof platform within range, not mobbed already, not just hunted.
   * Cheapest first: distance, minus 4 for an item in hand (a hit always knocks it loose), minus 3 on this team's order. */
  huntTarget(player, g, sim) {
    const options = [];
    sim.players.forEach((other, slot) => {
      if (!this.huntable(player, other)) return;
      const distance = flat(player.pos, other.pos);
      if (distance > HUNT_RANGE || (this.rest.get(slot) || 0) > this.board.time) return;
      if (this.board.hunters(slot, this.slot) >= this.profile.huntCap) return;
      const onOurOrder = g.orders.some((order) => order.truck === other.ground.truck && sameTeam(order, player.team));
      options.push({ player: other, slot, cost: distance - (other.heldTool ? 4 : 0) - (onOurOrder ? 3 : 0) });
    });
    return this.pick(options.sort((a, b) => a.cost - b.cost)) || null;
  }

  /** An enemy a bot may go after: on a roof platform (not a prop, a head or a ladder) and not swallowed. */
  huntable(player, other) {
    if (other === player || !other.occupied || other.swallowedBy || other.state !== 'ground' || other.wall) return false;
    if ((other.team ?? null) === null || other.team === player.team) return false;
    return !!other.ground && !(other.ground.solid >= 0) && other.ground.stand === undefined;
  }

  /** §14.7: each enemy newly within 3 m of a bot on its way somewhere (not while wiping) may start a 1–2 swing scuffle. */
  noticeNear(player, sim, task, wiping) {
    const near = new Set();
    sim.players.forEach((other, slot) => { if (this.huntable(player, other) && flat(player.pos, other.pos) < DISTRACT_RANGE) near.add(slot); });
    const before = this.near; this.near = near;
    if (!this.profile || this.grudge || task.kind === 'idle' || wiping) return;
    for (const slot of near) {
      if (before.has(slot) || this.random() >= this.profile.distract || this.board.hunters(slot, this.slot) >= this.profile.huntCap) continue;
      // Like a slap-back without the angry face: put the item down, go over, swing once or twice.
      this.board.hunt(this.slot, slot);
      this.grudge = { target: sim.players[slot], swings: this.random() < 0.5 ? 1 : 2, age: 0, delay: 0, angry: true, serial: player.slapSerial };
      return;
    }
  }

  hunt(player, sim, motor, trucks, dt, out, act) {
    const target = act.target;
    if (player.slapSerial !== act.serial) { act.swings -= player.slapSerial - act.serial; act.serial = player.slapSerial; }
    const down = !target.occupied || !['ground', 'air'].includes(target.state) || target.swallowedBy;
    const lost = motor.status === 'unreachable' || motor.status === 'stuck';
    if (act.swings <= 0 || down || lost || act.age > HUNT_SECONDS || flat(player.pos, target.pos) > HUNT_RANGE) {
      this.rest.set(act.slot, this.board.time + HUNT_REST_SECONDS); this.endAct(); motor.stop();
      return out;
    }
    return this.brawl(player, sim, motor, trucks, dt, out, target);
  }

  endAct() { if (this.act) { this.act = null; this.board.hunt(this.slot, null); } }

  /** A new slap on this bot: an enemy slapper may earn 1–2 swings back (more while they keep hitting); teammates are ignored. */
  noticeSlap(player, sim) {
    const serial = player.slappedSerial || 0;
    if (this.seenSlapped === null || serial <= this.seenSlapped) { this.seenSlapped = serial; return; }
    this.seenSlapped = serial;
    const by = player.slappedBy, attacker = sim.players[by];
    if (!this.profile || !attacker || attacker === player || (attacker.team ?? null) === (player.team ?? null)) return;
    const swings = this.random() < 0.5 ? 1 : 2, feud = sim.isBotControlled?.(by) ? BOT_FEUD : 1;
    if (this.grudge?.target === attacker) { if (this.random() < feud) { this.grudge.swings += swings; this.grudge.age = 0; } return; }
    if (this.random() >= this.profile.retaliate * feud) return;
    this.grudge = { target: attacker, swings, age: 0, delay: this.random.range(this.profile.reaction), angry: false, serial: player.slapSerial };
  }

  /** Turn on the slapper with an angry emote, drop whatever is in hand, close in and swing with K until the swings are spent. */
  retaliate(player, sim, motor, trucks, dt, out) {
    const grudge = this.grudge, target = grudge.target;
    grudge.age += dt;
    const dx = target.pos.x - player.pos.x, dz = target.pos.z - player.pos.z, distance = Math.hypot(dx, dz);
    if (player.slapSerial !== grudge.serial) { grudge.swings -= player.slapSerial - grudge.serial; grudge.serial = player.slapSerial; }
    const down = !target.occupied || !['ground', 'air'].includes(target.state) || target.swallowedBy;
    if (grudge.swings <= 0 || down || grudge.age > GRUDGE_SECONDS || distance > GRUDGE_RANGE) {
      this.grudge = null; this.think = 0; motor.stop(); this.board.hunt(this.slot, null);
      return out;
    }
    if (grudge.delay > 0) { grudge.delay -= dt; return out; }
    if (!grudge.angry) { grudge.angry = true; this.emote = 'angry'; }
    return this.brawl(player, sim, motor, trucks, dt, out, target);
  }

  /** Close in on `target` and swing at it with K: put any held item down first, finish a ladder climb, then walk up. */
  brawl(player, sim, motor, trucks, dt, out, target) {
    const dx = target.pos.x - player.pos.x, dz = target.pos.z - player.pos.z, distance = Math.hypot(dx, dz);
    this.toggle = (this.toggle + 1) % 2;
    // Only an empty hand slaps; a tap of K puts the item down first (J would pick it straight back up).
    if (player.heldTool) { if (this.toggle) out.press.push('KeyK'); motor.face(out, dx, dz); return out; }
    const close = distance < SLAP.reach * 0.9 && Math.abs(target.pos.y - player.pos.y) < SLAP.height;
    // On a ladder the motor keeps climbing (W/S toward its goal); turning there would only hang on the rungs.
    if (!close && player.wall?.ladder >= 0) return Object.assign(out, motor.update(player, trucks, dt), { press: [], hold: [] });
    if (!close) {
      if (player.state !== 'ground' || target.state !== 'ground' || !target.ground?.truck) { motor.face(out, dx, dz); return out; }
      const truck = target.ground.truck;
      motor.setGoal(truck, target.pos.x - truck.pos.x, target.pos.z - truck.pos.z, SLAP.reach * 0.6);
      return Object.assign(out, motor.update(player, trucks, dt), { press: [], hold: [] });
    }
    motor.stop(); motor.face(out, dx, dz);
    // Swing on alternate ticks so K is let go in between (a drop leaves the slap unarmed until K is released).
    if (this.toggle && slapTarget(player, sim.players) === target && player.slapCooldown <= 0) out.press.push('KeyK');
    return out;
  }

  /** Whether a road sign this bot has noticed is still to sweep past it and it stands (or still stands) in its path.
   * Only the public warning is read: lane, timing and sign size, as every player sees them (§14.9). */
  watchSigns(player, g) {
    if (!this.profile || !g.roadSigns) return false;
    const now = this.board.time, seen = new Set();
    let threat = null;
    for (const entry of g.roadSigns.entries()) {
      const frame = roadSignFrame(entry, g.elapsed, g.homeTruck, g.level.road);
      if (!frame) continue;
      seen.add(entry.id);
      if (!this.signs.has(entry.id)) this.signs.set(entry.id, now + this.random.range(this.profile.signReaction));
      if (now < this.signs.get(entry.id)) continue; // not noticed yet: a person reacts a moment late
      if (frame.phase === 'passing' && frame.x < player.pos.x - 1) continue; // already swept past
      if (this.dodging?.id === entry.id || signPath(player.pos, frame)) threat = threat && threat.remaining <= frame.remaining ? threat : { ...frame };
    }
    for (const id of this.signs.keys()) if (!seen.has(id)) this.signs.delete(id);
    if (!threat) { if (this.dodging) { this.dodging = null; this.think = 0; } return false; }
    if (this.dodging?.id !== threat.id) this.dodging = { id: threat.id, frame: threat, spot: null };
    this.dodging.frame = threat;
    return true;
  }

  /** Walk (or jump) to the nearest point out of the sign's path, on the central truck when it is clear; wait there. */
  dodge(player, g, motor, trucks, dt, out) {
    const dodging = this.dodging, frame = dodging.frame;
    if (!dodging.spot) {
      const regions = navRegions(trucks), home = regions.filter((r) => r.truck === g.homeTruck);
      dodging.spot = this.safeSpot(player, home, frame) || this.safeSpot(player, regions, frame);
      if (!dodging.spot) return out; // nowhere clear: stay put (the sign may still miss)
    }
    const { truck, x, z } = dodging.spot;
    motor.setGoal(truck, x, z, 0.3);
    return Object.assign(out, motor.update(player, trucks, dt), { press: [], hold: [] });
  }

  /** Nearest point of `regions` (a 5 × 5 sample each) whose standing body is clear of the sign's path. */
  safeSpot(player, regions, frame) {
    let best = null;
    for (const region of regions) {
      const { truck, plat } = region, y = levelOf(region);
      for (let i = 0; i < 5; i++) for (let k = 0; k < 5; k++) {
        const p = clampInto(region, truck.pos.x + plat.x0 + (plat.x1 - plat.x0) * (i + 0.5) / 5, truck.pos.z + plat.z0 + (plat.z1 - plat.z0) * (k + 0.5) / 5, NAV.inset);
        if (signPath({ x: p.x, y, z: p.z }, frame)) continue;
        const cost = flat(player.pos, p);
        if (!best || cost < best.cost) best = { cost, truck, x: p.x - truck.pos.x, z: p.z - truck.pos.z };
      }
    }
    return best;
  }

  /** Stop chasing a target that does not work out; cool it down so the next choice differs. */
  giveUp(task, out) {
    for (const key of [task.stainKey, task.toolKey]) if (key) this.cooldown.set(key, this.board.time + COOLDOWN_SECONDS);
    this.board.release(this.slot); this.task = null; this.think = 0;
    return out;
  }
}
