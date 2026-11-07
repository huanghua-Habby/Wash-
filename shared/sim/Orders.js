import * as THREE from 'three';
import { WASH_CONFIG as C } from './washConfig.js';
import { STAIN_KINDS, validateStains } from './StainDefinitions.js';
import { vehicleBehavior, advanceVehicle, leaveVehicle } from './VehicleBehaviors.js';
import { orderReward } from './ChargingRewards.js';
import { teamForSide } from './versusConfig.js';
import { versusChargeBonus } from './PvpScore.js';

/** Work lifecycle and bounded vehicle reservations. Scripts/behaviors never award their own money. */
export class Orders {
  constructor(game) { this.game = game; }
  definition(serial) {
    const g = this.game, request = g.levelScript.requests.find(r => r.serial === serial);
    if (request) {
      const definition = g.levelScript.definition(request.id);
      return { ...definition, stains: request.stains, behavior: request.behaviorId || definition.behavior };
    }
    return null;
  }
  side(serial) {
    const g = this.game;
    return g.orders.find(o => o.serial === serial)?.side || g.lanes.find(l => l.serial === serial)?.side || this.definition(serial)?.side || (g.level.orders.sides || [-1])[serial % (g.level.orders.sides || [-1]).length];
  }
  vehicle(serial, incoming) {
    const g = this.game;
    if (incoming?.vehicleSlot !== undefined) return g.orderTrucks[incoming.vehicleSlot];
    const reserved = g.lanes.find(l => l.serial === serial);
    if (reserved) return g.orderTrucks[reserved.vehicleSlot];
    const type = this.definition(serial)?.type || g.level.orders.waves?.[Math.floor(serial / 2)]?.vehicles[serial % 2];
    const candidates = type ? g.orderTrucks.filter(truck => truck.type === type) : [g.orderTrucks[serial % g.orderTrucks.length]];
    return candidates.find(truck => !g.orders.some(o => o.truck === truck) && !g.lanes.some(l => g.orderTrucks[l.vehicleSlot] === truck)) || null;
  }
  patience(stains, definition) {
    const g = this.game;
    if (definition?.patience?.mode === 'unlimited') return Infinity;
    const steps = stains.reduce((count, s) => count + s.steps.length, 0);
    if (definition?.patience) return 10 * steps * definition.patience.multiplier * g.partyBalance.patienceMultiplier;
    return g.level.orders.patienceSecondsPerStep ? steps * g.level.orders.patienceSecondsPerStep : C.unlimitedOrderWait ? Infinity : C.orderSeconds;
  }
  openLane(serial) {
    const g = this.game, truck = this.vehicle(serial);
    if (!truck || g.lanes.some(l => l.serial === serial)) return false;
    const behaviorId = this.definition(serial)?.behavior || 'cruise';
    g.lanes.push({ serial, side: this.side(serial), vehicleSlot: g.orderTrucks.indexOf(truck), behaviorId,
      x: g.orderX() + C.laneLength + C.laneLead, z: g.orderLaneZ(truck.spec, serial) });
    return true;
  }
  spawn(serial, incoming) {
    const g = this.game;
    const existing = g.orders.find(o => o.serial === serial); if (existing) return existing;
    const truck = this.vehicle(serial, incoming); if (!truck) return null;
    const definition = incoming?.definition || this.definition(serial), side = incoming?.side || this.side(serial);
    if (g.orders.some(o => o.truck === truck || o.side === side)) return null;
    const spec = truck.spec;
    const layout = definition?.stains || spec.stains.map((position, index) => ({ id: `stain-${index}`, kind: ['dust', 'mud', 'grease'][index], position }));
    validateStains(layout, spec);
    if (!g.lanes.some(l => l.serial === serial)) g.lanes.push({ serial, side, vehicleSlot: g.orderTrucks.indexOf(truck), behaviorId: definition?.behavior || 'cruise', x: g.orderX() + C.laneLength, z: g.orderLaneZ(spec, serial) });
    const lane = g.lanes.find(l => l.serial === serial), shape = g.laneShape(g.laneProgress(serial), serial);
    truck.setState(g.orderX(), lane.z + shape.z, 0, 0, g.base); truck.setAltitude(shape.y + spec.hover);
    truck.group.rotation.z = 0; truck.group.visible = true; truck.departing = false;
    truck.generation = incoming?.generation ?? (truck.generation || 0) + 1;
    g.charging.wet.clearTruck(truck);
    const stains = layout.map(({ id, kind, position: [x, z] }, index) => {
      const steps = STAIN_KINDS[kind], mesh = g.makeStainMesh(index, steps, truck);
      mesh.position.set(x, truck.localTopForLocal(x, z) + .045, z); truck.body.add(mesh);
      return { id, kind, position: [x, z], mesh, steps, stage: 0, progress: 0, done: false, points: 0 };
    });
    const remaining = this.patience(stains, definition);
    const order = { id: incoming?.id || definition?.id || `order-${serial}`, serial, type: truck.type, truck, stains,
      vehicleSlot: g.orderTrucks.indexOf(truck), generation: truck.generation, side,
      team: incoming?.team ?? (g.mode === 'versus' ? teamForSide(side) : null),
      definition: definition || { stains: layout, behavior: 'cruise', onComplete: 'leave' },
      behaviorId: definition?.behavior || 'cruise', behaviorState: {}, initialPatience: Number.isFinite(remaining) ? remaining : null,
      rewardMultiplier: 1, chargeRequired: false, chargeProgress: 0, charged: false, arrivalProgress: 0, framingEngaged: false,
      age: 0, dockAge: 0, mode: 'working', remaining, paid: false, leaveSpeed: 0, leaveAge: 0 };
    g.syncOrderCargo(order);
    g.orders.push(order); g.orderSerial = Math.max(g.orderSerial, serial + 1); g.refreshStainHud();
    return order;
  }
  update(dt) {
    const g = this.game;
    g.homeTruck.setState(g.homeX, g.homeZ, 0, 0, g.base); g.homeTruck.setAltitude(g.homeTruck.spec.hover);
    for (const lane of g.lanes) lane.x -= g.base * vehicleBehavior(lane.behaviorId || 'cruise').approachRate * dt;
    g.lanes = g.lanes.filter(l => l.x >= g.homeX - C.laneExpireBehind);
    if (g.level.script) g.levelScript.beforeFleet(dt);
    else {
      const waves = g.level.orders.waves, wave = waves?.[g.waveIndex];
      if (waves && wave && g.elapsed >= wave.at && !g.orders.length && !g.lanes.length) {
        g.openLane(g.waveIndex * 2); g.openLane(g.waveIndex * 2 + 1); g.orderSerial = g.waveIndex * 2 + 2; g.waveIndex++;
      } else if (!waves && !g.orders.length && !g.lanes.length) { g.spawnClock -= dt; if (g.spawnClock <= 0) g.openLane(); }
    }
    for (const lane of [...g.lanes]) if (!g.orders.some(o => o.serial === lane.serial) && lane.x - g.orderX() <= C.laneLength) g.spawnOrder(lane.serial);
    for (const order of g.orders) advanceVehicle(g, order, dt);
  }
  complete(order) {
    const g = this.game;
    if (g.viewOnly || !order || order.paid || order.mode !== 'working' || order.remaining === 0 || !order.stains.every(s => s.done)) return;
    order.paid = true;
    const team = order.team ?? null;
    if (team !== null) {
      // Versus (HouJianNan): every stain already scored for its team as it was finished; the washed truck leaves like a
      // campaign order and its points lock (smudging only reaches working trucks). A full charge bar pays its ×1.5 now.
      g.teamCompleted[team]++;
      const bonus = versusChargeBonus(g, order); if (bonus) g.hud.reward(bonus);
      leaveVehicle(order); return;
    }
    g.completed++; g.combo++;
    const points = orderReward(g, order, C.completionPoints + C.comboTip * Math.min(g.combo, C.maximumMultiplier));
    g.score += points; g.hud.reward(points);
    if (order.definition.onComplete !== 'hold') leaveVehicle(order);
  }
  reclaim(order) {
    const g = this.game;
    g.charging.wet.clearTruck(order.truck);
    for (const tool of g.tools) if (tool.truck === order.truck) {
      if (tool.kind === 'water') tool.release(null, order.truck.vel); else tool.placeOn(g.homeTruck, tool.originalPosition);
    }
    order.truck.group.visible = false; g.lanes = g.lanes.filter(l => l.serial !== order.serial);
    g.clearStains(order); g.spawnClock = C.nextOrderDelay;
    if (!g.levelScript.finished.includes(order.id)) g.levelScript.finished.push(order.id);
    const request = g.levelScript.requests.find(r => r.serial === order.serial); if (request) request.status = 'finished';
  }
}
