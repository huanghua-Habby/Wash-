/** Characters are drawn and collide at this size relative to the vehicles (2026-10-20: 0.8, so eight players fit on a
 * roof without feeling cramped). Every body-sized rule scales with it: body radius and height, hand and mouth points,
 * trunk tip, wall-cling gaps, head standing, slap and soap-contagion reach, and the presentation offsets above heads.
 * Move speed, jump and interaction ranges stay in world units. The gameplay camera distance scales with it too, so a
 * character keeps its on-screen size. No browser APIs. */
export const CHARACTER_SCALE = 0.8;
export const scaled = (value) => value * CHARACTER_SCALE;
/** Movement follows the size: speeds, accelerations and shoves scale with CHARACTER_SCALE, and gravity scales with it
 * together with jump speeds, so a jump is CHARACTER_SCALE as high with the same airtime (the same motion, smaller).
 * Walking (and air steering) additionally runs at WALK_SPEED_SCALE of the old base speed (2026-10-20: 0.8, so walking
 * is 0.64 of before; 0.9 would give 0.72). */
export const WALK_SPEED_SCALE = 0.8;
