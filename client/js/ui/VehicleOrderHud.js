import { localizedAttr, localizeMarkup } from '../i18n/Localization.js';
import { TEAM_LABELS } from '../core/teamColors.js';
const bounded = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

/** Continuous work completed, read only from the applied host cleaning state. */
export function orderCleaningProgress(stains) {
  let total = 0, complete = 0;
  for (const stain of stains) {
    const steps = stain.steps.length;
    total += steps;
    complete += stain.done ? steps : Math.min(steps, Math.max(0, stain.stage || 0) + bounded(stain.progress));
  }
  return total ? bounded(complete / total) : 0;
}

const clockIcon = '<svg class="order-clock-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M8 4.5V8l2 1.5"/></svg>';
const cleanIcon = '<svg class="order-clean-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 3 1.6 4.4L14 9l-4.4 1.6L8 15l-1.6-4.4L2 9l4.4-1.6ZM15 2v4m-2-2h4m-1 8v5m-2.5-2.5h5"/></svg>';

/** Two prepared cards; UIManager owns the parent world HUD and projection/lifetime. */
export class VehicleOrderHud {
  constructor(hud) {
    this.hud = hud;
    this.entries = Array.from({ length: 2 }, () => {
      const badge = document.createElement('div'); badge.className = 'car-badge'; badge.hidden = true;
      (badge.innerHTML = `<span class="order-team" hidden></span><div class="order-timer" role="img">
        <svg class="order-time-ring" viewBox="0 0 36 36" aria-hidden="true"><circle class="order-time-track" cx="18" cy="18" r="15"/><circle class="order-time-fill" cx="18" cy="18" r="15" pathLength="1"/></svg>
        ${clockIcon}<span class="order-seconds"></span></div>
        <div class="order-cleaning">${cleanIcon}<div class="order-clean-bar" role="progressbar" aria-label="车辆洗净进度" aria-valuemin="0" aria-valuemax="100"><i></i></div><span class="order-reward" hidden></span></div>`, localizeMarkup(badge));
      hud.root.appendChild(badge);
      return { badge, team: badge.querySelector('.order-team'), timer: badge.querySelector('.order-timer'), seconds: badge.querySelector('.order-seconds'),
        ring: badge.querySelector('.order-time-fill'), bar: badge.querySelector('.order-clean-bar'), fill: badge.querySelector('.order-clean-bar i'), reward: badge.querySelector('.order-reward') };
    });
  }
  update(game) {
    const hud = this.hud;
    this.entries.forEach(({ badge, team, timer, seconds, ring, bar, fill, reward }, index) => {
      const order = game.orders[index];
      hud.hidden(badge, !order || order.mode === 'leaving');
      if (!order || order.mode === 'leaving') return;
      // Project from the drawn hull, which includes its yaw, bob and rider load.
      // A chassis-space point drifts against the visible roof during arrival.
      hud.worldPoint.set(order.truck.spec.x1 - 1.3, order.truck.spec.top + 2.8, 0);
      order.truck.body.localToWorld(hud.worldPoint);
      hud.position(badge, hud.worldPoint, `${order.id || order.serial}:${order.generation ?? order.serial}`, true);
      badge.dataset.serial = String(order.serial);
      const owner = order.team === 0 || order.team === 1 ? String(order.team) : '';
      if ((badge.dataset.team ?? '') !== owner) {
        badge.dataset.team = owner;
        hud.hidden(team, !owner); if (owner) hud.text(team, TEAM_LABELS[order.team]);
      }
      const timed = Number.isFinite(order.remaining);
      hud.hidden(timer, !timed);
      badge.classList.toggle('urgent', timed && order.remaining <= 10);
      if (timed) {
        const remaining = Math.ceil(Math.max(0, order.remaining));
        const duration = order.initialPatience === undefined ? game.orderPatience(order.stains) : order.initialPatience;
        hud.text(seconds, remaining);
        const label = `剩余等待时间 ${remaining} 秒`;
        if (timer.getAttribute('aria-label') !== label) localizedAttr(timer, 'aria-label', label);
        const offset = String(1 - bounded(duration > 0 ? order.remaining / duration : 0));
        if (ring.style.strokeDashoffset !== offset) ring.style.strokeDashoffset = offset;
      } else hud.text(seconds, '');
      const progress = orderCleaningProgress(order.stains);
      hud.width(fill, progress * 100);
      const percent = String(Math.round(progress * 100));
      if (bar.getAttribute('aria-valuenow') !== percent) bar.setAttribute('aria-valuenow', percent);
      const boosted = Number.isFinite(order.rewardMultiplier) && order.rewardMultiplier > 1;
      badge.classList.toggle('reward-boosted', boosted);
      hud.hidden(reward, !boosted);
      if (boosted) hud.text(reward, `得分 +${Math.round((order.rewardMultiplier - 1) * 100)}%`);
    });
  }
}
