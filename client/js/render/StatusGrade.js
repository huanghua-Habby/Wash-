/** Local-only screen grade for the player's own state (2026-10-21 user): presentation, never synced or judged.
 * - `desat` 0..1 while waiting to respawn: the frame loses about half its colour, so a death reads at once;
 * - `shock` 0..1 while shock-stunned: a white / pale sky-blue electric shimmer rims the screen;
 * - `down` 0..1 while knocked down (slap/stomp stun): a soft, steady white rim;
 * - `death` 0..1 for a short, soft red edge flash at the moment of death (kept light so the mood stays bright).
 * SceneCamera updates it from the presented local player; PostFX reads the three as uniforms in its existing pass. */
const ease = (value, target, rate, dt) => value + (target - value) * (1 - Math.exp(-rate * dt));

export class StatusGrade {
  constructor() { this.reset(); }
  reset() { this.desat = 0; this.shock = 0; this.down = 0; this.deathTime = Infinity; this.wasDown = null; }
  /** `player` is the local presented player (or null); `live` false outside a running world (home, results, frozen). */
  update(dt, player, live) {
    const fallen = !!live && player?.state === 'fallen';
    // A fresh death (not a world reset) starts the edge flash.
    if (this.wasDown === false && fallen) this.deathTime = 0;
    this.wasDown = player ? fallen : null;
    this.deathTime += dt;
    this.desat = ease(this.desat, fallen ? 1 : 0, fallen ? 2.2 : 7, dt);
    this.shock = ease(this.shock, live && player?.stunRemaining > 0 ? 1 : 0, 12, dt);
    this.down = ease(this.down, live && player?.downRemaining > 0 ? 1 : 0, 10, dt);
    if (this.down < 1e-3) this.down = 0;
    if (this.desat < 1e-3) this.desat = 0;
    if (this.shock < 1e-3) this.shock = 0;
  }
  /** 60 ms rise, then a 0.55 s fall. */
  get death() {
    const t = this.deathTime;
    if (!(t < 0.61)) return 0;
    return Math.min(1, t / 0.06) * (t < 0.06 ? 1 : (1 - (t - 0.06) / 0.55) ** 2);
  }
}
