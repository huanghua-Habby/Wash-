/** Versioned level progress in this origin's browser-profile localStorage. No room/session identity is persisted. */
import { SAVE_VERSION, getLevel, getCoopLevel, validRoundResult } from '../../../shared/levels.js';
export const PROGRESS_KEY = 'wash-progress';
const integer = (value) => Number.isSafeInteger(value) && value >= 0;

/** Reject incompatible or malformed records without migrating or silently deleting the stored bytes. */
export function decodeProgress(raw) {
  if (raw === null) return { status: 'missing', data: null };
  let data; try { data = JSON.parse(raw); } catch { return { status: 'corrupt', data: null }; }
  if (!data || data.version !== SAVE_VERSION) return { status: 'incompatible', data: null };
  // A versus map written as the resume level (GameLogic build eccf0c2–70c8f10) is dropped, not treated as corrupt.
  if (data.lastLevelId !== null && getLevel(data.lastLevelId) && !getCoopLevel(data.lastLevelId)) data.lastLevelId = null;
  if ((data.lastLevelId !== null && !getCoopLevel(data.lastLevelId)) || !integer(data.updatedAt) ||
      !data.levels || typeof data.levels !== 'object' || Array.isArray(data.levels) ||
      !Array.isArray(data.resultIds) || data.resultIds.length > 128 || data.resultIds.some((id) => typeof id !== 'string' || !id || id.length > 64) ||
      Object.entries(data.levels).some(([id, stats]) => !getCoopLevel(id) || !stats ||
        !integer(stats.finishedRuns) || !integer(stats.bestScore) || !integer(stats.bestCompletedOrders) ||
        !Number.isInteger(stats.bestScorePlayers) || stats.bestScorePlayers < 1 || stats.bestScorePlayers > 4 ||
        !integer(stats.bestStars) || stats.bestStars > 3 || typeof stats.tutorialCompleted !== 'boolean')) return { status: 'corrupt', data: null };
  return { status: 'ready', data };
}

/** Storage errors are visible; receipts are acknowledged only after setItem succeeds. */
export class ProgressStore extends EventTarget {
  static browserOptions(locks = globalThis.navigator?.locks) {
    return { lock: locks ? work => locks.request('wash-progress', work) : null };
  }
  /** @param {{storage?: () => Pick<Storage, 'getItem' | 'setItem'>, lock?: null | ((work: () => boolean) => Promise<boolean>)}} options */
  constructor({ storage = () => globalThis.localStorage, lock = null } = {}) {
    super(); this.storage = storage; this.lock = lock; this.error = ''; this.reload();
  }
  reload() {
    try { Object.assign(this, decodeProgress(this.storage().getItem(PROGRESS_KEY))); this.error = ''; }
    catch { this.status = 'unavailable'; this.data = null; this.error = '浏览器未允许保存关卡进度'; }
    this.dispatchEvent(new Event('change'));
  }
  get resumeLevelId() { return this.status === 'ready' ? this.data.lastLevelId : null; }
  fresh() { return { version: SAVE_VERSION, lastLevelId: null, levels: {}, resultIds: [], updatedAt: Date.now() }; }
  /** Re-read under a browser-wide lock so multiple tabs merge into the same profile's record. */
  async update(mutate) {
    const work = () => {
      try {
        const decoded = decodeProgress(this.storage().getItem(PROGRESS_KEY));
        const data = decoded.data || this.fresh();
        const changed = mutate(data);
        if (changed) { data.updatedAt = Date.now(); this.storage().setItem(PROGRESS_KEY, JSON.stringify(data)); }
        this.status = 'ready'; this.data = data; this.error = ''; this.dispatchEvent(new Event('change')); return true;
      } catch { this.error = '存档写入失败，本次进度尚未保存'; this.dispatchEvent(new Event('change')); return false; }
    };
    try { return this.lock ? await this.lock(work) : work(); }
    catch { this.error = '存档写入失败，本次进度尚未保存'; this.dispatchEvent(new Event('change')); return false; }
  }
  /** Remember the last entered level, without saving any mid-round world state. */
  enter(levelId) {
    if (!getCoopLevel(levelId)) return Promise.resolve(false);
    return this.update((data) => { data.lastLevelId = levelId; return true; });
  }
  /** Merge best results and count a full finished round once, including reconnect redelivery. */
  record(result) {
    if (!validRoundResult(result)) return Promise.resolve(false);
    return this.update((data) => {
      if (data.resultIds.includes(result.roundId)) return false;
      const stats = data.levels[result.levelId] || { finishedRuns: 0, bestScore: 0, bestScorePlayers: result.partyBalance.playerCount, bestCompletedOrders: 0, bestStars: 0, tutorialCompleted: false };
      if (!stats.finishedRuns || result.score > stats.bestScore) {
        stats.bestScore = result.score; stats.bestScorePlayers = result.partyBalance.playerCount;
      }
      stats.finishedRuns++;
      stats.bestCompletedOrders = Math.max(stats.bestCompletedOrders, result.completedOrders);
      stats.bestStars = Math.max(stats.bestStars, result.stars || 0);
      stats.tutorialCompleted ||= result.reason === 'tutorial_complete';
      data.levels[result.levelId] = stats; data.lastLevelId = result.levelId;
      data.resultIds = [...data.resultIds, result.roundId].slice(-128); return true;
    });
  }
}
