/** Persist authority-issued round receipts in each participant's own browser profile. */
import { PROGRESS_KEY } from './ProgressStore.js';
import { SAVE_VERSION } from '../../../shared/levels.js';
export class SaveCoordinator {
  constructor(connection, store) {
    this.listeners = new AbortController(); this.disposed = false;
    this.connection = connection; this.store = store; this.pending = new Map(); this.saving = false;
    connection.addEventListener('round_started', (event) => { if (event.detail.saveVersion === SAVE_VERSION) void store.enter(event.detail.levelId); }, { signal: this.listeners.signal });
    connection.addEventListener('round_result', (event) => { this.pending.set(event.detail.roundId, event.detail); void this.flush(); }, { signal: this.listeners.signal });
    connection.addEventListener('status', () => { if (connection.connected) void this.flush(); }, { signal: this.listeners.signal });
    this.retry = setInterval(() => { if (this.pending.size) void this.flush(); }, 3000);
    addEventListener('storage', (event) => { if (event.key === PROGRESS_KEY || event.key === null) store.reload(); }, { signal: this.listeners.signal });
  }
  dispose() { this.disposed = true; this.listeners.abort(); clearInterval(this.retry); this.pending.clear(); }
  /** Keep failed receipts pending and let the server redeliver until durable storage acknowledges them. */
  async flush() {
    if (this.disposed || this.saving || !this.connection.connected) return;
    this.saving = true;
    try {
      for (const [roundId, result] of this.pending) {
        // Versus results are shown, never saved; acknowledge them so the host stops redelivering.
        if (result.mode !== 'versus' && !(await this.store.record(result))) break;
        if (this.disposed) break;
        if (this.connection.send('result_ack', { roundId })) this.pending.delete(roundId);
      }
    } finally { this.saving = false; }
  }
}
