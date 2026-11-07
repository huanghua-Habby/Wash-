import { localizedText, localizedAttr } from '../i18n/Localization.js';
import { Vector3, Vector4 } from 'three';
import { UI_WIDTH, UI_HEIGHT } from '../core/viewport.js';

/** Project onto a safe edge rectangle. The output is reused, including behind-camera points. */
export function projectTeammateEdge(clip, out) {
  const w = Math.abs(clip.w);
  if (!Number.isFinite(clip.x + clip.y + clip.z + clip.w)) return false;
  if (clip.w > 0 && Math.abs(clip.x) <= w && Math.abs(clip.y) <= w && Math.abs(clip.z) <= w) return false;
  let dx = clip.x * UI_WIDTH / 2, dy = -clip.y * UI_HEIGHT / 2;
  if (Math.abs(dx) + Math.abs(dy) < .001) { dx = 0; dy = UI_HEIGHT / 2; }
  const rx = UI_WIDTH / 2 - 100, ry = UI_HEIGHT / 2 - 105;
  const scale = Math.min(rx / Math.abs(dx), ry / Math.abs(dy));
  out.x = UI_WIDTH / 2 + dx * scale;
  out.y = UI_HEIGHT / 2 + dy * scale;
  out.angle = Math.atan2(dy, dx);
  out.vertical = Math.abs(dx * scale) >= rx - .01;
  return true;
}

/** UIManager-owned, fixed pool: no additional simulation, messages, or frame loop. */
export class TeammateIndicators {
  constructor(players, homeTruck) {
    this.players = players; this.homeTruck = homeTruck;
    this.point = new Vector3(); this.clip = new Vector4();
    this.root = document.createElement('div'); this.root.className = 'teammate-indicators'; this.root.hidden = true;
    this.entries = players.map((_, slot) => {
      const node = document.createElement('div'); node.className = `teammate-indicator player-${slot + 1}`; node.hidden = true;
      node.dataset.slot = String(slot);
      const arrow = document.createElement('span'); arrow.className = 'teammate-direction'; arrow.setAttribute('aria-hidden', 'true');
      const badge = document.createElement('strong'); badge.className = 'teammate-badge'; localizedText(badge, String(slot + 1));
      const name = document.createElement('span'); name.className = 'teammate-name';
      node.append(arrow, badge, name); this.root.appendChild(node);
      return { node, arrow, badge, name, x: 0, y: 0, angle: 0, vertical: false };
    });
    document.getElementById('ui-stage').appendChild(this.root);
  }
  /** @param {number | null} [team] the local player's versus team (0/1) to show only teammates; null in co-op shows everyone. */
  update(camera, localSlot, visible, tagOpacity = 1, team = null) {
    this.root.hidden = !visible;
    if (!visible) return;
    for (let slot = 0; slot < this.players.length; slot++) {
      const player = this.players[slot], entry = this.entries[slot];
      entry.node.hidden = true;
      if (slot === localSlot || !player.occupied || player.sceneReady === false) continue;
      // Versus: an offscreen enemy gets no arrow, so its position never leaks.
      if (team !== null && player.team !== team) continue;
      const fallen = player.state === 'fallen';
      if (fallen) { const x = this.homeTruck.pos.x + player.homeLocal.x, z = this.homeTruck.pos.z + player.homeLocal.z; this.point.set(x, this.homeTruck.topYAt(x, z) + .65, z); }
      else { player.root.getWorldPosition(this.point); this.point.y += .65; }
      this.clip.set(this.point.x, this.point.y, this.point.z, 1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
      if (!projectTeammateEdge(this.clip, entry)) continue;
      // At most three peers (co-op seats or versus teammates): shift overlapping badges along their shared edge.
      const original = entry.vertical ? entry.y : entry.x;
      const step = entry.vertical ? 70 : 170;
      for (let candidate = 0; candidate < 7; candidate++) {
        const shift = candidate === 0 ? 0 : Math.ceil(candidate / 2) * step * (candidate % 2 ? 1 : -1);
        const position = original + shift;
        if (position < (entry.vertical ? 105 : 100) || position > (entry.vertical ? UI_HEIGHT - 105 : UI_WIDTH - 100)) continue;
        if (entry.vertical) entry.y = position; else entry.x = position;
        let overlap = false;
        for (let i = 0; i < slot; i++) {
          const other = this.entries[i];
          if (!other.node.hidden && Math.abs(entry.x - other.x) < 168 && Math.abs(entry.y - other.y) < 68) { overlap = true; break; }
        }
        if (!overlap) break;
      }
      entry.node.hidden = false;
      const name = player.displayName || `玩家 ${slot + 1}`;
      const countdown = fallen ? `${Math.max(1, Math.ceil(player.fallTimer))}秒` : '';
      const accessible = fallen ? `${name} · ${countdown}` : name;
      const label = tagOpacity === 0 ? countdown : accessible;
      if (entry.name.textContent !== label) localizedText(entry.name, label);
      entry.name.hidden = !fallen && tagOpacity === 0;
      entry.name.style.opacity = fallen ? 1 : tagOpacity;
      if (entry.node.getAttribute('aria-label') !== accessible) localizedAttr(entry.node, 'aria-label', accessible);
      const transform = `translate3d(${Math.round(entry.x * 2) / 2}px, ${Math.round(entry.y * 2) / 2}px, 0)`;
      if (entry.node.style.transform !== transform) entry.node.style.transform = transform;
      const rotation = `rotate(${entry.angle}rad)`;
      if (entry.arrow.style.transform !== rotation) entry.arrow.style.transform = rotation;
    }
  }
  dispose() { this.root.remove(); }
}
