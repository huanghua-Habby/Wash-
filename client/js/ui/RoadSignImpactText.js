import { localizedText } from '../i18n/Localization.js';
import { Vector3 } from 'three';
import { roadSignFrame, roadSignTone } from '../../../shared/sim/RoadSigns.js';

const LIFE = 1.05, WORDS = ['哐~!', '哐!!', '哐当~!']; // ASCII punctuation: the rounded font has no full-width ！～

/** UIManager-owned comic "哐~!" pop at each confirmed road-sign hit; one pooled node per player slot.
 * Triggered by a new authoritative `roadSignAttachment` id. Pinned where the hit happened while the sign flies on.
 */
export class RoadSignImpactText {
  constructor(players, positioner, motionAllowed = () => true) {
    this.players = players; this.positioner = positioner; this.motionAllowed = motionAllowed;
    this.offset = new Vector3();
    const stage = document.getElementById('ui-stage');
    this.pops = players.map((player, slot) => {
      const node = document.createElement('div'); node.className = 'road-sign-pop'; node.hidden = true;
      node.setAttribute('aria-hidden', 'true'); node.dataset.slot = String(slot);
      const word = document.createElement('strong'); node.appendChild(word); stage.appendChild(node);
      return { node, word, anchor: new Vector3(), life: 0, id: player.roadSignAttachment?.id || null, serial: 0 };
    });
  }
  update(game, visible, dt) {
    const entries = game.roadSigns.entries();
    this.players.forEach((player, slot) => {
      const pop = this.pops[slot], id = player.roadSignAttachment?.id || null;
      if (id !== pop.id) {
        pop.id = id;
        const entry = id && player.occupied !== false && entries.find(entry => entry.id === id);
        const frame = entry && roadSignFrame(entry, game.roadSigns.presentationTime(), game.homeTruck, game.level.road);
        // Only fresh hits pop; a stale snapshot (the sign already gone) just moves the baseline.
        if (frame?.phase === 'passing') this.start(pop, frame, player, roadSignTone(game.roadSigns.definitions, id));
      }
      if (pop.life <= 0) return;
      if (!game.paused) pop.life = Math.max(0, pop.life - dt);
      const paused = String(!!game.paused);
      if (pop.node.dataset.paused !== paused) pop.node.dataset.paused = paused;
      if (!visible || pop.life <= 0) { this.positioner.hide(pop.node); return; }
      this.positioner.place(pop.node, pop.anchor, { identity: pop.serial, immediate: true,
        screenInsets: { left: 70, right: 70, top: 90, bottom: 20 } });
    });
  }
  start(pop, frame, player, tone) {
    pop.anchor.set(frame.x, frame.y + 1.9, frame.z).add(this.offset.fromArray(player.roadSignAttachment.offset));
    pop.life = LIFE; pop.serial++;
    localizedText(pop.word, WORDS[pop.serial % WORDS.length]);
    pop.node.dataset.tone = tone;
    // Restart the CSS pop; quiet UI keeps the static word for the same time.
    pop.node.classList.remove('popping');
    if (this.motionAllowed()) { void pop.node.offsetWidth; pop.node.classList.add('popping'); }
  }
  dispose() { for (const pop of this.pops) { this.positioner.hide(pop.node); pop.node.remove(); } this.pops = []; }
}
