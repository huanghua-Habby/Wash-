/** Standable tops (MULTIPLAYER.md "可站立的道具与角色"): roof props (`truck.solids`) and other players' heads.
 * Shared by host and guest prediction; no browser APIs. */
import { CHARACTER_SCALE as K } from './characterScale.js';
export const STAND = Object.freeze({
  propTolerance: 0.08, // A body centre this far past a prop's edge still stands on it.
  headRadius: 0.42 * K,    // Body centre within this flat distance of another player's centre stands on their head.
  landWindow: 0.3,     // Last tick's feet may be this far below a top and still land on it (fast falls).
});

/** World height of the top of roof prop `solid` on `truck`: the platform level under it plus its own height. */
export function solidTopY(truck, solid) {
  return truck.topYAt(truck.pos.x + solid.x, truck.pos.z + solid.z) + solid.height;
}

/** Index of the active solid on `truck` whose top footprint holds world (x, z), or -1. */
export function solidUnder(truck, x, z, tolerance = STAND.propTolerance) {
  const solids = truck?.solids || [];
  for (let i = 0; i < solids.length; i++) {
    const solid = solids[i];
    if (!solid.active) continue;
    const lx = x - truck.pos.x - solid.x, lz = z - truck.pos.z - solid.z;
    if (Math.abs(lx) <= solid.hx + tolerance && Math.abs(lz) <= solid.hz + tolerance) return i;
  }
  return -1;
}
