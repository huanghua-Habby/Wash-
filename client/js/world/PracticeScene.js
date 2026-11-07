import { Vector3 } from 'three';
import { PAL } from '../../../shared/sim/palette.js';
import { TruckDirector } from '../../../shared/sim/TruckDirector.js';
import { CFG } from '../core/config.js';
import { PLAYER_COLORS } from '../core/playerColors.js';
import { MAX_PLAYER_SLOTS } from '../../../shared/levels.js';
import { Truck } from './Truck.js';
import { Player } from '../game/Player.js';
import { identityRings } from '../render/IdentityRings.js';

/** Startup-built practice vehicles and roster, reused by all client scene presentations. */
export class PracticeScene {
  constructor({ scene, level }) {
    this.scene = scene;
    this.trucks = level.home.vehicles.map(({ palette, ...options }) => new Truck(PAL[palette], options));
    const [homeTruck, blueTruck] = this.trucks;
    scene.add(homeTruck.group, blueTruck.group);
    this.director = new TruckDirector(homeTruck, blueTruck, { speedMultiplier: () => CFG.world.speedMul, motion: level.home.motion });
    this.director.update(0);
    // Every mode's characters are built and prepared at startup; the longest home slot list places them.
    const slots = MAX_PLAYER_SLOTS.map(([x, z]) => new Vector3(x, 0, z));
    this.players = PLAYER_COLORS.map((color, slot) => {
      const player = new Player(scene, { color, slot });
      player.homeLocal = slots[slot]; player.spawn(homeTruck);
      player.occupied = false; player.root.visible = false;
      return player;
    });
    this.rings = identityRings(scene);
    this.roster = this.players.map((player, index) => ({ player, truck: homeTruck, localPosition: slots[index] }));
  }
  registerReadiness(resources) {
    resources.addAsset('角色毛色与标识', Promise.all(this.players.map(player => player.appearanceReady)));
  }
  dispose() { this.rings.dispose(); }
  updatePlayers(dt) { for (const player of this.players) player.updateVisual(dt); }
  visibleTrucks() { return this.trucks.filter(truck => truck.group.visible); }
}
