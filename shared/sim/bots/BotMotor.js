/** Turns a navigation goal into the same inputs a player gives: a world move axis and a Space press for jumps.
 * Plans over the live platform graph, walks around roof props, jumps between vehicles at the planned edge,
 * steers in the air toward the landing aim on the target vehicle, and replans from wherever it really ends up. */
import { navRegions, regionOf, regionAt, regionRect, clampInto, planRoute, jumpPoints, jumpReach, solidDetour, NAV, regionRise } from './BotNavigation.js';

const REPLAN_SECONDS = 0.3, STUCK_SECONDS = 0.8, ARRIVE = 0.22, TAKEOFF_RADIUS = 0.3;

export class BotMotor {
  /** `profile`/`random` add human jump limits (BOTS.md §14.3: hesitation, a rare short jump); without them the motor is exact. */
  constructor(profile = null, random = Math.random) { this.profile = profile; this.random = random; this.clear(); }
  clear() {
    this.goal = null; this.route = null; this.replan = 0; this.air = null; this.status = 'idle'; this.hesitation = null;
    this.best = Infinity; this.stuckTime = 0; this.hops = 0; this.lastTarget = null;
  }

  /** Go to a point on `truck`, given in that vehicle's local frame so it follows the vehicle. `arrive` is the stop radius. */
  setGoal(truck, localX, localZ, arrive = ARRIVE) {
    if (this.goal && this.goal.truck === truck && Math.abs(this.goal.x - localX) < 1e-6 && Math.abs(this.goal.z - localZ) < 1e-6) return;
    this.goal = { truck, x: localX, z: localZ, arrive }; this.route = null; this.replan = 0; this.status = 'moving';
    this.best = Infinity; this.stuckTime = 0; this.hops = 0;
  }
  stop() { this.goal = null; this.route = null; this.air = null; this.status = 'idle'; }
  /** -1 (W, up) or 1 (S, down): toward the goal truck's level at the goal, or up when the goal is elsewhere. */
  ladderClimb(player) {
    const wall = player.wall, truck = wall.truck, ladder = truck.spec.ladders[wall.ladder];
    const goalTop = this.goal?.truck === truck ? truck.localTopForLocal(this.goal.x, this.goal.z, 0) : ladder.toY;
    // Heading for the upper deck (or off this vehicle): keep climbing until it steps over the top; else go down.
    return Math.abs(goalTop - ladder.toY) < Math.abs(goalTop - ladder.fromY) ? -1 : 1;
  }

