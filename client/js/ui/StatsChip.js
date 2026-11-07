/** Small "my record" chip (UIManager panel): the local player's contribution (and versus disruption / co-op mischief),
 * with a "+N" that floats up whenever the shared record grows, and a Tab hint pointing to the full board.
 * Co-op: one chip on top of the score panel. Versus: the chip sits top right, as in most versus games, and the Tab hint
 * stands alone at the left middle (the team score board takes the top centre). Read-only over the applied snapshot. */
import { localizedText, localizedAttr, format } from '../i18n/Localization.js';
import { statPoints } from '../../../shared/sim/PlayerStats.js';

const BATCH = 0.45; // Seconds of gains gathered into one "+N", so a steady wipe reads +3, +3… not +1 every frame.
const FLOATS = 4;   // Prepared float nodes, reused round-robin.

export class StatsChip {
  constructor(motionAllowed) {
    this.motionAllowed = motionAllowed;
    this.root = document.createElement('section'); this.root.className = 'stats-chip'; this.root.hidden = true;
    localizedAttr(this.root, 'aria-label', '我的战绩');
    this.work = this.counter('work', '贡献');
    this.harm = this.counter('harm', '干扰');
    const hint = document.createElement('span'); hint.className = 'stats-chip-hint';
    const key = document.createElement('kbd'); key.textContent = 'Tab';
    const label = document.createElement('span'); localizedText(label, '战绩');
    hint.append(key, label); this.hint = hint;
    this.root.append(this.work.node, this.harm.node, hint);
    this.floats = Array.from({ length: FLOATS }, () => {
      const node = document.createElement('b'); node.className = 'stats-chip-float'; node.hidden = true; node.setAttribute('aria-hidden', 'true');
      this.root.appendChild(node); return node;
    });
    // Co-op: rides on top of the score panel, whatever its height (stars). Versus: placed by place().
    this.scorePanel = document.getElementById('score-panel'); this.controls = document.getElementById('game-controls');
    this.scorePanel.appendChild(this.root); this.placed = 'coop';
    this.reset();
  }

  counter(kind, label) {
    const node = document.createElement('span'); node.className = `stats-chip-count ${kind}`;
    const name = document.createElement('small'), value = document.createElement('strong');
    node.append(name, value); localizedText(name, label);
    return { node, name, value, shown: -1 };
  }

  update(dt, visible, game, localSlot, scope) {
    const entry = visible && game?.active ? game.stats?.[localSlot] : null;
    if (!entry) { this.root.hidden = true; this.hint.hidden = true; return; }
    const versus = game.mode === 'versus', points = statPoints(entry, versus ? 'versus' : 'coop');
    const harm = versus ? points.disruption : points.mischief;
    if (scope !== this.scope) { this.reset(); this.scope = scope; this.base = { work: points.contribution, harm }; }
    this.place(versus ? 'versus' : 'coop');
    this.root.hidden = false; this.hint.hidden = false; this.root.dataset.mode = versus ? 'versus' : 'coop';
    localizedText(this.harm.name, versus ? '干扰' : '捣蛋');
    this.set(this.work, points.contribution); this.set(this.harm, harm);
    this.harm.node.hidden = !versus && harm === 0;
    // Gains since the last float, released in batches.
    this.timer = Math.max(0, this.timer - dt);
    if (this.timer > 0) return;
    const gainWork = points.contribution - this.base.work, gainHarm = harm - this.base.harm;
    if (gainWork > 0) this.pop(gainWork, 'work', '贡献');
    else if (gainHarm > 0) this.pop(gainHarm, 'harm', versus ? '干扰' : '捣蛋');
    else return;
    if (gainWork > 0) this.base.work = points.contribution; else this.base.harm = harm;
    this.timer = BATCH;
  }

  /** Move the chip (and the Tab hint) between the co-op score panel and the versus corners. */
  place(mode) {
    if (mode === this.placed) return;
    this.placed = mode;
    if (mode === 'versus') { this.controls.append(this.root, this.hint); this.hint.classList.add('stats-tab-hint'); }
    else { this.scorePanel.appendChild(this.root); this.root.insertBefore(this.hint, this.floats[0]); this.hint.classList.remove('stats-tab-hint'); }
  }

  set(counter, value) {
    if (counter.shown === value) return;
    counter.shown = value; counter.value.textContent = String(value);
  }

  pop(amount, kind, label) {
    const node = this.floats[this.next++ % FLOATS];
    node.getAnimations().forEach(animation => animation.cancel());
    node.className = `stats-chip-float ${kind}`; node.hidden = false;
    localizedText(node, format('+{0} {1}', amount, label));
    if (!this.motionAllowed()) { node.hidden = true; return; }
    const counter = kind === 'work' ? this.work : this.harm;
    counter.node.animate([{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
    node.animate([
      { opacity: 0, transform: 'translate(0, 6px) scale(.8)' },
      { opacity: 1, transform: 'translate(0, -10px) scale(1.08)', offset: .2 },
      { opacity: 1, transform: 'translate(0, -26px) scale(1)', offset: .7 },
      { opacity: 0, transform: 'translate(0, -38px) scale(.96)' },
    ], { duration: 1050, easing: 'ease-out' }).finished.then(() => { node.hidden = true; }, () => {});
  }

  reset() {
    this.root.hidden = true; this.hint.hidden = true; this.scope = null; this.timer = 0; this.next = 0; this.base = { work: 0, harm: 0 };
    this.work.shown = this.harm.shown = -1;
    for (const node of this.floats) { node.getAnimations().forEach(animation => animation.cancel()); node.hidden = true; }
  }
  dispose() { this.reset(); this.root.remove(); this.hint.remove(); }
}
