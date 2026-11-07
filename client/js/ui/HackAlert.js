import { Vector3 } from 'three';
import { localizedText, format } from '../i18n/Localization.js';
import { TEAM_LABELS } from '../core/teamColors.js';
import { hackEffect } from '../../../shared/sim/HackEffects.js';
import { HACK } from '../../../shared/sim/HackConsole.js';

const RESULT_SECONDS = 3;
const TERMINAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="m7 9 3 2.5L7 14M12 14h5M9 21h6"/></svg>';

/** UIManager-owned versus hack presentation from the applied host state (shared/sim/HackConsole.js):
 * - a status badge over the console while someone hacks (the live bar in the hacker's team colour) or it reboots; its
 *   name is the standard "终端" equipment tag (WashGameHud), like every other station;
 * - a banner for this page's team: a pulsing warning while the other team types, a calm strip while yours does, and a
 *   result card when a hack lands (who did it and what happened). It never decides anything. */
export class HackAlert {
  constructor(positioner, motionAllowed = () => true) {
    Object.assign(this, { positioner, motionAllowed });
    const stage = document.getElementById('ui-stage');
    this.badge = document.createElement('div'); this.badge.className = 'hack-badge'; this.badge.hidden = true;
    this.badge.setAttribute('aria-hidden', 'true');
    this.badge.innerHTML = `<div class="hack-badge-card"><i class="hack-badge-icon">${TERMINAL}</i><span class="hack-badge-label"></span></div><div class="hack-badge-bar"><i></i></div>`;
    this.badgeLabel = this.badge.querySelector('.hack-badge-label'); this.badgeBar = this.badge.querySelector('.hack-badge-bar');
    this.badgeFill = this.badgeBar.firstElementChild;
    this.banner = document.createElement('div'); this.banner.className = 'hack-banner'; this.banner.hidden = true;
    this.banner.setAttribute('role', 'status'); this.banner.setAttribute('aria-live', 'assertive');
    this.banner.innerHTML = `<div class="hack-banner-card"><i class="hack-banner-icon">${TERMINAL}</i><div class="hack-banner-text"><strong></strong><span></span></div><div class="hack-banner-bar"><i></i></div></div>`;
    this.title = this.banner.querySelector('strong'); this.detail = this.banner.querySelector('.hack-banner-text span');
    this.bannerBar = this.banner.querySelector('.hack-banner-bar'); this.bannerFill = this.bannerBar.firstElementChild;
    this.card = this.banner.querySelector('.hack-banner-card');
    stage.append(this.badge, this.banner);
    this.anchor = new Vector3(); this.text = new Map(); this.reset();
  }
  set(node, value) { if (this.text.get(node) !== value) { this.text.set(node, value); localizedText(node, value); } }
  width(node, value) { const width = `${Math.round(Math.max(0, Math.min(1, value)) * 1000) / 10}%`; if (node.style.width !== width) node.style.width = width; }
  update(game, visible, localTeam, dt) {
    const hack = game.hackConsole;
    if (!visible || !hack?.group.visible || game.mode !== 'versus') { this.hide(); this.serial = hack?.serial ?? 0; return; }
    if (hack.serial !== this.serial) {
      if (hack.serial === this.serial + 1 && hack.last.effect) this.result = RESULT_SECONDS;
      this.serial = hack.serial;
    }
    this.result = Math.max(0, this.result - dt);
    const hackerTeam = hack.slot >= 0 ? game.players[hack.slot]?.team : null;
    this.updateBadge(hack, hackerTeam, game.practice);
    // Home menu: progress only, no team banners (2026-10-21 user).
    if (game.practice) this.hideBanner(); else this.updateBanner(hack, hackerTeam, localTeam);
  }
  updateBadge(hack, hackerTeam, practice = false) {
    const badge = this.badge, typing = hackerTeam === 0 || hackerTeam === 1;
    badge.dataset.team = typing ? String(hackerTeam) : '';
    badge.dataset.state = hack.cooldown > 0 ? 'reboot' : typing ? 'hacking' : 'idle';
    const percent = typing ? Math.floor(hack.progress[hackerTeam] * 100) : 0;
    this.set(this.badgeLabel, hack.cooldown > 0 ? format('重启中 {0}s', Math.ceil(hack.cooldown)) : typing ? (practice ? format('{0}%', percent) : format('骇入中 {0}%', percent)) : '黑客台');
    this.badgeBar.hidden = !typing && !(hack.cooldown > 0);
    this.width(this.badgeFill, typing ? hack.progress[hackerTeam] : 1 - hack.cooldown / HACK.cooldownSeconds);
    if (badge.dataset.state === 'idle') { this.positioner.hide(badge); return; }
    hack.worldPosition(this.anchor); this.anchor.y += 2.15 * HACK.scale;
    this.positioner.place(badge, this.anchor, { margin: 0.96 });
  }
  updateBanner(hack, hackerTeam, localTeam) {
    const teamed = localTeam === 0 || localTeam === 1;
    let mode = '', team = null;
    if (this.result > 0) { team = hack.last.team; mode = !teamed ? 'result' : team === localTeam ? 'success' : 'victim'; }
    else if (hackerTeam === 0 || hackerTeam === 1) { team = hackerTeam; mode = !teamed ? 'watch' : team === localTeam ? 'ours' : 'warning'; }
    if (!mode) { this.hideBanner(); return; }
    const enemy = TEAM_LABELS[1 - team], self = TEAM_LABELS[team], effect = hackEffect(hack.last.effect)?.label || '';
    if (this.banner.dataset.mode !== mode) {
      this.banner.dataset.mode = mode; this.banner.hidden = false;
      this.card.getAnimations().forEach(animation => animation.cancel());
      if (this.motionAllowed()) this.card.animate(mode === 'warning' || mode === 'victim'
        ? [{ transform: 'translateY(-40px) rotate(-3deg)', opacity: 0 }, { transform: 'translateY(4px) rotate(1deg)', opacity: 1, offset: .6 }, { transform: 'translateY(0) rotate(-1deg)', opacity: 1 }]
        : [{ transform: 'translateY(-24px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 360, easing: 'ease-out' });
    }
    this.banner.dataset.team = String(team);
    const value = hack.progress[team] || 0;
    if (mode === 'warning') { this.set(this.title, format('{0}正在骇入你们的车！', self)); this.set(this.detail, '快去黑客台把他拍走！'); }
    else if (mode === 'ours') { this.set(this.title, format('我方正在骇入{0}的车', enemy)); this.set(this.detail, '守住黑客台，别被拍走'); }
    else if (mode === 'watch') { this.set(this.title, format('{0}正在骇入{1}的车', self, enemy)); this.set(this.detail, ''); }
    else if (mode === 'victim') { this.set(this.title, '你们的车被骇入了！'); this.set(this.detail, effect); }
    else if (mode === 'success') { this.set(this.title, '骇入成功！'); this.set(this.detail, format('{0}：{1}', enemy, effect)); }
    else { this.set(this.title, format('{0}黑进了{1}的车', self, enemy)); this.set(this.detail, effect); }
    this.bannerBar.hidden = this.result > 0;
    this.width(this.bannerFill, value);
  }
  hideBanner() { if (!this.banner.hidden) { this.banner.hidden = true; this.banner.dataset.mode = ''; } }
  hide() { this.positioner.hide(this.badge); this.hideBanner(); this.result = 0; }
  reset() { this.serial = 0; this.result = 0; this.hide(); }
  dispose() { this.hide(); this.badge.remove(); this.banner.remove(); }
}
