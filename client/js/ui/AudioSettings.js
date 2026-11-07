import { localizedText, localizedAttr, format } from '../i18n/Localization.js';
/** Reusable settings section in two groups, so party voice never looks like part of the game mix:
 * "游戏声音" (game volume, music, effects, M mute — none of them touch voice) and "语音聊天" (teammate voice volume and
 * voice optimization). UIManager owns its listeners and lifecycle; AudioManager owns volumes, VoiceChat the optimization.
 */
export class AudioSettings {
  constructor(ui, audio) {
    this.ui = ui; this.audio = audio; this.voice = null;
    this.root = document.createElement('div'); this.root.className = 'audio-settings';
    this.sliders = [];
    const game = this.group('游戏声音');
    for (const [channel, title] of [['master', '游戏总音量'], ['music', '背景音乐'], ['sfx', '音效']]) this.slider(game, channel, title);
    const mute = document.createElement('label'); mute.className = 'setting-row audio-mute';
    const title = document.createElement('span'); localizedText(title, '游戏静音');
    const hint = document.createElement('small'); localizedText(hint, 'M 快捷切换 · 不影响语音'); title.appendChild(hint);
    this.mute = document.createElement('input'); this.mute.type = 'checkbox'; this.mute.id = 'setting-audio-muted';
    mute.append(title, this.mute); game.appendChild(mute);
    ui.listen(this.mute, 'change', () => { audio.setMuted(this.mute.checked); this.sync(); });
    const voice = this.group('语音聊天', 'voice');
    this.slider(voice, 'voice', '队友语音');
    const optimize = document.createElement('label'); optimize.className = 'setting-row audio-mute voice-optimize';
    const optimizeTitle = document.createElement('span'); localizedText(optimizeTitle, '语音优化');
    const optimizeHint = document.createElement('small'); localizedText(optimizeHint, '没人说话时不发送、降低码率，让游戏画面更流畅'); optimizeTitle.appendChild(optimizeHint);
    this.optimize = document.createElement('input'); this.optimize.type = 'checkbox'; this.optimize.id = 'setting-voice-optimized';
    optimize.append(optimizeTitle, this.optimize); voice.appendChild(optimize);
    ui.listen(this.optimize, 'change', () => { this.voice?.setOptimized(this.optimize.checked); this.sync(); });
  }
  group(title, kind = 'game') {
    const fieldset = document.createElement('fieldset'); fieldset.className = `audio-group ${kind}`;
    const legend = document.createElement('legend'); localizedText(legend, title); fieldset.appendChild(legend);
    this.root.appendChild(fieldset); return fieldset;
  }
  slider(parent, channel, title) {
    const row = document.createElement('label'); row.className = 'audio-setting';
    const name = document.createElement('span'); localizedText(name, title);
    const input = document.createElement('input'); input.type = 'range'; input.min = '0'; input.max = '100'; input.step = '1';
    input.id = `setting-audio-${channel}`; localizedAttr(input, 'aria-label', title);
    const output = document.createElement('output'); output.setAttribute('for', input.id);
    row.append(name, input, output); parent.appendChild(row);
    this.sliders.push({ channel, input, output });
    this.ui.listen(input, 'input', () => { this.audio.setVolume(channel, Number(input.value) / 100); this.sync(); });
  }
  /** VoiceChat arrives after audio (UIManager.bindVoice); until then the toggle shows the stored default (on). */
  bindVoice(voice) { this.voice = voice; this.sync(); }
  mount(parent) { parent.appendChild(this.root); this.sync(); }
  sync() {
    for (const { channel, input, output } of this.sliders) {
      const value = String(Math.round(this.audio.getVolume(channel) * 100));
      if (input.value !== value) input.value = value;
      if (output.textContent !== `${value}%`) localizedText(output, format("{0}%", value));
    }
    this.mute.checked = this.audio.muted;
    this.optimize.checked = this.voice ? this.voice.optimized : true;
    this.optimize.disabled = !this.voice;
  }
  dispose() { this.root.remove(); }
}
