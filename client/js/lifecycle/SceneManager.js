import { waitFor } from './waitFor.js';
import { getLevel } from '../../../shared/levels.js';

/** Client scene transactions. UIManager owns UI/input; network applies host snapshots;
 * ResourceManager supplies readiness. No gameplay rule or second simulation lives here.
 */
export class SceneManager {
  constructor({ ui, resources, connection, game, director, levelScenes, grass, transition, rig,
    nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve)) }) {
    Object.assign(this, { ui, resources, connection, game, director, levelScenes, grass, transition, rig, nextFrame });
    this.state = 'boot'; this.resetters = new Map(); this.operation = null; this.disposed = false;
    this.listeners = new AbortController(); this.scope = null;
  }
  bindNetwork(network) { if (this.network) throw new Error('Scene network is already bound'); this.network = network; }
  registerReset(name, reset) {
    this.assertAlive();
    if (this.sealed || this.resetters.has(name)) throw new Error(`Register each scene reset once before startup: ${name}`);
    this.resetters.set(name, reset);
  }
  seal() { this.sealed = true; }
  activate() { this.assertAlive(); this.state = 'running'; }
  assertAlive() { if (this.disposed) throw new Error('SceneManager is disposed'); }
  snapshotApplied(data) {
    this.assertAlive();
    const room = this.connection.room, scope = `${room.code}:${room.epoch}`;
    if (scope !== this.scope) { for (const reset of this.resetters.values()) reset(); this.scope = scope; }
    this.director.restoreState(data.director);
    this.ui.updateHostStatus?.(this.game);
    this.ui.updateRoundState?.(this.game);
    this.ui.roomSnapshotApplied?.(room, data);
    if (this.ui.page === 'home' && this.ui.ready && !this.ui.iris.active) this.homeVisible();
  }
  homeRequested() {
    if (this.disposed || !this.connection.guest?.homePending) return;
    if (this.ui.page === 'home' && !this.network.homeHold) { this.connection.guest.requestHome(); return; }
    this.network.holdHomePresentation();
    if (this.returning) { this.connection.guest.requestHome(); return; }
    this.ui.showHostReturn(() => { void this.returnHome({ remote:true }); });
  }
  homeVisible() {
    if (!this.disposed && this.ui.page === 'home' && this.ui.ready && !this.ui.iris.active) this.connection.guest?.homeVisible();
  }
  startEntry() { this.assertAlive(); if (this.transition.phase !== 'home') this.transition.reset(); this.transition.start(); }
  entryReady() { if (!this.disposed && this.network.latest?.phase === 'game') this.ui.menu.finishTransition(); }
  phaseChanged(phase) {
    if (this.disposed) return;
    if (phase === 'transition') this.ui.menu.startGame(true);
    if (phase === 'game') {
      if (!this.rig.gameplayPose) this.rig.beginGameplay();
      this.rig.gameplayProgress = 1; this.transition.setPhase('ready'); this.ui.menu.finishTransition(); this.ui.setSceneStage('ready');
    }
    if (phase === 'home' && this.ui.menu.mode !== 'home') this.ui.menu.returnHome(true);
  }
  async readyFrame() { await this.nextFrame(); await this.nextFrame(); this.assertAlive(); }
  async applyCovered(commit) {
    this.assertAlive();
    await waitFor(this.resources.prepare(), this.listeners.signal); this.assertAlive();
    await waitFor(commit(), this.listeners.signal); this.assertAlive();
    await this.readyFrame();
  }
  /** Nested level changes during a covered home commit reuse the same black mask. */
  covered(key, commit) {
    if (this.disposed) return Promise.reject(new Error('SceneManager is disposed'));
    if (!this.ui.ready || this.ui.iris.phase === 'wait') {
      const pending = this.applyCovered(commit).catch(error => { if (!this.disposed) this.onFailure?.(error); throw error; });
      pending.catch(() => {}); return pending;
    }
    if (this.operation) {
      if (this.operation.key === key) return this.operation.promise;
      const queued = this.operation.promise.then(() => this.covered(key, commit));
      queued.catch(() => {}); return queued;
    }
    let resolve, reject;
    const promise = new Promise((done, failed) => { resolve = done; reject = failed; }); promise.catch(() => {});
    const operation = { key, promise, reject }; this.operation = operation; this.state = 'covering';
    this.ui.iris.start(async () => {
      try {
        this.state = 'covered'; await this.applyCovered(commit); this.assertAlive(); this.state = 'revealing';
      } catch (error) { this.state = this.disposed ? 'disposed' : 'failed'; if (!this.disposed) this.onFailure?.(error); reject(error); throw error; }
    }, () => {
      if (this.disposed || this.operation !== operation) return;
      this.operation = null; this.state = 'running'; this.homeVisible(); this.ui.syncInteraction(); this.ui.focusGame(); resolve();
    });
    this.ui.syncInteraction();
    return promise;
  }
  changeLevel(id, commit) {
    return this.covered(`level:${id}`, () => {
      this.game.selectLevel(getLevel(id)); this.director.motion = this.game.level.home.motion;
      this.levelScenes.select(id); this.grass.setRoad(this.game.level.road); this.transition.reset({ restoreFleet: false });
      return commit();
    });
  }
  requestHome() {
    return new Promise((resolve, reject) => {
      const signal = this.listeners.signal;
      const clear = () => { this.connection.removeEventListener('room', send); signal.removeEventListener('abort', cancel); };
      const cancel = () => { clear(); reject(signal.reason); };
      const send = () => {
        if (!this.connection.connected || !this.connection.send('home')) return;
        clear(); resolve();
      };
      if (signal.aborted) { reject(signal.reason); return; }
      signal.addEventListener('abort', cancel, { once: true });
      this.connection.addEventListener('room', send); send();
    });
  }

  /** A guest's explicit return leaves membership; it never requests the host's whole-room home command. */
  leaveGame() {
    this.assertAlive();
    if (this.returning) return this.returning;
    if (!this.connection.requestLeave()) return Promise.resolve();
    return this.returnHome({remote:true});
  }

  returnHome({ remote = false } = {}) {
    if (this.ui.page === 'home') return Promise.resolve();
    if (this.returning) return this.returning;
    this.ui.setPage('leaving'); this.ui.requestPause(true); this.network.holdHomePresentation();
    if (remote) this.connection.guest?.requestHome();
    // Preparation can run during mask closure; only the covered callback mutates the world.
    const prepared = this.resources.prepare(); prepared.catch(() => {});
    this.returning = this.covered('home', async () => {
      await prepared; this.assertAlive();
      if (!remote) await this.requestHome();
      await this.network.commitHomePresentation(); this.assertAlive();
      this.transition.reset({ restoreFleet: false }); this.ui.setPage('home'); this.ui.menu.updateFraming();
    }).finally(() => { this.returning = null; });
    this.returning.catch(() => {});
    return this.returning;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.state = 'disposed'; this.listeners.abort(new Error('SceneManager is disposed'));
    const error = new Error('SceneManager is disposed');
    this.operation?.reject(error); this.resetters.clear();
  }
}
