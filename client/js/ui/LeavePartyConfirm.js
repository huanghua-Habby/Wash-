import { localizeMarkup } from '../i18n/Localization.js';

/** One local Y/N gate for every explicit party exit; room membership changes only after Y. */
export class LeavePartyConfirm {
  constructor(ui) {
    this.ui = ui; this.pending = false;
    this.dialog = document.createElement('dialog');
    this.dialog.id = 'leave-party-confirm'; this.dialog.className = 'menu-dialog leave-party-confirm';
    this.dialog.setAttribute('aria-labelledby', 'leave-party-title');
    (this.dialog.innerHTML = '<p class="dialog-kicker">退出组队</p><h2 id="leave-party-title">你确定要离开当前组队吗？</h2><div class="rejoin-actions"><button type="button" class="leave-party-yes">退出组队 · Y</button><button type="button" class="leave-party-no rejoin-no">取消 · N</button></div>', localizeMarkup(this.dialog));
    this.yes = this.dialog.querySelector('.leave-party-yes');
    this.no = this.dialog.querySelector('.leave-party-no');
    document.getElementById('ui-stage').appendChild(this.dialog);
    ui.listen(this.dialog, 'cancel', event => { event.preventDefault(); this.decide(false); });
    ui.listen(this.yes, 'click', () => this.decide(true));
    ui.listen(this.no, 'click', () => this.decide(false));
    ui.listen(window, 'keydown', event => {
      if (!ui.isPanelForeground('leave-confirm') || event.isComposing || !['KeyY', 'KeyN'].includes(event.code)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) this.decide(event.code === 'KeyY', true);
    }, { capture: true });
  }
  open() {
    this.pending = false;
    this.code = this.ui.connection.room?.code;
    this.origin = this.ui.page === 'home' ? 'home' : this.ui.menu.dialog.dataset.view === 'results' ? 'results' : 'pause';
    this.result = this.origin === 'results' ? this.ui.levelPresentation?.result : null;
    this.yes.disabled = this.no.disabled = false;
    this.ui.showDialog('leave-confirm'); this.no.focus({ preventScroll: true });
  }
  update() {
    if (this.dialog.open && this.ui.connection.room?.code !== this.code) this.ui.close('leave-confirm', true);
  }
  decide(leave, keyboard = false) {
    if (this.pending || !this.ui.isPanelForeground('leave-confirm')) return;
    if (keyboard) this.ui.playConfirmSound();
    if (!leave) {
      this.ui.close('leave-confirm', true);
      if (this.origin === 'results' && this.result) this.ui.menu.openResults(this.result);
      else if (this.origin === 'pause') this.ui.open('pause');
      return;
    }
    this.pending = true; this.yes.disabled = this.no.disabled = true;
    if (this.ui.page === 'home') {
      if (!this.ui.connection.requestLeave()) {
        this.pending = false; this.yes.disabled = this.no.disabled = false;
        this.ui.notify('连接恢复后才能退出组队');
      } else this.ui.close('leave-confirm', true);
      return;
    }
    void this.ui.menu.sceneManager.leaveGame();
  }
  dispose() { this.dialog.remove(); }
}
