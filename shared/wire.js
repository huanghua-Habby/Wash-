/** Per-guest wire view of a quantized snapshot (MULTIPLAYER.md 流量). The host diffs this view per guest; the guest
 * restores derived fields right after decoding, so every consumer still sees the full snapshot shape. No browser APIs.
 *
 * - Prediction-only fields travel for the guest's own character only; other characters are drawn by interpolation and
 *   never read them (audited 2026-10-21: coyote/jumpBuf/jumpBoost/takeoff are only written by the transition, cooldowns
 *   and hints are read for the local slot only).
 * - `local` (position on the carrying vehicle) is not sent; the guest derives it from the same snapshot's vehicle.
 * - Values are rounded per kind: millimetres for positions, 1/1000 rad for angles, 1/100 for speeds, timers and
 *   animation springs. Coarser values are shorter and stop flickering diffs from sub-millimetre noise.
 * - Ever-growing animation phases (`walk`, lean spin while fallen) are wrapped so their digits stay short. */

export const OWN_ONLY = Object.freeze(['ack', 'ackTick', 'hint', 'coyote', 'jumpBuf', 'jumpBoost', 'dashCooldown', 'skipUse',
  'throwCancelled', 'slipCooldown', 'catchRemaining', 'wallLock', 'emoteCooldown', 'swallowCooldown', 'glideRemaining', 'takeoff',
  'slipperyImmunity']);
const MILLIMETRE = new Set(['pos', 'standOffset']);
const ANGLE = new Set(['yaw', 'lean']);
const TAU = Math.PI * 2;

const round = (value, scale) => typeof value === 'number' ? Math.round(value * scale) / scale || 0
  : Array.isArray(value) ? value.map((item) => round(item, scale)) : value;
// The walk phase into [0, 2π) (two steps per turn, so the step parity of floor(walk / π) holds); lean angles into (-π, π]
// so a small negative tilt stays small (wrapping it to ~2π would make the receiver damp it back through a full turn).
const wrapPhase = (value) => typeof value === 'number' ? ((value % TAU) + TAU) % TAU : value;
const wrapAngle = (value) => typeof value === 'number' ? value - TAU * Math.round(value / TAU) : value;

/** One character as the guest in `slot` receives it. */
function playerView(player, own) {
  const out = {};
  for (const key in player) {
    if (key === 'local' || (!own && OWN_ONLY.includes(key))) continue;
    let value = player[key];
    if (key === 'walk') value = wrapPhase(value);
    if (key === 'lean' && Array.isArray(value)) value = value.map(wrapAngle);
    out[key] = MILLIMETRE.has(key) ? round(value, 1000) : ANGLE.has(key) ? round(value, 1000)
      : typeof value === 'number' && !Number.isInteger(value) ? round(value, 100)
      : Array.isArray(value) && value.some((item) => typeof item === 'number' && !Number.isInteger(item)) ? round(value, 100) : value;
  }
  return out;
}

/** The snapshot the guest in `slot` is sent (input is the shared quantized state; it is not mutated). */
export function guestView(state, slot) {
  if (!Array.isArray(state?.players)) return state;
  return { ...state, players: state.players.map((player, index) => player && typeof player === 'object' ? playerView(player, index === slot) : player) };
}

/** Guest side, right after decoding: put back what the view left out for derivation (`local` from the same snapshot). */
export function restoreView(state) {
  if (!Array.isArray(state?.players) || !Array.isArray(state.trucks)) return state;
  for (const player of state.players) {
    const truck = player && player.parent >= 0 ? state.trucks[player.parent] : null;
    if (!truck?.pos || !Array.isArray(player.pos)) continue;
    player.local = [player.pos[0] - truck.pos[0], player.pos[1] - truck.pos[1], player.pos[2] - truck.pos[2]];
  }
  return state;
}
