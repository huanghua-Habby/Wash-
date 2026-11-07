/** Shared hover-vehicle catalogue: footprint, standing roofs, stain layout and cruise altitude.
 * `suspension.mass` is the rider-weight resistance (see VehicleLoad.js): one cat is mass 1, so small cars lean visibly.
 * `walls` are the hull's solid boxes (local, y from the hull underside) whose vertical faces a squirrel clings to;
 * they follow the main boxes drawn by client/js/world/Truck.js.
 * A platform may carry its own standing height `y` (local, above the underside; default `top`): multi-level roofs.
 * A climb taller than STEP_UP between platforms only happens inside an authored `ladders` zone (Xiexufeng's design).
 * Colliders stay boxes: hull `walls`, roof props `truck.solids`; no mesh colliders. */
// Local frame: +x is forward, origin is the centre of the hull underside. The group's y is the
// hover altitude above the road; `top` is the standing roof height above that underside.
export const VEHICLES = {
  // Player wash vehicle: wider and longer than every order vehicle.
  washer: {
    name: '洗车飞车', x0: -6.4, x1: 5.8, width: 3.4, top: 3, hover: 1.5, suspension: { mass: 14 },
    platforms: [
      { name: 'deck', x0: -6.3, x1: 2.6, z0: -1.7, z1: 1.7 },
      { name: 'cab', x0: 3, x1: 5.5, z0: -1.4, z1: 1.4 },
    ],
    walls: [
      { x0: -6.3, x1: 2.6, z0: -1.7, z1: 1.7, y0: 0.1, y1: 3 },
      { x0: 2.7, x1: 5.7, z0: -1.45, z1: 1.45, y0: 0.1, y1: 3 },
    ],
    stains: [[-4, -0.6], [-1.5, 0.6], [1, -0.6]],
  },
  // Player wash vehicle (Xiexufeng, 2026-10-20): low rear deck at 1 m, a shorter cargo box whose roof is the 3 m deck,
  // the cab, and a ladder on the box's rear face between the two decks.
  washer2: {
    name: '洗车飞车2', x0: -7.45, x1: 5.8, width: 3.4, top: 3, hover: 1.5, suspension: { mass: 14 },
    platforms: [
      { name: 'low-deck', x0: -7.15, x1: -2.45, z0: -1.7, z1: 1.7, y: 1 },
      { name: 'box-roof', x0: -2.45, x1: 2.6, z0: -1.7, z1: 1.7 },
      { name: 'cab', x0: 3, x1: 5.5, z0: -1.4, z1: 1.4 },
    ],
    ladders: [
      { name: 'rear-ladder', x0: -2.62, x1: -2.28, z0: -0.38, z1: 0.38, fromY: 1, toY: 3 },
    ],
    walls: [
      { x0: -7.45, x1: -2.45, z0: -1.7, z1: 1.7, y0: 0.1, y1: 1 },
      { x0: -2.45, x1: 2.6, z0: -1.7, z1: 1.7, y0: 0.1, y1: 3 },
      { x0: 2.7, x1: 5.7, z0: -1.45, z1: 1.45, y0: 0.1, y1: 3 },
    ],
    stains: [[-4, -0.6], [-1.5, 0.6], [1, -0.6]],
  },
  cargo: {
    name: '悬浮货车', x0: -5.5, x1: 4.9, width: 2.6, top: 2.9, hover: 0.9, suspension: { mass: 6 },
    platforms: [
      { name: 'trailer', x0: -5.4, x1: 2.2, z0: -1.3, z1: 1.3 },
      { name: 'cab', x0: 2.6, x1: 4.75, z0: -1.1, z1: 1.1 },
    ],
    walls: [
      { x0: -5.4, x1: 2.2, z0: -1.3, z1: 1.3, y0: 0.2, y1: 2.9 },
      { x0: 2.5, x1: 4.8, z0: -1.1, z1: 1.1, y0: 0.2, y1: 2.9 },
    ],
    stains: [[-3.7, -0.45], [-1.45, 0.4], [0.8, -0.4]],
  },
  pod: {
    name: '胶囊小车', x0: -2.6, x1: 2.4, width: 2.2, top: 1.5, hover: 0.9, suspension: { mass: 1.4 },
    platforms: [{ name: 'roof', x0: -2.05, x1: 1.65, z0: -1.05, z1: 1.05 }],
    walls: [
      { x0: -2.05, x1: 1.65, z0: -1.05, z1: 1.05, y0: 0.85, y1: 1.5 },
      { x0: -2.5, x1: 2.3, z0: -1.1, z1: 1.1, y0: 0.15, y1: 0.85 },
    ],
    stains: [[-1.35, -0.35], [-0.2, 0.35], [0.95, -0.3]],
  },
  sedan: {
    name: '流线轿跑', x0: -3.7, x1: 3.6, width: 2.5, top: 1.75, hover: 0.9, suspension: { mass: 2 },
    platforms: [{ name: 'roof', x0: -2.6, x1: 1.8, z0: -1.15, z1: 1.15 }],
    walls: [
      { x0: -2.6, x1: 1.8, z0: -1.15, z1: 1.15, y0: 0.875, y1: 1.75 },
      { x0: -3.65, x1: 3.55, z0: -1.25, z1: 1.25, y0: 0.125, y1: 0.875 },
    ],
    stains: [[-1.85, -0.4], [-0.4, 0.4], [1.05, -0.35]],
  },
  bus: {
    name: '双层巴士', x0: -6.3, x1: 5.9, width: 2.9, top: 3.7, hover: 0.9, suspension: { mass: 10 },
    platforms: [{ name: 'roof', x0: -6.15, x1: 5.75, z0: -1.45, z1: 1.45 }],
    walls: [{ x0: -6.3, x1: 5.9, z0: -1.45, z1: 1.45, y0: 0.4, y1: 3.7 }],
    stains: [[-4, -0.5], [-0.6, 0.5], [2.8, -0.45]],
  },
  hauler: {
    name: '低底板运输车', x0: -6.8, x1: 5.1, width: 2.8, top: 2.25, hover: 0.9, suspension: { mass: 6.5 },
    platforms: [
      { name: 'container', x0: -6.6, x1: 1.8, z0: -1.4, z1: 1.4 },
      { name: 'cab', x0: 2.7, x1: 4.9, z0: -1.15, z1: 1.15 },
    ],
    walls: [
      { x0: -6.6, x1: 1.8, z0: -1.4, z1: 1.4, y0: 0.2, y1: 2.25 },
      { x0: 2.6, x1: 5, z0: -1.2, z1: 1.2, y0: 0.2, y1: 2.25 },
    ],
    stains: [[-5, -0.45], [-2.2, 0.45], [0.6, -0.4]],
  },
  // Order flatbed (Xiexufeng): a low 1 m bed (cargo stands on it) and a 2.25 m cab roof.
  flatbed: {
    name: '平板货车', x0: -6.8, x1: 5.1, width: 2.8, top: 1, hover: 0.9, suspension: { mass: 6.5 },
    platforms: [
      { name: 'low-bed', x0: -6.6, x1: 1.8, z0: -1.4, z1: 1.4 },
      { name: 'cab', x0: 2.7, x1: 4.9, z0: -1.15, z1: 1.15, y: 2.25 },
    ],
    walls: [
      { x0: -6.6, x1: 1.8, z0: -1.4, z1: 1.4, y0: 0.2, y1: 1 },
      { x0: 2.6, x1: 5, z0: -1.2, z1: 1.2, y0: 0.2, y1: 2.25 },
    ],
    stains: [[-5, -0.45], [-2.2, 0.45], [0.6, -0.4]],
  },
};

/** Resolve a catalogue entry; unknown ids are a configuration error, not a silent fallback. */
export function vehicleSpec(type) {
  const spec = VEHICLES[type];
  if (!spec) throw new Error(`unknown vehicle type: ${type}`);
  return spec;
}

/**
 * Merge lane shape shared by authority and renderer. `u` is the distance behind the junction
 * divided by the lane length: 0 is merged into the road, 1 is the off-screen side road.
 * Beyond 1 the side road bends further away so its far end never enters the view.
 */
export function laneShape(u, { sideOffset, height }) {
  const k = Math.min(1, Math.max(0, u));
  const s = k * k * (3 - 2 * k);
  const climb = Math.min(1, Math.max(0, (u - 0.06) / 0.4));
  return {
    z: -sideOffset * s - Math.max(0, u - 1) * sideOffset * 0.8,
    y: height * climb * climb * (3 - 2 * climb),
  };
}
