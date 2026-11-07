import { CFG } from '../core/config.js';
import { viewportSize } from '../core/viewport.js';

// 分辨率管理：
//  - 渲染像素比 = min(设备像素比, 最高像素比) × 分辨率倍率
//  - 开启自动分辨率时，帧率低于“最低帧数”就逐步降低倍率（不低于最低倍率），
//    帧率充裕时再慢慢升回手动设定的倍率
export class Resolution {
  constructor(renderer, post) {
    this.renderer = renderer;
    this.post = post;
    this.scale = CFG.render.scale;   // 当前实际倍率
    this.info = { scale: '', size: '', fps: 0 };
    this.frames = 0;
    this.time = 0;
    this.cooldown = 1;
    this.goodTime = 0;
    this.apply();
  }

  // 0 表示不设上限，直接使用屏幕原生像素比
  static baseRatio() {
    const cap = CFG.render.maxPixelRatio || Infinity;
    return Math.min(devicePixelRatio || 1, cap);
  }

  get baseRatio() {
    return Resolution.baseRatio();
  }

  apply() {
    const r = this.renderer;
    const { width, height } = viewportSize();
    const ratio = Math.max(0.25, this.baseRatio * this.scale);
    if (Math.abs(r.getPixelRatio() - ratio) > 1e-3) r.setPixelRatio(ratio);
    r.setSize(width, height, false);
    this.post.setSize();
    this.info.scale = `${Math.round(this.scale * 100)}%`;
    this.info.size = `${Math.round(width * ratio)} × ${Math.round(height * ratio)}`;
  }

  // 手动修改设置后调用
  onSettingsChange() {
    const R = CFG.render;
    const lo = Math.min(R.minScale, R.scale);
    this.scale = R.autoRes ? Math.min(Math.max(this.scale, lo), R.scale) : R.scale;
    this.cooldown = 1;
    this.apply();
  }

  // 每帧传入未经缩放的真实帧间隔
  // 规则：
  //  - 每 0.5 秒统计一次；低于“最低帧数”就按 0.1 一档往下降
  //  - 稳定达标 6 秒后试探性升一档；升档后 4 秒内又掉帧，就退回并锁定这一档一段时间（30s→60s→120s）
  //  - 每次改分辨率都要重建渲染目标（会卡一下），所以尽量少改
  update(rawDt, { deferDrop = false } = {}) {
    if (rawDt > 0.25) return;           // 切后台等异常帧不计入
    this.frames++;
    this.time += rawDt;
    this.cooldown -= rawDt;
    this.lockTime = Math.max(0, (this.lockTime || 0) - rawDt);
    this.sinceUp = (this.sinceUp ?? 99) + rawDt;
    if (this.time < 0.5) return;

    const fps = this.frames / this.time;
    this.info.fps = Math.round(fps);
    this.frames = 0;
    this.time = 0;

    const R = CFG.render;
    if (!R.autoRes || this.cooldown > 0) return;
    const lo = Math.min(R.minScale, R.scale);
    const step = (v) => Math.round(v * 20) / 20;   // 量化到 5%

    if (fps < R.targetFps - 1.5 && this.scale > lo + 1e-3) {
      if (deferDrop) return; // Fur 12→8→4 settles first; resolution recovery remains independent.
      if (this.sinceUp < 4) {
        // 刚升档就掉帧：这一档撑不住，退回并锁定
        this.lockLevel = this.scale;
        this.backoff = Math.min(120, (this.backoff || 15) * 2);
        this.lockTime = this.backoff;
      }
      const drop = fps < R.targetFps * 0.8 ? 0.15 : 0.1;
      this.scale = Math.max(lo, step(this.scale - drop));
      this.goodTime = 0;
      this.cooldown = 1.5;
      this.apply();
    } else if (fps >= R.targetFps - 1.5 && this.scale < R.scale - 1e-3) {
      this.goodTime += 0.5;
      const next = Math.min(R.scale, step(this.scale + 0.1));
      const locked = this.lockTime > 0 && next >= this.lockLevel - 1e-3;
      if (this.goodTime >= 6 && !locked) {
        this.scale = next;
        this.goodTime = 0;
        this.sinceUp = 0;
        this.cooldown = 1.5;
        this.apply();
      }
    } else {
      this.goodTime = 0;
      if (this.sinceUp > 20) this.backoff = 15;   // 长时间稳定后重置退避
    }
  }
}
