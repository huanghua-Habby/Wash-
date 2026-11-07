import { Vector3 } from 'three';
import { UI_WIDTH, UI_HEIGHT } from '../core/viewport.js';
import { localizedAttr, format, literal } from '../i18n/Localization.js';
import { emoteIcon, emoteBubbleFrame, EMOTE_NAMES } from './emoteIcons.js';
import { CHARACTER_SCALE } from '../../../shared/sim/characterScale.js';

/** Matches the `emote-out` keyframes in style.css. */
const LEAVE_MS = 260;
/** Tail-tip height above the feet: just over the head (and the 1.3 trunk/grip bar) while names are hidden in play;
 * above the name tag whenever names show (home, round intro, manual reveal), blended by the name opacity. */
const HEAD_CLEARANCE = 1.45, TOOL_CLEARANCE = 0.55, NAME_CLEARANCE = 0.95;
/** Card box around the tail tip, design px (see `.emote-bubble-art`: 76×79.5, tip a third in from the left). */
const CARD = { left: 76 / 3, right: 76 * 2 / 3, height: 79.5 };
/** A bubble covering another player fades toward MIN_OPACITY, fully once COVER_FULL of their body box is behind it. */
/** A ghost bubble's tip sits this far (design px) above its countdown's bottom-centre: the 72px respawn circle or the
 * 58px break-free circle (style.css `.respawn-counter`), plus a small gap. */
const GHOST_LIFT = Object.freeze({ fallen: 78, swallowed: 64 });
const MIN_OPACITY = 0.5, COVER_FULL = 0.35, FADE_RESPONSE = 10, BODY_HEIGHT = 1.2, BODY_ASPECT = 0.8;

/** UIManager-owned head bubbles: read the host-confirmed `emoteId / emoteSerial / emoteRemaining`, never a local guess.
 * Offscreen players show nothing (no edge marker), so an emote cannot reveal a position. A fallen or swallowed player
 * emotes from above their countdown circle (a dashed, floating "ghost" bubble with a halo). */
export class EmoteBubbles {
  /** @param counterAnchor (player, state, target) → target | null: where that player's respawn / break-free countdown
   * sits while it shows (PlayerNames). A fallen or swallowed player's emote rides above it as a "ghost" bubble. */
  constructor(players, positioner, motionAllowed = () => true, counterAnchor = () => null) {
    Object.assign(this, { players, positioner, motionAllowed, counterAnchor });
    this.point = new Vector3(); this.projected = new Vector3(); this.ghostPoint = new Vector3();
    const stage = document.getElementById('ui-stage');
    this.bubbles = players.map((_, slot) => {
      const node = document.createElement('div'); node.className = 'emote-bubble'; node.hidden = true;
      node.setAttribute('role', 'img'); node.dataset.slot = String(slot);
      // The frame's tail tip is the node's bottom-centre (CSS shifts the art), which the positioner pins to the anchor above the head.
      const art = document.createElement('div'); art.className = 'emote-bubble-art';
      art.appendChild(emoteBubbleFrame()); node.appendChild(art); stage.appendChild(node);
      return { node, art, anchor: new Vector3(), id: '', serial: -1, leaveUntil: 0, opacity: 1, lift: 0 };
    });
  }

  /** @param nameOpacity the shared name-tag opacity this frame (0 once names fade out in play). */
  update(state, visible, nameOpacity = 1) {
    this.nameOpacity = Math.max(0, Math.min(1, nameOpacity));
    this.players.forEach((player, slot) => {
      const bubble = this.bubbles[slot], id = player.emoteId || '';
      const out = ['fallen', 'swallowed'].includes(player.state);
      // Out of play, the emote still reaches everyone: it floats above the countdown that stands in for the body.
      const ghost = visible && out && !!this.counterAnchor(player, state, this.ghostPoint);
      const present = ghost || visible && !out && player.occupied !== false && player.sceneReady !== false && !!player.root?.visible;
      const mode = ghost ? player.state : '';
      if ((bubble.node.dataset.ghost || '') !== mode) {
        if (mode) bubble.node.dataset.ghost = mode; else delete bubble.node.dataset.ghost;
        bubble.lift = GHOST_LIFT[mode] || 0; bubble.node.style.marginTop = bubble.lift ? `${-bubble.lift}px` : '';
      }
      if (!present || !id || !(player.emoteRemaining > 0)) {
        // An emote that simply runs out shrinks away above a still-visible player; anything else hides at once.
        const now = performance.now();
        if (present && !bubble.node.hidden && this.motionAllowed()) {
          if (!bubble.leaveUntil) { bubble.leaveUntil = now + LEAVE_MS; bubble.node.classList.remove('popping'); bubble.node.classList.add('leaving'); }
          if (now < bubble.leaveUntil) { this.place(bubble, player, state, slot); return; }
        }
        this.endLeave(bubble);
        if (!bubble.node.hidden) this.positioner.hide(bubble.node);
        return;
      }
      this.endLeave(bubble);
      if (bubble.id !== id) { bubble.id = id; bubble.art.replaceChildren(bubble.art.firstChild, emoteIcon(id)); }
      if (bubble.serial !== player.emoteSerial) {
        bubble.serial = player.emoteSerial;
        localizedAttr(bubble.node, 'aria-label', format('{0}：{1}', literal(player.displayName || format('玩家 {0}', slot + 1)), EMOTE_NAMES[id]));
        bubble.node.classList.remove('popping');
        if (this.motionAllowed()) { void bubble.node.offsetWidth; bubble.node.classList.add('popping'); }
      }
      this.place(bubble, player, state, slot);
    });
  }

