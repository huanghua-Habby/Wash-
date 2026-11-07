import { validateEvent } from './LevelEvents.js';
import { validateStains, STAIN_KINDS } from './StainDefinitions.js';
import { vehicleSpec, VEHICLES } from './vehicles.js';
import { vehicleBehavior } from './VehicleBehaviors.js';
import { partyStainLayouts, PARTY_FACTORS } from './PartyBalance.js';
import { roadSignDefinitions, validateRoadSigns } from './RoadSigns.js';
import { GUIDE_DEFINITIONS } from '../guideDefinitions.js';
import { CARGO_KINDS } from './CargoObstacles.js';

const equipment = new Set(['towel', 'station', 'water', 'soap', 'charger']);
const conditions = new Set(['moved', 'clean', 'emptyHands', 'home', 'reclaimed', 'elapsed', 'skill', 'emote', 'dummy']);
const lendable = new Set(['elephant', 'pelican']);
const actions = new Set(['equipment', 'spawn', 'leave', 'finish', 'event', 'stopEvent', 'behavior']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 64;
const nonnegative = value => Number.isFinite(value) && value >= 0;
const pair = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);

/** Client adapters prepare one common asset manifest for every selectable level. Within one mode the home
 * slots match too; across modes (`sameSlots: false`) only slot counts differ, and clients prepare the largest. */
export function validateLevelSet(levels, { sameSlots = true } = {}) {
  if (!Array.isArray(levels) || !levels.length) throw new Error('A level set requires at least one preset');
  const ids = new Set(), first = levels[0];
  for (const level of levels) {
    if (!identifier(level.id) || ids.has(level.id)) throw new Error(`Invalid/duplicate level id: ${level.id}`);
    ids.add(level.id); validateLevelScript(level);
    for (const [path, before, after] of [['equipment', first.equipment, level.equipment],
      ['home.vehicles', first.home.vehicles, level.home.vehicles], ...(sameSlots ? [['home.playerSlots', first.home.playerSlots, level.home.playerSlots]] : []),
      ['orders.vehicles', first.orders.vehicles, level.orders.vehicles]]) {
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`[${level.id}] ${path}: new assets/layout require startup preparation support before authoring`);
    }
  }
}

