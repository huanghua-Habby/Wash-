/** Snapshot keyframes and per-guest deltas over the host's unreliable state channel (protocol 14).
 * A delta is always against a snapshot the guest acknowledged, so loss and reordering never corrupt state.
 * Reserved keys `$len` (entity list patch) and `$del` (removed key) never occur in snapshot data. */
const SCALE = 1e4;
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Round to 0.1 mm / 0.1 ms and drop undefined, so the diff baseline equals what JSON delivers. */
export function quantize(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * SCALE) / SCALE || 0 : null;
  if (Array.isArray(value)) return value.map((item) => item === undefined ? null : quantize(item));
  if (plain(value)) {
    const out = {};
    for (const key in value) if (value[key] !== undefined) out[key] = quantize(value[key]);
    return out;
  }
  return value;
}

const sameArray = (a, b) => Array.isArray(a) && a.length === b.length && a.every((item, i) => item === b[i] || diff(item, b[i]) === undefined);

/** Smallest patch turning `prev` into `next`; undefined when equal. Objects and same-length lists of entities or vectors patch
 *  per index (protocol 26 adds vector lists, e.g. hose nodes) unless every item changed; plain number vectors replace whole. */
export function diff(prev, next) {
  if (prev === next) return undefined;
  if (plain(next)) {
    if (!plain(prev)) return next;
    let out;
    for (const key in next) {
      const change = diff(prev[key], next[key]);
      if (change !== undefined) (out ??= {})[key] = change;
    }
    for (const key in prev) if (!(key in next)) (out ??= {})[key] = { $del: 1 };
    return out;
  }
  if (Array.isArray(next)) {
    if (Array.isArray(prev) && prev.length === next.length && next.some(item => plain(item) || Array.isArray(item))) {
      let out, changed = 0;
      next.forEach((item, i) => { const change = diff(prev[i], item); if (change !== undefined) { (out ??= { $len: next.length })[i] = change; changed++; } });
      // A whole moving vector list (a dragged hose) is smaller sent as-is than as per-index keys.
      return changed === next.length && !next.some(plain) ? next : out;
    }
    return sameArray(prev, next) ? undefined : next;
  }
  return Object.is(prev, next) ? undefined : next;
}

/** Apply a patch, returning new containers along changed paths. */
export function patch(base, change) {
  if (!plain(change)) return change;
  if ('$del' in change) return undefined;
  if ('$len' in change) {
    const out = Array.isArray(base) ? base.slice(0, change.$len) : [];
    out.length = change.$len;
    for (const key in change) if (key !== '$len') out[Number(key)] = patch(out[Number(key)], change[key]);
    return out;
  }
  const out = plain(base) ? { ...base } : {};
  for (const key in change) {
    const value = patch(out[key], change[key]);
    if (value === undefined) delete out[key]; else out[key] = value;
  }
  return out;
}

const HISTORY = 90;

/** Host side, one per guest. State travels unreliable/unordered, so a delta is only ever against a snapshot the guest
 *  has acknowledged holding; until an acknowledgement arrives (or after it falls out of history) a keyframe is sent. */
export class SnapshotEncoder {
  constructor() { this.reset(); }
  reset() { this.history = new Map(); this.acked = -1; this.scope = ''; }
  /** The guest holds the snapshot for `tick` (it reports the newest it decoded). */
  ack(tick) { if (Number.isSafeInteger(tick) && tick > this.acked && this.history.has(tick)) this.acked = tick; }
  /** `state` must already be quantized; it is shared between guests and never mutated. */
  encode(state, scope) {
    if (scope !== this.scope) { this.reset(); this.scope = scope; }
    const base = this.history.get(this.acked);
    const frame = base ? { tick: state.tick, base: this.acked, delta: diff(base, state) ?? {} } : { tick: state.tick, data: state };
    this.history.set(state.tick, state);
    for (const tick of this.history.keys()) if (this.history.size > HISTORY || tick < this.acked) this.history.delete(tick); else break;
    return frame;
  }
}

/** Guest side: rebuild full snapshots from keyframes or deltas against held history; stale or unmatched frames are dropped. */
export class SnapshotDecoder {
  constructor() { this.reset(); }
  reset() { this.history = new Map(); this.newest = -1; }
  decode(frame) {
    // Unordered delivery: anything not newer than what we hold is obsolete.
    if (!Number.isSafeInteger(frame?.tick) || frame.tick <= this.newest) return null;
    let state;
    if (frame.data) state = frame.data;
    else { const base = this.history.get(frame.base); if (!base) return null; state = patch(base, frame.delta); }
    this.newest = frame.tick; this.history.set(frame.tick, state);
    for (const tick of this.history.keys()) if (this.history.size > HISTORY) this.history.delete(tick); else break;
    // Consumers may keep or adjust a snapshot; the history stays private.
    return structuredClone(state);
  }
}
