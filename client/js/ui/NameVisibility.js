/** Shared name/tag presentation clock, advanced once per UIManager world frame. */
export class NameVisibility {
  constructor() { this.opacity = 1; this.phase = 'home'; this.manualRemaining = 0; }
  showTemporarily() { this.manualRemaining = 2.85; }
  update({ phase, active, ended, elapsed = 0, dt = 0, motionEnabled = true }) {
    if (phase !== 'game' || !active || ended) this.manualRemaining = 0;
    if (!motionEnabled) {
      this.manualRemaining = Math.max(0, this.manualRemaining - dt);
      const manual = this.manualRemaining > 0;
      this.opacity = phase === 'home' || (!ended && (manual || (phase === 'game' && active && elapsed > 0 && elapsed <= 2.5))) ? 1 : 0;
      this.phase = phase === 'home' ? 'home' : manual && !ended ? 'manual' : this.opacity ? 'round-intro' : 'hidden';
      return this.opacity;
    }
    if (phase === 'home') { this.opacity = 1; this.phase = 'home'; }
    else if (this.manualRemaining > 0) {
      this.manualRemaining = Math.max(0, this.manualRemaining - dt);
      this.opacity = Math.min(1, this.manualRemaining / 0.35);
      this.phase = this.manualRemaining > 0.35 ? 'manual' : this.opacity > 0 ? 'fading' : 'hidden';
    }
    else if (ended) { this.opacity = 0; this.phase = 'hidden'; }
    else if (phase === 'game' && active && elapsed > 0) {
      this.opacity = Math.max(0, Math.min(1, 1 - (elapsed - 2.5) / 0.35));
      this.phase = elapsed <= 2.5 ? 'round-intro' : this.opacity > 0 ? 'fading' : 'hidden';
    } else {
      this.opacity = Math.max(0, this.opacity - dt / 0.25);
      this.phase = this.opacity > 0 ? 'entering' : 'hidden';
    }
    return this.opacity;
  }
}
