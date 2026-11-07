/**
 * Squirrel wall cling: the vertical faces of vehicle hulls (vehicles.js `walls`) and of solid roof props (truck.solids).
 * An airborne squirrel that touches one sticks to it, slides down ever faster and can kick off with Space.
 * PlayerMotion runs these rules on the host and in guest prediction alike; no browser APIs.
 *
 * A cling is plain data: { truck, box, axis, side, along, y }. `box` indexes wallBoxes(truck), `axis`/`side` name the
 * face normal (axis 'z' side +1 is the vehicle's left flank, axis 'x' side -1 its rear), `along` is the truck-local
 * position along the face and `y` the feet height above the hull underside.
 */
import { WASH_CONFIG as C } from './washConfig.js';
import { CHARACTER_SCALE as K } from './characterScale.js';

export const WALL_GAP = 0.37 * K;      // Feet-to-face distance while clinging: the plush belly touches the face (≥ SOLID_RADIUS).
export const WALL_REACH = 0.85 * K;    // An airborne squirrel's feet this close to a face grab it.
export const WALL_TOP_CLEAR = 0.25 * K; // Feet must be this far below a face's top edge to grab it.
export const WALL_HANG = 0.45 * K;     // Feet may hang this far below a face's bottom edge before the paws slip off.
const EDGE = 0.12;                 // Faces end this far before a box corner.
/** Lock against re-grabbing after a kick-off / a drop, and the outward shove (m/s) that knocks paws off a face. */
export const WALL_JUMP_LOCK = 0.22, WALL_DROP_LOCK = 0.3, WALL_KNOCK = 2.5;
const INSIDE = 0.25 * K;               // Feet already this deep inside a box do not grab its face.

/** Hull boxes plus a box for every solid roof prop, cached per solids list (props never move on their roof). */
export function wallBoxes(truck) {
  const hull = truck.spec.walls || [];
  if (!truck.solids?.length) return hull;
  if (truck._wallSolids !== truck.solids) {
    truck._wallSolids = truck.solids;
    truck._wallBoxes = [...hull, ...truck.solids.map(solid => {
      const top = truck.localTopForLocal(solid.x, solid.z);
      return { x0: solid.x - solid.hx, x1: solid.x + solid.hx, z0: solid.z - solid.hz, z1: solid.z + solid.hz, y0: top, y1: top + solid.height, solid };
    })];
  }
  return truck._wallBoxes;
}

/** World height of a truck's hull underside, including the shared body bob. */
export const hullBase = (truck) => truck.pos.y + truck.body.position.y;
const usable = (box) => !!box && (!box.solid || box.solid.active && box.solid.cling !== false);

/** Unit outward normal of the clung face (x and z only). */
export function wallNormal(wall, out = { x: 0, z: 0 }) {
  out.x = wall.axis === 'x' ? wall.side : 0; out.z = wall.axis === 'z' ? wall.side : 0;
  return out;
}

/** Slide speed after `seconds` of clinging since the last landing: slow at first, then faster and faster. */
export function slideSpeed(seconds) {
  const [a, b, c] = C.squirrelSlide;
  return a + b * seconds + c * seconds * seconds;
}

/** Truck-local tangent range of a face. */
export function faceRange(box, axis) {
  return axis === 'z' ? [box.x0 + EDGE, box.x1 - EDGE] : [box.z0 + EDGE, box.z1 - EDGE];
}

/** The closest face within reach of airborne feet at `pos`, or null. */
export function findWall(pos, trucks) {
  let best = null, bestDistance = Infinity;
  const consider = (truck, box, axis, side, distance, along, y) => {
    if (distance < -INSIDE || distance > WALL_REACH || distance >= bestDistance) return;
    best = { truck, box, axis, side, along, y }; bestDistance = distance;
  };
  for (const truck of trucks) {
    const boxes = wallBoxes(truck), lx = pos.x - truck.pos.x, lz = pos.z - truck.pos.z, ly = pos.y - hullBase(truck);
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (!usable(box) || ly > box.y1 - WALL_TOP_CLEAR || ly < box.y0 - 0.2) continue;
      if (lx >= box.x0 + EDGE && lx <= box.x1 - EDGE) { consider(truck, i, 'z', 1, lz - box.z1, lx, ly); consider(truck, i, 'z', -1, box.z0 - lz, lx, ly); }
      if (lz >= box.z0 + EDGE && lz <= box.z1 - EDGE) { consider(truck, i, 'x', 1, lx - box.x1, lz, ly); consider(truck, i, 'x', -1, box.x0 - lx, lz, ly); }
    }
  }
  return best;
}

/** The clung box, or null once its truck left the active set or its prop was hidden. */
export function wallBox(wall, trucks) {
  if (!trucks.includes(wall.truck)) return null;
  const box = wallBoxes(wall.truck)[wall.box];
  return usable(box) ? box : null;
}

/** World feet position of a cling, WALL_GAP out from its face. */
export function wallPosition(wall, box, out) {
  const truck = wall.truck, offset = wall.side > 0 ? (wall.axis === 'z' ? box.z1 : box.x1) + WALL_GAP : (wall.axis === 'z' ? box.z0 : box.x0) - WALL_GAP;
  if (wall.axis === 'z') out.set(truck.pos.x + wall.along, 0, truck.pos.z + offset);
  else out.set(truck.pos.x + offset, 0, truck.pos.z + wall.along);
  out.y = hullBase(truck) + wall.y;
  return out;
}

/** Plain snapshot form (truck as an index). */
export const captureWall = (wall, trucks) => wall ? { truck: trucks.indexOf(wall.truck), box: wall.box, axis: wall.axis, side: wall.side, along: wall.along, y: wall.y, ...(wall.ladder >= 0 ? { ladder: wall.ladder } : {}) } : null;
export function restoreWall(data, trucks) {
  const truck = data && trucks[data.truck];
  return truck ? { truck, box: data.box, axis: data.axis, side: data.side, along: data.along, y: data.y, ...(data.ladder >= 0 ? { ladder: data.ladder } : {}) } : null;
}