  /** One fixed tick: returns { move: {x, z} (world, length ≤ 1), jump }. */
  update(player, trucks, dt) {
    const out = { move: { x: 0, z: 0 }, jump: false };
    // On a vehicle ladder (cling state with `ladder`): W up / S down toward the goal's level (axis y is move.z).
    if (player.state === 'air' && player.wall?.ladder >= 0) { out.move.z = this.ladderClimb(player); return out; }
    if (player.state === 'air') {
      if (this.air) this.steer(out, player, this.air.truck.pos.x + this.air.x, this.air.truck.pos.z + this.air.z, this.air.sloppy ? 0.5 : 1);
      return out;
    }
    if (player.state !== 'ground' || !this.goal) { this.air = null; return out; }
    if (this.air) { this.air = null; this.route = null; this.replan = 0; this.best = Infinity; }
    const regions = navRegions(trucks), here = regionOf(regions, player);
    if (!here) return out;
    const gx = this.goal.truck.pos.x + this.goal.x, gz = this.goal.truck.pos.z + this.goal.z;
    const goalRegion = regionAt(regions, this.goal.truck, gx, gz);
    this.replan -= dt;
    if (!this.route || this.replan <= 0 || (this.route[0] && this.route[0].from !== here)) {
      this.route = planRoute(regions, here, goalRegion, player.speedScale || 1); this.replan = REPLAN_SECONDS;
    }
    if (!this.route) { this.status = 'unreachable'; return out; }
    if (!this.route.length) {
      const target = clampInto(goalRegion, gx, gz, NAV.inset);
      if (Math.hypot(target.x - player.pos.x, target.z - player.pos.z) <= this.goal.arrive) { this.status = 'arrived'; return out; }
      this.status = 'moving'; this.walk(out, player, here, target.x, target.z, dt);
      return out;
    }
    this.status = 'moving';
    const step = this.route[0];
    if (step.kind === 'walk') {
      const target = clampInto(step.to, player.pos.x, player.pos.z, NAV.inset + 0.1);
      this.walk(out, player, here, target.x, target.z, dt);
      return out;
    }
    const { takeoff, landing } = jumpPoints(step.from, step.to, player.pos.x, player.pos.z);
    const toTakeoff = Math.hypot(takeoff.x - player.pos.x, takeoff.z - player.pos.z);
    if (toTakeoff > TAKEOFF_RADIUS) { this.walk(out, player, here, takeoff.x, takeoff.z, dt); return out; }
    // A person stops at the edge for a moment before leaping.
    if (this.hesitation === null) this.hesitation = this.profile ? this.random() * this.profile.hesitate : 0;
    if (this.hesitation > 0) { this.hesitation -= dt; return out; }
    // Recheck the gap at the moment of the jump: vehicles move, and a bad window means waiting rather than leaping.
    const gap = rectGapNow(step.from, step.to);
    if (gap > jumpReach(regionRise(step.from, step.to), player.speedScale || 1)) { this.route = null; this.hesitation = null; return out; }
    // A misjudged leap pushes and steers at half strength and may fall short; the fall and respawn are the shared rules.
    const sloppy = !!this.profile && this.random() < this.profile.misjump;
    if (sloppy) this.steer(out, player, landing.x, landing.z, 0.5); else this.steer(out, player, landing.x, landing.z, 1, true);
    out.jump = true; this.hesitation = null;
    this.air = { truck: step.to.truck, x: landing.x - step.to.truck.pos.x, z: landing.z - step.to.truck.pos.z, sloppy };
    return out;
  }

  /** Walk toward (tx, tz) on the current vehicle, around props; a long stall triggers a hop (over a basin or a body). */
  walk(out, player, region, tx, tz, dt) {
    const detour = solidDetour(region, player.pos.x, player.pos.z, tx, tz);
    const wx = detour ? detour.x : tx, wz = detour ? detour.z : tz, distance = Math.hypot(wx - player.pos.x, wz - player.pos.z);
    const key = `${Math.round(wx * 4)}:${Math.round(wz * 4)}`; // progress is measured toward the current waypoint
    if (key !== this.lastTarget) { this.lastTarget = key; this.best = Infinity; this.stuckTime = 0; }
    if (distance < this.best - 0.05) { this.best = distance; this.stuckTime = 0; } else this.stuckTime += dt;
    this.steer(out, player, wx, wz, distance > 0.6 ? 1 : Math.max(0.3, distance / 0.6));
    if (this.stuckTime > STUCK_SECONDS) { out.jump = true; this.stuckTime = 0; this.best = Infinity; this.hops++; if (this.hops > 4) this.status = 'stuck'; }
  }

  steer(out, player, tx, tz, magnitude, full = false) {
    const dx = tx - player.pos.x, dz = tz - player.pos.z, length = Math.hypot(dx, dz);
    if (length < 1e-6) return;
    const scale = full ? 1 : Math.min(magnitude, player.state === 'air' ? Math.min(1, length / 0.9) : 1);
    out.move.x = dx / length * scale; out.move.z = dz / length * scale;
  }

  /** Nudge the facing toward (dx, dz) without walking far: a short, slow step turns the character. */
  face(out, dx, dz) {
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) return;
    out.move.x = dx / length * 0.15; out.move.z = dz / length * 0.15;
  }
}

function rectGapNow(a, b) {
  const ra = regionRect(a), rb = regionRect(b);
  return Math.hypot(Math.max(0, ra.x0 - rb.x1, rb.x0 - ra.x1), Math.max(0, ra.z0 - rb.z1, rb.z0 - ra.z1));
}
