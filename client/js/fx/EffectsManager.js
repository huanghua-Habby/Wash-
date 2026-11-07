import { WindLines } from './WindLines.js';
import { Puffs } from './Puffs.js';
import { DustBurst } from './DustBurst.js';
import { PelicanBurst } from './PelicanBurst.js';
import { WallClingFx } from './WallClingFx.js';
import { WaterEffects } from '../game/WaterEffects.js';
import { CleaningEffects } from '../game/CleaningEffects.js';
import { ChargingEffects } from '../game/ChargingEffects.js';
import { DepartureSmoke } from './DepartureSmoke.js';
import { RoadSignImpact } from './RoadSignImpact.js';
import { ChargerBlast } from './ChargerBlast.js';
import { ItemPoof } from './ItemPoof.js';
import { SoapSlip } from './SoapSlip.js';
import { SoapFoam } from './SoapFoam.js';
import { SlapHit } from './SlapHit.js';
import { SlapSwipe } from './SlapSwipe.js';
import { GlideWind } from './GlideWind.js';
import { DizzyStars } from './DizzyStars.js';
import { MorphPoof } from './MorphPoof.js';
import { DummyWobble } from './DummyWobble.js';
import { HackBurst } from './HackBurst.js';
import { isWorldFrozen } from '../../../shared/sim/roundFlow.js';

const factories = {
  wind: (scene) => new WindLines(scene),
  puffs: (scene) => new Puffs(scene),
  dust: (scene) => new DustBurst(scene),
  pelican: (scene) => new PelicanBurst(scene),
  wallCling: (scene) => new WallClingFx(scene),
  water: (_scene, game) => new WaterEffects(game),
  cleaning: (_scene, game) => new CleaningEffects(game),
  charging: (_scene, game) => new ChargingEffects(game),
  departure: (scene, game) => new DepartureSmoke(scene, game),
  roadSign: (scene, game) => new RoadSignImpact(scene, game),
  chargerBlast: (scene, game) => new ChargerBlast(scene, game),
  itemPoof: (scene, game) => new ItemPoof(scene, game),
  soapSlip: (scene, game) => new SoapSlip(scene, game),
  soapFoam: (_scene, game) => new SoapFoam(game.players),
  slapHit: (scene, game) => new SlapHit(scene, game),
  slapSwipe: (scene, game) => new SlapSwipe(scene, game),
  glideWind: (scene, game) => new GlideWind(scene, game),
  dizzyStars: (scene, game) => new DizzyStars(scene, game),
  morphPoof: (scene, game) => new MorphPoof(scene, game),
  dummyWobble: (_scene, game) => new DummyWobble(game),
  hackBurst: (scene, game, blast) => new HackBurst(scene, game, blast),
};

/** One client-only owner for effect resources, calls, clocks and scene resets.
 * Systems retain their bounded GPU pools; this class never simulates particles or gameplay.
 */
