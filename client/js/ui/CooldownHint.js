import { Vector3 } from 'three';
import { localizedText } from '../i18n/Localization.js';
import { slapProfile } from '../../../shared/sim/Slap.js';
import { WASH_CONFIG as C } from '../../../shared/sim/washConfig.js';
import { CHARACTER_SCALE } from '../../../shared/sim/characterScale.js';

/** How long the "ready" pop lasts before the badge leaves. */
const READY = 0.28;
const PAW = 'M12 21c-3.3 0-6-2-6-4.6C6 13.6 8.8 12 12 12s6 1.6 6 4.4C18 19 15.3 21 12 21zM5.5 11a2.2 2.6 0 110-5.2 2.2 2.6 0 010 5.2zM18.5 11a2.2 2.6 0 110-5.2 2.2 2.6 0 010 5.2zM9.2 8a2.3 2.8 0 110-5.6 2.3 2.8 0 010 5.6zM14.8 8a2.3 2.8 0 110-5.6 2.3 2.8 0 010 5.6z';
const DROP = 'M12 2.5C9 7 5.5 10.6 5.5 14.6a6.5 6.5 0 0013 0C18.5 10.6 15 7 12 2.5z';
const BEAK = 'M3 10.5c4-4 11-5 18-1.5-2 2.6-5.5 4-9 4.2l-1 3.3-2.4-3.3C6 13 4.2 12 3 10.5z';
const KINDS = Object.freeze({
  slap: { icon: PAW, label: '拍打冷却中' },
  swallow: { icon: BEAK, label: '吞咽冷却中' },
  trunk: { icon: DROP, label: '象鼻回水中' },
});

/** Local-only recharge badge beside the head. It appears the moment the local player's own action starts a cooldown
 * (a slap swing, the pelican's swallow cooldown, an emptied elephant trunk), shows the recharge left as a ring and
 * pops away by itself when ready. Pressing the refused action again meanwhile gives a small wiggle and a dull "not yet"
 * thud. Presentation only: it reads the host-confirmed shared state; the host still decides every action. */
export class CooldownHint {
  /** @param refuse () => void — plays the "not yet" sound (UIManager routes it through AudioManager). */
  constructor(positioner, motionAllowed = () => true, refuse = () => {}) {
    Object.assign(this, { positioner, motionAllowed, refuse });
    this.anchor = new Vector3(); this.kind = ''; this.ready = 0; this.player = null; this.seen = null;
    this.root = document.createElement('div'); this.root.className = 'cooldown-hint'; this.root.hidden = true;
    this.root.setAttribute('role', 'status'); this.root.setAttribute('aria-live', 'polite');
    this.badge = document.createElement('div'); this.badge.className = 'cooldown-badge';
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    this.icon = document.createElementNS(ns, 'path'); svg.appendChild(this.icon);
    this.label = document.createElement('span'); this.label.className = 'cooldown-label';
    this.badge.appendChild(svg); this.root.append(this.badge, this.label);
    document.getElementById('ui-stage').appendChild(this.root);
  }

  /** Once per frame before the input is sampled (presses are still fresh). `allowed` is false while blocked or absent. */
  handle(localInput, player, allowed) {
    if (!allowed || !this.able(player)) return;
    const kind = this.refused(localInput, player);
    if (!kind) return;
    if (this.kind !== kind) this.show(kind, player);
    this.ready = 0; this.root.classList.remove('ready', 'nope'); this.root.classList.add('told');
    if (this.motionAllowed()) { void this.root.offsetWidth; this.root.classList.add('nope'); }
    this.refuse();
  }

  able(player) { return !!player && player.occupied !== false && ['ground', 'air'].includes(player.state) && !(player.stunRemaining > 0) && !(player.downRemaining > 0); }

  /** Which refused action this frame's presses are, if any. */
  refused(input, player) {
    if (!player.heldTool && player.slapCooldown > 0) {
      const hint = player.interactionHint || '';
      // K always slaps empty-handed (once re-armed); J only when there is nothing to pick up.
      if (input.hit('KeyK') && player.slapArmed !== false) return 'slap';
      if (input.hit('KeyJ') && (hint === '' || hint === 'J / K 拍打')) return 'slap';
    }
    if (input.hit('KeyL')) {
      if (player.animal === 'pelican' && !player.swallowed && player.swallowCooldown > 0) return 'swallow';
      if (player.animal === 'elephant' && player.trunk?.empty) return 'trunk';
    }
    return '';
  }

  show(kind, player) {
    this.player = player; this.ready = 0;
    if (this.kind !== kind) {
      this.kind = kind; this.icon.setAttribute('d', KINDS[kind].icon); this.root.dataset.kind = kind;
      localizedText(this.label, KINDS[kind].label);
    }
    this.root.classList.remove('ready');
  }

  /** Remaining share (1 → 0) of a recharge, from the shared state. */
  remaining(kind, player) {
    if (kind === 'slap') return Math.min(1, (player.slapCooldown || 0) / slapProfile(player).cooldown);
    if (kind === 'swallow') return Math.min(1, (player.swallowCooldown || 0) / C.swallowCooldownSeconds);
    const trunk = player.trunk;
    return trunk?.empty ? Math.max(0, 1 - trunk.water / C.trunkRestart) : 0;
  }

  /** Start the badge when the local player's own action just started a recharge (edges of the shared state). */
  watch(player) {
    const now = { player, swings: player.slapSerial || 0, swallow: player.swallowCooldown > 0, empty: !!player.trunk?.empty };
    const was = this.seen?.player === player ? this.seen : null;
    this.seen = now;
    if (!was || !this.able(player)) return;
    if (now.swings > was.swings && player.slapCooldown > 0) this.show('slap', player);
    else if (player.animal === 'pelican' && now.swallow && !was.swallow) this.show('swallow', player);
    else if (player.animal === 'elephant' && now.empty && !was.empty) this.show('trunk', player);
  }

  update(dt, visible, player) {
    if (player) this.watch(player);
    if (!this.kind || !this.player || !visible || !this.player.root?.visible || !this.able(this.player)) { this.reset(); return; }
    const left = this.remaining(this.kind, this.player);
    if (left <= 0 && !this.ready) {
      // Recharged: one quick pop, then out (a new swing meanwhile restarts the badge without leaving).
      this.ready = READY; this.root.classList.remove('nope'); this.root.classList.add('ready');
    }
    if (this.ready) { this.ready = Math.max(0, this.ready - dt); if (!this.ready) { this.reset(); return; } }
    this.root.style.setProperty('--left', left.toFixed(3));
    this.player.root.getWorldPosition(this.anchor); this.anchor.y += 1.25 * CHARACTER_SCALE;
    // immediate: the badge sticks to the player every frame (no smoothing lag behind a moving body).
    this.positioner.place(this.root, this.anchor, { margin: 1, immediate: true });
  }

  reset() {
    this.kind = ''; this.player = null; this.ready = 0;
    this.root.classList.remove('ready', 'nope', 'told'); delete this.root.dataset.kind;
    if (!this.root.hidden) this.positioner.hide(this.root);
  }
  dispose() { this.root.remove(); }
}
