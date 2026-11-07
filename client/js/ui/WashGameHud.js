import { localizedText, format } from '../i18n/Localization.js';
import * as THREE from 'three';
import { WASH_CONFIG as C } from '../../../shared/sim/washConfig.js';
import { CleaningCue, cleaningIcon, labelCleaningTool } from './CleaningCue.js';
import { HACK } from '../../../shared/sim/HackConsole.js';
/** The console's terminal glyph (trusted static markup). */
const TERMINAL_ICON = '<svg class="cleaning-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="m7 9 3 2.5L7 14M12 14h5M9 21h6"/></svg>';
import { applyCleaningTheme } from '../core/cleaningTheme.js';
import { ChargingHud, chargingIcon, applyChargingTheme } from './ChargingHud.js';
import { VehicleOrderHud } from './VehicleOrderHud.js';
import { CleaningHudFocus } from './CleaningHudFocus.js';
import { wrongToolStain, WRONG_TOOL_SECONDS } from './WrongToolHint.js';
import { LevelClock } from './LevelClock.js';
export class WashGameHud {
  constructor(players, motionEnabled, positioner) {
    this.positioner = positioner;
    this.motionEnabled = motionEnabled;
    this.rewardTimers = new Map();
    this.root = document.createElement('div');
    this.root.className = 'world-hud';
    this.root.hidden = true;
    document.getElementById('ui-stage').appendChild(this.root);
    this.worldPoint = new THREE.Vector3();
    this.ui = Object.fromEntries(['score-value','combo-value','combo-flame','time-value','time-fill','time-panel','interaction-prompt','score-panel'].map(id => [id, document.getElementById(id)]));
    this.playerBadges = players.map((_, index) => {
      const badge = document.createElement('div');
      badge.className = `player-badge player-${index + 1}`;
      badge.innerHTML = `<div class="held-tool"><i></i><span></span></div><div class="durability-bar"><i></i></div><div class="throw-charge-bar" hidden><i></i></div>`;
      badge.parts = { label: badge.querySelector('.held-tool span'), icon: badge.querySelector('.held-tool i'), durability: badge.querySelector('.durability-bar'),
        fill: badge.querySelector('.durability-bar i'), charge: badge.querySelector('.throw-charge-bar'), chargeFill: badge.querySelector('.throw-charge-bar i') };
      this.root.appendChild(badge);
      return badge;
    });
    this.stationBadge = document.createElement('div');
    this.stationBadge.className = 'station-badge';
    labelCleaningTool(this.stationBadge, 'towel', '洗面台');
    this.root.appendChild(this.stationBadge);
    this.soapBadge = document.createElement('div'); this.soapBadge.className = 'station-badge';
    labelCleaningTool(this.soapBadge, 'soap', '肥皂箱'); this.root.appendChild(this.soapBadge);
    // Versus terminal: the same equipment tag as the stations, in the console's terminal teal (icon is static markup).
    this.terminalBadge = document.createElement('div'); this.terminalBadge.className = 'station-badge terminal-badge';
    this.terminalBadge.dataset.tool = 'terminal';
    for (const [key, value] of [['--clean-accent', '#3E8088'], ['--clean-paper', '#E4F4F2'], ['--clean-ink', '#245A5F']]) this.terminalBadge.style.setProperty(key, value);
    this.terminalBadge.innerHTML = `${TERMINAL_ICON}<span></span>`; localizedText(this.terminalBadge.lastElementChild, '终端');
    this.root.appendChild(this.terminalBadge);
    this.supplyBadges = [];
    this.chargingHud = new ChargingHud(this);
    this.vehicleOrders = new VehicleOrderHud(this);
    this.taskFocus = new CleaningHudFocus();
    /** Last wrong-tool press: { stain, serial, until } (local presentation only). */
    this.wrongTool = null; this.wrongSerial = 0; this.hintTime = 0;
    this.stainBadges = [];
    this.lastScore = this.lastCombo = -1;
    this.clock = new LevelClock(this);
  }
  setStains(stains) {
    this.stainBadges.forEach((badge) => { badge.remove(); badge.cue.spot.remove(); });
    this.stainBadges = stains.map((stain) => {
      const cue = new CleaningCue(stain.steps), badge = cue.root;
      badge.cue = cue;
      this.root.append(cue.spot, badge);
      return badge;
    });
  }
  text(node, value) { const text = String(value); if (node.textContent !== text) localizedText(node, text); }
  hidden(node, value) { if (value) this.positioner.hide(node); else if (node.hidden) node.hidden = false; }
  width(node, value) {
    const width = `${Math.round(value * 10) / 10}%`;
    if (node.style.width !== width) node.style.width = width;
  }
  at(object, height) { object.getWorldPosition(this.worldPoint); this.worldPoint.y += height; return this.worldPoint; }
  position(node, point, identity = null, immediate = false) { this.positioner.place(node, point, { margin: 0.96, identity, immediate }); }
  positionTag(node, point, opacity, identity = null) {
    node.style.opacity = opacity;
    if (opacity === 0) this.hidden(node, true);
    else this.position(node, point, identity);
  }
  pop(node) {
    node.getAnimations().forEach((animation) => animation.cancel());
    if (this.motionEnabled()) node.animate([
      { transform: 'scale(1)' }, { transform: 'scale(1.15) rotate(-2deg)' }, { transform: 'scale(1)' },
    ], { duration: 420, easing: 'ease-out' });
  }
  reward(amount) {
    const popup = document.createElement('span');
    popup.className = 'money-popup';
    localizedText(popup, format("+{0}", amount));
    this.ui['score-panel'].appendChild(popup);
    const timer = setTimeout(() => { popup.remove(); this.rewardTimers.delete(timer); }, 1100);
    this.rewardTimers.set(timer, popup);
  }
  dispose() {
    for (const [timer, popup] of this.rewardTimers) { clearTimeout(timer); popup.remove(); }
    this.rewardTimers.clear();
    this.taskFocus.reset();
    this.root.remove();
  }
  /** Local J press with the wrong tool: pop the right tool over the stain (see WrongToolHint). */
  noteUse(game, player) {
    const stain = wrongToolStain(game, player);
    if (stain) this.wrongTool = { stain, serial: ++this.wrongSerial, until: this.hintTime + WRONG_TOOL_SECONDS };
    return !!stain;
  }
  /** Advance the hint clock (wall time, frozen-world safe). */
  tick(dt) { this.hintTime += dt; }

