/** Sound bank ids and mix. Numeric ids keep the per-frame audio path free of string keys. */
export const SFX = Object.freeze({
  jump: 0, land: 1, fall_hit: 2, fall_bounce: 3, mew: 4, pickup: 5, drop: 6, throw: 7, dash: 8, slip: 9,
  spray_start: 10, pop: 11, clean: 12, order_complete: 13, round_end: 14, ui_click: 15,
  spray_loop: 16, soap_loop: 17, wipe_loop: 18, rinse_loop: 19,
  step: 20, splash_ground_loop: 21, splash_truck_loop: 22, splash_stain_loop: 23, splash_cat_loop: 24, progress_bubble: 25,
  road_sign_whoosh: 26, road_sign_hit: 27, vehicle_arrive: 28, vehicle_leave: 29,
  electric_loop: 30, shock_zap: 31, short_explosion: 32, plug_pop: 33,
  slap_swing: 34, slap_hit: 35, order_complete_rival: 36, wing_flap: 37,
});
export const BANK_NAMES = Object.keys(SFX);

/** Per bank: gain (linear), random pitch spread (± ratio), minimum retrigger gap per key (s), steal priority. */
export const MIX = BANK_NAMES.map(() => ({ gain: 1, pitch: 0, gap: 0, priority: 1 }));
const set = (name, mix) => Object.assign(MIX[SFX[name]], mix);
set('jump', { gain: 0.7, pitch: 0.06, gap: 0.08 });
set('land', { gain: 0.85, pitch: 0.06, gap: 0.08 });
set('fall_hit', { gain: 0.85, pitch: 0.04, priority: 2 });
set('fall_bounce', { gain: 0.7, pitch: 0.05 });
set('mew', { gain: 0.55, pitch: 0.08, gap: 1.5 });
set('pickup', { gain: 0.75, pitch: 0.05 });
set('drop', { gain: 0.7, pitch: 0.06 });
set('throw', { gain: 0.8, pitch: 0.05 });
set('dash', { gain: 0.6, pitch: 0.06 });
set('slip', { gain: 0.8, pitch: 0.03 });
set('spray_start', { gain: 0.7, pitch: 0.03 });
set('pop', { gain: 0.8, pitch: 0.05, gap: 0.05, priority: 2 });
set('clean', { gain: 0.8, priority: 3 });
set('order_complete', { gain: 0.9, priority: 3 });
set('round_end', { gain: 0.9, priority: 3 });
set('ui_click', { gain: 0.5, pitch: 0.04, gap: 0.03, priority: 2 });
set('spray_loop', { gain: 0.55 });
set('soap_loop', { gain: 0.6 });
set('wipe_loop', { gain: 0.6 });
set('rinse_loop', { gain: 0.55 });
set('step', { gain: 0.5, pitch: 0.08, gap: 0.1 });
set('splash_ground_loop', { gain: 0.7 });
set('splash_truck_loop', { gain: 0.7 });
set('splash_stain_loop', { gain: 0.7 });
set('splash_cat_loop', { gain: 0.6 });
set('progress_bubble', { gain: 0.6, pitch: 0.015 });
set('road_sign_whoosh', { gain: 0.75, pitch: 0.04, gap: 0.5, priority: 2 });
set('road_sign_hit', { gain: 0.9, pitch: 0.03, priority: 3 });
set('vehicle_arrive', { gain: 0.7, pitch: 0.03, priority: 2 });
set('vehicle_leave', { gain: 0.7, pitch: 0.03, priority: 2 });
set('electric_loop', { gain: 0.5 });
set('shock_zap', { gain: 0.8, pitch: 0.04, gap: 0.3, priority: 3 });
set('short_explosion', { gain: 0.85, pitch: 0.03, priority: 3 });
set('plug_pop', { gain: 0.75, pitch: 0.05, priority: 2 });
set('slap_swing', { gain: 0.85, pitch: 0.07, gap: 0.05, priority: 2 });
set('slap_hit', { gain: 1, pitch: 0.05, gap: 0.04, priority: 3 });
set('order_complete_rival', { gain: 0.85, priority: 3 });
set('wing_flap', { gain: 0.75, pitch: 0.06, gap: 0.1, priority: 2 });

/**
 * Progress bubbling: a stream of water bloops while a stain cleans. Their playback rate climbs
 * 1.3 octaves across the stain's whole cleaning (≈550 → 1350 Hz); `interval` is the gap between bubbles.
 */
export const PROGRESS = Object.freeze({ low: 0.6, octaves: 1.3, interval: 0.09, jitter: 0.05 });

/** File "jump_2.wav" → bank id of "jump"; null when the file is not a known bank. */
export function bankOfFile(path) {
  const name = path.split('/').pop().replace(/\.wav$/, '').replace(/_\d+$/, '');
  return name in SFX ? SFX[name] : null;
}

/**
 * Background music. Files come from tools/sfx/music.py (loop crossfade baked before loopEnd);
 * `volume` keeps music well under the effects (in-game ≈ −27 LUFS vs effects ≈ −17 LUFS short-term).
 */
export const MUSIC = Object.freeze({ menu: 0, game: 1 });
export const MUSIC_TRACKS = [
  { name: 'menu', title: 'Lazy Sunday Swing', loopStart: 51.8337, loopEnd: 121.31, volume: 0.55 },
  { name: 'game', title: 'Swinging with the Band', loopStart: 7.555, loopEnd: 101.19, volume: 0.4 },
];

/**
 * Frequency avoidance on the music bus. The effects concentrate in 250 Hz–2 kHz (≈59 % of their
 * weighted energy) with transient clarity around 3 kHz, so the music is carved there statically and
 * dips further (dynamic EQ + small gain duck) while effects sound.
 */
export const MUSIC_EQ = Object.freeze({
  highpass: 35,
  carve: [{ type: 'peaking', frequency: 1000, Q: 0.8, gain: -3 }, { type: 'peaking', frequency: 3000, Q: 1, gain: -2 }, { type: 'highshelf', frequency: 7000, Q: 0.7, gain: -2 }],
  duck: { frequency: 1100, Q: 0.7, gainDb: -6, levelDb: -3, attack: 0.015, release: 0.25 },
  paused: { lowpass: 1200, volume: 0.5 },
});
