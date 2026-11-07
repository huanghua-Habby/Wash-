import { localizedText, localizedAttr, format } from '../i18n/Localization.js';

/** Versus team score board, pinned top centre (UIManager panel). Top strip: red combo · remaining time · blue combo
 * (the score target instead of the time when the match has no time limit). Below: big red / sky-blue score blocks that
 * bounce whenever their score changes. Read-only over the applied snapshot and the authority clock. */
export class VersusScoreHud {
  constructor(motionAllowed) {
    this.motionAllowed = motionAllowed;
    this.controls = document.getElementById('game-controls');
    this.root = document.createElement('section'); this.root.className = 'versus-hud'; this.root.hidden = true;
    localizedAttr(this.root, 'aria-label', '对抗比分');
    const strip = document.createElement('div'); strip.className = 'versus-hud-strip';
    this.combos = [0, 1].map(team => {
      const node = document.createElement('span'); node.className = `versus-hud-combo team-${team}`; return node;
    });
    this.time = document.createElement('strong'); this.time.className = 'versus-hud-time'; this.time.setAttribute('role', 'timer');
    strip.append(this.combos[0], this.time, this.combos[1]);
    const scores = document.createElement('div'); scores.className = 'versus-hud-scores';
    this.teams = [0, 1].map(team => {
      const block = document.createElement('div'); block.className = `versus-hud-team team-${team}`;
      const name = document.createElement('small'); localizedText(name, team === 0 ? '红队' : '蓝队');
      const value = document.createElement('b'); value.textContent = '0';
      block.append(name, value); scores.appendChild(block);
      return { block, value, shown: null };
    });
    this.root.append(strip, scores);
    this.controls.appendChild(this.root);
    this.reset();
  }

  /** @param {any} game applied snapshot @param {any} clock authority clock (`levelPresentation.clock`) @param {boolean} visible */
  update(game, clock, visible) {
    const versus = game?.mode === 'versus';
    // Co-op keeps its bottom score and time cards; versus swaps them for this board.
    if (this.controls.dataset.mode !== (versus ? 'versus' : 'coop')) this.controls.dataset.mode = versus ? 'versus' : 'coop';
    this.root.hidden = !versus || !visible;
    if (this.root.hidden) return;
    this.teams.forEach((team, index) => {
      const score = game.teamScores?.[index] ?? 0;
      if (team.shown === score) return;
      const first = team.shown === null;
      team.shown = score; team.value.textContent = String(score);
      localizedAttr(team.block, 'aria-label', format(index === 0 ? '红队 {0} 分' : '蓝队 {0} 分', score));
      if (!first) this.bounce(team.value, 1.38);
    });
    this.combos.forEach((node, index) => {
      const combo = Math.max(1, game.teamCombos?.[index] ?? 1);
      if (this.comboShown[index] === combo) return;
      const first = this.comboShown[index] === null;
      this.comboShown[index] = combo; node.textContent = `×${combo}`;
      localizedAttr(node, 'aria-label', format(index === 0 ? '红队连击 ×{0}' : '蓝队连击 ×{0}', combo));
      node.classList.toggle('hot', combo > 1);
      if (!first) this.bounce(node, 1.25);
    });
    this.updateTime(game, clock);
  }

  updateTime(game, clock) {
    const unlimited = !clock || clock.mode === 'unlimited';
    const target = game.matchSettings?.scoreTarget;
    if (unlimited) {
      const key = `target:${target ?? ''}`;
      if (key !== this.timeKey) {
        this.timeKey = key; this.lastSecond = null;
        localizedText(this.time, Number.isFinite(target) ? format('目标 {0} 分', target) : '--:--');
        this.time.removeAttribute('aria-label');
        this.root.classList.remove('urgent', 'final-seconds');
      }
      return;
    }
    const seconds = Math.ceil(Math.max(0, Number.isFinite(clock.remaining) ? clock.remaining : 0));
    if (seconds === this.lastSecond) return;
    if (this.lastSecond !== null && seconds > 0 && seconds <= 10) this.bounce(this.time, 1.2);
    this.lastSecond = seconds; this.timeKey = 'clock';
    this.time.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    localizedAttr(this.time, 'aria-label', format('剩余 {0} 秒', seconds));
    this.root.classList.toggle('urgent', seconds > 0 && seconds <= 30);
    this.root.classList.toggle('final-seconds', seconds > 0 && seconds <= 10);
  }

  bounce(node, peak) {
    if (!this.motionAllowed()) return;
    node.getAnimations().forEach(animation => animation.cancel());
    node.animate([
      { transform: 'scale(1)' }, { transform: `scale(${peak})`, offset: 0.3 },
      { transform: 'scale(0.92)', offset: 0.62 }, { transform: 'scale(1.04)', offset: 0.82 }, { transform: 'scale(1)' },
    ], { duration: 480, easing: 'ease-out' });
  }

  reset() {
    this.root.hidden = true; this.teams.forEach(team => { team.shown = null; }); this.comboShown = [null, null];
    this.lastSecond = null; this.timeKey = '';
    for (const node of [this.time, ...this.combos, ...this.teams.map(team => team.value)]) node.getAnimations?.().forEach(animation => animation.cancel());
  }
  dispose() { this.reset(); this.root.remove(); delete this.controls.dataset.mode; }
}
