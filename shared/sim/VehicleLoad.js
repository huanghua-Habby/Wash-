/** Rider-weight suspension: roll, pitch and sink of a hover vehicle under the cats standing on it. No browser APIs.
 * Presentation-only — standing height, landing and every wash result keep using the untilted roof (`TruckState.topY`),
 * so the authority never depends on it and no snapshot field is needed. Every viewer derives it from the same
 * rider positions with these shared rules. */
import { VEHICLES } from './vehicles.js';
import { playerMass } from './Mass.js';

export { PLAYER_MASS, TOOL_MASS } from './Mass.js';

const ROLL_GAIN = 0.16;   // rad per (rider mass · metre of lateral lever) per unit vehicle mass
const PITCH_GAIN = 0.05;  // rad per (rider mass · metre of longitudinal lever) per unit vehicle mass
const SINK_GAIN = 0.12;   // metres per rider mass per unit vehicle mass
const STEP = 1 / 120;

/** Weight one standing player puts on the roof, including a pelican's swallowed load. */
export const riderWeight = playerMass;

/** Spring constants for a catalogue entry. Light vehicles tilt further and bounce quicker. */
export function suspensionFor(spec) {
  const s = spec.suspension;
  return { mass: s.mass, omega: s.omega ?? 7 + 4 / Math.sqrt(s.mass), zeta: s.zeta ?? 0.32 + 0.02 * s.mass,
    maxRoll: s.maxRoll ?? 0.2, maxPitch: s.maxPitch ?? 0.12, maxSink: s.maxSink ?? 0.32 };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Static lean for a set of riders in the vehicle's local frame (+x forward, +z right, origin at the hull centre line).
 * Positive roll lowers the +z side; positive pitch raises the nose, so a rider in front gives negative pitch.
 * Weights add, so stacked cats on one side lean the vehicle further until the travel limit.
 */
export function loadTarget(spec, riders) {
  const k = suspensionFor(spec), cx = (spec.x0 + spec.x1) / 2;
  let roll = 0, pitch = 0, weight = 0;
  for (const { x, z, w } of riders) { roll += w * z; pitch -= w * (x - cx); weight += w; }
  return {
    roll: clamp(roll * ROLL_GAIN / k.mass, -k.maxRoll, k.maxRoll),
    pitch: clamp(pitch * PITCH_GAIN / k.mass, -k.maxPitch, k.maxPitch),
    sink: clamp(weight * SINK_GAIN / k.mass, 0, k.maxSink),
    weight,
  };
}

/** Damped spring state for one vehicle; integrate with `step`, kick with `impulse` on landings and take-offs. */
export class VehicleLoad {
  constructor(type) {
    this.spec = VEHICLES[type];
    this.k = suspensionFor(this.spec);
    this.reset();
  }

  reset() {
    this.roll = this.pitch = this.sink = 0;
    this.rollV = this.pitchV = this.sinkV = 0;
    this.target = { roll: 0, pitch: 0, sink: 0, weight: 0 };
    this.carry = 0;
  }

  /**
   * A rider of weight `w` meets the roof at local (x, z) with vertical speed `speed` (m/s, positive = into the roof).
   * Jumping off pushes down as well, so take-offs pass their launch speed too.
   */
  impulse(x, z, w, speed) {
    const cx = (this.spec.x0 + this.spec.x1) / 2, m = this.k.mass;
    const j = w * clamp(speed, 0, 16);
    this.sinkV += j * 0.045 / m;
    this.rollV += j * z * 0.06 / m;
    this.pitchV -= j * (x - cx) * 0.02 / m;
  }

  /** Advance toward the riders' static lean with fixed sub-steps, so the result is frame-rate independent. */
  step(dt, riders) {
    this.target = loadTarget(this.spec, riders);
    const { omega, zeta, maxRoll, maxPitch, maxSink } = this.k, w2 = omega * omega, c = 2 * zeta * omega;
    this.carry = Math.min(0.25, this.carry + Math.max(0, dt));
    while (this.carry >= STEP) {
      this.carry -= STEP;
      this.rollV += (w2 * (this.target.roll - this.roll) - c * this.rollV) * STEP;
      this.pitchV += (w2 * (this.target.pitch - this.pitch) - c * this.pitchV) * STEP;
      this.sinkV += (w2 * (this.target.sink - this.sink) - c * this.sinkV) * STEP;
      this.roll += this.rollV * STEP; this.pitch += this.pitchV * STEP; this.sink += this.sinkV * STEP;
      // Bump stops: travel ends softly instead of letting an impulse fold the hull over.
      if (Math.abs(this.roll) > maxRoll * 1.4) { this.roll = Math.sign(this.roll) * maxRoll * 1.4; this.rollV *= -0.3; }
      if (Math.abs(this.pitch) > maxPitch * 1.4) { this.pitch = Math.sign(this.pitch) * maxPitch * 1.4; this.pitchV *= -0.3; }
      if (this.sink > maxSink * 1.5) { this.sink = maxSink * 1.5; this.sinkV *= -0.3; }
      if (this.sink < -maxSink * 0.6) { this.sink = -maxSink * 0.6; this.sinkV *= -0.3; }
    }
    return this;
  }
}
