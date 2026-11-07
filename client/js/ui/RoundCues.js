import { localizedText, format } from '../i18n/Localization.js';
import { roundCue } from '../../../shared/sim/roundFlow.js';

/** Versus finish from this page's side: its team won, lost, drew, or (no team) which team won. */
export function versusOutcomeCue(result, localTeam) {
  if (result?.winner !== 0 && result?.winner !== 1) return 'draw';
  if (localTeam !== 0 && localTeam !== 1) return result.winner === 0 ? 'red' : 'blue';
  return localTeam === result.winner ? 'win' : 'lose';
}

/** A prepared DOM view; cue timing always comes from the applied host snapshot. */
export class RoundCues {
  constructor(motionEnabled) {
    this.motionEnabled = motionEnabled; this.cue = '';
    this.root = document.createElement('div'); this.root.id = 'round-cue'; this.root.className = 'round-cue';
    this.root.hidden = true; this.root.setAttribute('role', 'status'); this.root.setAttribute('aria-live', 'polite');
    this.root.innerHTML = '<div class="round-cue-card"><span class="round-cue-kicker"></span><strong class="round-cue-title"></strong><span class="round-cue-detail"></span><b class="round-cue-count"></b></div>';
    this.card = this.root.querySelector('.round-cue-card');
    this.kicker = this.root.querySelector('.round-cue-kicker'); this.title = this.root.querySelector('.round-cue-title');
    this.detail = this.root.querySelector('.round-cue-detail'); this.count = this.root.querySelector('.round-cue-count');
    document.getElementById('ui-stage').appendChild(this.root);
  }
  update(game, visible, localTeam = null) {
    const cue = visible ? roundCue(game) : '';
    const reason = game.result?.reason;
    // Versus finish: a colored WIN / FAILED / DRAW banner for this page's team instead of the co-op "Finish!".
    const outcome = cue === 'finish' && game.result?.mode === 'versus' ? versusOutcomeCue(game.result, localTeam) : '';
    if (cue === this.cue && reason === this.reason && outcome === this.outcome) return;
    this.reason = reason; this.outcome = outcome;
    const previous = this.cue; this.cue = cue;
    this.card.getAnimations().forEach(animation => animation.cancel());
    this.root.hidden = !cue;
    if (!cue) return;
    const ready = cue.startsWith('ready');
    this.root.dataset.cue = ready ? 'ready' : cue;
    localizedText(this.kicker, ready ? '准备开工' : cue === 'go' ? '一起把麻烦洗干净' : '本轮作业结束');
    localizedText(this.title, ready ? 'Ready?' : cue === 'go' ? 'GO!' : reason === 'tutorial_complete' ? '教程结束！' : 'Finish!');
    localizedText(this.detail, ready ? '拿好工具，准备出发' : cue === 'go' ? '开工！' : reason === 'tutorial_complete' ? '上手成功 · 下一站见！' : reason === 'score_target' ? '率先达到目标分！' : '时间到 · 辛苦啦！');
    this.count.hidden = !ready; localizedText(this.count, ready ? cue.slice(-1) : '');
    if (outcome) {
      this.root.dataset.cue = `versus-${outcome}`;
      const result = game.result;
      localizedText(this.kicker, reason === 'score_target' ? format('率先达到 {0} 分', result.scoreTarget) : '时间到');
      localizedText(this.title, { win: 'WIN!', lose: 'FAILED', draw: 'DRAW', red: '红队胜！', blue: '蓝队胜！' }[outcome]);
      localizedText(this.detail, format('红 {0} : {1} 蓝', result.teamScores[0], result.teamScores[1]));
    }
    if (this.motionEnabled() && outcome === 'lose') {
      // A defeat lands heavy and droops instead of bouncing.
      this.card.animate([
        { opacity: 0, transform: 'translateY(-70px) scale(1.25) rotate(0deg)', filter: 'saturate(1)' },
        { opacity: 1, transform: 'translateY(8px) scale(1) rotate(0deg)', offset: .45 },
        { opacity: 1, transform: 'translateY(0) scale(1) rotate(-1deg)', offset: .6 },
        { opacity: 1, transform: 'translateY(14px) scale(.97) rotate(-4deg)', filter: 'saturate(.55)' },
      ], { duration: 1500, easing: 'ease-out', fill: 'forwards' });
    } else if (this.motionEnabled() && outcome) {
      this.card.animate([
        { opacity: 0, transform: 'scale(.3) rotate(-14deg)' },
        { opacity: 1, transform: 'scale(1.18) rotate(3deg)', offset: .55 },
        { opacity: 1, transform: 'scale(.96) rotate(-3deg)', offset: .78 },
        { opacity: 1, transform: 'scale(1) rotate(-2deg)' },
      ], { duration: 620, easing: 'ease-out' });
    } else if (this.motionEnabled()) {
      if (ready && previous.startsWith('ready')) this.count.animate([
        { transform: 'scale(1.35) rotate(6deg)' }, { transform: 'scale(.94)' }, { transform: 'scale(1)' },
      ], { duration: 320, easing: 'ease-out' });
      else this.card.animate([
        { opacity: 0, transform: 'translateY(25px) scale(.55) rotate(-8deg)' },
        { opacity: 1, transform: 'translateY(-6px) scale(1.08) rotate(2deg)', offset: .65 },
        { opacity: 1, transform: 'translateY(0) scale(1) rotate(-2deg)' },
      ], { duration: 430, easing: 'ease-out' });
    }
  }
  reset() { this.cue = ''; this.outcome = ''; this.root.hidden = true; this.root.getAnimations({ subtree: true }).forEach(animation => animation.cancel()); }
  dispose() { this.reset(); this.root.remove(); }
}
