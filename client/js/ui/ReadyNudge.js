/**
 * Versus guest on the main menu who has not readied up for a while: their "准备" button gives a little shake every
 * few seconds until they ready (or leave the room / the host starts). Presentation only; the room service's
 * ready rules are unchanged. Any change that clears ready (team swaps, settings, joins/leaves) restarts the wait.
 */
export const READY_NUDGE = Object.freeze({
  afterSeconds: 8,    // Not ready for this long on the versus main menu → start nudging.
  everySeconds: 4,    // Shake again this often while still not ready.
});

export class ReadyNudge {
  constructor(button) { this.button = button; this.waited = 0; this.sinceShake = 0; this.on = false; }

  /** `waiting`: a connected versus guest, on the home page, who is not ready. */
  update(dt, waiting, motionAllowed) {
    if (!waiting) { this.waited = 0; this.sinceShake = 0; this.set(false); return; }
    this.waited += dt;
    if (this.waited < READY_NUDGE.afterSeconds) { this.set(false); return; }
    this.set(true);
    this.sinceShake += dt;
    if (this.sinceShake >= READY_NUDGE.everySeconds || !this.shook) {
      this.sinceShake = 0; this.shook = true;
      if (motionAllowed) { this.button.classList.remove('nudge-shake'); void this.button.offsetWidth; this.button.classList.add('nudge-shake'); }
    }
  }

  set(on) {
    if (this.on === on) return;
    this.on = on; this.shook = false;
    this.button.classList.toggle('ready-nudge', on);
    if (!on) this.button.classList.remove('nudge-shake');
  }

  dispose() { this.set(false); }
}
