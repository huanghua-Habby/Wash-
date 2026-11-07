import { localizedText, format } from '../i18n/Localization.js';
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
  hide() { this.root.hidden = true; }
  fail(error) {
    this.root.dataset.failed = '1';
    localizedText(document.getElementById('boot-label'), '加载未完成，请刷新重试');
    console.error('启动资源准备失败', error);
  }
}
