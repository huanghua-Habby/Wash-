import { localizedText } from '../i18n/Localization.js';
/** Home controls card: the core keys stay visible and the full list folds out above them with the shared disclosure motion. */
export class ControlsHint {
  constructor(ui) {
    this.ui = ui; this.open = false;
    this.more = document.getElementById('keys-more');
    this.toggle = document.getElementById('toggle-keys');
    this.label = document.getElementById('toggle-keys-label');
    this.voiceKeys = ['keys-voice-mic', 'keys-voice-listen'].map(id => document.getElementById(id));
    // A mouse click hands focus back to the game so Space jumps again; keyboard activation keeps focus on the toggle.
    ui.listen(this.toggle, 'click', event => { this.expand(!this.open); if (event.detail) ui.focusGame(); });
  }
  expand(open) {
    this.open = !!open;
    this.ui.setDisclosure(this.more, this.open);
    this.toggle.setAttribute('aria-expanded', String(this.open));
    localizedText(this.label, this.open ? '收起' : '全部按键');
  }
  /** V (mic) and B (listen) are listed only while party voice is live; VoiceControl reports it. */
  setVoice(active) { for (const row of this.voiceKeys) if (row) row.hidden = !active; }
  dispose() { this.expand(false); }
}
