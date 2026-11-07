/** Hose-like jet pressure shared by the water gun and the elephant trunk (authority rule, synced as `pressure`).
 * Holding builds pressure from a weak dribble to the full jet; letting go tapers it off for a short tail.
 * Range, speed, lift, shove and rinse all follow the current pressure, so a weak jet really lands short. */
import { WASH_CONFIG as C } from './washConfig.js';

/** Advance `jet.pressure` (0–1) by one tick. Returns whether water flows this tick. */
export function stepPressure(jet, want, dt) {
  if (want) jet.pressure = Math.min(1, Math.max(jet.pressure, C.pressureMin) + dt * (1 - C.pressureMin) / C.pressureRampSeconds);
  else jet.pressure = Math.max(0, jet.pressure - dt / C.pressureFallSeconds);
  if (!want && jet.pressure < C.pressureCutoff) jet.pressure = 0;
  return jet.pressure > 0;
}

/** Ballistics at a pressure; pressure 1 is exactly the configured full jet. */
export function pressureBallistics({ speed, range, lift }, pressure) {
  // Keep the flight-time budget as the jet shortens. A separate speed floor cuts weak jets off in mid-air,
  // before they can touch roof stains (especially the higher elephant nozzle).
  const horizontal = scale(C.pressureRangeMin, pressure);
  return { speed: speed * horizontal, range: range * horizontal, lift: lift * scale(C.pressureLiftMin, pressure) };
}
const scale = (minimum, pressure) => minimum + (1 - minimum) * Math.max(0, Math.min(1, pressure));

/** Shove and rinse strength relative to the full jet. */
export const pressureForce = (pressure) => scale(C.pressureForceMin, pressure);
export const pressureRinse = (pressure) => scale(C.pressureRinseMin, pressure);
