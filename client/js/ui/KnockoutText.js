import { localizedText } from '../i18n/Localization.js';

const LIFE = 1.1;

/** UIManager-owned knock-off feedback: a big comic "砰～!" with a small "打下车！" tag bursts in the upper middle of the
 * screen when the host credits the local player with knocking someone off (`knockoutSerial`, StatsTally.fell). Fixed on
 * screen rather than over the body, so it never drops out at the screen edge. Read-only; the camera thump and the
 * post-processing punch come from SceneCamera, the sound from GameAudio. */
export class KnockoutText {
  constructor(motionAllowed = () => true) {
    this.motionAllowed = motionAllowed;
    this.node = document.createElement('div'); this.node.className = 'knockout-pop'; this.node.hidden = true;
    this.node.setAttribute('role', 'status'); this.node.setAttribute('aria-live', 'polite');
    this.node.innerHTML = '<div class="knockout-pop-inner"><strong></strong><span></span></div>';
    this.inner = this.node.firstElementChild;
    localizedText(this.node.querySelector('strong'), '砰～!'); localizedText(this.node.querySelector('span'), '打下车！');
    document.getElementById('ui-stage').appendChild(this.node);
    this.life = 0; this.seen = null;
  }
  update(player, visible, dt, scope) {
    const count = player?.knockoutSerial || 0;
    if (scope !== this.scope || !visible || !player) { this.scope = scope; this.seen = count; this.hide(); return; }
    if (this.seen !== null && count > this.seen) {
      this.life = LIFE; this.node.hidden = false;
      this.inner.classList.remove('popping');
      if (this.motionAllowed()) { void this.inner.offsetWidth; this.inner.classList.add('popping'); }
    }
    this.seen = count;
    if (this.life <= 0) return;
    this.life = Math.max(0, this.life - dt);
    if (this.life <= 0) this.hide();
  }
  hide() { this.life = 0; this.inner.classList.remove('popping'); this.node.hidden = true; }
  dispose() { this.hide(); this.node.remove(); }
}
