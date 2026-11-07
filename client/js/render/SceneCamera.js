import { StatusGrade } from './StatusGrade.js';
import { Vector3 } from 'three';
import { clamp } from '../../../shared/sim/util.js';
import { CFG } from '../core/config.js';
import { isWorldFrozen } from '../../../shared/sim/roundFlow.js';
import { CHARACTER_SCALE } from '../../../shared/sim/characterScale.js';

/** Camera composition policy over the existing rig and entry transition. */
/** How far ahead/behind (m) the home partner truck may pull the home-menu frame. */
const HOME_PARTNER_REACH = 6;

export class SceneCamera {
  constructor({ camera, rig, game, practice, session, transition }) {
    this.status = new StatusGrade();
    Object.assign(this, { camera, rig, game, practice, session, transition });
    this.focus = new Vector3();
    this.vehicle = new Vector3();
    this.playerFocus = new Vector3();
    this.playerFeet = new Vector3(); this.playerHead = new Vector3();
    this.playerPoints = [this.playerFeet, this.playerHead];
    /** @type {Vector3[]} */ this.emptyPoints = [];
    this.localTargets = { focus: this.playerFocus, points: this.playerPoints, safetyPoints: this.playerPoints, minDistance: 0 };
    this.fixedFocus = new Vector3();
    this.fixedTargets = { focus: this.fixedFocus, points: this.emptyPoints, safetyPoints: this.emptyPoints, minDistance: 0 };
  }
  homeFocus() {
    const [a, b] = this.practice.trucks, player = this.session.localPlayer();
    // The player's vehicle is the main subject: the partner pulls the frame only within its usual cruising offset, so a
    // partner sent flying by a home-menu hack (TruckDirector.sendAway) does not drag the camera down the road.
    const bx = a.pos.x + Math.max(-HOME_PARTNER_REACH, Math.min(HOME_PARTNER_REACH, b.pos.x - a.pos.x));
    this.focus.set((a.pos.x + bx) / 2, 2.2, (a.pos.z + b.pos.z) / 2);
    if (player.state !== 'fallen') {
      this.focus.x += (player.pos.x - this.focus.x) * .35;
      this.focus.z += (player.pos.z - this.focus.z) * .25;
    }
    return this.focus;
  }
  /** Tilt-shift focus: the home vehicle's centre line stays sharp whoever the camera follows. */
  vehicleFocus() {
    const truck = this.game.homeTruck;
    return this.vehicle.set(truck.pos.x, (truck.pos.y + truck.topY) / 2, truck.pos.z);
  }
  snap() { this.rig.snap(this.homeFocus()); this.camera.updateMatrixWorld(true); }
  /** 固定镜头: frames the home vehicle at the gameplay pitch/distance/FOV and never follows any player. */
  fixedGameplayTargets() {
    const home = this.game.homeTruck;
    this.fixedFocus.set(home.pos.x, home.topY + .65, home.pos.z);
    this.fixedTargets.minDistance = this.rig.gameplayOffset.length();
    return this.fixedTargets;
  }
  gameplayTargets() {
    if (CFG.camera.style === 'fixed') return this.fixedGameplayTargets();
    this.localTargets.minDistance = this.rig.gameplayOffset.length();
    const player = this.session.localPlayer(), home = this.game.homeTruck;
    // The lowest standing level anywhere (multi-level roofs: the new washer's rear deck sits 2 m under its box roof).
    let lowestRoof = home.topY;
    for (const truck of this.game.activeTrucks()) for (const plat of truck.platforms) lowestRoof = Math.min(lowestRoof, truck.platTopY(plat));
    const falling = player.state === 'fallen' || (player.state === 'air' && player.vel.y < 0 && player.pos.y < lowestRoof - .3);
    if (falling) {
      this.playerFocus.set(home.pos.x + player.homeLocal.x, home.topYAt(home.pos.x + player.homeLocal.x, home.pos.z + player.homeLocal.z) + .65, home.pos.z + player.homeLocal.z);
      this.localTargets.points = this.localTargets.safetyPoints = this.emptyPoints;
    } else {
      // Keep a little of the occupied vehicle in view, without pulling the
      // player back toward home or fitting any other player/vehicle.
      const truck = player.ground?.truck;
      // The local avatar is glued to the interpolated, drawn platform after
      // prediction. Following its authority position instead makes the camera
      // move out of phase with the vehicle and every world-space HUD marker.
      const drawn = player.root.visible ? player.root.position : player.pos;
      this.playerFocus.copy(drawn); this.playerFocus.y += .65 * CHARACTER_SCALE;
      if (truck) {
        this.playerFocus.x += clamp(truck.pos.x - drawn.x, -3, 3) * .2;
        this.playerFocus.z += clamp(truck.pos.z - drawn.z, -3, 3) * .2;
      }
      this.playerFeet.copy(drawn); this.playerHead.copy(drawn).y += 1.3 * CHARACTER_SCALE;
      this.localTargets.points = this.localTargets.safetyPoints = this.playerPoints;
    }
    return this.localTargets;
  }
  /** Post-processing punch 0..1 for the knock-off feedback: a 70 ms rise, then a smooth fall over ~0.6 s; scaled by
   * the recoil shake setting so turning shakes off also calms the flash. RenderPipeline passes it to PostFX. */
  get punch() {
    const t = this.punchTime ?? Infinity;
    if (!(t < 0.7)) return 0;
    const rise = Math.min(1, t / 0.07), fall = t < 0.07 ? 1 : 1 - (t - 0.07) / 0.63;
    return rise * fall * fall * Math.min(1, CFG.camera.recoilShake ?? 1);
  }
  update(dt, base) {
    const speed01 = clamp((base - 26) / 8, 0, 1);
    // Only the local elephant's own jet shakes this page's camera.
    const local = this.session.localPlayer();
    const available = local?.occupied !== false && local?.sceneReady !== false && ['ground', 'air'].includes(local?.state);
    // Versus slap: only the page of the player who was hit jolts, once per host-confirmed hit.
    const slapped = local?.slappedSerial || 0;
    if (this.slapSeen !== undefined && slapped > this.slapSeen && available && this.game.active) this.rig.hitShake?.();
    this.slapSeen = slapped; // a lower count is a new world: it re-baselines without a jolt
    // The slapper's page gets a lighter kick when its own swing lands: its swing count and someone else's hit count rise
    // in the same presented frame (the host applies both in one tick and signs them urgently).
    const players = this.game.players || [], swings = local?.slapSerial || 0;
    const hits = players.map(p => p === local ? 0 : p.slappedSerial || 0);
    if (this.swingSeen !== undefined && swings > this.swingSeen && available && this.game.active &&
        hits.some((count, i) => count > (this.hitsSeen[i] ?? count))) this.rig.hitShake?.(0.35);
    this.swingSeen = swings; this.hitsSeen = hits;
    // Knock-off feedback: the attacker's page gets a soft thump and a post-processing punch, once per host-confirmed knock-off.
    const knockouts = local?.knockoutSerial || 0;
    if (this.knockoutSeen !== undefined && knockouts > this.knockoutSeen && this.game.active && !this.game.ended) { this.rig.knockoutShake?.(); this.punchTime = 0; }
    this.knockoutSeen = knockouts;
    this.punchTime = (this.punchTime ?? Infinity) + dt;
    // Own-state screen grade (respawn wait, shock, death flash): only in a running, unfrozen world.
    this.status.update(dt, local, this.game.active && !this.game.ended && !isWorldFrozen(this.game));
    if (!available || isWorldFrozen(this.game) || this.game.ended) this.rig.resetRecoil?.();
    this.rig.setRecoil?.(available && local?.animal === 'elephant' && local.trunk?.spraying && !isWorldFrozen(this.game) && !this.game.ended ? 1 : 0);
    if (this.game.active) {
      const targets = this.gameplayTargets();
      this.rig.followGameplay(targets.focus, targets.points, targets); this.rig.update(dt, targets.focus, speed01);
    } else {
      this.rig.update(dt, this.transition.cameraFocus(this.homeFocus()), speed01); this.transition.afterCamera();
    }
    // HUD/audio projection and rendering share the final camera of this frame.
    this.camera.updateMatrixWorld(true);
    this.game.afterCamera(this.camera);
  }
}
