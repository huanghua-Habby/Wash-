/** Transient, host-owned guide barrier. Slots come from the registry/link identity, never a client claim. */
export const GUIDE_CLOSE_SECONDS = 0.25;
import { GUIDE_DEFINITIONS } from '../guideDefinitions.js';
export const GUIDE_IDS = Object.freeze(Object.keys(GUIDE_DEFINITIONS));

export class LevelGuide {
  constructor() { this.reset(); }
  // `elapsed` counts the guide's own seconds for a definition with `timeoutSeconds` (versus terminal: 15 s), which then
  // closes like a full confirmation. Masks cover up to eight slots (versus).
  reset() { this.id = null; this.pageIndex = 0; this.pageCount = 0; this.participants = 0; this.ready = 0; this.closeTime = 0; this.elapsed = 0; this.timeout = 0; }
  begin(id, players) {
    this.reset();
    if (!id) return false;
    if (!GUIDE_IDS.includes(id)) throw new Error(`Unknown level guide: ${id}`);
    this.id = id; this.pageCount = GUIDE_DEFINITIONS[id].pages.length; this.timeout = GUIDE_DEFINITIONS[id].timeoutSeconds || 0; this.reconcile(players);
    if (!this.participants) { this.reset(); return false; }
    return true;
  }
  reconcile(players) {
    const mask = players.reduce((mask, player, slot) => mask | (player.occupied !== false && player.connected !== false ? 1 << slot : 0), 0);
    if (mask !== this.participants) {
      this.ready &= mask; this.participants = mask; this.closeTime = 0;
    }
  }
  confirm(slot, id, pageIndex = 0) {
    if (id !== this.id || pageIndex !== this.pageIndex || !Number.isInteger(slot) || slot < 0 || slot > 7 || !(this.participants & (1 << slot))) return false;
    this.ready |= 1 << slot; return true;
  }
  get complete() { return (this.participants !== 0 && this.ready === this.participants) || (this.timeout > 0 && this.elapsed >= this.timeout); }
  /** Seconds before a timed guide closes by itself (0 when it has no timeout). */
  get remaining() { return this.timeout > 0 ? Math.max(0, this.timeout - this.elapsed) : 0; }
  clearSlot(slot) { this.ready &= ~(1 << slot); this.closeTime = 0; }
  update(dt, players) {
    this.reconcile(players);
    if (this.timeout > 0) this.elapsed += dt;
    this.closeTime = this.complete ? this.closeTime + dt : 0;
    if (this.closeTime < GUIDE_CLOSE_SECONDS - 1e-8) return false;
    if (this.pageIndex + 1 < this.pageCount) { this.pageIndex++; this.ready = 0; this.closeTime = 0; return false; }
    return true;
  }
  capture() { return { id: this.id, pageIndex: this.pageIndex, pageCount: this.pageCount, participants: this.participants, ready: this.ready, closeTime: this.closeTime, elapsed: this.elapsed, timeout: this.timeout }; }
  apply(state) { Object.assign(this, { elapsed: 0, timeout: 0 }, state); }
}
