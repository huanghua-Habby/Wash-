/** Optional WebGL2 GPU timing. Never reads a result until the driver marks it available. */
export class GpuTimer {
  constructor(renderer, capacity = 4, sampleInterval = 250) {
    this.gl = renderer.getContext();
    this.ext = renderer.capabilities.isWebGL2 ? this.gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
    this.capacity = capacity; this.sampleInterval = sampleInterval; this.nextSample = 0; this.pending = []; this.active = null; this.lastMs = null;
    this.sampleId = 0;
  }
  poll() {
    if (!this.ext || !this.pending.length || this.gl.isContextLost()) return;
    const gl = this.gl;
    if (gl.getParameter(this.ext.GPU_DISJOINT_EXT)) { this.clear(); this.lastMs = null; return; }
    while (this.pending.length && gl.getQueryParameter(this.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const query = this.pending.shift();
      const ms = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
      this.lastMs = this.lastMs === null ? ms : this.lastMs * 0.85 + ms * 0.15;
      this.sampleId++;
      gl.deleteQuery(query);
    }
  }
  begin(now = performance.now()) {
    this.poll();
    if (!this.ext || now < this.nextSample || this.gl.isContextLost() || this.active || this.pending.length >= this.capacity) return;
    this.nextSample = now + this.sampleInterval;
    this.active = this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.active);
  }
  end() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active); this.active = null;
  }
  clear() {
    if (this.active) { this.gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.gl.deleteQuery(this.active); this.active = null; }
    this.pending.forEach(query => this.gl.deleteQuery(query)); this.pending.length = 0;
  }
}
