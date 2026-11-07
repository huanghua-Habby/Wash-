import { vehicleSpec } from '../sim/vehicles.js';
import { stainLayout } from '../sim/StainDefinitions.js';
import { ROAD_SIGN, ROAD_SIGN_PASS_SECONDS } from '../sim/RoadSigns.js';
export function order(id, at, side, type, kinds, { multiplier = 1.4, behavior = 'cruise', onComplete = 'leave' } = {}) {
  return { id, at, side, type, stains: stainLayout(vehicleSpec(type), kinds), patience: { mode: 'steps', multiplier }, behavior, onComplete };
}
export function roadSignEvents() {
  return [18, 45, 72, 99, 126, 153].map((launch, i) => ({ id: `sign-${i + 1}`, type: 'roadSign', at: launch - ROAD_SIGN.warningSeconds,
    duration: ROAD_SIGN.warningSeconds + ROAD_SIGN_PASS_SECONDS, params: { side: i % 2 ? 1 : -1 } }));
}
