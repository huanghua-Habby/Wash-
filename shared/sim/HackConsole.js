/** Versus hack console (HACK_CONSOLE.md): one neutral terminal on the home truck's rear deck. An empty-handed player
 * holds J beside it to fill their team's hack bar; a full bar fires a random registered effect (HackEffects.js) on the
 * other team's docked truck, then the console reboots. One hacker at a time; slapping them away stops the typing.
 * Host-owned: viewers get the state from the snapshot. Co-op and the lobby hide it. No browser APIs. */
import * as THREE from 'three';
import { buildHackConsole, HACK_CONSOLE_SOLID } from './HackConsoleModel.js';
import { pickHackEffect } from './HackEffects.js';
import { dampAngle } from './util.js';

/** Balance (HouJianNan, VERSUS_RULES.md §8). `position` is truck-local (x, z) on the cab roof beside the charging cable
 * (the top of the screen; 2026-10-21 user), on the side away from the charger post; `scale` draws and collides the
 * terminal a little smaller than its model (2026-10-21 user). */
export const HACK = Object.freeze({
  position: [4.5, 0.8],
  scale: 0.85,
  range: 1.05,           // Flat distance from the console centre that still reaches the keyboard (any side).
  seconds: 4.8,          // Holding J this long fills a team's bar from empty (2026-10-21 user: 6 → 4.8, ~20% faster).
  decayPerSecond: 0.04,  // A bar nobody of that team is typing on drains this much per second (25 s from full).
  cooldownSeconds: 10,   // Reboot after a successful hack; nobody can hack meanwhile (2026-10-21 user: 25 → 10).
});

const _at = new THREE.Vector3();
/** The home-menu practice target (the partner truck), distinct from any order. */
const PRACTICE_TARGET = Object.freeze({ practice: true });
const emptyLast = () => ({ effect: '', team: -1, hacker: -1, target: -1, at: [0, 0, 0] });

export class HackConsole {
  constructor(game) {
    this.game = game;
    const home = game.homeTruck, [x, z] = HACK.position;
    this.group = buildHackConsole(); this.group.visible = false;
    // Keyboard and main screen face the tail (-x): the gameplay camera looks over the hacker's shoulder at the screen.
    this.group.position.set(x, home.localTopForLocal(x, z), z); this.group.rotation.y = Math.PI; this.group.scale.setScalar(HACK.scale);
    home.body.add(this.group);
    const console_ = this;
    const solid = { hx: HACK_CONSOLE_SOLID.hx * HACK.scale, hz: HACK_CONSOLE_SOLID.hz * HACK.scale, height: HACK_CONSOLE_SOLID.height * HACK.scale };
    // Not a squirrel wall: a squirrel jumping up to it lands on the roof beside it instead of clinging out of reach.
    home.solids.push({ x, z, ...solid, cling: false, get active() { return console_.group.visible; } });
    this.reset();
  }
  /** progress[team] 0..1; `slot` the player typing (-1 none); `serial` counts finished hacks; `last` describes the latest. */
  reset() {
    this.progress = [0, 0]; this.slot = -1; this.cooldown = 0; this.serial = 0; this.last = emptyLast();
    this.typing = this.game.players.map(() => false);
  }
  get enabled() { return this.game.mode === 'versus' && !!this.game.equipmentVisible; }
  present() { this.group.visible = this.enabled; }
  /** A running match can be hacked (not Ready, the finish or a pause), and the home-menu practice of a versus room
   * (the partner truck is the target there). */
  live() {
    const g = this.game;
    if (!this.enabled || g.paused || g.ended) return false;
    return g.practice ? !!g.practiceHack : g.active && g.roundStage === 'playing';
  }
  worldPosition(target = _at) { this.group.updateWorldMatrix(true, false); return this.group.getWorldPosition(target); }
  inRange(player) {
    if (!this.group.visible || player.ground?.truck !== this.game.homeTruck) return false;
    const at = this.worldPosition();
    return Math.hypot(player.pos.x - at.x, player.pos.z - at.z) < HACK.range && Math.abs(player.pos.y - at.y) < 0.6;
  }
  /** The other team's docked, still-working truck for `team`, or null. */
  target(team) {
    if (this.game.practice) return this.game.practiceHack?.available() ? PRACTICE_TARGET : null;
    return this.game.orders.find(order => Number.isInteger(order.team) && order.team !== team && order.mode === 'working' && order.arrivalProgress === 1) || null;
  }

