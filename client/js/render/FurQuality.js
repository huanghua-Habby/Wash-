import { CFG } from '../core/config.js';
import { FUR_STATUS, FUR_TIERS, normalizeFurShells } from '../core/furSettings.js';

/** Real-load quality adaptation, driven by the existing frame loop; see docs/domains/wash/PERFORMANCE.md. */
export class FurQuality {
  constructor({ config = CFG.fur, renderConfig = CFG.render, status = FUR_STATUS } = {}) {
    Object.assign(this, { config, renderConfig, status });
    this.ceiling = normalizeFurShells(config.shells); this.auto = config.auto;
    status.shells = this.ceiling; status.reason = config.auto ? '默认画质' : '手动档位';
    this.time = 0; this.lockUntil = 0; this.lastUpgrade = -Infinity;
    this.resetSamples(3);
  }

  resetSamples(cooldown = 3) {
    this.cooldown = cooldown; this.seconds = 0; this.frames = 0;
    this.cpuSum = 0; this.cpuCount = 0; this.gpuSum = 0; this.gpuCount = 0;
    this.badFor = 0; this.goodFor = 0; this.lastGpuId = null;
  }

  get deferResolutionDrop() { return !!this.config.auto && (this.status.shells > 4 || this.cooldown > 0); }

  /**
   * @param {number} rawDt
   * @param {{cpuMs?: number|null, gpuMs?: number|null, gpuId?: number|null, eligible?: boolean, fullResolution?: boolean}} [sample]
   */
  update(rawDt, { cpuMs = null, gpuMs = null, gpuId = null, eligible = true, fullResolution = true } = {}) {
    const ceiling = normalizeFurShells(this.config.shells);
    if (ceiling !== this.ceiling || this.config.auto !== this.auto) {
      this.ceiling = ceiling; this.auto = this.config.auto;
      this.status.shells = ceiling; this.status.reason = this.auto ? '自动上限' : '手动档位';
      this.resetSamples(); this.lockUntil = 0; this.lastUpgrade = -Infinity;
    }
    if (!eligible || !Number.isFinite(rawDt) || rawDt <= 0 || rawDt >= 1) {
      this.resetSamples(); return;
    }
    if (!this.auto) return;
    this.time += rawDt;
    if (this.cooldown > 0) { this.cooldown = Math.max(0, this.cooldown - rawDt); return; }
    this.seconds += rawDt; this.frames++;
    if (Number.isFinite(cpuMs) && cpuMs >= 0) { this.cpuSum += cpuMs; this.cpuCount++; }
    // A timer result may persist for many frames: count each completed query only once.
    if (gpuId !== null && gpuId !== this.lastGpuId && Number.isFinite(gpuMs) && gpuMs >= 0) {
      this.lastGpuId = gpuId; this.gpuSum += gpuMs; this.gpuCount++;
    }
    if (this.seconds < 1) return;
    const elapsed = this.seconds, fps = this.frames / elapsed;
    const target = Math.max(20, Math.min(144, Number(this.renderConfig.targetFps) || 60));
    const budget = 1000 / target;
    const cpu = this.cpuCount ? this.cpuSum / this.cpuCount : null;
    const gpu = this.gpuCount ? this.gpuSum / this.gpuCount : null;
    const slow = fps < target * .92, gpuBusy = gpu !== null && gpu > budget * .82;
    const cpuBusy = cpu !== null && cpu > budget * .82;
    const busy = slow || gpuBusy || cpuBusy;
    this.badFor = busy ? this.badFor + elapsed : 0;
    // Recover resolution first. Missing GPU queries allow a slow probe, never pretend to measure GPU load.
    const spare = fps >= target * .98 && fullResolution && cpu !== null && cpu < budget * .5 && (gpu === null || gpu < budget * .55);
    this.goodFor = !busy && spare ? this.goodFor + elapsed : 0;
    this.seconds = 0; this.frames = 0; this.cpuSum = 0; this.cpuCount = 0; this.gpuSum = 0; this.gpuCount = 0;

    const index = FUR_TIERS.indexOf(this.status.shells);
    if (this.badFor >= 2 && index > 0) {
      if (this.time - this.lastUpgrade < 8) this.lockUntil = this.time + 60;
      this.status.shells = FUR_TIERS[index - 1];
      this.status.reason = slow ? '帧率持续偏低' : gpuBusy ? 'GPU 持续高负载' : 'CPU 持续高负载';
      this.resetSamples();
    } else if (this.goodFor >= 20 && this.time >= this.lockUntil && this.status.shells < ceiling) {
      this.status.shells = FUR_TIERS[index + 1]; this.status.reason = '余量稳定，试升一档';
      this.lastUpgrade = this.time; this.resetSamples();
    }
  }
}
