import * as THREE from 'three';
import { ALL_LEVELS, FIRST_LEVEL_ID } from '../../../shared/levels.js';
import { Road } from './Road.js';
import { Props } from './Props.js';
import { MergeLane } from './MergeLane.js';
import { RoadSignView } from './RoadSignView.js';

/** Bounded startup scene presets for every mode's levels. Switching only exposes already prepared resources. */
export class LevelScenes {
  constructor(scene) {
    this.presets = new Map(ALL_LEVELS.map((level) => {
      const root = new THREE.Group(); root.name = level.id; scene.add(root);
      const road = new Road(root, level.road), props = new Props(root, level.road);
      const roadSigns = new RoadSignView(root, level.roadSigns, level.road);
      const lanes = new Map((level.orders.sides || [-1]).map((side) => [side, new MergeLane(root, side)]));
      root.visible = false;
      return [level.id, { root, road, props, lanes, roadSigns }];
    }));
    this.select(FIRST_LEVEL_ID);
  }
  select(id) {
    if (!this.presets.has(id)) throw new Error(`Unknown prepared level: ${id}`);
    for (const [key, preset] of this.presets) preset.root.visible = key === id;
    this.id = id; this.current = this.presets.get(id);
  }
  update(scroll, game, laneX) {
    const { road, props, lanes, roadSigns } = this.current;
    roadSigns.update(game);
    road.update(scroll); props.update(scroll);
    const offset = laneX - (game.lane?.x || 0);
    for (const [side, view] of lanes) {
      const lane = game.lanes.find(lane => game.orderSide(lane.serial) === side);
      view.update(game.active ? lane : null, (lane?.x || 0) + offset);
    }
  }
  setPlaying(playing) { for (const preset of this.presets.values()) preset.props.setPlaying(playing); }
  refreshDensity() { for (const preset of this.presets.values()) preset.props.refreshDensity(); }
  refreshSigns() { for (const preset of this.presets.values()) preset.props.syncSigns(); }
  refreshGround() { for (const preset of this.presets.values()) preset.road.refreshGround(); }
  tintGround(color) { for (const preset of this.presets.values()) preset.road.groundMat.color.set(color); }
  registerReadiness(readiness) { for (const preset of this.presets.values()) preset.roadSigns.registerReadiness(readiness); }
  disposeRoadSigns() { for (const preset of this.presets.values()) preset.roadSigns.dispose(); }
}
