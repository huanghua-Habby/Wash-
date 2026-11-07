import { localizedAttr, localizeMarkup, format } from '../i18n/Localization.js';
import { Vector3 } from 'three';
import { roadSignFrame } from '../../../shared/sim/RoadSigns.js';
import { UI_WIDTH, UI_HEIGHT } from '../core/viewport.js';

/** UIManager-owned warning, pinned to the threatened roof side. No local timer or hit rules. */
export class RoadSignWarnings {
  constructor(positioner) {
    this.positioner = positioner; this.anchor = new Vector3(); this.left = new Vector3(); this.right = new Vector3();
    this.root = document.createElement('div'); this.root.className = 'road-sign-warning'; this.root.hidden = true;
    this.root.setAttribute('role', 'status');
    (this.root.innerHTML = `<svg class="road-warning-display" viewBox="0 0 200 136" width="200" height="136" aria-hidden="true">
      <g class="road-warning-halo" fill="none" stroke="#ff9a92" stroke-width="3" stroke-linejoin="round">
        <path d="M94 8Q100-2 106 8L169 116Q175 128 162 128H38Q25 128 31 116Z"/>
      </g>
      <g class="road-warning-symbol">
        <path d="M95 21Q100 12 105 21L157 110Q163 120 151 120H49Q37 120 43 110Z" fill="#ffe8dc" stroke="#ee807c" stroke-width="6" stroke-linejoin="round"/>
        <path d="M100 47V78" stroke="#c85e5b" stroke-width="9" stroke-linecap="round"/>
        <circle cx="100" cy="97" r="5.5" fill="#c85e5b"/>
      </g>
      <g class="road-warning-arrows" fill="none" stroke="#f58a83" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 58L15 70 5 82M195 58L185 70 195 82"/>
        <path d="M18 58L28 70 18 82M182 58L172 70 182 82"/>
      </g>
    </svg><div class="road-warning-caption"><div class="road-warning-leds" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <strong>路牌来啦！</strong><span>回主车 · 避开危险侧</span></div>`, localizeMarkup(this.root));
    document.getElementById('ui-stage').appendChild(this.root);
    this.svg = this.root.querySelector('svg');
    this.beacon = document.createElement('div'); this.beacon.className = 'road-sign-beacon'; this.beacon.hidden = true;
    this.beacon.setAttribute('aria-hidden', 'true'); document.getElementById('ui-stage').appendChild(this.beacon);
  }
  update(game, visible) {
    const frame = visible && game.active && !game.ended && game.roundStage === 'playing'
      ? game.roadSigns.entries().map(entry => roadSignFrame(entry, game.roadSigns.presentationTime(), game.homeTruck, game.level.road)).find(frame => frame?.phase === 'warning') : null;
    if (!frame) { this.positioner.hide(this.root); this.beacon.hidden = true; return; }
    if (this.root.dataset.event !== frame.id) {
      this.root.dataset.side = this.beacon.dataset.side = String(frame.side); this.root.dataset.event = frame.id;
      localizedAttr(this.root, 'aria-label', format("{0}车道路牌来袭，回主车并避开危险侧", frame.side < 0 ? '左' : '右'));
    }
    const paused = String(!!game.paused);
    if (this.root.dataset.paused !== paused) this.root.dataset.paused = this.beacon.dataset.paused = paused;
    this.beacon.hidden = false;
    this.anchor.set(game.homeTruck.pos.x+2, game.homeTruck.topY+.7, frame.z);
    this.left.copy(this.anchor).z -= frame.width/2; this.right.copy(this.anchor).z += frame.width/2;
    this.left.project(this.positioner.camera); this.right.project(this.positioner.camera);
    const width = Math.round(Math.max(190, Math.min(250, Math.hypot((this.right.x-this.left.x)*UI_WIDTH/2, (this.right.y-this.left.y)*UI_HEIGHT/2))));
    if (this.width !== width) {
      this.root.style.width = `${width}px`; this.width = width;
      this.svg.setAttribute('width', String(width)); this.svg.setAttribute('height', String(width*.68));
    }
    this.positioner.place(this.root, this.anchor, { identity: frame.id, immediate: true,
      screenInsets: { left: width/2+20, right: width/2+20, top: width*.68+94, bottom: 20 } });
  }
  dispose() { this.positioner.hide(this.root); this.root.remove(); this.beacon.remove(); }
}
