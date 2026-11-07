import { TICK_SECONDS } from '../../../shared/protocol.js';

/** Hidden host tabs must keep their one authority alive when requestAnimationFrame stops. */
export class BackgroundAuthorityClock {
  /** @param {{connection:any, onMode?: (hidden:boolean) => void, doc?:any, now?:() => number, createWorker?:() => any}} options */
  constructor({ connection, onMode = () => {}, doc = document, now = () => performance.now(),
    createWorker = () => new Worker(new URL('./authority-clock-worker.js', import.meta.url), { type: 'module' }) }) {
    Object.assign(this, { connection, onMode, doc, now });
    this.started = false; this.active = false; this.hidden = doc.visibilityState === 'hidden';
    this.generation = 0; this.accumulator = 0; this.last = 0;
    this.worker = createWorker();
    this.ready = new Promise((resolve, reject) => {
      this.readyTimer = setTimeout(() => reject(new Error('后台房主时钟准备超时，请刷新重试')), 8000);
      this.resolveReady = resolve; this.rejectReady = reject;
    });
    this.ready.catch(() => {});
    this.onMessage = event => {
      if (event.data.type === 'ready') { clearTimeout(this.readyTimer); this.resolveReady(); }
      else if (event.data.type === 'pulse' && event.data.generation === this.generation) this.pulse();
    };
    this.onError = () => { clearTimeout(this.readyTimer); this.rejectReady(new Error('无法准备后台房主时钟')); };
    this.onVisibility = () => this.sync(); this.onRoom = () => this.sync();
    this.worker.addEventListener('message', this.onMessage); this.worker.addEventListener('error', this.onError);
    doc.addEventListener('visibilitychange', this.onVisibility); connection.addEventListener('room', this.onRoom);
  }
  start() { this.started = true; this.sync(); if (this.hidden) this.onMode(true); }
  sync() {
    if (this.disposed) return;
    const hidden = this.doc.visibilityState === 'hidden';
    if (hidden !== this.hidden) { this.hidden = hidden; this.accumulator = 0; if (this.started) this.onMode(hidden); }
    const active = this.started && hidden && this.connection.isHost && this.connection.room?.mode === 'multiplayer';
    if (active === this.active) return;
    this.active = active; this.accumulator = 0; this.last = this.now();
    this.worker.postMessage({ enabled: active, generation: ++this.generation });
  }
  pulse() {
    if (this.disposed || !this.active || !this.hidden || !this.connection.isHost) return;
    const now = this.now();
    this.accumulator += Math.max(0, Math.min(1, (now - this.last) / 1000)); this.last = now;
    while (this.active && this.accumulator + 1e-9 >= TICK_SECONDS) {
      this.accumulator = Math.max(0, this.accumulator - TICK_SECONDS);
      this.connection.advanceLocal();
    }
  }
  dispose() {
    this.disposed = true; this.active = false; clearTimeout(this.readyTimer);
    this.doc.removeEventListener('visibilitychange', this.onVisibility); this.connection.removeEventListener('room', this.onRoom);
    this.worker.removeEventListener('message', this.onMessage); this.worker.removeEventListener('error', this.onError); this.worker.terminate();
  }
}
