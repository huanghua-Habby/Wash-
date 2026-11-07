import { localizedText, localizedAttr, format, literal } from '../i18n/Localization.js';
/** Public ids above occupied player slots, in both the home practice scene and a round. */
import * as THREE from 'three';
import { NameVisibility } from './NameVisibility.js';
import { WASH_CONFIG } from '../../../shared/sim/washConfig.js';
import { PLAYER_COLORS } from '../core/playerColors.js';
import { displayColor, plateStyle, teamColor } from '../core/teamColors.js';
import { CHARACTER_SCALE } from '../../../shared/sim/characterScale.js';
export class PlayerNames {
  dispose() { this.root.remove(); this.respawnRoot.remove(); this.tankRoot.remove(); }
  constructor(players, homeTruck, positioner, visibility = new NameVisibility()) {
    this.positioner = positioner;
    this.players = players; this.homeTruck = homeTruck; this.point = new THREE.Vector3();
    const stage = document.getElementById('ui-stage');
    PLAYER_COLORS.forEach((color, i) => stage.style.setProperty(`--player-color-${i + 1}`, color));
    this.visibility = visibility;
    this.root = document.createElement('div'); this.root.className = 'player-names';
    document.getElementById('ui-stage').appendChild(this.root);
    this.labels = players.map((_,i) => { const label = document.createElement('span'); label.className = `name-tag player-${i+1}`; this.root.appendChild(label); return label; });
    // Elephant trunk tanks: a small water bar over each elephant, shown while it sprays or refills.
    // A squirrel slot reuses the same bar (class `grip`) for the paws' remaining grip while it clings.
    this.tankRoot = document.createElement('div'); this.tankRoot.className = 'trunk-tanks';
    document.getElementById('ui-stage').appendChild(this.tankRoot);
    this.tanks = players.map((_, i) => {
      const tank = document.createElement('div'); tank.className = `trunk-tank player-${i + 1}`; tank.hidden = true;
      tank.setAttribute('role', 'meter'); tank.setAttribute('aria-valuemin', '0'); tank.setAttribute('aria-valuemax', '100');
      const fill = document.createElement('i'); tank.appendChild(fill); tank.fill = fill; tank.level = -1;
      this.tankRoot.appendChild(tank); return tank;
    });
    this.respawnRoot = document.createElement('div'); this.respawnRoot.className = 'respawn-counters';
    document.getElementById('ui-stage').appendChild(this.respawnRoot);
    this.counters = players.map((_, i) => {
      const counter = document.createElement('div'); counter.className = `respawn-counter player-${i + 1}`; counter.hidden = true;
      localizedAttr(counter, 'data-break-free', '挣脱');
      const seconds = document.createElement('strong');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 72 72'); svg.setAttribute('aria-hidden', 'true');
      const circles = ['respawn-track', 'respawn-progress'].map((className) => {
        const circle = document.createElementNS(svg.namespaceURI, 'circle');
        for (const [key, value] of Object.entries({ cx: '36', cy: '36', r: '29', pathLength: '1', class: className })) circle.setAttribute(key, value);
        svg.appendChild(circle); return circle;
      });
      counter.append(svg, seconds); counter.parts = { seconds, progress: circles[1] }; this.respawnRoot.appendChild(counter); return counter;
    });
  }
  showTemporarily() { this.visibility.showTemporarily(); }
  /** Where a player's respawn / break-free countdown sits (its bottom-centre), or null while it is not shown.
   * Also the stand-in "body" for an emote sent while fallen or swallowed. */
  counterAnchor(player, state, target) {
    if (!player?.occupied || player.sceneReady === false || !['fallen', 'swallowed'].includes(player.state) || state.ended || state.phase === 'transition') return null;
    if (player.state === 'swallowed') {
      // Break-free countdown just above the pelican's own name tag (the passenger rides in its pouch).
      const owner = player.swallowedBy || player;
      owner.root.getWorldPosition(target); target.y += ((state.active || owner.heldTool ? 2.5 : 1.6) + 0.3) * CHARACTER_SCALE;
    } else {
      // The moving home vehicle's respawn point, never the fallen avatar.
      const rx = this.homeTruck.pos.x + player.homeLocal.x, rz = this.homeTruck.pos.z + player.homeLocal.z;
      target.set(rx, this.homeTruck.topYAt(rx, rz) + 0.6, rz);
    }
    return target;
  }
  /** Water left in an elephant's trunk, from the authoritative tank; hidden while full and idle.
   * For a squirrel the same bar shows the grip left while it clings (shared `wallTime`), draining toward the slip. */
  updateTank(player, i, state) {
    const tank = this.tanks[i], trunk = player.trunk, visible = !!player.occupied && player.sceneReady !== false && player.root.visible &&
      !['fallen', 'swallowed'].includes(player.state) && !state.ended && state.phase !== 'transition';
    // Ladders cost no grip: no bar there.
    const grip = visible && player.animal === 'squirrel' && player.state === 'air' && !!player.wall && !(player.wall.ladder >= 0);
    const show = grip || (visible && !!trunk && player.animal === 'elephant' && (trunk.spraying || trunk.water < 0.999));
    if (!show) { if (!tank.hidden) { tank.hidden = true; this.positioner.hide(tank); } return; }
    tank.hidden = false;
    player.root.getWorldPosition(this.point); this.point.y += 1.3 * CHARACTER_SCALE;
    this.positioner.place(tank, this.point);
    if (tank.classList.contains('grip') !== grip) {
      tank.classList.toggle('grip', grip); tank.level = -1;
      localizedAttr(tank, 'aria-label', grip ? '松鼠抓力' : '象鼻水量');
    }
    const amount = grip ? Math.max(0, 1 - player.wallTime / WASH_CONFIG.squirrelGripSeconds) : trunk.water;
    const level = Math.round(amount * 100);
    if (level !== tank.level) { tank.level = level; tank.fill.style.transform = `scaleX(${level / 100})`; tank.setAttribute('aria-valuenow', String(level)); }
    tank.classList.toggle('empty', grip ? amount < 0.3 : trunk.empty); tank.classList.toggle('spraying', !grip && trunk.spraying);
  }
  update(state, opacity = this.visibility.update(state)) {
    this.root.style.opacity = opacity;
    this.root.hidden = opacity === 0;
    this.root.dataset.visibility = this.visibility.phase;
    // Team plate palette (HouJianNan look) follows CFG.team; written only when a color changes.
    const teamPalette = `${teamColor(0)}|${teamColor(1)}`;
    if (this.teamPalette !== teamPalette) {
      this.teamPalette = teamPalette;
      const stage = document.getElementById('ui-stage').style;
      stage.setProperty('--team-0', teamColor(0)); stage.setProperty('--team-1', teamColor(1));
    }
    const plates = plateStyle();
    this.players.forEach((player,i) => {
      const color = displayColor(player, PLAYER_COLORS[i]);
      if (this.colors?.[i] !== color) {
        this.colors ||= []; this.colors[i] = color;
        document.getElementById('ui-stage').style.setProperty(`--player-color-${i + 1}`, color);
      }
      const counter = this.counters[i], swallowed = player.state === 'swallowed';
      counter.hidden = !player.occupied || player.sceneReady === false || !['fallen', 'swallowed'].includes(player.state) || state.ended || state.phase === 'transition';
      counter.classList.toggle('swallowed', swallowed);
      if (!counter.hidden && swallowed) {
        this.counterAnchor(player, state, this.point);
        this.positioner.place(counter, this.point);
        const seconds = String(Math.max(1, Math.ceil(player.swallowRemaining - 1e-9)));
        if (counter.parts.seconds.textContent !== seconds) localizedText(counter.parts.seconds, seconds);
        counter.parts.progress.style.strokeDashoffset = String(1 - Math.max(0, Math.min(1, player.swallowRemaining / WASH_CONFIG.swallowSeconds)));
        localizedAttr(counter, 'aria-label', format("{0}被鹈鹕吞下，{1} 秒后挣脱", literal(player.displayName || format("玩家 {0}", i + 1)), seconds));
      } else if (!counter.hidden) {
        this.counterAnchor(player, state, this.point);
        this.positioner.place(counter, this.point);
        const seconds = String(Math.max(1, Math.ceil(player.fallTimer - 1e-9)));
        if (counter.parts.seconds.textContent !== seconds) localizedText(counter.parts.seconds, seconds);
        const duration = WASH_CONFIG.respawnSeconds * (1 - player.respawnReduction);
        counter.parts.progress.style.strokeDashoffset = String(1 - Math.max(0, Math.min(1, player.fallTimer / duration)));
        localizedAttr(counter, 'aria-label', format("{0}，{1} 秒后复活", literal(player.displayName || format("玩家 {0}", i + 1)), counter.parts.seconds.textContent));
      } else this.positioner.hide(counter);
      this.updateTank(player, i, state);
      const label = this.labels[i];
      // Follow the visible mesh (prediction/interpolation), not its authority correction.
      player.root.getWorldPosition(this.point);
      this.point.y += (state.active || player.heldTool ? 2.5 : 1.6) * CHARACTER_SCALE;
      this.positioner.place(label, this.point, { visible: opacity > 0 && !!player.occupied && player.sceneReady !== false && player.state !== 'fallen' && !swallowed });
      const name = player.displayName || '';
      if (label.textContent !== name) label.textContent = name;
      // Versus, plate look: the whole plate takes the team color so teammates read at a glance.
      // A bot standing in for a dropped player keeps their name with an AI mark.
      if (label.hasAttribute('data-ai') !== !!player.standIn) label.toggleAttribute('data-ai', !!player.standIn);
      const team = plates && (player.team === 0 || player.team === 1) ? String(player.team) : '';
      if ((label.dataset.team || '') !== team) { if (team) label.dataset.team = team; else delete label.dataset.team; }
    });
  }
}
