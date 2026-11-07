import { Vector3 } from 'three';
import { localizedText, localizedAttr } from '../i18n/Localization.js';
import { EMOTES, emoteDirection } from '../../../shared/emotes.js';
import { emoteIcon, EMOTE_NAMES } from './emoteIcons.js';

const RADIUS = 92;
/** A pick reached by lifting a key (W+A → A) must hold this long, so a diagonal survives its two keys lifting a moment apart. */
const RELEASE_GRACE_MS = 120;

/** Hold U (pad RB) to open an eight-slot wheel over the local player; WASD picks, releasing U sends the last pick.
 * UIManager-owned: it only reads LocalInput and sends through the connection; the host decides (shared/emotes.js). */
export class EmoteWheel {
  constructor(positioner, send, now = () => performance.now()) {
    Object.assign(this, { positioner, send, now });
    this.open = false; this.selected = -1; this.anchor = new Vector3();
    this.keys = { x: 0, y: 0 }; this.pending = -1; this.pendingSince = 0;
    this.root = document.createElement('div'); this.root.className = 'emote-wheel'; this.root.hidden = true;
    this.root.setAttribute('role', 'menu'); localizedAttr(this.root, 'aria-label', '表情轮盘');
    const ring = document.createElement('div'); ring.className = 'emote-wheel-ring'; this.root.appendChild(ring);
    this.slots = EMOTES.map((id, index) => {
      // Slot 0 is up (W); the list runs counter-clockwise on screen, like emoteDirection.
      const angle = Math.PI / 2 + index * Math.PI / 4;
      const slot = document.createElement('div'); slot.className = 'emote-wheel-slot'; slot.setAttribute('role', 'menuitem');
      slot.style.transform = `translate(${Math.round(Math.cos(angle) * RADIUS)}px, ${Math.round(-Math.sin(angle) * RADIUS)}px)`;
      const label = document.createElement('span'); localizedText(label, EMOTE_NAMES[id]);
      localizedAttr(slot, 'aria-label', EMOTE_NAMES[id]);
      slot.append(emoteIcon(id), label); ring.appendChild(slot);
      return slot;
    });
    document.getElementById('ui-stage').appendChild(this.root);
  }

  /** Once per frame before the input is sampled. `allowed` is false while the player is blocked or absent. */
  handle(localInput, allowed) {
    const held = allowed && localInput.emoteHeld();
    if (held && !this.open) { this.open = true; this.select(-1); this.keys = { x: 0, y: 0 }; this.pending = -1; }
    if (!this.open) return;
    if (held) {
      const axis = localInput.rawAxis(), direction = emoteDirection(axis.x, axis.y);
      const x = Math.abs(axis.x) >= .5 ? Math.sign(axis.x) : 0, y = Math.abs(axis.y) >= .5 ? Math.sign(axis.y) : 0;
      const lifted = (this.keys.x !== 0 && x === 0) || (this.keys.y !== 0 && y === 0);
      this.keys = { x, y };
      // Letting go of everything keeps the pick. A pick reached only by lifting a key waits out the grace;
      // a fresh press applies at once.
      if (direction < 0 || direction === this.selected) this.pending = -1;
      else if (!lifted && this.pending < 0) this.select(direction);
      else {
        if (this.pending !== direction) { this.pending = direction; this.pendingSince = this.now(); }
        if (this.now() - this.pendingSince >= RELEASE_GRACE_MS) { this.select(direction); this.pending = -1; }
      }
      localInput.holdMovement = true;
      return;
    }
    if (allowed && this.selected >= 0) this.send(EMOTES[this.selected]);
    this.close(localInput);
  }

  select(index) {
    if (this.selected === index) return;
    this.selected = index;
    this.slots.forEach((slot, i) => { slot.classList.toggle('selected', i === index); slot.setAttribute('aria-checked', String(i === index)); });
  }

  close(localInput) { this.open = false; this.select(-1); if (localInput) localInput.holdMovement = false; }

  /** Place the open wheel over the drawn local player, or centred on its countdown circle (`ghost`, the circle's
   * bottom-centre) while it is out of play; hidden otherwise. */
  update(player, ghost = null) {
    const show = this.open && (!!ghost || !!player?.root?.visible);
    if (!show) { if (!this.root.hidden) this.positioner.hide(this.root); this.root.hidden = true; return; }
    this.root.hidden = false;
    this.root.classList.toggle('ghost', !!ghost);
    if (ghost) this.anchor.copy(ghost);
    else { player.root.getWorldPosition(this.anchor); this.anchor.y += 1; }
    this.positioner.place(this.root, this.anchor, { immediate: true, screenInsets: { left: 150, right: 150, top: 150, bottom: 150 } });
  }

  dispose() { this.root.remove(); }
}
