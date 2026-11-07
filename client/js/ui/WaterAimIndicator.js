import { Vector3 } from 'three';
import { WASH_CONFIG as C } from '../../../shared/sim/washConfig.js';

/** The first hit flips on and off while the jet's tip grazes a roof edge or the road; a brief loss keeps the ring
 * at its last contact, and the ring fades in/out instead of strobing between frames. */
const LOST_GRACE = 0.15, FADE_SECONDS = 0.12;

/** One local-only aim cue. Reuses the shared first-hit query without changing the gun's authoritative spray.
 * Shown while holding a water gun (sprayed or not), and while the local elephant's trunk sprays (its synced target). */
export class WaterAimIndicator {
  constructor(players, positioner) {
    this.players = players; this.positioner = positioner;
    this.preview = { sprayNodes: [], sprayTarget: new Vector3(), hitPlayer: null, hitStain: null };
    this.target = new Vector3(); this.fade = 0; this.lost = Infinity;
    this.root = document.createElement('div'); this.root.className = 'water-aim'; this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');
    // Vivid water-blue mark with a white halo and a softly filled landing ring, readable on cream roofs (2026-10-21).
    this.root.innerHTML = `<svg viewBox="0 0 24 48" width="36" height="72" fill="none" aria-hidden="true">
      <ellipse class="water-aim-fill" cx="12" cy="44.5" rx="8" ry="3.5"/>
      <g stroke-linecap="round" stroke-linejoin="round">
        <path class="water-aim-halo" d="M12 3V36m-4-4 4 5 4-5M20 48a8 3.5 0 1 0-16 0 8 3.5 0 1 0 16 0"/>
        <path class="water-aim-ink" d="M12 3V36m-4-4 4 5 4-5M20 48a8 3.5 0 1 0-16 0 8 3.5 0 1 0 16 0"/>
      </g></svg>`;
    document.getElementById('ui-stage').appendChild(this.root);
  }
  update(game, localSlot, visible, dt = 0, motionEnabled = true) {
    const player = this.players[localSlot], gun = player?.heldTool, trunk = player?.animal === 'elephant' ? player.trunk : null;
    const able = visible && game.equipmentVisible && !game.paused && !game.ended && player?.occupied !== false &&
      player?.sceneReady !== false && ['ground', 'air'].includes(player?.state);
    const holding = able && gun?.kind === 'water' && gun.holder === player && !player.throwWasDown;
    // Elephant: only while the trunk sprays, at the synced (host) first hit; no scratch trace of its own.
    const trunking = able && !holding && !!trunk?.spraying && trunk.sprayNodes?.length > 1;
    if (!holding && !trunking) { this.fade = 0; this.lost = Infinity; this.positioner.hide(this.root); return; }
    if (trunking) {
      this.lost = 0; this.target.copy(trunk.sprayTarget);
      this.fade = !motionEnabled ? 1 : Math.min(1, this.fade + dt / FADE_SECONDS);
      this.root.dataset.spraying = 'true';
      const fade = String(Math.round(Math.max(this.fade, 0.001) * 100) / 100);
      if (this.root.style.getPropertyValue('--aim-fade') !== fade) this.root.style.setProperty('--aim-fade', fade);
      this.positioner.place(this.root, this.target, { margin: .95, identity: 'trunk', immediate: true });
      return;
    }
    // Query the presented scene before J is pressed as well as while spraying.
    // This scratch result never enters snapshots, wet-area logic, cleaning or push calculations.
    // Before J the ring shows where the next press lands: a jet opens weak and close (SprayPressure: max(pressure,
    // pressureMin)) and only builds out while held; while spraying it follows the live pressure.
    const pressure = gun.spraying ? gun.pressure : Math.max(gun.pressure || 0, C.pressureMin);
    const contact = gun.trace(game.activeTrucks(), this.players, game.orders.flatMap(order => order.stains), this.preview, pressure);
    if (contact) { this.lost = 0; this.target.copy(this.preview.sprayTarget); } else this.lost += dt;
    const shown = this.lost < LOST_GRACE;
    this.fade = !motionEnabled ? Number(shown) : Math.max(0, Math.min(1, this.fade + (shown ? dt : -dt) / FADE_SECONDS));
    if (this.fade <= 0 && !shown) { this.positioner.hide(this.root); return; }
    this.root.dataset.spraying = String(!!gun.spraying);
    const fade = String(Math.round(Math.max(this.fade, 0.001) * 100) / 100);
    if (this.root.style.getPropertyValue('--aim-fade') !== fade) this.root.style.setProperty('--aim-fade', fade);
    this.positioner.place(this.root, this.target, { margin: .95, identity: gun.id, immediate: true });
  }
  dispose() { this.positioner.hide(this.root); this.root.remove(); }
}
