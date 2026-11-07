import { localizedAttr, format } from '../i18n/Localization.js';
/** Presentation only. The caller supplies the applied authority clock; this view never ticks it. */
export class LevelClock {
  constructor(hud) { this.hud = hud; this.last = null; }
  /** @param {import('../../../shared/levelContracts.js').ClockState} clock */
  update(clock) {
    const hud = this.hud, ui = hud.ui;
    const unlimited = clock.mode === 'unlimited';
    const remaining = Number.isFinite(clock.remaining) ? Math.max(0, clock.remaining) : 0;
    const seconds = unlimited ? null : Math.ceil(remaining);
    if (!unlimited && seconds !== this.last && seconds > 0 && seconds <= 10 && this.last !== null) hud.pop(ui['time-value']);
    this.last = seconds;
    hud.text(ui['time-value'], unlimited ? '--：--' : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`);
    ui['time-panel'].classList.toggle('unlimited', unlimited);
    ui['time-panel'].classList.toggle('urgent', !unlimited && seconds > 0 && seconds <= 30);
    ui['time-panel'].classList.toggle('final-seconds', !unlimited && seconds > 0 && seconds <= 10);
    localizedAttr(ui['time-value'], 'aria-label', unlimited ? '本关无时限' : format("剩余 {0} 秒", seconds));
    const duration = Number.isFinite(clock.duration) ? clock.duration : 0;
    hud.width(ui['time-fill'], unlimited || duration <= 0 ? 0 : Math.min(1, remaining / duration) * 100);
  }
  reset() { this.last = null; }
}
