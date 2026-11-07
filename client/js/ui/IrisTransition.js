const ease = (t) => t * t * (3 - 2 * t);

// A shrinking WASH-shaped opening closes to black before the scene changes.
export class IrisTransition {
  /** @param {{ motionEnabled?: () => boolean }} [options] */
  constructor({ motionEnabled = () => true } = {}) {
    this.motionEnabled = motionEnabled;
    this.surface = document.getElementById('wash-iris-layer');
    this.layer = document.getElementById('wash-iris');
    this.cutout = document.getElementById('wash-cutout');
    this.opening = document.getElementById('wash-opening');
    this.active = false;
    this.revision = 0;
    this.listeners = new AbortController();
    // Escape must not dismiss the mask while a scene transaction is pending.
    this.surface.addEventListener('cancel', event => event.preventDefault(), { signal: this.listeners.signal });
    this.surface.addEventListener('keydown', event => { event.preventDefault(); event.stopPropagation(); }, { signal: this.listeners.signal });
  }
  async prepare() {
    // Paint the vector mask once behind the opaque boot screen before first use.
    this.layer.removeAttribute('hidden');
    this.surface.show();
    this.draw(1, 1);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    this.layer.setAttribute('hidden', '');
    this.surface.close();
  }
  show() {
    this.layer.removeAttribute('hidden');
    if (!this.surface.open) this.surface.showModal();
  }
  reset() {
    this.revision++;
    this.active = false; this.phase = 'idle'; this.onCovered = null; this.onDone = null;
    this.layer.setAttribute('hidden', ''); this.layer.dataset.phase = 'idle';
    if (this.surface.open) this.surface.close();
  }
  dispose() {
    this.reset(); this.listeners.abort();
  }
  start(onCovered, onDone) {
    if (this.active) return;
    Object.assign(this, { active: true, phase: 'close', elapsed: 0, onCovered, onDone });
    this.show();
    this.layer.dataset.phase = 'close';
    this.draw(this.motionEnabled() ? 40 : 0, this.motionEnabled() ? 0 : 1);
  }
  draw(scale, opacity) {
    this.cutout.setAttribute('transform', `translate(720 405) scale(${scale}) translate(-720 -405)`);
    // Large letter counters/gaps otherwise sweep sideways across the screen.
    // A centered opening takes over once the word has grown beyond its readable size.
    this.opening.setAttribute('r', Math.max(0, scale - 1) * 120);
    this.layer.style.opacity = opacity;
  }
  reveal(onDone) {
    Object.assign(this, { active: true, phase: 'open', elapsed: 0, onDone });
    this.show(); this.layer.dataset.phase = 'open'; this.draw(0, 1);
  }
  update(dt) {
    if (!this.active) return;
    if (this.phase === 'wait' || this.phase === 'error') return;
    this.elapsed += dt;
    const t = this.motionEnabled() ? Math.min(1, this.elapsed / 0.7) : 1;
    if (this.phase === 'close') {
      this.draw(40 * (1 - ease(t)) ** 3, Math.min(1, t * 5));
      if (t === 1) {
        this.draw(0, 1);
        this.phase = 'wait'; this.layer.dataset.phase = 'wait';
        const revision = this.revision;
        // Scene commit and resource readiness may take longer than the mask animation.
        Promise.resolve().then(() => { if (this.active && this.revision === revision) return this.onCovered?.(); }).then(() => {
          if (!this.active || this.revision !== revision) return;
          this.phase = 'open'; this.layer.dataset.phase = 'open'; this.elapsed = 0;
        }).catch((error) => {
          if (!this.active || this.revision !== revision) return;
          this.phase = 'error'; this.layer.dataset.phase = 'error';
          console.error('返回主页转场未完成', error);
        });
      }
    } else {
      this.draw(40 * ease(t) ** 3, 1 - Math.max(0, (t - 0.8) / 0.2));
      if (t === 1) {
        const done = this.onDone;
        this.reset();
        done?.();
      }
    }
  }
}
