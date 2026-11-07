/** Versus hack effects (HACK_CONSOLE.md): what a finished hack does to the other team's docked truck. Open registry:
 * any shared module can `registerHackEffect` at import time; the host picks one by weight with its seeded dice.
 * Effects run on the host only and may change anything the snapshot already carries (stains, order mode, players'
 * velocity); they must not need a new synced field. No browser APIs. */
import * as THREE from 'three';
import { pushPlayer } from './Mass.js';

const effects = new Map();

/** `id` is a stable key (synced as `hack.effect`); `label` is the Chinese name shown to players (add its English to
 * client/js/i18n/en.js); `weight` is the relative pick chance (0 disables it); `apply(context)` changes the world.
 * context = { game, order, truck, team, hacker, random } — `order` is the victim truck's order, `team` the hacker's. */
export function registerHackEffect(id, { label, weight = 1, apply }) {
  if (typeof id !== 'string' || !id || effects.has(id)) throw new Error(`Invalid or duplicate hack effect: ${id}`);
  if (typeof label !== 'string' || !label || typeof apply !== 'function' || !(weight >= 0)) throw new Error(`Hack effect ${id} needs a label, a weight ≥ 0 and apply()`);
  effects.set(id, Object.freeze({ id, label, weight, apply }));
}
export function hackEffect(id) { return effects.get(id) || null; }
export function hackEffects() { return [...effects.values()]; }

/** One effect by weight; `random` is the host's seeded dice so every replay picks the same. */
export function pickHackEffect(random = Math.random) {
  const list = hackEffects().filter(effect => effect.weight > 0), total = list.reduce((sum, effect) => sum + effect.weight, 0);
  let roll = random() * total;
  for (const effect of list) if ((roll -= effect.weight) < 0) return effect;
  return list.at(-1) || null;
}

/** Built-in effect tuning (balance: HouJianNan, VERSUS_RULES.md §8). */
export const HACK_EFFECT_TUNING = Object.freeze({
  grimeSteps: 1,          // "更脏": every stain on the truck falls back this many whole steps (a washed one reopens).
  blastRadius: 3.6,       // "爆炸": players within this distance of the roof centre are thrown…
  blastLift: 8.5, blastPush: 12,
});

/** Push one stain back a whole step: a washed one reopens at its last step, progress inside a step is lost first. */
function grimeStain(game, order, stain) {
  if (stain.done) { game.stainReopened(order, stain); stain.stage = stain.steps.length - 1; stain.progress = 0; }
  else if (stain.progress > 0) stain.progress = 0;
  else if (stain.stage > 0) { stain.stage--; stain.progress = 0; }
  stain.mesh.visible = true; stain.mesh.material.opacity = 1;
}

registerHackEffect('grime', {
  label: '车变得更脏了', weight: 1,
  apply({ game, order }) {
    for (let step = 0; step < HACK_EFFECT_TUNING.grimeSteps; step++) for (const stain of order.stains) grimeStain(game, order, stain);
  },
});

registerHackEffect('runaway', {
  label: '车直接开溜了', weight: 1,
  // The truck drives off unfinished: stains already washed keep their points, the rest (and any charge bonus) are lost;
  // a plugged connector springs back as for any leaving truck (ChargingSystem.update).
  apply({ game, order }) {
    if (Number.isInteger(order.team)) game.teamCombos[order.team] = 0;
    game.leaveOrder(order);
  },
});

const _center = new THREE.Vector3(), _away = new THREE.Vector3();
registerHackEffect('blast', {
  label: '车上发生了爆炸', weight: 1,
  // A bang on the roof: everyone near is thrown up and outward, and every half-done step loses its progress.
  apply({ game, order, truck }) {
    const T = HACK_EFFECT_TUNING; truck.body.getWorldPosition(_center); _center.y = truck.topY;
    for (const player of game.players) {
      if (player.occupied === false || player.swallowedBy || !['ground', 'air'].includes(player.state)) continue;
      _away.set(player.pos.x - _center.x, 0, player.pos.z - _center.z);
      const distance = Math.hypot(_away.x, _away.z, (player.pos.y - _center.y) * 0.5);
      if (distance > T.blastRadius) continue;
      const k = 1 - distance / T.blastRadius;
      if (_away.lengthSq() < 1e-6) _away.set(0, 0, order.side || 1); else _away.normalize();
      player.blastUp(T.blastLift * (0.6 + 0.4 * k));
      pushPlayer(player, _away, T.blastPush * (0.5 + 0.5 * k));
    }
    for (const stain of order.stains) if (!stain.done && stain.progress > 0) { stain.progress = 0; stain.mesh.material.opacity = 1; }
  },
});
