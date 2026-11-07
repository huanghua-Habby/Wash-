import { localizedText, localizedAttr, format } from '../i18n/Localization.js';
import { CLEANING_THEME, applyCleaningTheme } from '../core/cleaningTheme.js';

const shapes = {
  soap: '<rect x="3" y="9" width="16" height="11" rx="4"/><path d="M7 13h8"/><circle cx="17" cy="5" r="2"/><circle cx="8" cy="5" r="1"/>',
  water: '<path d="M3 8h13v7H8l-2 5H2l2-7H3zM16 10h4v3h-4M8 8V5h6v3M21 5l1-2M22 17l1 1"/>',
  towel: '<path d="M4 4h14v4h3v13H7v-4H3V4zM7 8h11M7 8v9h14M10 11h8M10 14h6"/>',
};

/** Fixed inline vector art, created once. No font/emoji dependency or runtime image loading. */
export function cleaningIcon(kind) {
  return `<svg class="cleaning-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[kind] || shapes.towel}</svg>`;
}

export function labelCleaningTool(node, kind, label) {
  applyCleaningTheme(node, kind);
  node.innerHTML = `${cleaningIcon(kind)}<span></span>`;
  localizedText(node.lastElementChild, label);
}

const SMUDGE_THEME = { '--clean-accent': '#D0643F', '--clean-paper': '#FFF0E6', '--clean-ink': '#8A3A1C' };

/** A compact action route, fed only the applied host stage/progress. UIManager owns its frame. */
export class CleaningCue {
  constructor(steps) {
    this.steps = steps;
    const root = this.root = document.createElement('div'); root.className = 'stain-badge';
    root.setAttribute('role', 'img');
    const route = document.createElement('div'); route.className = 'stain-steps';
    this.nodes = steps.map((kind, index) => {
      if (index) {
        const arrow = document.createElement('i'); arrow.className = 'stain-arrow'; localizedText(arrow, '›'); arrow.setAttribute('aria-hidden', 'true');
        route.appendChild(arrow);
      }
      const step = document.createElement('span'); step.className = 'stain-step'; applyCleaningTheme(step, kind);
      step.innerHTML = `${cleaningIcon(kind)}<b class="stain-action"></b><b class="stain-check" aria-hidden="true">✓</b>`;
      localizedText(step.querySelector('.stain-action'), CLEANING_THEME[kind].action);
      step.setAttribute('aria-hidden', 'true'); route.appendChild(step);
      return step;
    });
    // Versus: the same badge turns into a "smear it" call-out while the local player holds a usable dirty towel.
    const smudge = document.createElement('div'); smudge.className = 'stain-smudge'; smudge.setAttribute('aria-hidden', 'true');
    smudge.innerHTML = `${cleaningIcon('towel')}<b></b>`; localizedText(smudge.lastElementChild, '抹脏');
    const bar = document.createElement('div'); bar.className = 'wipe-bar';
    this.fill = document.createElement('i'); bar.appendChild(this.fill); root.append(route, smudge, bar);
    // Wrong tool: a speech bubble with the right tool's icon pops above the badge and shakes (WrongToolHint).
    this.need = document.createElement('div'); this.need.className = 'stain-need'; this.need.hidden = true;
    this.needKind = ''; root.appendChild(this.need);
    // Ground mark under the stain (part B of the cue); positioned by the world HUD.
    this.spot = document.createElement('div'); this.spot.className = 'smudge-spot'; this.spot.hidden = true; this.spot.setAttribute('aria-hidden', 'true');
    this.stage = -1; this.progress = -1;
    this.update({ stage: 0, progress: 0 });
  }
  /** Pop (or restart) the "use this" bubble for the stain's current step; `on` false hides it. */
  setNeed(on, kind = '', serial = 0) {
    if (!on) { if (!this.need.hidden) { this.need.hidden = true; this.root.classList.remove('needs-tool'); } this.needSerial = 0; return; }
    if (kind !== this.needKind) {
      this.needKind = kind; applyCleaningTheme(this.need, kind);
      this.need.innerHTML = `${cleaningIcon(kind)}<b></b>`; localizedText(this.need.lastElementChild, CLEANING_THEME[kind].name);
      localizedAttr(this.need, 'aria-label', format('这一步要用{0}', CLEANING_THEME[kind].name));
    }
    if (serial !== this.needSerial) {
      // Restart the pop-and-shake on every new wrong press.
      this.needSerial = serial; this.need.hidden = false; this.root.classList.add('needs-tool');
      this.need.classList.remove('shake'); void this.need.offsetWidth; this.need.classList.add('shake');
    }
  }

  /** `undoable` is the clean share a dirty towel could still rub back (1 for a finished stain). */
  setSmudge(active, undoable = 0) {
    if (this.smudging !== active) {
      this.smudging = active; this.root.classList.toggle('smudge', active);
      if (active) {
        // The stain theme is inline; the smear palette must be inline too to take over.
        for (const [key, value] of Object.entries(SMUDGE_THEME)) this.root.style.setProperty(key, value);
        localizedAttr(this.root, 'aria-label', '可以用脏毛巾抹脏这块');
      }
      else { this.stage = -1; this.progress = -1; } // Restore the route label/progress on the next update.
    }
    if (active) { const width = `${Math.round(Math.max(0, Math.min(1, undoable)) * 1000) / 10}%`; if (this.fill.style.width !== width) this.fill.style.width = width; }
  }
  setFocused(focused) {
    if (this.focused === focused) return;
    this.focused = focused; this.root.classList.toggle('task-focused', focused);
  }
  update(stain) {
    if (this.smudging) return;
    if (stain.stage !== this.stage) {
      this.stage = stain.stage;
      const kind = this.steps[stain.stage];
      if (kind) {
        applyCleaningTheme(this.root, kind);
        localizedAttr(this.root, 'aria-label', format("第 {0}/{1} 步：用{2}{3}。顺序：{4}", stain.stage + 1, this.steps.length, CLEANING_THEME[kind].name, CLEANING_THEME[kind].action, this.steps.map(step => CLEANING_THEME[step].name).join('、')));
      }
      this.nodes.forEach((node, index) => {
        node.classList.toggle('done', index < stain.stage); node.classList.toggle('current', index === stain.stage);
      });
    }
    const progress = Math.round(Math.max(0, Math.min(1, stain.progress)) * 1000) / 10;
    if (progress !== this.progress) { this.progress = progress; this.fill.style.width = `${progress}%`; }
  }
}
