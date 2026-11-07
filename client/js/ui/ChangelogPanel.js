import { localizedText, localizedAttr } from '../i18n/Localization.js';
import { CHANGELOG } from './changelog.js';

/** Update notes (UI_MANAGEMENT.md 更新内容): a small "更新内容 ›" button beside the version watermark on the main menu,
 * and a paper dialog listing the notes. The first time a browser reaches the main menu on a version it has not seen,
 * the dialog opens once by itself; the seen version is saved per browser (`wash-changelog-seen`), never in the save. */
const SEEN_KEY = 'wash-changelog-seen';

export class ChangelogPanel {
  constructor(ui, version) {
    this.ui = ui; this.version = version || ''; this.forced = false;
    try { this.seen = localStorage.getItem(SEEN_KEY) || ''; } catch { this.seen = ''; }
    this.entry = CHANGELOG.find(entry => entry.version === this.version) || null;

    this.button = document.createElement('button'); this.button.type = 'button'; this.button.className = 'changelog-button';
    localizedText(this.button, '更新内容 ›'); localizedAttr(this.button, 'aria-label', '查看更新内容');
    this.button.hidden = true;
    document.getElementById('ui-stage').appendChild(this.button);
    ui.listen(this.button, 'click', () => ui.open('changelog'));

    this.dialog = document.createElement('dialog'); this.dialog.id = 'changelog-dialog';
    this.dialog.className = 'menu-dialog changelog-dialog'; this.dialog.setAttribute('aria-labelledby', 'changelog-title');
    const close = document.createElement('button'); close.type = 'button'; close.className = 'dialog-close'; close.textContent = '×';
    localizedAttr(close, 'aria-label', '关闭更新内容');
    const kicker = document.createElement('p'); kicker.className = 'dialog-kicker'; localizedText(kicker, '更新内容');
    const title = document.createElement('h2'); title.id = 'changelog-title';
    this.body = document.createElement('div'); this.body.className = 'changelog-body';
    const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'changelog-ok'; localizedText(ok, '知道了');
    this.dialog.append(close, kicker, title, this.body, ok);
    document.getElementById('ui-stage').appendChild(this.dialog);
    // Nothing can block closing these notes: close at once (UIManager.close with force).
    ui.listen(close, 'click', () => ui.close('changelog', true));
    ui.listen(ok, 'click', () => ui.close('changelog', true));
    ui.listen(this.dialog, 'cancel', event => { event.preventDefault(); ui.close('changelog', true); });
    this.render(title);
  }

  /** Static, project-written text only: every line goes through a text node, never innerHTML. */
  render(title) {
    const entry = this.entry || CHANGELOG[0];
    localizedText(title, entry.title);
    const list = (items) => {
      const ul = document.createElement('ul');
      for (const item of items) { const li = document.createElement('li'); localizedText(li, item); ul.appendChild(li); }
      return ul;
    };
    for (const section of entry.sections) {
      const block = document.createElement('section'); block.className = 'changelog-section';
      const heading = document.createElement('h3'); localizedText(heading, section.title); block.appendChild(heading);
      if (section.items) block.appendChild(list(section.items));
      for (const group of section.groups || []) {
        const sub = document.createElement('h4'); localizedText(sub, group.title);
        block.append(sub, list(group.items));
      }
      this.body.appendChild(block);
    }
  }

  open() {
    this.markSeen();
    this.body.scrollTop = 0;
    this.ui.showDialog('changelog');
  }

  markSeen() {
    if (!this.version || this.seen === this.version) return;
    this.seen = this.version;
    try { localStorage.setItem(SEEN_KEY, this.version); } catch { /* still shown only once this session */ }
  }

  /** Each UI frame: the button lives on the main menu only; a new version's notes open once on their own there. */
  update() {
    const ui = this.ui, home = ui.ready && ui.page === 'home' && !ui.iris.active;
    this.button.hidden = !home || !this.entry;
    if (this.forced || !home || !this.entry || this.seen === this.version || ui.hasModal) return;
    if (ui.open('changelog')) this.forced = true;
  }

  dispose() { this.button.remove(); this.dialog.remove(); }
}
