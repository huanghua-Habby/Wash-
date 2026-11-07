import { localizedText, localizedAttr } from '../i18n/Localization.js';
export const chargingIcon = () => '<svg class="cleaning-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v5m7-5v5M5 8h13v4a6.5 6.5 0 0 1-5 6v4m-3-4a6.5 6.5 0 0 1-5-6M15 15l-3 4"/></svg>';

export function applyChargingTheme(node) {
  node.dataset.tool = 'charger';
  node.style.setProperty('--clean-accent', '#8C88B4');
  node.style.setProperty('--clean-paper', '#F2EFFA');
  node.style.setProperty('--clean-ink', '#514D75');
}

/** Small applied-state adapter; lifetime and positioning belong to the UIManager world HUD. */
export class ChargingHud {
  constructor(hud) {
    this.hud = hud;
    this.source = this.badge(); localizedText(this.source.lastElementChild, '充电线起点');
    this.ports = [this.badge(), this.badge()];
    this.progress = this.ports.map(badge => {
      const progress = document.createElement('div'); progress.className = 'charging-progress'; progress.hidden = true;
      progress.setAttribute('role', 'progressbar'); localizedAttr(progress, 'aria-label', '可选充电进度');
      progress.setAttribute('aria-valuemin', '0'); progress.setAttribute('aria-valuemax', '100');
      progress.appendChild(document.createElement('i')); badge.insertBefore(progress, badge.lastElementChild);
      return progress;
    });
  }
  badge() {
    const badge = document.createElement('div'); badge.className = 'station-badge charging-badge';
    applyChargingTheme(badge); badge.innerHTML = `${chargingIcon()}<span></span>`;
    this.hud.root.appendChild(badge); return badge;
  }
  update(game, tagOpacity = 1, focus = null) {
    const hud = this.hud;
    if (game.equipmentEnabled && !game.equipmentEnabled('charger')) {
      hud.hidden(this.source, true); this.ports.forEach(badge => hud.hidden(badge, true)); return;
    }
    hud.positionTag(this.source, hud.at(game.charging.source, 0.6), tagOpacity);
    this.ports.forEach((badge, index) => {
      const order = game.orders[index];
      hud.hidden(badge, !order || order.mode !== 'working');
      if (!order || order.mode !== 'working') return;
      const plugged = game.chargers.some(item => item.connectedSerial === order.serial);
      const versus = game.mode === 'versus' && Number.isInteger(order.team);
      const value = order.chargeProgress || 0, done = order.charged;
      // Preserve applied progress/status; idle ports follow the same local tool/proximity emphasis as cleaning routes.
      const essential = done || plugged || value > 0, focused = !!focus?.ports.has(order);
      const progress = this.progress[index];
      hud.hidden(progress, !essential);
      const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
      hud.width(progress.firstElementChild, percent); progress.setAttribute('aria-valuenow', String(percent));
      badge.classList.toggle('charged', done === true);
      badge.classList.toggle('task-muted', !essential && !focused);
      const opacity = essential || focused ? 1 : .18;
      hud.positionTag(badge, hud.at(game.charging.ports.get(order.truck), 0.6), opacity, order.serial);
      const shown = Math.floor(value * 100);
      hud.text(badge.lastElementChild, done ? versus ? '洗完结算 ×1.5 ✓' : '充电完成 ✓' : plugged ? `充电中 ${shown}%` : value > 0 ? `充电暂停 ${shown}%` : versus ? '充电口' : '可选充电');
    });
  }
}
