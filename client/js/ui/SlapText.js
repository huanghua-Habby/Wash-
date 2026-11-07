import { Vector3 } from 'three';
import { localizedText } from '../i18n/Localization.js';
import { CHARACTER_SCALE } from '../../../shared/sim/characterScale.js';

const LIFE = 0.8;

/** UIManager-owned comic "啪!" over a slapped player ("踩!" for a head stomp, `stompedSerial`); reads the host-confirmed
 * serials, never predicts a hit. */
export class SlapText {
  constructor(players, positioner, motionAllowed = () => true) {
    Object.assign(this, { players, positioner, motionAllowed });
    const stage = document.getElementById('ui-stage');
    this.pops = players.map((player, slot) => {
      const node = document.createElement('div'); node.className = 'slap-pop'; node.hidden = true;
      node.setAttribute('aria-hidden', 'true'); node.dataset.slot = String(slot);
      const word = document.createElement('strong'); localizedText(word, '啪!');
      node.appendChild(word); stage.appendChild(node);
      return { node, word, said: '啪!', anchor: new Vector3(), life: 0, seen: player.slappedSerial || 0, stomps: player.stompedSerial || 0, serial: 0 };
    });
  }
  update(visible, dt, scope) {
    if (scope !== this.scope || !visible) { this.scope = scope; this.reset(); return; }
    this.players.forEach((player, slot) => {
      const pop = this.pops[slot], serial = player.slappedSerial || 0, fresh = serial !== pop.seen;
      const stomps = player.stompedSerial || 0, stomped = stomps !== pop.stomps;
      pop.seen = serial; pop.stomps = stomps;
      if (player.occupied === false) { pop.life = 0; this.positioner.hide(pop.node); return; }
      if (fresh && player.root.visible) {
        pop.anchor.copy(player.root.position); pop.anchor.y += 1.4 * CHARACTER_SCALE;
        const said = stomped ? '踩!' : '啪!';
        if (said !== pop.said) { pop.said = said; localizedText(pop.word, said); }
        pop.life = LIFE; pop.serial++;
        pop.node.classList.remove('popping');
        if (this.motionAllowed()) { void pop.node.offsetWidth; pop.node.classList.add('popping'); }
      }
      if (pop.life <= 0) return;
      pop.life = Math.max(0, pop.life - dt);
      if (pop.life <= 0) { this.positioner.hide(pop.node); return; }
      this.positioner.place(pop.node, pop.anchor, { identity: pop.serial, immediate: true, margin: 1 });
    });
  }
  reset() {
    this.pops.forEach((pop, slot) => { pop.life = 0; pop.seen = this.players[slot].slappedSerial || 0; pop.stomps = this.players[slot].stompedSerial || 0; pop.node.classList.remove('popping'); this.positioner.hide(pop.node); });
  }
  dispose() { this.reset(); for (const pop of this.pops) pop.node.remove(); this.pops = []; }
}