/** Startup/CLI authoring checks. Error paths point to the actual editable field, before allocating a world. */
export function validateLevelScript(level) {
  if (!level.script) return; // Legacy mechanics fixtures use the same simulation without a script.
  const check = (valid, path, message) => { if (!valid) throw new Error(`[${level.id || 'level'}] ${path}: ${message}`); };
  const list = (value, path, maximum) => check(Array.isArray(value) && value.length <= maximum, path, `expected an array of at most ${maximum} entries`);
  const keys = (value, path) => {
    list(value, path, equipment.size);
    check(value.every(key => equipment.has(key)) && new Set(value).size === value.length, path, 'unknown or duplicate equipment');
  };
  const script = level.script;
  check(identifier(level.id), 'id', 'expected a stable identifier of 1–64 characters');
  check(level.guide === null || Object.hasOwn(GUIDE_DEFINITIONS, level.guide), 'guide', 'unknown guide id');
  check(record(script), 'script', 'expected an object');
  list(script.orders, 'script.orders', 64); list(script.steps, 'script.steps', 32); list(script.events ?? [], 'script.events', 32);
  keys(level.unlockedEquipment, 'unlockedEquipment');
  check(level.partyScaling === undefined || typeof level.partyScaling === 'boolean', 'partyScaling', 'expected a boolean');
  check(['unlimited', 'countdown'].includes(level.clock?.mode) && nonnegative(level.clock.duration) &&
    (level.clock.mode === 'countdown' ? level.clock.duration > 0 : level.clock.duration === 0), 'clock', 'expected unlimited/0 or a positive countdown');
  check(['score', 'tutorial'].includes(level.rating?.mode), 'rating.mode', 'expected score or tutorial');
  check(Array.isArray(level.rating.thresholds) && (level.rating.mode === 'tutorial' ? level.rating.thresholds.length === 0 :
    level.rating.thresholds.length === 3 && level.rating.thresholds.every((n, i, all) => Number.isSafeInteger(n) && n > 0 && (!i || n > all[i - 1]))),
  'rating.thresholds', 'expected three increasing positive integers, or [] for tutorial');
  list(level.orders?.vehicles, 'orders.vehicles', 16);
  const vehicles = new Set();
  for (const [index, vehicle] of level.orders.vehicles.entries()) {
    check(record(vehicle) && !vehicles.has(vehicle.type) && Object.hasOwn(VEHICLES, vehicle.type) &&
      Number.isInteger(vehicle.capacity ?? 1) && (vehicle.capacity ?? 1) >= 1 && (vehicle.capacity ?? 1) <= 2,
    `orders.vehicles[${index}]`, 'expected a unique known vehicle with startup capacity 1–2');
    vehicles.add(vehicle.type);
  }
  const ids = new Set(), eventIds = new Set(), stepIds = new Set();
  for (const [index, event] of (script.events ?? []).entries()) {
    const path = `script.events[${index}]`;
    check(record(event) && identifier(event.id) && !eventIds.has(event.id), path, 'expected a unique event id');
    eventIds.add(event.id);
    try { validateEvent(event); } catch (error) { check(false, path, error.message); }
  }
  check(!level.roadSigns?.length, 'roadSigns', 'scripted levels define signs only in script.events');
  // A versus `roadSignChaos` is generated per match; validate it at its longest (score-only) schedule.
  try { validateRoadSigns(roadSignDefinitions(level), level.roadSignChaos?.max ?? 32); } catch (error) { check(false, 'script.events', error.message); }
  let previousAt = -Infinity;
  for (const [index, order] of script.orders.entries()) {
    const path = `script.orders[${index}]`;
    check(record(order) && identifier(order.id) && !ids.has(order.id), path, 'expected a unique order id'); ids.add(order.id);
    check(vehicles.has(order.type) && [-1, 1].includes(order.side), path, 'unknown vehicle or invalid side');
    check(!!vehicleBehavior(order.behavior) && ['hold', 'leave'].includes(order.onComplete), path, 'unknown behavior or completion policy');
    check(['unlimited', 'steps'].includes(order.patience?.mode) && (order.patience.mode !== 'steps' ||
      Number.isFinite(order.patience.multiplier) && order.patience.multiplier > 0), `${path}.patience`, 'expected unlimited or steps with a positive multiplier');
    if (order.at !== undefined) {
      check(nonnegative(order.at) && order.at >= previousAt && (level.clock.mode !== 'countdown' || order.at < level.clock.duration),
        `${path}.at`, 'expected ascending seconds within the round; omit at for step-triggered orders');
      previousAt = order.at;
    }
    check(order.playerCountStains === undefined || typeof order.playerCountStains === 'boolean', `${path}.playerCountStains`, 'expected a boolean');
    try { validateStains(order.stains, vehicleSpec(order.type)); } catch (error) { check(false, `${path}.stains`, error.message); }
    list(order.cargo ?? [], `${path}.cargo`, 8);
    for (const [cargoIndex, cargo] of (order.cargo ?? []).entries()) {
      const cargoPath = `${path}.cargo[${cargoIndex}]`;
      check(record(cargo) && identifier(cargo.id) && CARGO_KINDS.has(cargo.kind), cargoPath, 'expected a known cargo id and kind');
      check(pair(cargo.position), `${cargoPath}.position`, 'expected [x,z]');
      check(pair(cargo.size) && cargo.size.every(value => value > 0 && value <= 4), `${cargoPath}.size`, 'expected positive [width,depth]');
      check(Number.isFinite(cargo.height) && cargo.height > 0 && cargo.height <= 4, `${cargoPath}.height`, 'expected a positive height');
      check(cargo.yaw === undefined || Number.isFinite(cargo.yaw), `${cargoPath}.yaw`, 'expected a finite rotation');
      const spec = vehicleSpec(order.type);
      const [x, z] = cargo.position, [width, depth] = cargo.size;
      check(spec.platforms.some(platform => x - width / 2 >= platform.x0 && x + width / 2 <= platform.x1 &&
        z - depth / 2 >= platform.z0 && z + depth / 2 <= platform.z1), cargoPath, 'cargo footprint must fit on a vehicle platform');
    }
  }
  const available = new Set(level.unlockedEquipment), spawned = new Set();
  for (const [index, step] of script.steps.entries()) {
    const path = `script.steps[${index}]`;
    check(record(step) && identifier(step.id) && !stepIds.has(step.id), path, 'expected a unique step id'); stepIds.add(step.id);
    check(typeof step.text === 'string' && step.text.length > 0 && (step.praise === undefined || typeof step.praise === 'string'), `${path}.text`, 'expected tutorial text');
    check(conditions.has(step.condition?.type), `${path}.condition`, 'unknown condition');
    check(nonnegative(step.hold ?? 0) && nonnegative(step.minimumSeconds ?? 0), path, 'hold/minimumSeconds must be finite and nonnegative');
    check(step.morph === undefined || lendable.has(step.morph), `${path}.morph`, 'expected an animal with an L ability');
    check(step.dummy === undefined || typeof step.dummy === 'boolean', `${path}.dummy`, 'expected a boolean');
    if (['clean', 'reclaimed'].includes(step.condition.type)) check(ids.has(step.condition.orderId), `${path}.condition.orderId`, 'unknown order');
    if (step.condition.type === 'elapsed') check(nonnegative(step.condition.seconds), `${path}.condition.seconds`, 'expected nonnegative seconds');
    if (step.condition.type === 'moved') check(step.condition.distance === undefined || Number.isFinite(step.condition.distance) && step.condition.distance > 0,
      `${path}.condition.distance`, 'expected a positive distance');
    for (const phase of ['enter', 'exit']) {
      list(step[phase] ?? [], `${path}.${phase}`, 32);
      for (const [actionIndex, action] of (step[phase] ?? []).entries()) {
        const target = `${path}.${phase}[${actionIndex}]`;
        check(record(action) && actions.has(action.type), target, 'unknown action');
        if (['spawn', 'leave', 'behavior'].includes(action.type)) check(ids.has(action.orderId), `${target}.orderId`, 'unknown order');
        if (action.type === 'spawn') spawned.add(action.orderId);
        if (action.type === 'behavior') check(!!vehicleBehavior(action.behavior), `${target}.behavior`, 'unknown behavior');
        if (['event', 'stopEvent'].includes(action.type)) check(eventIds.has(action.eventId), `${target}.eventId`, 'unknown event');
        if (action.type === 'equipment') { keys(action.keys, `${target}.keys`); action.keys.forEach(key => available.add(key)); }
      }
    }
  }
  const provisioned = { towel: level.equipment?.towels?.positions?.length, station: level.equipment?.washStation,
    water: level.equipment?.waterguns?.length, soap: level.equipment?.soap?.enabled && level.equipment.soap.positions?.length,
    charger: level.equipment?.chargers?.length };
  for (const key of available) check(!!provisioned[key], `equipment.${key}`, 'unlocked tool has no prepared equipment');
  for (const [index, order] of script.orders.entries()) {
    check(order.at !== undefined || spawned.has(order.id), `script.orders[${index}].at`, 'untimed order requires a spawn action');
    for (const stain of order.stains) for (const key of STAIN_KINDS[stain.kind])
      check(available.has(key), `script.orders[${index}].stains`, `requires locked equipment: ${key}`);
  }
  for (const [index, factors] of PARTY_FACTORS.entries()) {
    try { for (const [id, stains] of partyStainLayouts(level, factors)) validateStains(stains, vehicleSpec(script.orders.find(order => order.id === id).type)); }
    catch (error) { check(false, `partyScaling[${index + 1}]`, error.message); }
  }
}
