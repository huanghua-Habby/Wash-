/** Versus room settings tab: the end conditions the next match freezes. Host edits, everyone else reads. */
import { localizedText, format } from '../i18n/Localization.js';
import { VERSUS_SCORE_TARGETS, VERSUS_TIME_LIMITS, DEFAULT_VERSUS_SETTINGS, AI_FILL, AI_DIFFICULTY, normalizeVersusSettings } from '../../../shared/protocol.js';

/** Plain one-of choices (no on/off switch); `note` explains the selected value under its buttons. */
const CHOICES = {
  aiFill: { values: AI_FILL, label: value => ({ off: '关闭', balance: '平衡', fill: '填满' })[value],
    note: value => ({ off: '不添加任何 AI。', balance: '只添加让两队人数平衡所需的最少 AI。', fill: '剩下的空位全部由 AI 补上。' })[value] },
  aiDifficulty: { values: AI_DIFFICULTY, label: value => ({ easy: '简单', normal: '普通', hard: '困难' })[value],
    note: value => ({ easy: 'AI 比起干活，更爱捣乱。', normal: 'AI 认真干活，偶尔也会走神。', hard: 'AI 是工作狂，可能根本不捣乱。' })[value] },
};
const OPTIONS = {
  scoreTarget: { values: VERSUS_SCORE_TARGETS, label: value => format("{0} 分", value) },
  timeLimit: { values: VERSUS_TIME_LIMITS, label: value => format("{0} 分钟", value / 60) },
};

export class RoomSettingsPanel {
  constructor(connection, ui) {
    this.connection = connection;
    this.root = document.getElementById('room-settings');
    this.owner = this.root.querySelector('.room-settings-owner');
    // The value a switched-off condition returns to when switched on again.
    this.remembered = { ...DEFAULT_VERSUS_SETTINGS };
    this.groups = Object.entries(OPTIONS).map(([key, { values, label }]) => {
      const group = this.root.querySelector(`[data-setting="${key}"]`), toggle = group.querySelector('input');
      const choices = group.querySelector('.setting-choices');
      const buttons = values.map(value => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'setting-choice';
        localizedText(button, label(value)); ui.listen(button, 'click', () => this.change(key, value));
        choices.appendChild(button); return { value, button };
      });
      ui.listen(toggle, 'change', () => this.change(key, toggle.checked ? this.remembered[key] : null));
      return { key, toggle, buttons };
    });
    this.choices = Object.entries(CHOICES).map(([key, { values, label, note }]) => {
      const choices = this.root.querySelector(`[data-choice="${key}"] .setting-choices`);
      const noteNode = this.root.querySelector(`[data-choice="${key}"] .setting-choice-note`);
      const buttons = values.map(value => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'setting-choice';
        localizedText(button, label(value)); ui.listen(button, 'click', () => this.change(key, value));
        choices.appendChild(button); return { value, button };
      });
      return { key, buttons, note, noteNode };
    });
  }
  get settings() { return normalizeVersusSettings(this.connection.room?.settings); }
  get editable() { const room = this.connection.room; return this.connection.connected && !!room?.ownCode && room.phase === 'home'; }

  /** Host only; the registry confirms and every page re-renders from its broadcast. */
  change(key, value) {
    if (!this.editable) { this.refresh(); return; }
    const next = { ...this.settings, [key]: value };
    if (next.scoreTarget === null && next.timeLimit === null) { this.refresh(); return; }
    if (value !== null && key in this.remembered) this.remembered[key] = value;
    if (!this.connection.setRoomSettings(next)) this.refresh();
  }

  refresh() {
    const settings = this.settings, editable = this.editable;
    for (const { key, toggle, buttons } of this.groups) {
      const value = settings[key], other = settings[key === 'scoreTarget' ? 'timeLimit' : 'scoreTarget'];
      if (value !== null) this.remembered[key] = value;
      toggle.checked = value !== null;
      // The last condition still on cannot be switched off.
      toggle.disabled = !editable || (value !== null && other === null);
      for (const { value: choice, button } of buttons) {
        button.setAttribute('aria-pressed', String(choice === (value ?? this.remembered[key]) && value !== null));
        button.disabled = !editable || value === null;
      }
    }
    for (const { key, buttons, note, noteNode } of this.choices) {
      const value = settings[key] ?? DEFAULT_VERSUS_SETTINGS[key];
      for (const { value: choice, button } of buttons) { button.setAttribute('aria-pressed', String(choice === value)); button.disabled = !editable; }
      // Only the selected value's explanation shows, under the buttons.
      if (noteNode && noteNode.dataset.value !== value) { noteNode.dataset.value = value; localizedText(noteNode, note(value)); }
    }
    localizedText(this.owner, editable ? '仅房主可修改' : '由房主设置，你只能查看');
  }
}