  /** One player's J beside the console (from WashSimulation.interact, empty hands). True when the console owns J this
   * tick (so J never slaps here; K still does). Writes the hint and the "hack" pose. */
  interact(player, input, dt) {
    if (this.game.viewOnly || !this.live() || !Number.isInteger(player.team) || !this.inRange(player)) return false;
    const slot = this.game.players.indexOf(player), team = player.team;
    if (this.cooldown > 0) { player.interactionHint = `黑客台重启中 ${Math.ceil(this.cooldown)}s`; return true; }
    if (this.slot >= 0 && this.slot !== slot) { player.interactionHint = '黑客台被占用：拍走对方！'; return true; }
    if (!this.target(team)) { player.interactionHint = '对面暂无车辆可骇入'; return true; }
    if (!input.down('KeyJ') || player.skipUse) { player.interactionHint = 'J 骇入'; return true; }
    this.slot = slot; this.typing[slot] = true; player.useAction = 'hack';
    const at = this.worldPosition();
    player.yaw = dampAngle(player.yaw, Math.atan2(-(at.z - player.pos.z), at.x - player.pos.x), 14, dt);
    this.progress[team] = Math.min(1, this.progress[team] + dt / HACK.seconds);
    player.interactionHint = `骇入中 ${Math.floor(this.progress[team] * 100)}%`;
    if (this.progress[team] >= 1 - 1e-9) this.complete(player, team);
    return true;
  }

  /** A full bar: one weighted effect on the enemy truck, then the reboot. The hacker must press J afresh afterwards. */
  complete(player, team) {
    const g = this.game, order = this.target(team);
    this.progress[team] = 0; this.slot = -1; player.skipUse = true;
    if (order === PRACTICE_TARGET) {
      // Home menu: the partner truck speeds off and a new one drives in; no score, same reboot.
      g.practiceHack.fire(); g.practiceHack.truck.body.getWorldPosition(_at);
      this.serial++; this.cooldown = HACK.cooldownSeconds;
      this.last = { effect: 'practice-away', team, hacker: g.players.indexOf(player), target: -1, at: [_at.x, g.practiceHack.truck.topY, _at.z] };
      return;
    }
    const effect = order && pickHackEffect(g.random);
    if (!order || !effect) return;
    effect.apply({ game: g, order, truck: order.truck, team, hacker: player, random: g.random });
    order.truck.body.getWorldPosition(_at);
    this.serial++; this.cooldown = HACK.cooldownSeconds;
    this.last = { effect: effect.id, team, hacker: g.players.indexOf(player), target: order.serial, at: [_at.x, order.truck.topY, _at.z] };
    g.tally.add(player, 'hacks');
  }

  /** Once per tick after every player's interaction: release a hacker who stopped typing, drain idle bars, reboot. */
  update(dt) {
    if (this.game.viewOnly) return;
    if (!this.live()) { this.slot = -1; this.typing.fill(false); return; }
    if (this.slot >= 0 && !this.typing[this.slot]) this.slot = -1;
    const typingTeam = this.slot >= 0 ? this.game.players[this.slot].team : -1;
    for (const team of [0, 1]) if (team !== typingTeam) this.progress[team] = Math.max(0, this.progress[team] - HACK.decayPerSecond * dt);
    this.cooldown = this.cooldown - dt < 1e-9 ? 0 : this.cooldown - dt;
    this.typing.fill(false);
  }

  capture() { return { progress: [...this.progress], slot: this.slot, cooldown: this.cooldown, serial: this.serial, last: { ...this.last, at: [...this.last.at] } }; }
  apply(data) {
    this.progress = Array.isArray(data?.progress) ? [...data.progress] : [0, 0];
    this.slot = Number.isInteger(data?.slot) ? data.slot : -1; this.cooldown = data?.cooldown || 0; this.serial = data?.serial || 0;
    this.last = data?.last ? { ...emptyLast(), ...data.last, at: [...(data.last.at || [0, 0, 0])] } : emptyLast();
    this.present();
  }
}
