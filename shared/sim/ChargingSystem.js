import * as THREE from 'three';
import { ChargingHead } from './ChargingHead.js';
import { ChargingCable } from './ChargingCable.js';
import { WetField } from './WetField.js';
import { CHARGING, chargingPortLocal } from './chargingConfig.js';
import { holdPoint } from './CarryItem.js';
import { pushPlayer } from './Mass.js';
import { buildChargePort, buildChargingPost, isSharedToolResource } from './ToolModels.js';
import { onChargeCompleted } from './ChargingRewards.js';
import { PVP_TUNING } from './PvpScore.js';
import { shock, leaveShock } from './Wobble.js';

/** Indicator lights glow in their own color; only changes touch the material. */
function setLight(material, color) {
  if (!material || material.userData.lightColor === color) return;
  material.userData.lightColor = color; material.color.set(color); material.emissive.set(color).multiplyScalar(0.55);
}

/** Host-only charging, wet topology, contact stuns and port short-circuits; the page consumes the same state via snapshots. */
export class ChargingSystem {
  constructor(game) {
    this.game = game;
    this.trucks = [...game.practiceTrucks, ...game.orderTrucks];
    this.wet = new WetField(this.trucks); this.emitClock = new Map();
    // The latest port short-circuit; clients play the blast once per new id.
    this.blast = { id: 0, tick: 0, at: [0, 0, 0] };
    this.heads = game.equipment.chargers.map(({ position: [x, z] }, index) =>
      new ChargingHead(game.scene, game.homeTruck, new THREE.Vector3(x, 0, z), index));
    this.cables = this.heads.map((head, index) => new ChargingCable(game.homeTruck, head, game.equipment.chargers[index]));
    // Charging post on the home vehicle; its origin is the cable outlet.
    this.source = buildChargingPost(game.equipment.chargers[0].supplyHeight);
    game.homeTruck.body.add(this.source); this.source.position.copy(this.cables[0].anchorLocal); this.source.visible = false;
    this.ports = new Map(this.trucks.filter(truck => truck !== game.homeTruck).map(truck => {
      const port = buildChargePort(); port.position.set(...chargingPortLocal(truck));
      truck.body.add(port); return [truck, port];
    }));
  }
  reset() { this.wet.reset(); this.emitClock.clear(); this.cables.forEach(cable => cable.reset()); this.blast = { id: 0, tick: 0, at: [0, 0, 0] }; }
  /** The nearest working order port this player may plug into. Versus (HouJianNan): either team may charge either truck. */
  nearPort(player) {
    if (!this.game.equipmentEnabled('charger')) return null;
    if (player.state !== 'ground') return null;
    return this.game.orders.find(order => order.mode === 'working' && order.truck === player.ground?.truck &&
      player.pos.distanceTo(new THREE.Vector3(order.truck.pos.x + chargingPortLocal(order.truck)[0], order.truck.topY, order.truck.pos.z)) < CHARGING.portRange) || null;
  }
  recallable(player) {
    if (!this.game.equipmentEnabled('charger')) return null;
    if (player.heldTool || player.ground?.truck !== this.game.homeTruck) return null;
    return this.cables.find(cable => !cable.gun.holder && !cable.gun.swallowedBy && player.pos.distanceTo(cable.anchor()) < cable.recallRange) || null;
  }
  /** Same in campaign and versus: whoever plugs in charges that truck's one bar (versus may charge the other team's truck). */
  plug(head, order, player = null) {
    if (order.mode !== 'working' || order.charged || this.heads.some(item => item.connectedSerial === order.serial)) return false;
    const [x, , z] = chargingPortLocal(order.truck);
    head.placeOn(order.truck, new THREE.Vector3(x, 0, z)); head.connectedSerial = order.serial;
    // Host-local credit for the match record; read only while this connection lasts.
    head.pluggedBy = player;
    return true;
  }
  interact(player, input) {
    const head = player.heldTool, order = this.nearPort(player);
    player.interactionHint = order ? order.charged ? '车辆已充满 · 轻点 K 放下' : 'J 插入充电口 · 轻点 K 放下 · 长按 K 投掷' : '轻点 K 放下 · 长按 K 投掷';
    if (order && input.hit('KeyJ') && !player.skipUse && this.plug(head, order, player)) player.interactionHint = '充电中 · J 拔下充电头';
  }
  contact(head) {
    if (head.holder) {
      const p = head.holder;
      return p.occupied !== false && p.state === 'ground' && p.ground ? { truck: p.ground.truck, x: p.pos.x, z: p.pos.z } : null;
    }
    if (head.flight) return null;
    if (head.truck) return { truck: head.truck, x: head.truck.pos.x + head.mesh.position.x, z: head.truck.pos.z + head.mesh.position.z };
    if (head.groundedRoad) return { truck: null, x: head.mesh.position.x, z: head.mesh.position.z };
    return null;
  }
  /** `dt` advances each victim's shock clock (WOBBLE.md: wobble on contact and every interval); 0 re-checks contact only. */
  checkElectricity(dt = 0) {
    this.wet.electrify(this.game.equipmentEnabled('charger') ? this.heads.map(head => this.contact(head)).filter(Boolean) : []);
    if (!this.game.equipmentEnabled('charger')) return;
    for (const player of this.game.players) {
      if (player.occupied === false || player.state !== 'ground' || !player.ground || player.swallowedBy ||
        !this.wet.markAt(player.ground.truck, player.pos.x, player.pos.z, true)) { leaveShock(player); continue; }
      if (!shock(player, dt)) continue;
      // Leave a held live connector at the victim's feet: the shock cannot magically clear the fault.
      // Versus: the water gun is knocked loose the same way, so a live puddle can strip the gun from its holder.
      if (player.heldTool?.kind === 'charger' || (this.game.mode === 'versus' && player.heldTool?.kind === 'water')) {
        const truck = player.ground.truck;
        player.heldTool.placeOn(truck, new THREE.Vector3(player.pos.x - truck.pos.x, 0, player.pos.z - truck.pos.z));
      }
    }
  }
  /** World position of a vehicle's charging socket. */
  portPoint(truck, target = new THREE.Vector3()) {
    const [x, , z] = chargingPortLocal(truck);
    return target.set(truck.pos.x + x, truck.topY + 0.16, truck.pos.z + z);
  }
  /** Water touching a plugged-in socket shorts it: the connector is blasted out and everyone nearby is thrown. */
  checkPlugs() {
    if (this.game.viewOnly || !this.game.equipmentEnabled('charger')) return;
    for (const head of this.heads) {
      if (head.connectedSerial === null || !head.truck) continue;
      const truck = head.truck, port = this.portPoint(truck);
      if (this.wet.markAt(truck, port.x, port.z)) this.shortCircuit(head, truck, port);
    }
  }
  shortCircuit(head, truck, port) {
    const id = this.blast.id + 1, [forward, up, side] = CHARGING.plugLaunch;
    // Out of the socket, up and to one side (alternating per blast); the reel still limits how far it can go.
    head.release(null, new THREE.Vector3(truck.vel.x + forward, up, truck.vel.z + (id % 2 ? side : -side)));
    this.blast = { id, tick: this.wet.tick, at: [port.x, port.y, port.z] };
    // The explosion boils the water around the socket away.
    this.wet.dryNear(truck, port.x, port.z, 1.2, 0.2);
    const direction = new THREE.Vector3();
    for (const player of this.game.players) {
      if (player.occupied === false || player.swallowedBy || !['ground', 'air'].includes(player.state)) continue;
      direction.set(player.pos.x - port.x, 0, player.pos.z - port.z);
      const distance = Math.hypot(direction.x, direction.z, (player.pos.y + 0.5 - port.y) * 0.5);
      if (distance > CHARGING.blastRadius) continue;
      const k = 1 - distance / CHARGING.blastRadius;
      if (direction.lengthSq() < 1e-6) direction.set(-1, 0, 0); else direction.normalize();
      player.blastUp(CHARGING.blastLift * (0.65 + 0.35 * k));
      pushPlayer(player, direction, CHARGING.blastPush * (0.45 + 0.55 * k));
    }
  }
  beginTick(dt) {
    this.wet.advance(dt, this.game.base);
    this.checkPlugs();
    this.checkElectricity(dt); // Contact is checked before J can steal a live connector through its wet footprint.
  }
  landWater(dt) {
    for (const gun of this.game.sprayers()) {
      if (!gun.spraying || gun.hitPlayer || gun.sprayNodes.length < 2) {
        this.emitClock.delete(`${gun.id}:roof`); this.emitClock.delete(`${gun.id}:road`); continue;
      }
      const hit = gun.sprayNodes.at(-1);
      const truck = this.game.activeTrucks().find(truck => truck.platformAt(hit.x, hit.z, 0) && Math.abs(hit.y - truck.topYAt(hit.x, hit.z)) < 0.45);
      const interval = truck ? 0.07 : 0.025, key = `${gun.id}:${truck ? 'roof' : 'road'}`;
      const clock = (this.emitClock.get(key) || 0) + dt;
      if (clock < interval) { this.emitClock.set(key, clock); continue; }
      this.emitClock.set(key, Math.min(clock - interval, interval));
      if (truck) this.wet.splash(truck, hit.x - truck.pos.x, hit.z - truck.pos.z);
      else if (hit.y < 0.4) this.wet.splash(null, hit.x, hit.z);
    }
  }
  dryTowels(dt) {
    this.game.players.forEach((player, slot) => {
      const key = `towel:${slot}`;
      if (player.occupied === false || player.state !== 'ground' || player.heldTool?.kind !== 'towel' || player.useAction !== 'wipe') { this.emitClock.delete(key); return; }
      const clock = (this.emitClock.get(key) || 0) + dt;
      if (clock < .08) { this.emitClock.set(key, clock); return; }
      this.emitClock.set(key, Math.min(clock - .08, .08));
      const reach = holdPoint('towel')[0];
      this.wet.dryNear(player.ground.truck, player.pos.x + Math.cos(player.yaw) * reach, player.pos.z - Math.sin(player.yaw) * reach);
    });
  }
  update(dt, oldPlayerPositions) {
    this.landWater(dt);
    this.dryTowels(dt);
    this.checkPlugs(); // Newly landed water interrupts before this tick can complete a charge/award.
    for (const head of this.heads) if (head.connectedSerial !== null) {
      const order = this.game.orders.find(order => order.serial === head.connectedSerial);
      const cable = this.cables[head.index];
      if (!order || order.mode !== 'working' || head.connector().distanceTo(cable.anchor()) > cable.maxLength) {
        head.release(null, head.truck?.vel); continue;
      }
      // Versus charges in its own time (HouJianNan). Charging your own side's truck is work; the other team's earns nothing.
      const seconds = this.game.mode === 'versus' ? PVP_TUNING.chargeSeconds : CHARGING.seconds;
      const by = head.pluggedBy, game = this.game;
      if (by && !order.charged && (game.mode !== 'versus' || by.team === order.team)) game.tally.add(by, 'charge', Math.min(dt, (1 - order.chargeProgress) * seconds));
      order.chargeProgress = Math.min(1, order.chargeProgress + dt / seconds);
      if (order.chargeProgress >= 1 - 1e-8 && !order.charged) {
        order.chargeProgress = 1; order.charged = true; onChargeCompleted(this.game, order);
      }
    }
    if (this.game.equipmentEnabled('charger')) this.cables.forEach(cable => cable.update(dt, this.game.activeTrucks(), this.game.players, oldPlayerPositions));
    this.checkPlugs();
    this.checkElectricity();
  }
  present() {
    this.source.visible = this.game.equipmentEnabled('charger');
    // Post strip and connector ring: amber while a connector is plugged in, mint when idle.
    const charging = this.heads.some(head => head.connectedSerial !== null);
    setLight(this.source.userData.led.material, charging ? '#f3d16b' : '#7be3b4');
    for (const head of this.heads) setLight(head.mesh.children[0]?.userData.light?.material, head.connectedSerial !== null ? '#f3d16b' : '#7be3b4');
    for (const [truck, port] of this.ports) {
      const order = this.game.orders.find(order => order.truck === truck);
      port.visible = this.game.equipmentEnabled('charger') && truck.group.visible && !!order;
      setLight(port.userData.led.material, order?.charged ? '#88d58a' : order?.chargeProgress > 0 ? '#f3d16b' : '#d0c6af');
    }
  }
  disposeViews() {
    const geometries = new Set(), materials = new Set();
    for (const root of [this.source, ...this.ports.values(), ...this.heads.map(head => head.mesh)]) {
      root.removeFromParent();
      root.traverse(node => { if (node.isMesh) { geometries.add(node.geometry); materials.add(node.material); } });
    }
    for (const resource of [...geometries, ...materials]) if (!isSharedToolResource(resource)) resource.dispose();
  }
}
