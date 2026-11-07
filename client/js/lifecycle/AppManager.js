import { waitFor } from './waitFor.js';

/** Overall application lifecycle; main.js assembles dependencies and registers GameRuntime.
 * Startup waits for a snapshot applied to the view, not merely a received network message.
 */
export class AppManager {
  constructor({ ui, resources, nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve)),
    requestFrame = callback => requestAnimationFrame(callback), cancelFrame = id => cancelAnimationFrame(id) }) {
    Object.assign(this, { ui, resources, nextFrame, requestFrame, cancelFrame });
    this.state = 'assembling'; this.services = new Map(); this.listeners = new AbortController();
    this.snapshotReady = new Promise((resolve, reject) => { this.resolveSnapshot = resolve; this.rejectSnapshot = reject; });
    this.snapshotReady.catch(() => {});
    this.disposed = false; this.failure = null; this.frameId = null; this.startup = null;
  }
  async prepareBootstrap(prepareFonts) {
    this.ui.prepareLayout(); this.ui.progress('准备字体', .02);
    await this.resources.addAsset('字体', prepareFonts());
    this.assertAlive(); this.ui.progress('准备游戏资源', .15);
  }
  registerService(name, service) {
    if (this.state !== 'assembling') throw new Error('Register lifecycle services before startup');
    if (this.services.has(name)) throw new Error(`Duplicate lifecycle service: ${name}`);
    this.services.set(name, service);
  }
  listen(target, type, listener) { target.addEventListener(type, listener, { signal: this.listeners.signal }); }
  /** @param {{sceneManager: any, connection: any, doc?: any, target?: EventTarget}} options */
  bind({ sceneManager, connection, doc = document, target = window }) {
    if (this.sceneManager) throw new Error('Application lifecycle is already bound');
    Object.assign(this, { sceneManager, connection });
    sceneManager.onFailure = error => { if (!this.disposed) { this.failure = error; this.state = 'failed'; this.ui.fail(error); this.rejectSnapshot(error); } };
    const listen = (node, type, fn) => node.addEventListener(type, fn, { signal: this.listeners.signal });
    listen(connection, 'disconnect', () => { for (const service of this.services.values()) service.disconnect?.(); });
    listen(doc, 'visibilitychange', () => { for (const service of this.services.values()) service.visibility?.(doc.hidden); });
    listen(target, 'pagehide', event => {
      for (const service of this.services.values()) service.pagehide?.();
      if (!event.persisted) void this.dispose().catch(error => console.error('应用释放失败', error));
    });
  }
  assertAlive() { if (this.disposed) throw new Error('AppManager is disposed'); if (this.failure) throw this.failure; }
  snapshotApplied(data) {
    if (this.disposed) return;
    this.sceneManager.snapshotApplied(data);
    this.resolveSnapshot();
  }
  start({ connect, renderFirst, beforeRun = () => {}, frame }) {
    this.assertAlive();
    if (this.startup) return this.startup;
    this.sceneManager.seal();
    this.state = 'loading';
    this.startup = this.run({ connect, renderFirst, beforeRun, frame }).catch(error => {
      if (!this.disposed) { this.state = 'failed'; this.ui.fail(error); }
      throw error;
    });
    this.startup.catch(() => {});
    return this.startup;
  }
  async run({ connect, renderFirst, beforeRun, frame }) {
    await waitFor(this.resources.prepare((label, value) => this.ui.progress(label, .2 + .65 * value)), this.listeners.signal);
    this.assertAlive(); this.state = 'connecting'; this.ui.progress('连接房间', .9);
    connect();
    await waitFor(this.snapshotReady, this.listeners.signal);
    this.assertAlive(); this.state = 'first-frame';
    await renderFirst(); this.assertAlive();
    await this.nextFrame(); await this.nextFrame(); this.assertAlive();
    this.ui.progress('准备完成', 1);
    beforeRun(); this.state = 'running'; this.sceneManager.activate(); this.ui.reveal();
    this.tick = () => {
      if (this.disposed || this.failure) return;
      try { frame(); }
      catch (error) { this.failure = error; this.state = 'failed'; this.ui.fail(error); console.error('应用帧更新失败', error); return; }
      if (!this.disposed) this.frameId = this.requestFrame(this.tick);
    };
    this.frameId = this.requestFrame(this.tick);
  }
  failStartup(error) {
    if (this.disposed || this.ui.disposed) return;
    this.failure = error; this.state = 'failed'; this.ui.fail(error);
  }
  dispose() {
    if (this.disposal) return this.disposal;
    this.disposed = true; this.state = 'disposed';
    this.ui.ready = false; this.ui.syncInteraction?.();
    this.listeners.abort(new Error('Application stopped'));
    if (this.frameId !== null) this.cancelFrame(this.frameId);
    this.sceneManager?.dispose();
    this.disposal = this.resources.dispose();
    return this.disposal;
  }
}
