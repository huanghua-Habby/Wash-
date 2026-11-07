import { SceneReadiness } from '../render/SceneReadiness.js';

/** Application resource registry. SceneReadiness remains the GPU preparation backend.
 * Providers own their resources; explicit disposers run once, in reverse registration order.
 */
export class ResourceManager {
  constructor({ readiness = null } = {}) {
    this.readiness = readiness; this.assets = new Map(); this.samples = new Set(); this.providers = new Map();
    this.state = 'registering'; this.ready = null; this.disposal = null;
  }
  assertRegistering() {
    if (this.state !== 'registering') throw new Error('Register resources before preparation starts');
  }
  configureRender(options) {
    this.assertRegistering();
    if (this.readiness) throw new Error('Render preparation is already configured');
    this.readiness = new SceneReadiness(options);
    for (const [name, entry] of this.assets) this.readiness.addAsset(name, entry.promise);
    for (const sample of this.samples) this.readiness.addSample(sample);
  }
  /** Optional failures are recorded and explicitly reported, after real completion. */
  /** @param {string} name
   * @param {Promise<any>} promise
   * @param {{optional?: boolean, onError?: (error: any) => void}} options */
  addAsset(name, promise, { optional = false, onError = () => {} } = {}) {
    this.assertRegistering();
    if (this.assets.has(name)) throw new Error(`Duplicate resource: ${name}`);
    const entry = { state: 'loading', optional, error: null, promise: null };
    entry.promise = Promise.resolve(promise).then(value => { entry.state = 'ready'; return value; }, error => {
      entry.error = error; entry.state = optional ? 'degraded' : 'failed';
      if (!optional) throw error;
      onError(error);
    });
    entry.promise.catch(() => {});
    this.assets.set(name, entry); this.readiness?.addAsset(name, entry.promise);
    return entry.promise;
  }
  addSample(object) {
    this.assertRegistering();
    if (this.samples.has(object)) return;
    this.samples.add(object); this.readiness?.addSample(object);
  }
  /** @param {string} name
   * @param {(resources: ResourceManager) => unknown} register
   * @param {{dispose?: (() => unknown) | null}} options */
  registerProvider(name, register, { dispose = null } = {}) {
    this.assertRegistering();
    if (this.providers.has(name)) throw new Error(`Duplicate resource provider: ${name}`);
    this.providers.set(name, { dispose }); register(this);
  }
  prepare(onProgress = (_label, _value) => {}) {
    if (this.state === 'disposing' || this.state === 'disposed') return Promise.reject(new Error('ResourceManager is disposed'));
    if (this.ready) return this.ready;
    if (!this.readiness) return Promise.reject(new Error('Render preparation is not configured'));
    this.state = 'preparing';
    this.ready = Promise.resolve().then(() => this.readiness.prepare(onProgress)).then(() => {
      if (this.state === 'preparing') this.state = 'ready';
    }, error => { if (this.state === 'preparing') this.state = 'failed'; throw error; });
    this.ready.catch(() => {});
    return this.ready;
  }
  /** Diagnostic state, evaluated on demand rather than during each render frame. */
  get status() {
    const assets = [...this.assets].map(([name, entry]) => ({ name, state: entry.state, optional: entry.optional, error: entry.error?.message || null }));
    return { state: this.state, assets, samples: this.samples.size, providers: [...this.providers.keys()] };
  }
  dispose() {
    if (this.disposal) return this.disposal;
    this.state = 'disposing';
    // Never destroy resources while SceneReadiness is borrowing them for real GPU frames.
    this.disposal = Promise.allSettled([this.ready, ...[...this.assets.values()].map(entry => entry.promise)]).then(async () => {
      const errors = [];
      for (const { dispose } of [...this.providers.values()].reverse()) {
        try { await dispose?.(); } catch (error) { errors.push(error); }
      }
      this.readiness = null;
      this.assets.clear(); this.samples.clear(); this.providers.clear(); this.state = 'disposed';
      if (errors.length) throw new AggregateError(errors, 'Resource release failed');
    });
    this.disposal.catch(() => {});
    return this.disposal;
  }
}
