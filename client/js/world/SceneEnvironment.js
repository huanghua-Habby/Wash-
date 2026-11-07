import { BackSide } from 'three';
import { WASH_CONFIG } from '../../../shared/sim/washConfig.js';
import { CFG } from '../core/config.js';
import { applyTimeOfDay } from '../render/TimeOfDay.js';
import { syncGlow } from '../render/GlowMaterials.js';
import { Lighting } from '../render/Lighting.js';
import { Grass } from './Grass.js';
import { LevelScenes } from './LevelScenes.js';
import { TeamTruckColors } from './TeamTruckColors.js';

/** Environment presentation follows the applied authority clock; it never advances gameplay. */
export class SceneEnvironment {
  constructor({ scene, level }) {
    this.scene = scene;
    this.lighting = new Lighting(scene); this.lighting.sync();
    this.levelScenes = new LevelScenes(scene); this.grass = new Grass(scene, this.lighting);
    this.grass.setRoad(level.road);
  }
  bindPractice(practice) { this.trucks = practice.trucks; this.teamColors = null; }
  refreshLighting() {
    this.lighting.sync(); this.grass.refresh(this.lighting); this.levelScenes.tintGround(CFG.grass.groundTint);
  }
  refreshScenery() { this.levelScenes.refreshDensity(); this.refreshOutline(); }
  refreshSigns() { this.levelScenes.refreshSigns(); }
  refreshGround() { this.levelScenes.refreshGround(); }
  refreshGrassDensity() { this.grass.syncDensity(); }
  refreshOutline() {
    this.scene.traverse(object => {
      if (object.isMesh && object.material?.isMeshBasicMaterial && object.material.side === BackSide) object.visible = CFG.light.outline;
    });
  }
  prepareWorld(game) { this.levelScenes.update(0, game, 0); this.grass.update(0, 0, 1, 0); }
  update({ time, scroll, base, activeTrucks, game, snapshot }) {
    game.roadSigns.present(game.elapsed + (snapshot && game.active && game.roundStage === 'playing' && !game.paused && !game.ended ? Math.max(0, Math.min(.25, time-snapshot.time)) : 0));
    // An active round thins scenery and grass (CFG.play); home keeps the full densities.
    this.levelScenes.setPlaying(game.active); this.grass.setPlaying(game.active);
    applyTimeOfDay(game.active ? (game.elapsed || 0) / WASH_CONFIG.roundSeconds : 0);
    this.lighting.sync(); this.grass.refresh(this.lighting); syncGlow();
    this.levelScenes.update(scroll, game, (game.lane?.x || 0) - (snapshot ? scroll - snapshot.scroll : 0));
    for (const truck of [...this.trucks, ...game.orderTrucks]) truck.syncHover();
    (this.teamColors ||= new TeamTruckColors(game.homeTruck, game.orderTrucks)).update(game);
    this.grass.update(time, scroll, base / 30, activeTrucks.reduce((sum, truck) => sum + truck.pos.x, 0) / activeTrucks.length);
  }
  follow(target) { this.lighting.follow(target); }
}