export class EffectsManager {
  constructor({ scene, game, getBase = () => 30, create = {} }) {
    create = { ...factories, ...create };
    this.game = game; this.getBase = getBase;
    this.entries = new Map(); this.disposed = false; this.readiness = null;
    this.register('wind', create.wind(scene, game), {
      update: (system, frame) => system.update(frame.dt, frame.time, frame.trucks, frame.camera, frame.base),
    });
    this.register('puffs', create.puffs(scene, game), {
      update: (system, frame) => system.update(frame.dt, frame.trucks, frame.base),
    });
    this.register('dust', create.dust(scene, game), {
      update: (system, frame) => system.update(frame.dt),
      play: (system, { position, strength, onRoad = false }) => system.burst(position, strength, onRoad ? -this.getBase() : 0),
    });
    this.register('pelican', create.pelican(scene, game), {
      update: (system, frame) => system.update(frame.dt),
      play: (system, { type, mouth, forward, carry, feather }) => system.burst(type, mouth, forward, carry, feather),
    });
    this.register('wallCling', create.wallCling(scene, game), {
      update: (system, frame) => system.update(frame.dt),
      play: (system, parameters) => system.play(parameters),
    });
    this.register('water', create.water(scene, game), {
      scope: 'gameplay', update: (system, frame) => system.update(frame.gameplayDt),
    });
    this.register('cleaning', create.cleaning(scene, game), {
      scope: 'gameplay', update: (system, frame) => system.update(frame.gameplayDt),
    });
    this.register('charging', create.charging(scene, game), {
      scope: 'gameplay', update: (system) => system.update(),
    });
    this.register('departure', create.departure(scene, game), {
      update: (system, frame) => system.update(frame.wallDt),
    });
    this.register('roadSign', create.roadSign(scene, game), {
      scope: 'gameplay', update: (system, frame) => system.update(frame.gameplayDt),
    });
    this.register('chargerBlast', create.chargerBlast(scene, game), {
      scope: 'gameplay', update: (system, frame) => system.update(frame.gameplayDt),
    });
    this.register('itemPoof', create.itemPoof(scene, game), {
      scope: 'gameplay', update: (system, frame) => system.update(frame.gameplayDt),
    });
    this.register('soapSlip', create.soapSlip(scene, game), {
      scope: 'gameplay', update: (system, frame) => system.update(frame.gameplayDt),
    });
    this.register('soapFoam', create.soapFoam(scene, game), {
      scope: 'gameplay', update: (system, frame) => system.update(frame.time),
    });
    this.register('slapHit', create.slapHit(scene, game), {
      scope: 'gameplay', update: (system, frame) => system.update(frame.gameplayDt),
    });
    this.register('slapSwipe', create.slapSwipe(scene, game), {
      scope: 'gameplay', update: (system, frame) => system.update(frame.gameplayDt),
    });
    this.register('glideWind', create.glideWind(scene, game), {
      scope: 'gameplay', update: (system, frame) => system.update(frame.gameplayDt),
    });
    this.register('dizzyStars', create.dizzyStars(scene, game), {
      scope: 'gameplay', update: (system, frame) => system.update(frame.gameplayDt),
    });
    // Lifecycle cosmetic like the departure smoke: it finishes on wall time even if the world pauses mid-poof.
    this.register('morphPoof', create.morphPoof(scene, game), {
      update: (system, frame) => system.update(frame.wallDt),
    });
    this.register('dummyWobble', create.dummyWobble(scene, game), {
      scope: 'gameplay', update: (system, frame) => system.update(frame.gameplayDt),
    });
    // A finished versus hack; its "blast" effect reuses the charger short-circuit explosion.
    this.register('hackBurst', create.hackBurst(scene, game, this.entries.get('chargerBlast').system), {
      scope: 'gameplay', update: (system, frame) => system.update(frame.gameplayDt),
    });
    this.bindings = game.players.map((player) => {
      const previous = player.onDust, previousPouch = player.onPouchFx, previousWall = player.onWallFx;
      const callback = (position, strength, onRoad) => this.play('dust', { position, strength, onRoad });
      const pouch = (parameters) => this.play('pelican', parameters);
      const wall = (parameters) => this.play('wallCling', parameters);
      player.onDust = callback; player.onPouchFx = pouch; player.onWallFx = wall;
      return { player, previous, callback, previousPouch, pouch, previousWall, wall };
    });
  }

  register(name, system, { update, play = null, scope = 'world' }) {
    if (this.disposed || this.readiness) throw new Error('Effects must be registered before scene preparation');
    if (this.entries.has(name)) throw new Error(`Duplicate effect: ${name}`);
    this.entries.set(name, { system, update, play, scope });
  }

  registerReadiness(readiness) {
    if (this.disposed) throw new Error('EffectsManager is disposed');
    if (this.readiness === readiness) return;
    if (this.readiness) throw new Error('Effects already belong to another SceneReadiness');
    this.readiness = readiness;
    // All meshes (including hidden pools) already belong to the scene scanned by SceneReadiness.
    for (const [name, { system }] of this.entries) {
      if (system.ready) readiness.addAsset(`特效资源：${name}`, system.ready);
    }
  }

  play(name, parameters) {
    if (this.disposed) return false;
    const entry = this.entries.get(name);
    if (!entry?.play) throw new Error(`Unknown callable effect: ${name}`);
    entry.play(entry.system, parameters);
    return true;
  }

  update({ dt, wallDt = dt, time, trucks, camera, base, scroll = 0 }) {
    if (this.disposed) return;
    const frame = { dt: this.game.roundStage === 'guide' ? 0 : dt, wallDt, time, trucks, camera, base, scroll,
      gameplayDt: isWorldFrozen(this.game) || this.game.ended ? 0 : dt };
    for (const entry of this.entries.values()) entry.update(entry.system, frame);
  }

  reset(scope = 'all') {
    if (this.disposed) return;
    for (const entry of this.entries.values()) {
      if (scope === 'all' || entry.scope === scope) entry.system.reset();
    }
  }

  dispose() {
    if (this.disposed) return;
    for (const { player, previous, callback, previousPouch, pouch, previousWall, wall } of this.bindings) {
      if (player.onDust === callback) player.onDust = previous;
      if (player.onPouchFx === pouch) player.onPouchFx = previousPouch;
      if (player.onWallFx === wall) player.onWallFx = previousWall;
    }
    this.reset();
    for (const { system } of this.entries.values()) system.dispose();
    this.entries.clear(); this.bindings = []; this.disposed = true;
  }
}
