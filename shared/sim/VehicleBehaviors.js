import { WASH_CONFIG as C } from './washConfig.js';
import { damp } from './util.js';

/** Behaviors own motion intentions. Orders own work/payment; scripts choose behaviors. */
export const VEHICLE_BEHAVIORS = Object.freeze({
  cruise: Object.freeze({ approachRate: 1, amplitude: 2.2, frequency: .55, exitAcceleration: 10, exitMaximum: 24 }),
  wideCruise: Object.freeze({ approachRate: 1.1, amplitude: 4.2, frequency: .65, exitAcceleration: 10, exitMaximum: 24 }),
});
const rules = new Map();
/** New AI lives in its own shared module, registers once at startup and keeps bounded serializable
 * state in order.behaviorState. Movement/collision policy belongs to that rule, never the script. */
export function registerVehicleBehavior(id, rule) {
  if (typeof id !== 'string' || !id || rules.has(id) || !rule || typeof rule.update !== 'function' || !Number.isFinite(rule.approachRate) || rule.approachRate <= 0)
    throw new Error(`Invalid vehicle behavior: ${id}`);
  rules.set(id, Object.freeze({ ...rule }));
}
export function vehicleBehavior(id) { return rules.get(id); }
export function advanceVehicle(game, order, dt) {
  const rule = vehicleBehavior(order.behaviorId);
  if (!rule) throw new Error(`Unknown vehicle behavior: ${order.behaviorId}`);
  rule.update(game, order, dt);
}
/** A washed truck pulls away gently first, so players still on its roof can jump back to the home truck, then speeds off.
 * Option A lives in PlayerMotion: a jump (or step) off a departing truck carries at most `carrySpeed` of its speed. */
export const DEPARTURE = Object.freeze({
  slowSeconds: 2,    // Gentle phase after the last stain is washed: about 2 s to jump back from anywhere on the roof.
  slowSpeed: 0.8,    // Top speed (m/s) during the gentle phase: the truck creeps ~1.6 m, staying beside the home truck.
  carrySpeed: 0.3,   // Truck speed a player keeps when leaving a departing truck's roof (so a jump never flings forward).
});
function advanceService(game, order, dt) {
  const truck = order.truck, config = VEHICLE_BEHAVIORS[order.behaviorId];
  order.age += dt;
  if (order.mode === 'leaving') {
    order.leaveAge = (order.leaveAge || 0) + dt;
    const ceiling = order.leaveAge < DEPARTURE.slowSeconds ? DEPARTURE.slowSpeed : config.exitMaximum;
    order.leaveSpeed = Math.min(ceiling, order.leaveSpeed + dt * config.exitAcceleration);
    truck.setState(truck.pos.x + order.leaveSpeed * dt, truck.pos.z, order.leaveSpeed, 0, game.base);
    game.fly(truck, damp(truck.pos.y, truck.spec.hover, 1.2, dt), dt);
    if (truck.pos.x - game.homeX > 22) for (const player of game.players) if (player.ground?.truck === truck) player.fallOut();
    return;
  }
  const u = game.laneProgress(order.serial);
  order.arrivalProgress = 1 - u;
  if (u === 0) order.dockAge += dt;
  if (u === 0 && Number.isFinite(order.remaining) && !order.paid) order.remaining = Math.max(0, order.remaining - dt);
  const urgency = Number.isFinite(order.remaining) && !order.paid ? Math.max(0, 8 - order.remaining) : 0;
  const shape = game.laneShape(u, order.serial);
  const x = game.orderX() + Math.sin(order.dockAge * config.frequency) * config.amplitude + urgency ** 2 * .2;
  const z = game.orderLaneZ(truck.spec, order.serial) + shape.z - Math.sin(order.dockAge * .9) * .3;
  truck.setState(x, z, (x - truck.pos.x) / dt, (z - truck.pos.z) / dt, game.base);
  if (u > 0) truck.group.rotation.y = -Math.atan2(truck.vel.z, game.base);
  game.fly(truck, u > 0 ? shape.y + truck.spec.hover : damp(truck.pos.y, game.alignedAltitude(truck, order.age), C.altitudeRate, dt), dt);
  if (!order.paid && order.remaining === 0) {
    // A missed versus order counts against its own team only.
    if (order.team === null || order.team === undefined) { game.missed++; game.combo = 0; }
    else { game.teamMissed[order.team]++; game.teamCombos[order.team] = 0; }
    leaveVehicle(order);
  }
}
export function leaveVehicle(order) {
  if (!order || order.mode === 'leaving') return;
  order.mode = 'leaving'; order.leaveAge = 0;
  // Start no faster than the gentle phase allows, even if it was mid-sway forward.
  order.leaveSpeed = Math.min(DEPARTURE.slowSpeed, Math.max(2, order.truck.vel.x));
  order.truck.departing = true;
}
for (const [id, config] of Object.entries(VEHICLE_BEHAVIORS)) registerVehicleBehavior(id, { ...config, update: advanceService });
