import { Vector3 } from 'three';
import { localizedText } from '../i18n/Localization.js';
import { isWorldFrozen } from '../../../shared/sim/roundFlow.js';
import { CHARACTER_SCALE } from '../../../shared/sim/characterScale.js';

const LIFE = 0.85;

/** UIManager-owned comic text; reads confirmed slip timers, never predicts a soap hit. */
export class SoapSlipText {
  constructor(players, positioner, motionAllowed = () => true) {
    Object.assign(this, { players, positioner, motionAllowed });
    const stage = document.getElementById('ui-stage');
    this.pops = players.map((player, slot) => {
      const node = document.createElement('div'); node.className = 'soap-slip-pop'; node.hidden = true;
      node.setAttribute('aria-hidden', 'true'); node.dataset.slot = String(slot);
      const word = document.createElement('strong'); localizedText(word, '哧溜~!');
      node.appendChild(word); stage.appendChild(node);
      return { node, anchor: new Vector3(), life: 0, seen: player.slipRemaining || 0, serial: 0 };
    });
  }
  update(game, visible, dt, scope) {
    if (scope !== this.scope || !visible) { this.scope = scope; this.reset(); return; }
    const paused = isWorldFrozen(game);
    this.players.forEach((player, slot) => {
      const pop = this.pops[slot], slip = player.slipRemaining || 0;
      const fresh = slip > pop.seen + 0.02; pop.seen = slip;
      if (player.occupied === false) { pop.life = 0; this.positioner.hide(pop.node); return; }
      if (fresh && player.root.visible) {
        pop.anchor.copy(player.root.position); pop.anchor.y += 1.6 * CHARACTER_SCALE;
        pop.life = LIFE; pop.serial++;
        pop.node.classList.remove('popping');
        if (this.motionAllowed()) { void pop.node.offsetWidth; pop.node.classList.add('popping'); }
      }
      if (pop.life <= 0) return;
      if (!paused) pop.life = Math.max(0, pop.life - dt);
      pop.node.dataset.paused = String(paused);
      if (pop.life <= 0) { this.positioner.hide(pop.node); return; }
      this.positioner.place(pop.node, pop.anchor, { identity: pop.serial, immediate: true,
        screenInsets: { left: 110, right: 110, top: 70, bottom: 25 } });
    });
  }
  reset() {
    this.pops.forEach((pop, slot) => {
      pop.life = 0; pop.seen = this.players[slot].slipRemaining || 0;
      pop.node.classList.remove('popping'); this.positioner.hide(pop.node);
    });
  }
  dispose() { this.reset(); for (const pop of this.pops) pop.node.remove(); this.pops = []; }
}
