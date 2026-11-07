import { Clock } from 'three';
import { CFG } from '../core/config.js';
import { isWorldFrozen } from '../../../shared/sim/roundFlow.js';

/** Ordered client frame pipeline. AppManager owns scheduling; shared/sim owns gameplay. */
export class GameRuntime {
  constructor({ ui, input, localInput, network, game, practice, session, suspension, environment,
    sceneCamera, render, debug, audio, transition, tasks, backgroundClock, clock = new Clock() }) {
    Object.assign(this, { ui, input, localInput, network, game, practice, session, suspension, environment,
      sceneCamera, render, debug, audio, transition, tasks, backgroundClock, clock });
    this.time = 0; this.scroll = 0; this.base = 30;
    sceneCamera.snap();
    ui.setSceneStage('home'); ui.syncInteraction(); environment.prepareWorld(game);
  }
  bind(app) { app.listen(window, 'resize', this.render.resize.bind(this.render)); }
  start() { this.clock.getDelta(); this.backgroundClock.start(); }
  shortcuts() {
    this.ui.handleShortcuts(this.input, this.network.phase, this.game.active, this.localInput);
    this.render.handleShortcuts(this.input);
    this.debug.handleShortcuts(this.input);
  }
  step(dt) {
    const { localInput, network, game, practice, session, suspension, environment, sceneCamera, ui, audio, input, transition, tasks } = this;
    localInput.beginFrame(); this.time += dt; this.shortcuts();
    if (network.latest) {
      if (network.phase === 'transition' && !network.homeHold) transition.updatePlayers(dt, this.time);
      network.step(dt, this.time); network.present(dt);
      this.time = network.renderTime; this.scroll = network.renderScroll;
    }
    const worldDt = game.roundStage === 'guide' ? 0 : dt;
    suspension.update(isWorldFrozen(game) || game.ended ? 0 : dt);
    practice.updatePlayers(worldDt);
    const base = session.presentationBase();
    const activeTrucks = game.active ? game.activeTrucks() : practice.visibleTrucks();
    environment.update({ time: this.time, scroll: this.scroll, base, activeTrucks, game, snapshot: network.latest });
    if (ui.menu.mode === 'home' && !ui.menu.blocksPlayer) tasks.update(dt);
    sceneCamera.update(worldDt, base);
    ui.updateWorld(this.render.camera, game, network.phase, dt);
    audio.update(this.render.camera); environment.follow(sceneCamera.rig.target);
    game.effects.update({ dt: worldDt, wallDt: dt, time: this.time, trucks: activeTrucks, camera: this.render.camera, base, scroll: this.scroll });
    input.endFrame(); localInput.endFrame(); this.base = base;
  }
  renderFirst() { this.step(0); this.render.drawFirst(this.time, this.sceneCamera.vehicleFocus()); }
  frame() {
    const started = this.render.beginFrame();
    const real = this.clock.getDelta(), dt = Math.min(real, 1 / 20);
    this.ui.update(dt); this.debug.update(dt);
    this.render.updateResolution(real, !globalThis.document?.hidden && !this.ui.hasModal && !this.ui.iris?.active && this.ui.page !== 'transition' && this.ui.page !== 'leaving');
    if (CFG.world.pause && !this.session.connection.connected) {
      this.shortcuts(); this.input.endFrame();
    } else this.step(dt);
    this.render.draw({ time: this.time, base: this.base, target: this.sceneCamera.rig.target, focus: this.sceneCamera.vehicleFocus(),
      dt: Math.min(real, 1 / 20), swallowed: !!this.session.localPlayer?.()?.swallowedBy, punch: this.sceneCamera.punch, status: this.sceneCamera.status });
    this.render.recordFrame(real, started);
  }
}
