import { localizedText, format } from '../i18n/Localization.js';
const RETRY_KEY = 'wash-boot-retry';
const MAX_RETRIES = 2;
const RETRY_WINDOW_MS = 5 * 60 * 1000;
/** Exists in the initial HTML so no unprepared scene flashes before JavaScript boots. */
export class LoadingScreen {
  constructor() { this.root = document.getElementById('boot-loading'); this.progress = 0; }
  step(label, progress) {
    // Assets still settling after a failure must not overwrite the failure message.
    if (this.root.dataset.failed) return;
    this.progress = Math.max(this.progress, Math.min(1, progress));
    const percent = Math.round(this.progress * 100);
    localizedText(document.getElementById('boot-label'), label);
    localizedText(document.getElementById('boot-percent'), format("{0}%", percent));
    document.getElementById('boot-fill').style.width = `${percent}%`;
    this.root.querySelector('[role="progressbar"]').setAttribute('aria-valuenow', percent);
  }
  hide() {
    this.root.hidden = true;
    try { sessionStorage.removeItem(RETRY_KEY); } catch { /* Storage is optional. */ }
  }
  fail(error) {
    if (this.root.dataset.failed) return;
    this.root.dataset.failed = '1';
    localizedText(document.getElementById('boot-label'), '加载未完成，请刷新重试');
    console.error('启动资源准备失败', error);
    // A transient asset or worker request can fail while Chrome changes transport.
    // Retry only before the first scene appears, with a strict per-tab limit.
    if (document.body.classList.contains('scene-ready')) return;
    try {
      const [started, previous] = (sessionStorage.getItem(RETRY_KEY) || '').split(':').map(Number);
      const count = Date.now() - started < RETRY_WINDOW_MS ? previous || 0 : 0;
      if (count >= MAX_RETRIES) return;
      sessionStorage.setItem(RETRY_KEY, `${count ? started : Date.now()}:${count + 1}`);
      setTimeout(() => location.reload(), 1200 * (count + 1));
    } catch { /* Keep the existing failure screen if storage is unavailable. */ }
  }
}