  update(game, tagOpacity = 1, clock = null) {
    if (!game.active && !game.practice) return;
    if (game.active) {
    const score = this.ui['score-value'];
    const combo = this.ui['combo-value'];
    // Versus shows both team scores (red : blue); co-op keeps the shared score.
    const versus = game.mode === 'versus', key = versus ? `vs:${game.teamScores[0]}:${game.teamScores[1]}` : game.score;
    if (key !== this.lastScore) {
      localizedText(score, versus ? format("红 {0} : {1} 蓝", game.teamScores[0], game.teamScores[1]) : game.score);
      this.pop(score); this.lastScore = key;
    }
    // Versus: each team's per-stain combo (HouJianNan's scoring); co-op keeps the shared order combo.
    const comboKey = versus ? `vs:${game.teamCombos[0]}:${game.teamCombos[1]}` : game.combo;
    if (comboKey !== this.lastCombo) {
      localizedText(combo, versus ? format("红 ×{0} · 蓝 ×{1}", game.teamCombos[0], game.teamCombos[1]) : format("COMBO ×{0}", Math.min(C.maximumMultiplier, Math.max(1, game.combo))));
      this.pop(combo); this.lastCombo = comboKey;
    }
    this.hidden(this.ui['combo-flame'], versus || game.combo < C.maximumMultiplier);
    this.clock.update(clock || { mode: 'countdown', remaining: game.remaining, duration: C.roundSeconds });
    }
    const prompt = this.ui['interaction-prompt'];
    // Inside a pelican the big SwallowEscapeCue says it instead of this small toast.
    const own = game.players[game.localSlot || 0];
    this.text(prompt, own.state === 'swallowed' ? '' : own.interactionHint || '');
    this.hidden(prompt, !prompt.textContent);
    for (let i = 0; i < game.players.length; i++) {
      const player = game.players[i], badge = this.playerBadges[i], towel = player.heldTool, parts = badge.parts;
      if (!towel || player.state === 'fallen' || player.occupied === false) { this.hidden(badge, true); continue; }
      this.position(badge, this.at(player.root, 1.7));
      if (badge.dataset.tool !== towel.kind) {
        if (towel.kind === 'charger') { applyChargingTheme(badge); parts.icon.innerHTML = chargingIcon(); }
        else { applyCleaningTheme(badge, towel.kind); parts.icon.innerHTML = cleaningIcon(towel.kind); }
      }
      this.text(parts.label, towel.kind === 'charger' ? game.cables[towel.index].taut ? '充电头 · 电线拉满' : '充电头' : towel.kind === 'water' ? game.hoses[towel.index].taut ? '水枪 · 水管绷紧' : '水枪' : towel.kind === 'soap' ? `肥皂 ${Math.ceil(towel.durabilityRatio * 100)}%` : towel.dirty ? towel.filthy ? '更脏毛巾' : towel.grime > 0 ? `脏毛巾 · 更脏 ${Math.floor(towel.grimeRatio * 100)}%` : '脏毛巾' : `毛巾 ${Math.ceil(towel.durabilityRatio * 100)}%`);
      this.hidden(parts.durability, towel.kind === 'water' || towel.kind === 'charger');
      // A dirty towel's bar shows how much filthier it has become (versus smudging).
      const grimy = towel.kind === 'towel' && towel.dirty && towel.grime > 0;
      this.width(parts.fill, (grimy ? towel.grimeRatio : towel.durabilityRatio || 0) * 100);
      badge.classList.toggle('grimy', grimy);
      const chargeBar = parts.charge;
      this.hidden(chargeBar, !player.throwWasDown || towel.charge < C.throwHoldSeconds);
      this.width(parts.chargeFill, Math.max(0, Math.min(1, ((towel.charge || 0) - C.throwHoldSeconds) / (C.throwChargeSeconds - C.throwHoldSeconds))) * 100);
      badge.classList.toggle('dirty', !!towel?.dirty);
    }
    this.positionTag(this.stationBadge, this.at(game.station, 1.25), tagOpacity);
    this.positionTag(this.soapBadge, this.at(game.soapBox, 0.65), tagOpacity);
    if (!game.equipmentEnabled('station')) this.hidden(this.stationBadge, true);
    if (!game.equipmentEnabled('soap')) this.hidden(this.soapBadge, true);
    const hack = game.hackConsole;
    if (hack?.group.visible) { hack.worldPosition(this.worldPoint); this.worldPoint.y += 1.45 * HACK.scale; this.positionTag(this.terminalBadge, this.worldPoint, tagOpacity); }
    else this.hidden(this.terminalBadge, true);
    while (this.supplyBadges.length < game.hoses.length) {
      const badge = document.createElement('div'); badge.className = 'station-badge'; labelCleaningTool(badge, 'water', '水枪起点');
      this.root.appendChild(badge); this.supplyBadges.push(badge);
    }
    game.hoses.forEach((hose, index) => {
      hose.anchor(this.worldPoint); this.worldPoint.y += 0.7;
      this.positionTag(this.supplyBadges[index], this.worldPoint, tagOpacity);
      if (!game.equipmentEnabled('water')) this.hidden(this.supplyBadges[index], true);
    });
    const entries = game.orders.flatMap(order => order.stains.map(stain => ({ order, stain })));
    const focus = this.taskFocus.select(game, entries);
    const wrong = this.wrongTool && this.hintTime < this.wrongTool.until && !this.wrongTool.stain.done ? this.wrongTool : null;
    this.chargingHud.update(game, tagOpacity, focus);
    this.vehicleOrders.update(game);
    this.stainBadges.forEach((badge, i) => {
      const { order, stain } = entries[i] || {}, spot = badge.cue.spot;
      const smudge = !!stain && focus.smudge.has(stain);
      if (!smudge) this.hidden(spot, true);
      if (!stain || (stain.done && !smudge) || order.mode === 'leaving') { this.hidden(badge, true); return; }
      // These marks are painted on the already-interpolated hull. Damping their
      // screen position makes them visibly slide behind a moving vehicle.
      this.position(badge, this.at(stain.mesh, 0.5), order.serial, true);
      if (smudge) this.position(spot, this.at(stain.mesh, 0), `spot:${order.serial}`, true);
      badge.cue.setSmudge(smudge, stain.done ? 1 : stain.progress);
      badge.cue.update(stain);
      const needs = !smudge && wrong?.stain === stain;
      badge.cue.setNeed(needs, needs ? stain.steps[stain.stage] : '', needs ? wrong.serial : 0);
      badge.cue.setFocused(smudge || needs || focus.stains.has(stain));
    });
  }
}
