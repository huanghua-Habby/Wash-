const BLOCK = new Set(['Space', 'Tab', 'Backquote', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash', 'NumpadAdd', 'NumpadSubtract']);
/** Keys whose fresh presses count as a struggle while swallowed; held-key auto-repeat never counts. */
const STRUGGLE = new Set(['Space', 'KeyJ', 'KeyK', 'KeyL', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.strikes = 0;
    this.enabled = true;
    this.listeners = new AbortController();
    const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    addEventListener('keydown', (e) => {
      if (!this.enabled || (typing(e) && e.code !== 'Backquote')) return;
      if (e.target.tagName === 'BUTTON' && e.code === 'Space') return;
      if (BLOCK.has(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) { this.pressed.add(e.code); if (STRUGGLE.has(e.code)) this.strikes++; }
      this.keys.add(e.code);
    }, { signal: this.listeners.signal });
    addEventListener('keyup', (e) => this.keys.delete(e.code), { signal: this.listeners.signal });
    addEventListener('blur', () => this.clear(), { signal: this.listeners.signal });
  }

  dispose() { this.listeners.abort(); this.setEnabled(false); }
  clear() { this.keys.clear(); this.pressed.clear(); this.strikes = 0; }
  setEnabled(enabled) { this.enabled = enabled; this.clear(); }

  down(...codes) { return codes.some((c) => this.keys.has(c)); }
  hit(code) { return this.pressed.has(code); }
  /** Fresh struggle-key presses since the last frame. */
  struggles() { return this.strikes; }

  // x: 右为正, y: 下(靠近镜头)为正
  axis() {
    const x = (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0);
    const y = (this.down('KeyS', 'ArrowDown') ? 1 : 0) - (this.down('KeyW', 'ArrowUp') ? 1 : 0);
    return { x, y };
  }

  endFrame() { this.pressed.clear(); this.strikes = 0; }
}
