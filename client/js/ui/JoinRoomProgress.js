import { localizedText } from '../i18n/Localization.js';

/** Modal join progress, released only after SceneManager confirms an applied target-room snapshot. */
export class JoinRoomProgress {
  constructor(ui) {
    this.ui = ui; this.target = null; this.applied = false; this.entered = false;
    this.dialog = document.createElement('dialog'); this.dialog.id = 'join-room-progress';
    this.dialog.className = 'menu-dialog join-room-progress'; this.dialog.tabIndex = -1;
    this.dialog.setAttribute('aria-labelledby', 'join-room-progress-title'); this.dialog.setAttribute('aria-busy', 'true');
    const spinner = document.createElement('span'); spinner.className = 'join-room-spinner'; spinner.setAttribute('aria-hidden', 'true');
    const title = document.createElement('h2'); title.id = 'join-room-progress-title'; localizedText(title, '正在连接房间');
    this.dialog.append(spinner, title); document.getElementById('ui-stage').appendChild(this.dialog);
    ui.listen(this.dialog, 'cancel', event => event.preventDefault());
  }
  get active() { return this.target !== null; }
  start(code) {
    if (this.active) return false;
    this.target = code; this.applied = this.entered = this.failed = false;
    if (this.ui.open('join-progress')) return true;
    this.target = null; return false;
  }
  open() { this.ui.showDialog('join-progress'); this.dialog.focus({ preventScroll: true }); }
  observeRoom(room) {
    if (!this.active) return;
    if (room?.code === this.target) this.entered = true;
    else if (this.entered) { this.failed = true; this.finish(); }
  }
  snapshotApplied(room, data) {
    if (this.active && room.code === this.target && this.ui.connection.playing &&
        data.players[room.slot]?.occupied && data.players[room.slot]?.sceneReady) this.applied = true;
  }
  update() {
    if (this.active && this.applied && this.ui.ready && !this.ui.iris.active) this.finish();
  }
  finish() {
    this.target = null; this.applied = this.entered = false;
    this.ui.close('join-progress', true);
  }
  dispose() { this.target = null; this.dialog.remove(); }
}
