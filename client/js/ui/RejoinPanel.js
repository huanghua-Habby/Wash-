import { localizedText, localizeMarkup } from '../i18n/Localization.js';
/** Local choice only. The host keeps this slot absent until its scoped acknowledgement succeeds. */
export class RejoinPanel {
  constructor(ui) {
    this.ui = ui; this.pending = false;
    this.dialog = document.createElement('dialog'); this.dialog.id = 'rejoin-dialog'; this.dialog.className = 'menu-dialog rejoin-dialog';
    this.dialog.setAttribute('aria-labelledby', 'rejoin-title');
    (this.dialog.innerHTML = '<p class="dialog-kicker">欢迎回来</p><h2 id="rejoin-title">我们看到你不小心离开了！</h2><p class="rejoin-detail">你需要回到自己的游戏中吗？</p><div class="rejoin-actions"><button type="button" class="rejoin-yes">回到游戏 · Y</button><button type="button" class="rejoin-no">离开房间 · N</button></div><p class="dialog-note">其他玩家正在继续游戏，返回后会在复活点出现。</p>', localizeMarkup(this.dialog));
    this.yes = this.dialog.querySelector('.rejoin-yes'); this.no = this.dialog.querySelector('.rejoin-no');
    document.getElementById('ui-stage').appendChild(this.dialog);
    ui.listen(this.dialog, 'cancel', event => event.preventDefault());
    ui.listen(this.yes, 'click', () => this.decide(true)); ui.listen(this.no, 'click', () => this.decide(false));
    ui.listen(window, 'keydown', event => {
      if (!ui.isPanelForeground('rejoin') || !['KeyY', 'KeyN'].includes(event.code)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) this.decide(event.code === 'KeyY', true);
    }, {capture:true});
  }
  update() {
    const guest = this.ui.connection.guest;
    if (!guest?.rejoinPending) { this.ui.close('rejoin', true); this.scope = null; this.pending = false; return; }
    const scope = `${guest.code}:${guest.state.epoch}:${guest.rejoinRequest.recoveryId}`;
    if (scope !== this.scope) { this.scope = scope; this.pending = false; }
    this.yes.disabled = this.no.disabled = this.pending || !guest.open;
    localizedText(this.yes, this.pending ? '处理中…' : '回到游戏 · Y');
    if (!this.dialog.open) this.ui.open('rejoin');
  }
  decide(accept, keyboard = false) {
    if (this.pending || !this.ui.isPanelForeground('rejoin')) return;
    if (this.ui.connection.guest?.decideRejoin(accept)) {
      this.pending = true; this.yes.disabled = this.no.disabled = true;
      if (keyboard) this.ui.playConfirmSound();
    }
  }
  dispose() { this.dialog.remove(); }
}
