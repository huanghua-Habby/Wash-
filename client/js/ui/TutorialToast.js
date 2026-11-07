import { localizedText, localizedAttr, localizeMarkup, format } from '../i18n/Localization.js';
/** Non-modal applied-state view. It has no controls, clocks or task-completion rules. */
export class TutorialToast {
  constructor(ui) {
    this.ui = ui;
    this.root = document.createElement('section'); this.root.className = 'tutorial-toast'; this.root.hidden = true;
    localizedAttr(this.root, 'aria-label', '实操教学');
    (this.root.innerHTML = '<div class="tutorial-toast-copy" role="status" aria-live="polite"><span class="tutorial-toast-kicker">上手练习</span><p></p></div><div class="tutorial-toast-dots" role="group"></div>', localizeMarkup(this.root));
    this.copy = this.root.querySelector('p'); this.dotsRoot = this.root.querySelector('.tutorial-toast-dots');
    this.dots = Array.from({ length: 4 }, () => {
      const dot = document.createElement('span'); dot.className = 'tutorial-task-dot'; dot.hidden = true;
      this.dotsRoot.appendChild(dot); return dot;
    });
    document.getElementById('ui-stage').appendChild(this.root);
  }
  /** @param {import('../../../shared/levelContracts.js').TutorialState} state */
  update(state, visible, scope = '') {
    if (!state || !visible || !state.text) { this.reset(); return; }
    const revision = `${scope}:${state.stepId}:${state.revision}:${state.text}`;
    const changed = this.revision !== revision;
    this.revision = revision; this.root.hidden = false;
    if (this.copy.textContent !== state.text) localizedText(this.copy, state.text);
    const entries = state.dots?.entries || [], players = state.dots?.kind === 'players';
    localizedAttr(this.dotsRoot, 'aria-label', players ? '玩家完成状态' : '污渍清洁状态');
    this.dotsRoot.hidden = entries.length === 0;
    this.dots.forEach((dot, index) => {
      const entry = entries[index]; dot.hidden = !entry;
      if (!entry) return;
      const active = entry.active === true, complete = active && entry.complete === true;
      dot.classList.toggle('inactive', !active); dot.classList.toggle('complete', complete);
      dot.dataset.id = String(entry.id); localizedText(dot, players && Number.isInteger(entry.slot) ? String(entry.slot + 1) : String(index + 1));
      localizedAttr(dot, 'aria-label', format("{0} · {1}", players ? format("玩家 {0}", entry.slot + 1) : format("污渍 {0}", index + 1), !active ? '未参与' : complete ? '已完成' : '未完成'));
    });
    if (changed) {
      this.root.getAnimations().forEach(animation => animation.cancel());
      if (this.ui.motionAllowed) this.root.animate([
        { opacity: 0, transform: 'translate(-50%, -12px)' }, { opacity: 1, transform: 'translate(-50%, 0)' },
      ], { duration: 200, easing: 'ease-out' });
    }
  }
  reset() {
    if (this.revision === null && this.root.hidden) return;
    this.revision = null; this.root.hidden = true; this.root.getAnimations().forEach(animation => animation.cancel());
  }
  dispose() { this.reset(); this.root.remove(); }
}
