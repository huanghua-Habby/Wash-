import { localizedText, localizedAttr, format, literal } from '../i18n/Localization.js';
/** Managed room notice. The return deadline is wall time, independent of frozen gameplay. */
export class HostNotice {
  constructor(ui, now = () => performance.now()) {
    this.ui = ui; this.now = now; this.mode = null; this.confirmed = false;
    this.dialog = document.getElementById('host-notice');
    this.title = document.getElementById('host-notice-title');
    this.detail = document.getElementById('host-notice-detail');
    this.count = document.getElementById('host-notice-count');
    this.button = document.getElementById('host-notice-confirm');
    this.votes = document.getElementById('host-notice-votes');
    ui.listen(this.dialog, 'cancel', event => event.preventDefault());
    ui.listen(this.button, 'click', () => this.confirm());
  }
  /** Versus pause vote for every player: who paused, one dot per online player, and a resume vote button. */
  votePaused(vote, names, localSlot, onVote) {
    if (this.mode === 'home') return;
    const opening = this.mode !== 'vote';
    if (opening) {
      this.mode = 'vote'; this.count.hidden = true; this.votes.hidden = false; this.button.hidden = false;
      this.onConfirm = onVote; localizedText(this.button, '申请继续');
    }
    const key = `${vote.by}|${vote.votes.join('.')}|${vote.voters.join('.')}|${names[vote.by] || ''}`;
    if (key !== this.voteKey) {
      this.voteKey = key;
      localizedText(this.title, format("{0} 暂停了游戏", literal(names[vote.by] || '')));
      localizedText(this.detail, format("超过半数玩家申请继续后恢复（{0}/{1}）", vote.votes.length, vote.voters.length));
      this.votes.replaceChildren(...vote.voters.map(slot => {
        const dot = document.createElement('i'); dot.className = 'pause-vote'; dot.toggleAttribute('data-voted', vote.votes.includes(slot));
        return dot;
      }));
      localizedAttr(this.votes, 'aria-label', format("继续投票 {0}/{1}", vote.votes.length, vote.voters.length));
      this.button.disabled = vote.votes.includes(localSlot) || !vote.voters.includes(localSlot);
    }
    if (opening) this.ui.open('host-notice');
  }
  paused() {
    if (this.mode === 'home' || this.mode === 'paused') return;
    this.mode = 'paused'; localizedText(this.title, '房主暂停了游戏');
    localizedText(this.detail, '稍等一下，房主继续后会一起恢复游玩。');
    this.count.hidden = this.button.hidden = true;
    this.ui.open('host-notice');
  }
  returning(callback) {
    this.onConfirm = callback;
    if (this.mode === 'home') return;
    this.mode = 'home'; this.confirmed = false; this.deadline = this.now() + 3000;
    localizedText(this.title, '房主退出了游戏');
    localizedText(this.detail, '本局已结束，返回主菜单等待下一次出发。你仍在当前房间。');
    this.button.hidden = this.count.hidden = false; localizedText(this.button, '确认');
    this.update(); this.ui.open('host-notice');
    this.timer = setTimeout(() => this.confirm(), 3000);
  }
  update() {
    if (this.mode !== 'home' || this.confirmed) return;
    const seconds = Math.max(0, Math.ceil((this.deadline - this.now()) / 1000));
    const text = `${seconds} 秒后自动返回主菜单`;
    if (this.count.textContent !== text) localizedText(this.count, text);
    if (!seconds) this.confirm();
  }
  confirm() {
    if (this.mode === 'vote') { if (!this.button.disabled) this.onConfirm?.(); return; }
    if (this.mode !== 'home' || this.confirmed) return;
    this.confirmed = true; clearTimeout(this.timer); this.onConfirm?.();
  }
  reset() { clearTimeout(this.timer); this.mode = null; this.onConfirm = null; this.confirmed = false; this.voteKey = ''; this.votes.hidden = true; }
  dispose() { this.reset(); }
}
