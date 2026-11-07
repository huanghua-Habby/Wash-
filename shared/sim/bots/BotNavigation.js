/** Bot navigation over the shared standing platforms: every visible vehicle's `platforms` rectangles form the graph,
 * walking links platforms the physics treats as continuous, and jump links are recomputed from the vehicles' current
 * positions and the shared jump physics. Nothing here moves a character; the bot motor turns plans into inputs. */
import { MOTION } from '../PlayerMotion.js';
import { SOLID_RADIUS } from '../ToolModels.js';
import { PLAYER_BODY } from '../PlayerContacts.js';
import { CHARACTER_SCALE as K } from '../characterScale.js';

/** Highest point of a standing jump (JUMP² / 2G): about 1.43 m at character scale 0.8. */
const JUMP_APEX = MOTION.jump ** 2 / (2 * MOTION.gravity);

// Body-sized margins follow the shared body and character scale (VEHICLES.md handoff 6); nothing assumes a fixed size.
export const NAV = Object.freeze({
  inset: 0.8 * PLAYER_BODY.radius, // Standing targets stay this far inside a platform edge.
  takeoffInset: 0.22 * K, // Take off this close to the edge facing the target.
  landInset: 0.6 * K,  // Aim this far inside the landing platform.
  jumpSafety: 0.65,    // Fraction of the ideal running-jump reach a bot relies on.
  maxRise: 0.67 * JUMP_APEX, // Highest roof step a bot will try: two thirds of the jump apex (about 0.96 m).
  maxDrop: 3.5,        // Deepest roof step down a bot will take.
  solidMargin: 0.15,   // Extra clearance around roof props when walking past them.
});

/** Seconds until a running jump comes back down to a roof `rise` metres above the takeoff roof; null if out of reach. */
export function airTime(rise) {
  const disc = MOTION.jump ** 2 - 2 * MOTION.gravity * rise;
  return disc < 0 ? null : (MOTION.jump + Math.sqrt(disc)) / MOTION.gravity;
}

/** Conservative horizontal reach of a running jump onto a roof `rise` higher (negative: lower). */
export function jumpReach(rise, speedScale = 1) {
  if (rise > NAV.maxRise || rise < -NAV.maxDrop) return 0;
  const time = airTime(rise);
  return time ? MOTION.speed * speedScale * time * NAV.jumpSafety : 0;
}

/** World-space rectangle of a platform on its vehicle (platformAt ignores vehicle yaw, and so does navigation). */
export function regionRect(region) {
  const { truck, plat } = region;
  return { x0: truck.pos.x + plat.x0, x1: truck.pos.x + plat.x1, z0: truck.pos.z + plat.z0, z1: truck.pos.z + plat.z1 };
}

/** Standing regions of the visible vehicles. */
export function navRegions(trucks) {
  const regions = [];
  for (const truck of trucks) {
    if (truck.group?.visible === false) continue;
    truck.platforms.forEach((plat, index) => regions.push({ truck, plat, id: `${truck.instanceId || truck.name || truck.type}:${index}` }));
  }
  return regions;
}

const rectGap = (a, b) => Math.hypot(Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.z0 - b.z1, b.z0 - a.z1));

/** The region a character stands on, or null in the air / off the field. */
export function regionOf(regions, player) {
  if (player.state !== 'ground' || !player.ground) return null;
  return regions.find((region) => region.truck === player.ground.truck && region.plat === player.ground.plat) ||
    regions.find((region) => region.truck === player.ground.truck && inside(regionRect(region), player.pos.x, player.pos.z, MOTION.edgeTolerance)) || null;
}

/** The region of `truck` that contains (x, z), or the nearest of its regions. */
export function regionAt(regions, truck, x, z) {
  const own = regions.filter((region) => region.truck === truck);
  return own.find((region) => inside(regionRect(region), x, z, 0)) ||
    own.reduce((best, region) => !best || rectDistance(regionRect(region), x, z) < rectDistance(regionRect(best), x, z) ? region : best, null);
}

