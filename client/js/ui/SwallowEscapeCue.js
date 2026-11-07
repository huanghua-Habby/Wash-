import { localizedText, localizedAttr } from '../i18n/Localization.js';
import { WASH_CONFIG as C } from '../../../shared/sim/washConfig.js';

/** Big centre-low cue for the local player inside a pelican: what happened, that mashing any key breaks free, and a bar
 * that jumps forward with each accepted press so the escape is visibly sped up. Replaces the small bottom toast for this
 * state. Presentation only: reads the applied shared `swallowRemaining`; the host still counts the presses. */
export class SwallowEscapeCue {
  constructor(motionAllowed = () => true) {
    this.motionAllowed = motionAllowed;
    this.root = document.createElement('section'); this.root.className = 'swallow-escape'; this.root.hidden = true;
    this.root.setAttribute('role', 'alert');
    const title = document.createElement('strong'); title.className = 'swallow-escape-title'; localizedText(title, '被鹈鹕吞下了！');
    const keys = document.createElement('div'); keys.className = 'swallow-escape-keys'; keys.setAttribute('aria-hidden', 'true');
    for (const label of ['J', 'K', '␣']) { const key = document.createElement('kbd'); key.textContent = label; keys.appendChild(key); }
    const action = document.createElement('span'); action.className = 'swallow-escape-action'; localizedText(action, '连按任意键挣脱！');
    const row = document.createElement('div'); row.className = 'swallow-escape-row'; row.append(keys, action);
    this.bar = document.createElement('div'); this.bar.className = 'swallow-escape-bar'; this.bar.setAttribute('role', 'progressbar');
    this.bar.setAttribute('aria-valuemin', '0'); this.bar.setAttribute('aria-valuemax', '100'); localizedAttr(this.bar, 'aria-label', '挣脱进度');
    this.fill = document.createElement('i'); this.bar.appendChild(this.fill);
    this.root.append(title, row, this.bar);
    document.getElementById('ui-stage').appendChild(this.root);
    this.shown = -1;
  }

  update(visible, player) {
    if (!visible || player?.state !== 'swallowed') { this.hide(); return; }
    const progress = Math.max(0, Math.min(1, 1 - (player.swallowRemaining || 0) / C.swallowSeconds));
    const level = Math.round(progress * 100);
    const fresh = this.root.hidden;
    if (fresh) this.root.hidden = false;
    if (fresh || level !== this.shown) {
      // A jump bigger than the plain countdown is an accepted press: nudge the bar.
      if (!fresh && level - this.shown >= 3 && this.motionAllowed()) { this.bar.classList.remove('bump'); void this.bar.offsetWidth; this.bar.classList.add('bump'); }
      this.shown = level; this.fill.style.transform = `scaleX(${progress})`; this.bar.setAttribute('aria-valuenow', String(level));
    }
  }

  hide() {
    if (this.root.hidden) return;
    this.root.hidden = true; this.shown = -1; this.bar.classList.remove('bump');
  }
  dispose() { this.root.remove(); }
}