  place(bubble, player, state, slot) {
    if (bubble.node.dataset.ghost) bubble.anchor.copy(this.ghostPoint); // the node margin lifts the tip above the countdown circle
    else {
      player.root.getWorldPosition(bubble.anchor);
      const nearHead = (HEAD_CLEARANCE + (player.heldTool ? TOOL_CLEARANCE : 0)) * CHARACTER_SCALE;
      const aboveName = ((state.active || player.heldTool ? 2.5 : 1.6) + NAME_CLEARANCE) * CHARACTER_SCALE;
      bubble.anchor.y += nearHead + (aboveName - nearHead) * this.nameOpacity;
    }
    // margin 1: an offscreen head hides its bubble instead of riding the screen edge.
    this.positioner.place(bubble.node, bubble.anchor, { identity: slot, margin: 1 });
    if (bubble.node.hidden) return;
    const target = 1 - (1 - MIN_OPACITY) * Math.min(1, this.coverage(bubble.anchor, slot, bubble.lift) / COVER_FULL);
    const dt = this.motionAllowed() ? Math.max(0, Math.min(0.25, state.dt || 0)) : Infinity;
    bubble.opacity += (target - bubble.opacity) * (1 - Math.exp(-FADE_RESPONSE * dt));
    const opacity = bubble.opacity > 0.995 ? '' : bubble.opacity.toFixed(3);
    if (bubble.node.style.opacity !== opacity) bubble.node.style.opacity = opacity;
  }

  /** Largest share of another visible player's screen body box hidden behind this bubble's card. */
  coverage(anchor, slot, lift = 0) {
    const tip = this.screen(anchor);
    if (!tip) return 0;
    const left = tip.x - CARD.left, right = tip.x + CARD.right, bottom = tip.y - lift, top = bottom - CARD.height;
    let worst = 0;
    this.players.forEach((other, index) => {
      if (index === slot || other.occupied === false || other.sceneReady === false || !other.root?.visible || other.state === 'swallowed') return;
      other.root.getWorldPosition(this.point);
      const feet = this.screen(this.point);
      this.point.y += BODY_HEIGHT * CHARACTER_SCALE;
      const head = this.screen(this.point);
      if (!feet || !head) return;
      const height = Math.max(1, feet.y - head.y), half = height * BODY_ASPECT / 2, x = (feet.x + head.x) / 2;
      const w = Math.min(right, x + half) - Math.max(left, x - half), h = Math.min(bottom, feet.y) - Math.max(top, head.y);
      if (w > 0 && h > 0) worst = Math.max(worst, (w * h) / (2 * half * height));
    });
    return worst;
  }

  screen(world) {
    const camera = this.positioner.camera;
    if (!camera) return null;
    const p = this.projected.copy(world).project(camera);
    if (!Number.isFinite(p.x + p.y) || p.z < -1 || p.z > 1) return null;
    return { x: (p.x + 1) * UI_WIDTH / 2, y: (1 - p.y) * UI_HEIGHT / 2 };
  }

  endLeave(bubble) { if (bubble.leaveUntil) { bubble.leaveUntil = 0; bubble.node.classList.remove('leaving'); } }

  reset() { for (const bubble of this.bubbles) { bubble.id = ''; bubble.serial = -1; bubble.art.replaceChildren(bubble.art.firstChild); this.endLeave(bubble); bubble.opacity = 1; bubble.node.style.opacity = ''; bubble.node.classList.remove('popping'); this.positioner.hide(bubble.node); } }
  dispose() { for (const bubble of this.bubbles) bubble.node.remove(); this.bubbles = []; }
}
