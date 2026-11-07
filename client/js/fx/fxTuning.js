/** Look of the electric effects. Shaders read these as uniforms every frame (no recompilation). */
export const FX_DEFAULTS = Object.freeze({
  electric: Object.freeze({
    spread: 7,          // Growth speed from the contact point (m/s).
    intensity: 4.2,     // HDR gain; above 1 feeds Bloom.
    band: 0.22,         // Width of the bright travelling front (m).
    bandGain: 0.9,
    flickerRate: 14,    // Re-strikes per second.
    streakScale: 3.2, streakSharp: 18, streakSpeed: 6, // Radial streaks running out from the source.
    webScale: 2.6, webSharp: 14,                        // Branching web filaments.
    fineScale: 6.5, fineSharp: 22, fineAmount: 0.6,     // Fine crackle.
    base: 0.05,         // Faint glow over the whole live puddle.
    core: '#fffada', edge: '#a0deff', // sRGB; equal to the previous linear (1,.96,.7) / (.35,.72,1)
  }),
  shock: Object.freeze({
    bolts: 12,          // Up to 24.
    strikeRate: 16,     // Bolt re-strikes per second.
    width: 0.085,
    reach: 1,           // Floor bolt reach multiplier.
    boltGain: 5,
    shellGain: 1.6, shellRim: 1.3, shellFilament: 2.2,
    core: '#fffbe1', edge: '#94dbff',
    elephantScale: 1.45,
  }),
});
export const SHOCK_MAX_BOLTS = 24;
const copy = () => ({ electric: { ...FX_DEFAULTS.electric }, shock: { ...FX_DEFAULTS.shock } });
export const FX_TUNING = copy();
export function resetFxTuning() { Object.assign(FX_TUNING.electric, FX_DEFAULTS.electric); Object.assign(FX_TUNING.shock, FX_DEFAULTS.shock); }