const inside = (rect, x, z, tol) => x >= rect.x0 - tol && x <= rect.x1 + tol && z >= rect.z0 - tol && z <= rect.z1 + tol;
const rectDistance = (rect, x, z) => Math.hypot(Math.max(0, rect.x0 - x, x - rect.x1), Math.max(0, rect.z0 - z, z - rect.z1));

/** Clamp (x, z) into a region shrunk by `inset` (the centre line when the region is narrower than twice the inset). */
export function clampInto(region, x, z, inset = NAV.inset) {
  const r = regionRect(region), cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  const clamp = (v, a, b, c) => a + inset > b - inset ? c : Math.min(b - inset, Math.max(a + inset, v));
  return { x: clamp(x, r.x0, r.x1, cx), z: clamp(z, r.z0, r.z1, cz) };
}

/** Standing level of a region (multi-level roofs: a platform may carry its own height). */
export const levelOf = (region) => region.truck.platTopY ? region.truck.platTopY(region.plat) : region.truck.topY;
/** Height change of a jump between two regions (their own levels, not the vehicles' main roofs). */
export const regionRise = (from, to) => levelOf(to) - levelOf(from);
/** Walkable rise between adjacent platforms (PlayerMotion STEP_UP); taller ones need a ladder. */
const STEP_UP = 0.65;

/** Links between regions right now: walk (continuous footing), a ladder climb, a step down, or a jump the shared
 * physics can make with margin. A ladder is a small aim region on the vehicle (not a standing region): walking into it
 * climbs, and the motor replans from the upper deck. */
export function navLinks(regions, speedScale = 1) {
  const links = new Map(regions.map((region) => [region, []]));
  for (let i = 0; i < regions.length; i++) for (let j = i + 1; j < regions.length; j++) {
    const a = regions[i], b = regions[j], ra = regionRect(a), rb = regionRect(b), gap = rectGap(ra, rb);
    if (a.truck === b.truck && gap < 2 * MOTION.edgeTolerance) {
      const rise = levelOf(b) - levelOf(a);
      if (Math.abs(rise) <= STEP_UP) { links.get(a).push({ to: b, kind: 'walk', cost: gap + 0.5 }); links.get(b).push({ to: a, kind: 'walk', cost: gap + 0.5 }); continue; }
      const [low, high] = rise > 0 ? [a, b] : [b, a];
      links.get(high).push({ to: low, kind: 'walk', cost: gap + 1 });   // step off the ledge and land below
      const local = (region) => region.truck.platformTop ? region.truck.platformTop(region.plat) : region.truck.spec.top;
      for (const ladder of low.truck.spec?.ladders || []) {
        if (Math.abs(ladder.fromY - local(low)) > 0.35 || Math.abs(ladder.toY - local(high)) > 0.35) continue;
        const aim = { truck: low.truck, plat: { x0: ladder.x0, x1: ladder.x1, z0: ladder.z0, z1: ladder.z1 }, ladder: true, id: `${low.id}>ladder>${high.id}` };
        links.set(aim, [{ to: high, kind: 'walk', cost: 0.5 }]);
        links.get(low).push({ to: aim, kind: 'walk', cost: gap + 2 });
      }
      continue;
    }
    const rise = levelOf(b) - levelOf(a);
    if (gap <= jumpReach(rise, speedScale)) links.get(a).push({ to: b, kind: 'jump', cost: gap + 2 });
    if (gap <= jumpReach(-rise, speedScale)) links.get(b).push({ to: a, kind: 'jump', cost: gap + 2 });
  }
  return links;
}

