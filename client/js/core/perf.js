// 帧时间统计：平均帧率、1% low、最长帧、CPU 耗时、draw call
// 结果挂在 window.__perf 上，调试面板与性能测试脚本都读这里
export class Perf {
  constructor(size = 600) {
    this.dts = new Float32Array(size);
    this.cpu = new Float32Array(size);
    this.size = size;
    this.i = 0;
    this.n = 0;
    this.sorted = new Float32Array(size);
    this.stats = { fps: 0, low1: 0, maxMs: 0, cpuMs: 0, calls: 0, tris: 0, longFrames: 0, gpuMs: '等待结果', passes: 0, textures: 0, geometries: 0, programs: 0 };
    this.acc = 0;
    window.__perf = this;
  }

  record(dt, cpuMs, info) {
    if (dt > 0.25) return;   // 切后台
    this.dts[this.i] = dt;
    this.cpu[this.i] = cpuMs;
    this.i = (this.i + 1) % this.size;
    this.n = Math.min(this.n + 1, this.size);
    this.stats.calls = info.render.calls;
    this.stats.tris = info.render.triangles;
    this.stats.textures = info.memory.textures; this.stats.geometries = info.memory.geometries;
    this.stats.programs = info.programs?.length || 0;
    this.acc += dt;
    if (this.acc >= 0.5) { this.acc = 0; this.compute(); }
  }

  compute() {
    const n = this.n;
    if (!n) return;
    const s = this.sorted.subarray(0, n);
    s.set(this.dts.subarray(0, n));
    s.sort();
    let sum = 0, cpu = 0, long = 0;
    for (let k = 0; k < n; k++) {
      sum += s[k];
      cpu += this.cpu[k];
      if (s[k] > 1 / 40) long++;
    }
    const worst = Math.max(1, Math.round(n * 0.01));
    let worstSum = 0;
    for (let k = n - worst; k < n; k++) worstSum += s[k];
    const st = this.stats;
    st.fps = Math.round(n / sum);
    st.low1 = Math.round(worst / worstSum);
    st.maxMs = +(s[n - 1] * 1000).toFixed(1);
    st.cpuMs = +(cpu / n).toFixed(2);
    st.longFrames = long;
  }

  reset() { this.i = 0; this.n = 0; }
}
