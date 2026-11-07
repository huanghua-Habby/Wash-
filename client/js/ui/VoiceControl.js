import { localizedText, localizedAttr } from '../i18n/Localization.js';
/** Party voice controls: a status row on the room card and a mic button beside pause in game. Both appear only while
 * VoiceChat has a direct link (never solo). Clicking or V toggles the local microphone; a blocked/missing microphone
 * retries instead. UIManager owns listeners and lifetime; VoiceChat owns capture and the mute preference. */
const MIC_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="3" width="6" height="11" rx="3"/>'
  + '<path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" fill="none"/><path class="voice-slash" d="M4 4l16 16" fill="none"/></svg>';

/** Speaker for the listen toggle (B); the same slash shows when listening is off. */
const SPEAKER_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9h4l5-4v14l-5-4H4z" stroke-linejoin="round"/>'
  + '<path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" fill="none"/><path class="voice-slash" d="M4 4l16 16" fill="none"/></svg>';

const STATUS = {
  pending: '正在开启麦克风…', blocked: '麦克风未授权 · 仅收听', missing: '未找到麦克风 · 仅收听',
  unsupported: '需 HTTPS 或 localhost 才能开麦 · 仅收听',
};

export class VoiceControl {
  constructor(ui, voice, audio = null) {
    this.ui = ui; this.voice = voice; this.audio = audio;
    this.row = document.createElement('div'); this.row.className = 'voice-row'; this.row.hidden = true;
    this.status = document.createElement('span'); this.status.className = 'voice-status';
    this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.homeButton = this.button('voice-toggle');
    this.homeListen = this.button('voice-toggle voice-listen', SPEAKER_ICON);
    const buttons = document.createElement('span'); buttons.className = 'voice-buttons'; buttons.append(this.homeButton, this.homeListen);
    this.row.append(this.status, buttons);
    document.querySelector('#room-panel .room-current').appendChild(this.row);
    this.gameButton = this.button('voice-game-button');
    this.gameListen = this.button('voice-game-button voice-listen', SPEAKER_ICON);
    document.getElementById('pause-game').after(this.gameButton, this.gameListen);
    for (const button of [this.homeButton, this.gameButton]) ui.listen(button, 'click', () => this.activate());
    for (const button of [this.homeListen, this.gameListen]) ui.listen(button, 'click', () => this.toggleListening());
    ui.listen(window, 'keydown', event => {
      if (event.repeat || ui.editing || !ui.ready || !voice.active) return;
      if (event.code === 'KeyV') this.activate();
      else if (event.code === 'KeyB') this.toggleListening();
    });
    ui.listen(voice, 'change', () => this.sync());
    this.sync();
  }

  button(className, icon = MIC_ICON) {
    const button = document.createElement('button'); button.type = 'button'; button.className = className;
    button.innerHTML = icon; // trusted static icon only
    return button;
  }

  toggleListening() {
    if (!this.voice.active || !this.audio) return;
    this.audio.setVoiceListening(!this.audio.voiceListening); this.sync();
  }

  activate() {
    const { voice } = this;
    if (!voice.active) return;
    if (voice.mic === 'blocked' || voice.mic === 'missing') voice.requestMic();
    else if (voice.mic !== 'unsupported') voice.toggleMute();
  }

  sync() {
    const { voice } = this, active = voice.active;
    this.row.hidden = this.gameButton.hidden = this.gameListen.hidden = !active;
    this.ui.controlsHint?.setVoice(active);
    if (!active) return;
    const retry = voice.mic === 'blocked' || voice.mic === 'missing', live = voice.mic === 'on';
    const state = retry || voice.mic === 'unsupported' ? 'unavailable' : live && voice.muted ? 'muted' : live ? 'live' : 'pending';
    localizedText(this.status, STATUS[voice.mic] || (voice.muted ? '麦克风已静音' : voice.peers ? '语音已连通' : '正在连接语音…'));
    const label = retry ? '重试麦克风' : voice.muted ? '打开麦克风' : '关闭麦克风';
    for (const button of [this.homeButton, this.gameButton]) {
      button.dataset.state = state;
      button.disabled = voice.mic === 'unsupported' || voice.mic === 'pending';
      localizedAttr(button, 'aria-label', label);
      localizedAttr(button, 'title', retry ? '重试麦克风' : 'V 快捷切换');
    }
    const listening = this.audio?.voiceListening !== false;
    for (const button of [this.homeListen, this.gameListen]) {
      button.dataset.state = listening ? 'live' : 'muted';
      button.disabled = !this.audio;
      button.setAttribute('aria-pressed', String(!listening));
      localizedAttr(button, 'aria-label', listening ? '关闭队友语音' : '收听队友语音');
      localizedAttr(button, 'title', 'B 快捷切换');
    }
  }

  dispose() { this.row.remove(); this.gameButton.remove(); this.gameListen.remove(); }
}