/** Cheapest chain of links from one region to another: [] when already there, null when unreachable. */
export function planRoute(regions, from, to, speedScale = 1) {
  if (!from || !to) return null;
  if (from === to) return [];
  const links = navLinks(regions, speedScale), cost = new Map([[from, 0]]), back = new Map(), open = [from];
  while (open.length) {
    open.sort((a, b) => cost.get(a) - cost.get(b));
    const region = open.shift();
    if (region === to) break;
    for (const link of links.get(region)) {
      const next = cost.get(region) + link.cost;
      if (next < (cost.get(link.to) ?? Infinity)) { cost.set(link.to, next); back.set(link.to, { from: region, link }); open.push(link.to); }
    }
  }
  if (!back.has(to)) return null;
  const route = [];
  for (let region = to; region !== from; region = back.get(region).from) route.unshift({ ...back.get(region).link, from: back.get(region).from });
  return route;
}

/** Takeoff point on `from` facing `to` (preferring the player's current lateral position) and the landing aim on `to`. */
export function jumpPoints(from, to, px, pz) {
  const a = regionRect(from), b = regionRect(to);
  const toward = (a0, a1, b0, b1, p) => b0 > a1 ? a1 : b1 < a0 ? a0 : Math.min(Math.min(a1, b1), Math.max(Math.max(a0, b0), p));
  const takeoff = clampInto(from, toward(a.x0, a.x1, b.x0, b.x1, px), toward(a.z0, a.z1, b.z0, b.z1, pz), NAV.takeoffInset);
  const landing = clampInto(to, takeoff.x, takeoff.z, NAV.landInset);
  return { takeoff, landing };
}

/** The next waypoint when the straight walk crosses solid roof props on this vehicle (a shortest path over the props'
 * expanded corners); null when the way is clear or no corner path exists. */
export function solidDetour(region, x, z, tx, tz) {
  const truck = region.truck, boxes = [];
  for (const solid of truck.solids || []) {
    if (!solid.active) continue;
    const cx = truck.pos.x + solid.x, cz = truck.pos.z + solid.z;
    boxes.push({ cx, cz, hx: solid.hx + SOLID_RADIUS + NAV.solidMargin, hz: solid.hz + SOLID_RADIUS + NAV.solidMargin });
  }
  // Corners themselves sit on the expanded boxes, so visibility uses slightly shrunk boxes.
  const clear = (ax, az, bx, bz) => boxes.every((b) => !segmentHitsBox(ax, az, bx, bz, b.cx - b.hx + 0.05, b.cx + b.hx - 0.05, b.cz - b.hz + 0.05, b.cz + b.hz - 0.05));
  if (!boxes.length || clear(x, z, tx, tz)) return null;
  const nodes = [{ x, z }, { x: tx, z: tz }];
  for (const b of boxes) for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const corner = clampInto(region, b.cx + sx * b.hx, b.cz + sz * b.hz, NAV.inset);
    if (boxes.every((o) => Math.abs(corner.x - o.cx) >= o.hx - 0.06 || Math.abs(corner.z - o.cz) >= o.hz - 0.06)) nodes.push(corner);
  }
  const cost = nodes.map(() => Infinity), back = nodes.map(() => -1), done = nodes.map(() => false);
  cost[0] = 0;
  for (;;) {
    let u = -1;
    for (let k = 0; k < nodes.length; k++) if (!done[k] && cost[k] < Infinity && (u < 0 || cost[k] < cost[u])) u = k;
    if (u < 0 || u === 1) break;
    done[u] = true;
    for (let v = 0; v < nodes.length; v++) {
      if (done[v] || !clear(nodes[u].x, nodes[u].z, nodes[v].x, nodes[v].z)) continue;
      const next = cost[u] + Math.hypot(nodes[v].x - nodes[u].x, nodes[v].z - nodes[u].z);
      if (next < cost[v]) { cost[v] = next; back[v] = u; }
    }
  }
  if (back[1] < 0) return null;
  let step = 1;
  while (back[step] !== 0) step = back[step];
  return step === 1 ? null : nodes[step];
}

function segmentHitsBox(x0, z0, x1, z1, bx0, bx1, bz0, bz1) {
  let t0 = 0, t1 = 1;
  for (const [p, d, lo, hi] of [[x0, x1 - x0, bx0, bx1], [z0, z1 - z0, bz0, bz1]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; continue; }
    let a = (lo - p) / d, b = (hi - p) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}
