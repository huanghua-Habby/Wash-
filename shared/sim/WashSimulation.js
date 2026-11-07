/** Shared authoritative washing, orders and scoring; renderer supplies HUD and truck views. */
import * as THREE from 'three';
import { TruckState } from './TruckState.js';
import { PAL } from './palette.js';
import { laneShape } from './vehicles.js';
import { clamp, damp } from './util.js';
import { Towel } from './Towel.js';
import { WaterGun } from './WaterGun.js';
import { Soap } from './Soap.js';
import { Hose } from './Hose.js';
import { ChargingSystem } from './ChargingSystem.js';
import { TrunkSpray } from './TrunkSpray.js';
import { pushPlayer } from './Mass.js';
import { slap, slapTarget } from './Slap.js';
import { incapacitated } from './Wobble.js';
import { mulberry32 } from './util.js';
import { resolvePlayerContacts } from './PlayerContacts.js';
import { STATION_SOLID, SOAP_BOX_SOLID } from './ToolModels.js';
import { POUCH_X, POUCH_Y } from './CarryItem.js';
import { buildSoapBox, buildSupplyPoint, buildWashStation } from './ToolModels.js';
import { WASH_CONFIG as C } from './washConfig.js';
import { ROUND_FLOW, isPreparing } from './roundFlow.js';
import { LevelGuide } from './LevelGuide.js';
import { RoadSigns } from './RoadSigns.js';
import { FIRST_LEVEL_ID, getLevel, nextLevelId } from '../levels.js';
import { Orders } from './Orders.js';
import { LevelScript } from './LevelScript.js';
import { evaluateLevel, levelRatingProgress } from './LevelRating.js';
import { advanceVehicle, leaveVehicle } from './VehicleBehaviors.js';
import { roundPartyBalance } from './PartyBalance.js';
import { stepPressure, pressureForce, pressureRinse } from './SprayPressure.js';
import { versusOutcome, matchSettings } from './versusConfig.js';
import { spreadSlippery } from './Slippery.js';
import { stainCompleted, stainUndone, PVP_TUNING, smudgeable, enemyOrder } from './PvpScore.js';
import { StatsTally, packStats } from './PlayerStats.js';
import { TrainingDummy } from './TrainingDummy.js';
import { HackConsole } from './HackConsole.js';
import { CHARACTER_SCALE as K } from './characterScale.js';

// Stain i uses STAIN_STEPS[i]; positions come from each vehicle type's roof layout.
const _stainPoint = new THREE.Vector3();
export const STAIN_STEPS = [['towel'], ['water', 'towel'], ['soap', 'water', 'towel']];

export class WashSimulation {
  constructor({ scene, homeTruck, players, inputs, rig, onEnd, TruckClass = TruckState, TowelClass = Towel, SoapClass = Soap, hud, level = getLevel(FIRST_LEVEL_ID), practiceTrucks = [homeTruck], mode = 'coop' }) {
    // Host dice for hit item drops (WOBBLE.md); seeded so tests and replays repeat.
    this.random = mulberry32(0x5eed);
    Object.assign(this, { scene, homeTruck, players, inputs, rig, onEnd, SoapClass });
    this.level = level;
    /** `versus` gives orders a team and keeps one tally per team; `coop` keeps the single shared score. */
    this.mode = mode;
    /** Versus end conditions frozen by the host at match start (score target / time limit, null = off). */
    this.matchSettings = matchSettings(null);
    /** Versus bots the host placed this match: { slot, name, team, appearance }; empty otherwise. */
    this.bots = [];
    this.resetTeamTallies();
    this.partyBalance = roundPartyBalance(level, players);
    this.roadSigns = new RoadSigns(this);
    this.guide = new LevelGuide();
    this.equipment = level.equipment;
    this.practiceTrucks = practiceTrucks; this.practice = false; this.equipmentVisible = false;
    this.active = false;
    this.roundStage = 'idle'; this.roundStageTime = 0;
    this.paused = false;
    this.orders = [];
    this.lanes = [];
    this.waveIndex = 0;
    this.levelScript = new LevelScript(this); this.orderSystem = new Orders(this);
    this.equipmentKeys = []; this.result = null;
    this.hud = hud;
    // Fixed prepared slots per type; type and instance identity are independent.
    this.orderTrucks = level.orders.vehicles.flatMap(({ palette, capacity = 1, ...options }, index) =>
      Array.from({ length: capacity }, (_, copy) => {
        const truck = new TruckClass(PAL[palette], { name: '订单车', phase: 1.7 + index * .9 + copy * .3, ...options });
        truck.instanceId = `${options.type}-${copy}`; truck.generation = 0; return truck;
      }));
    for (const wave of level.orders.waves || []) {
      if (wave.vehicles?.length !== 2 || new Set(wave.vehicles).size !== 2 ||
          !wave.vehicles.every(type => this.orderTrucks.some(truck => truck.type === type))) {
        throw new Error('A paired wave requires two different, startup-prepared vehicle types');
      }
    }
    for (const truck of this.orderTrucks) { truck.group.visible = false; scene.add(truck.group); }
    this.orderTruck = this.orderTrucks[0];
    this.orderSerial = 0;
    this.lane = null;
    this.station = buildWashStation();
    homeTruck.body.add(this.station);
    const [stationX, stationZ] = this.equipment.washStation.position;
    this.station.position.set(stationX, homeTruck.localTopForLocal(stationX, stationZ), stationZ);
    this.station.visible = false; if (this.soapBox) this.soapBox.visible = false;
    // The cabinet and counter are solid while the station is shown: players slide around it (PlayerMotion.resolveSolids).
    const station = this.station;
    homeTruck.solids = [{ x: stationX, z: stationZ, ...STATION_SOLID, get active() { return station.visible; } }];
    this.towels = this.equipment.towels.positions.map(([x, z]) => new THREE.Vector3(x, 0, z))
      .map((position, index) => new TowelClass(scene, homeTruck, position, index));
    this.waterguns = this.equipment.waterguns.map(({ position: [x, z] }, index) => new WaterGun(scene, homeTruck, new THREE.Vector3(x, 0, z), index));
    this.soaps = [];
    this.tools = [...this.towels, ...this.waterguns];
    const [soapX, soapZ] = this.equipment.soap.positions[0];
    this.soapPosition = new THREE.Vector3(soapX, 0, soapZ);
    this.soapBox = buildSoapBox();
    this.soapBox.position.set(soapX, homeTruck.localTopForLocal(soapX, soapZ) + 0.3, soapZ);
    this.soapBox.visible = false; homeTruck.body.add(this.soapBox);
    // The crate is solid and standable while it is shown, like the station.
    const soapBox = this.soapBox;
    homeTruck.solids.push({ x: soapX, z: soapZ, ...SOAP_BOX_SOLID, get active() { return soapBox.visible; } });
    this.ensureSoap(0);
    // Tutorial slap target; hidden and inert unless a script step shows it.
    this.dummy = new TrainingDummy(this);
    // Versus hack console on the rear deck (HACK_CONSOLE.md); hidden in co-op and the lobby.
    this.hackConsole = new HackConsole(this);
    this.hoses = this.waterguns.map((gun, index) => new Hose(homeTruck, gun, this.equipment.waterguns[index]));
    this.supplyPoints = this.hoses.map((hose, index) => {
      const point = buildSupplyPoint(this.equipment.waterguns[index].supplyHeight);
      homeTruck.body.add(point); point.position.copy(hose.anchorLocal); point.visible = false;
      return point;
    });
    this.charging = new ChargingSystem(this);
    this.wet = this.charging.wet;
    this.chargers = this.charging.heads; this.cables = this.charging.cables;
    this.tools.push(...this.chargers);
    // Every slot owns a trunk tank; only an elephant can open it.
    this.trunks = players.map((player, slot) => (player.trunk = new TrunkSpray(player, slot)));
    // Per-player match record (Tab board, "+N" chip, versus awards); host tallies, viewers apply `stats`.
    this.tally = new StatsTally(this);
    this.jetSources = [...this.waterguns, ...this.trunks];
    this.frustum = new THREE.Frustum();
    this.viewMatrix = new THREE.Matrix4();
    this.box = new THREE.Box3();
    for (const player of players) player.on('fall', () => {
      this.tally.fell(player);
      if (!this.viewOnly && (this.active || this.practice) && player.heldTool) player.heldTool.launch(player);
    });
  }

  ensureSoap(index) {
    if (!Number.isInteger(index) || index < 0 || index >= C.maxSoapEntities) throw new RangeError('Soap entity index exceeds the shared pool capacity');
    while (this.soaps.length <= index) {
      const soap = new this.SoapClass(this.scene, this.homeTruck, this.soapPosition, this.soaps.length);
      this.soaps.push(soap); this.tools = [...this.towels, ...this.waterguns, ...this.soaps, ...(this.chargers || [])];
    }
    return this.soaps[index];
  }

  nearSoapBox(player) {
    return this.equipmentEnabled('soap') && this.equipment.soap.enabled && player.ground?.truck === this.homeTruck &&
      player.pos.distanceTo(this.soapBox.getWorldPosition(new THREE.Vector3())) < this.equipment.soap.interactionRange;
  }

  get soapAvailable() { return this.soaps.length < C.maxSoapEntities || this.soaps.some(item => !item.active); }

  takeSoap(player) {
    if (!this.soapAvailable) return null;
    const soap = this.soaps.find((item) => !item.active) || this.ensureSoap(this.soaps.length);
    soap.activate(); return soap;
  }

  canCatch(player, input) {
    return player.occupied !== false && ['ground', 'air'].includes(player.state) && !player.heldTool && !incapacitated(player) &&
      !input?.down('KeyK') && (input?.down('KeyJ') || input?.hit('KeyJ') || player.catchRemaining > 0);
  }

  interceptItem(tool, start, end) {
    const segment = end.clone().sub(start), lengthSq = segment.lengthSq();
    const hits = [];
    this.players.forEach((player, index) => {
      if (player.occupied === false || !['ground', 'air'].includes(player.state) || (tool.thrower === player && tool.ownerGrace > 0)) return;
      const catching = this.canCatch(player, this.inputs[index]);
      if (!catching && tool.kind !== 'soap') return;
      const center = player.pos.clone().add(new THREE.Vector3(0, 0.65, 0));
      const t = lengthSq > 0 ? THREE.MathUtils.clamp(center.clone().sub(start).dot(segment) / lengthSq, 0, 1) : 0;
      const point = start.clone().addScaledVector(segment, t);
      if (point.distanceTo(center) < (catching ? C.catchRange : 0.55)) hits.push({ player, catching, t, point });
    });
    hits.sort((a, b) => a.t - b.t);
    const hit = hits[0]; if (!hit) return false;
    if (hit.catching && tool.pickup(hit.player)) { hit.player.skipUse = true; return true; }
    hit.player.slip();
    tool.mesh.position.copy(hit.point); tool.velocity.multiplyScalar(-0.2); tool.velocity.y = 1;
    tool.thrower = hit.player; tool.ownerGrace = C.itemOwnerGrace;
    return true;
  }

  /** Everything that lays a jet: hose-fed guns and elephant trunks. */
  sprayers() { return this.jetSources; }

  resetEquipment() {
    this.playerContacts = 0;
    this.roadSigns.reset();
    this.players.forEach((player) => this.releasePouch(player));
    this.trunks.forEach((trunk) => trunk.reset());
    this.tools.forEach((tool) => tool.reset());
    this.hoses.forEach((hose) => hose.reset());
    this.charging.reset();
    this.hackConsole.reset();
    this.players.forEach((player) => { player.heldTool = null; player.skipUse = false; player.throwWasDown = false; player.throwCancelled = false; player.interactionHint = ''; });
  }

  enterPractice(base) {
    this.roundStage = 'idle'; this.roundStageTime = 0;
    this.active = false; this.practice = true; this.equipmentVisible = true;
    this.paused = this.ended = false; this.base = base;
    this.remaining = this.elapsed = this.score = this.combo = this.completed = this.missed = 0; this.resetTeamTallies(); this.tally.reset();
    this.clearStains(); this.hideOrderTrucks(); this.lane = null;
    this.station.visible = true; this.soapBox.visible = this.equipment.soap.enabled; this.supplyPoints.forEach((point) => { point.visible = true; });
    this.resetEquipment(); this.setEquipment(['towel', 'station', 'water', 'soap', 'charger']); this.hud.root.hidden = false;
  }

  leavePractice() {
    this.practice = false;
    this.resetEquipment(); this.hud.root.hidden = true;
  }

  start(base, ready = false) {
    this.partyBalance = roundPartyBalance(this.level, this.players);
    this.roundStage = ready ? 'ready' : 'playing'; this.roundStageTime = 0;
    this.guide.reset();
    if (ready && this.guide.begin(this.level.guide, this.players)) this.roundStage = 'guide';
    this.practice = false; this.equipmentVisible = true;
    this.active = true; this.paused = this.ended = false;
    this.remaining = this.roundClock().duration;
    this.result = null;
    this.elapsed = 0;
    this.score = this.combo = this.completed = this.missed = 0; this.resetTeamTallies(); this.tally.reset(); this.slipperyContacts = 0;
    this.spawnClock = C.firstOrderDelay;
    this.clearStains();
    this.orderSerial = 0; this.lane = null; this.waveIndex = 0;
    this.homeX = this.homeTruck.pos.x; this.homeZ = this.homeTruck.pos.z; this.base = base;
    this.station.visible = true; this.soapBox.visible = this.equipment.soap.enabled;
    this.supplyPoints.forEach((point) => { point.visible = true; });
    this.resetEquipment();
    this.setEquipment(this.level.unlockedEquipment || ['towel', 'station', 'water', 'soap', 'charger']);
    this.levelScript.start();
    this.hud.lastScore = this.hud.lastCombo = -1;
    this.hud.root.hidden = false;
  }

  // Legacy primary accessors keep tutorial consumers usable; gameplay always iterates orders/lanes.
  get order() { return this.orders[0] || null; }
  set order(value) { this.orders = value ? [value] : []; }
  get orderTruck() { return this.order?.truck || this.idleOrderTruck; }
  set orderTruck(value) { this.idleOrderTruck = value; }
  get lane() { return this.lanes.find(lane => lane.serial === this.order?.serial) || this.lanes[0] || null; }
  set lane(value) { this.lanes = value ? [value] : []; }

  /** Per-slot match record: the host's live tally, or the applied snapshot copy on a viewer. */
  get stats() { return this.tally.list; }
  set stats(list) { this.tally.list = list; }

  refreshStainHud() { this.hud.setStains(this.orders.flatMap(order => order.stains)); }
  clearStains(order = null) {
    for (const entry of order ? [order] : this.orders) {
      this.clearOrderCargo(entry);
      for (const stain of entry.stains) this.releaseStainMesh(stain.mesh);
    }
    this.orders = order ? this.orders.filter(entry => entry !== order) : [];
    this.refreshStainHud();
  }
  /** Renderer adapters can return prepared meshes to a pool. */
  releaseStainMesh(mesh) { mesh.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose(); }
  reclaimOrder(order) { this.orderSystem.reclaim(order); }

  stop() {
    this.guide.reset(); this.levelScript.reset(); this.tally.reset(); this.result = null;
    this.roundStage = 'idle'; this.roundStageTime = 0;
    this.practice = false; this.equipmentVisible = false;
    this.active = false;
    this.paused = this.ended = false;
    this.clearStains();
    this.hideOrderTrucks(); this.lane = null;
    this.station.visible = false; if (this.soapBox) this.soapBox.visible = false;
    this.supplyPoints.forEach((point) => { point.visible = false; });
    this.hud.root.hidden = true;
    for (const tool of this.tools) { tool.reset(); tool.mesh.visible = false; }
    for (const trunk of this.trunks) trunk.reset();
    for (const hose of this.hoses) hose.initialized = false;
    this.charging.reset(); this.charging.present();
    this.hackConsole.reset(); this.hackConsole.present();
    this.roadSigns.reset();
    for (const player of this.players) player.interactionHint = '';
  }

  /** Headless placeholder; the client replaces it with the procedural stain look (index and steps pick the dirt type). */
  makeStainMesh(_index = 0, _steps = STAIN_STEPS[0], _truck = null) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.49, 0.025, 9), new THREE.MeshLambertMaterial({ color: '#756141', transparent: true }));
    mesh.scale.z = 0.75; mesh.layers.enable(1);
    return mesh;
  }

  hideOrderTrucks() { for (const truck of this.orderTrucks) { truck.group.visible = false; truck.solids = []; } }

  /** Cargo authored on an order (Xiexufeng: crates and log piles on a flatbed) becomes box solids on its truck:
   * solid sides, a standable top, squirrel faces; the order definition (already in the snapshot) carries it. The client
   * adds the prepared art through makeCargoMesh. Colliders are boxes, never meshes; the authored yaw is art only. */
  syncOrderCargo(order) {
    const cargo = order.definition?.cargo || [], key = JSON.stringify(cargo);
    if (order.cargoKey === key) return;
    this.clearOrderCargo(order);
    order.cargoKey = key;
    order.truck.solids = cargo.map(({ id, position: [x, z], size: [width, depth], height }) =>
      ({ id, x, z, hx: width / 2, hz: depth / 2, height, active: true }));
    order.cargoMeshes = cargo.map((entry) => {
      const mesh = this.makeCargoMesh(entry);
      if (!mesh) return null;
      const [x, z] = entry.position;
      mesh.position.set(x, order.truck.localTopForLocal(x, z) + (mesh.userData?.floor || 0), z); mesh.rotation.y = entry.yaw || 0;
      order.truck.body.add(mesh);
      return mesh;
    });
  }
  clearOrderCargo(order) {
    for (const mesh of order?.cargoMeshes || []) if (mesh) this.releaseCargoMesh(mesh);
    if (order?.truck) order.truck.solids = [];
    if (order) { order.cargoMeshes = []; order.cargoKey = null; }
  }
  /** Client hooks (WashGame): a prepared cargo model instance and its release. Headless worlds draw none. */
  makeCargoMesh(_cargo) { return null; }
  releaseCargoMesh(mesh) { mesh.removeFromParent(); }

  /** World x where an arriving order vehicle rides its merge lane. */
  orderX() { return this.homeX - 0.5; }

  /** Nominal docked lane beside the player vehicle; wider vehicles keep the same hull gap. */
  orderSide(serial = this.order?.serial ?? this.orderSerial) { return this.orderSystem.side(serial); }
  orderPatience(stains) { return this.orderSystem.patience(stains); }
  orderLaneZ(spec, serial = this.order?.serial ?? this.orderSerial) { return this.homeZ + this.orderSide(serial) * (this.homeTruck.halfWidth + spec.width / 2 + C.orderGap); }

  laneShape(u, serial = this.order?.serial ?? this.orderSerial) { return laneShape(u, { sideOffset: -this.orderSide(serial) * C.laneSideOffset, height: C.laneHeight }); }

  /** Merge progress for the current order: 1 on the off-screen side road, 0 once merged. */
  laneProgress(serial) {
    const lane = this.lanes.find(lane => lane.serial === serial);
    return lane && lane.serial === serial ? clamp((lane.x - this.orderX()) / C.laneLength, 0, 1) : 0;
  }

  /**
   * Create the next order's merge lane ahead of the player, outside the view. The vehicle only
   * appears once the player vehicle reaches the lane, then follows it in.
   */
  orderVehicle(serial) { return this.orderSystem.vehicle(serial); }

  openLane(serial = this.orderSerial) { return this.orderSystem.openLane(serial); }

  spawnOrder(serial = this.orderSerial, incoming) { return this.orderSystem.spawn(serial, incoming); }

  /** The player vehicle's level an order roof docks to: the closest of its deck heights (a low flatbed meets the low
   * deck, a tall roof meets the box roof). */
  dockLevel(truck) {
    const levels = this.homeTruck.platforms.map(plat => this.homeTruck.platformTop(plat));
    return levels.reduce((best, level) => Math.abs(level - truck.topLocal) < Math.abs(best - truck.topLocal) ? level : best, this.homeTruck.topLocal);
  }

  /** Roof-level target: the order's roof hugs the matching player deck with a small continuous drift. */
  alignedAltitude(truck, age) {
    const home = this.homeTruck, p = truck.phase;
    const drift = C.roofWobble * (Math.sin(age * 0.8 + p) + 0.4 * Math.sin(age * 2.3 + p * 1.7));
    return home.pos.y + this.dockLevel(truck) - truck.topLocal + drift;
  }

  /** Apply altitude and the matching nose pitch from the climb rate. */
  fly(truck, y, dt) {
    const before = truck.pos.y;
    truck.setAltitude(y);
    truck.vel.y = (truck.pos.y - before) / dt;
    truck.group.rotation.z = Math.atan2(truck.vel.y, this.base) * 0.8;
  }

  updateFleet(dt) {
    if (this.viewOnly || !this.active || isPreparing(this) || this.paused || this.ended || dt <= 0) return;
    this.orderSystem.update(dt);
  }

  updateOrder(order, dt) { advanceVehicle(this, order, dt); }

  activeTrucks() { return this.practice ? this.practiceTrucks.filter(truck => truck.group.visible) : [this.homeTruck, ...this.orders.filter(order => order.truck.group.visible).map(order => order.truck)]; }

  /** Versus: one tally per team (0 red, 1 blue). Co-op leaves them at zero. Also clears a versus pause vote. */
  resetTeamTallies() {
    this.teamScores = [0, 0]; this.teamCombos = [0, 0]; this.teamCompleted = [0, 0]; this.teamMissed = [0, 0];
    // HouJianNan's per-stain scoring: stains washed, stains undone by the enemy and charge bonuses paid, per team.
    this.teamCleaned = [0, 0]; this.teamUndone = [0, 0]; this.teamChargeBonus = [0, 0];
    // Versus pause: { by, votes, voters } slots while a requested pause holds the match; cooldown per requester slot.
    this.pauseVote = null; this.pauseCooldowns = this.players.map(() => 0);
  }

  /** Versus: the other team's truck for this player. Cleaning there runs backwards (sabotage). */
  enemyOrder(player, order) { return enemyOrder(this, player, order); }

  /** Versus sabotage target for a dirty towel: the nearest enemy stain whose current towel step has progress to lose,
   *  or a done stain whose last step is the towel. Never reaches back into an earlier step. */
  smudgeTarget(player) {
    const order = this.orders.find(entry => entry.truck === player.ground?.truck);
    if (!order || order.mode !== 'working' || !this.enemyOrder(player, order)) return null;
    let best = null, distance = C.useRange;
    for (const stain of order.stains) {
      if (!smudgeable(stain)) continue;
      const d = player.pos.distanceTo(stain.mesh.getWorldPosition(_stainPoint));
      if (d < distance) { best = stain; distance = d; }
    }
    return best && { order, stain: best };
  }

  nearestStain(player) {
    const order = this.orders.find(entry => entry.truck === player.ground?.truck);
    if (!order || order.mode !== 'working' || player.ground?.truck !== order.truck) return null;
    if (this.enemyOrder(player, order)) return null; // Versus: only your own truck gets cleaner.
    let best = null, distance = C.useRange;
    for (const stain of order.stains) {
      if (stain.done || stain.steps[stain.stage] !== (player.heldTool?.kind || 'towel')) continue;
      const d = player.pos.distanceTo(stain.mesh.getWorldPosition(new THREE.Vector3()));
      if (d < distance) { best = stain; distance = d; }
    }
    return best;
  }

  nearStation(player) {
    if (!this.equipmentEnabled('station')) return false;
    return player.ground?.truck === this.homeTruck && player.pos.distanceTo(this.station.getWorldPosition(new THREE.Vector3())) < this.equipment.washStation.interactionRange;
  }

  recallableHose(player) {
    if (!this.equipmentEnabled('water')) return null;
    if (player.ground?.truck !== this.homeTruck || player.heldTool) return null;
    return this.hoses.find((hose) => {
      const anchor = hose.anchor();
      return !hose.gun.holder && Math.hypot(player.pos.x - anchor.x, player.pos.z - anchor.z) < hose.recallRange;
    }) || null;
  }

  spray(player, input, dt) {
    const gun = player.heldTool;
    player.interactionHint = '按住 J 喷水 · 轻点 K 放下';
    // Holding builds hose pressure; letting go leaves a short, weakening tail.
    if (!stepPressure(gun, input.down('KeyJ') && !player.skipUse && !input.down('KeyK'), dt)) return;
    gun.spraying = true; player.useAction = 'spray';
    gun.trace(this.activeTrucks(), this.players, this.orders.flatMap(order => order.stains));
    if (gun.hitPlayer) {
      pushPlayer(gun.hitPlayer, gun.direction(), (this.mode === 'versus' ? PVP_TUNING.sprayPushSpeed : C.sprayPushSpeed) * pressureForce(gun.pressure));
      this.tally.shove(player, gun.hitPlayer);
      return;
    }
    this.rinse(player, gun.hitStain, dt * pressureRinse(gun.pressure));
  }

  /** A jet on a stain waiting for its water step advances that step; `dt` is already scaled by the jet's rinse rate. */
  rinse(player, target, dt) {
    const order = this.orders.find(entry => entry.stains.includes(target));
    if (!order || order.mode !== 'working') return;
    // Versus: an enemy jet washes back rinse progress already made on that truck (HouJianNan).
    if (this.enemyOrder(player, order)) { this.rinseBack(player, target, dt); return; }
    if (!target || target.done || target.steps[target.stage] !== 'water') return;
    this.tally.add(player, 'work', Math.min(dt / C.spraySeconds, 1 - target.progress));
    target.progress = Math.min(1, target.progress + dt / C.spraySeconds);
    player.interactionHint = `冲洗污渍 ${Math.round(target.progress * 100)}%`;
    if (target.progress >= 1 - 0.000001) {
      target.stage++; target.progress = 0; target.done = target.stage === target.steps.length;
      target.mesh.material.color.set('#9b8063');
      if (target.done) { target.mesh.visible = false; this.tally.add(player, 'stains'); this.stainFinished(order, target); }
      if (order.stains.every(stain => stain.done)) this.completeOrder(order);
    }
  }

  /** Versus: water on the enemy truck washes back rinse progress already made, never below the start of that step. */
  rinseBack(player, target, dt) {
    if (target.done || target.steps[target.stage] !== 'water' || target.progress <= 0) return;
    this.tally.add(player, 'sabotage', Math.min(target.progress, dt / PVP_TUNING.rinseBackSeconds));
    target.progress = Math.max(0, target.progress - dt / PVP_TUNING.rinseBackSeconds);
    player.interactionHint = `冲掉对面进度 ${Math.round(target.progress * 100)}%`;
  }

  /**
   * Elephant L: hold to spray from the trunk, independent of whatever the paws carry. The tank drains while the jet
   * is open and refills when idle. The jet opens with a heavy kick back and keeps pushing the elephant backwards;
   * like the gun it rinses the first water-step stain it hits or shoves the first teammate in its path.
   */
  trunkSpray(player, input, dt) {
    if (!this.trunksEnabled()) { player.trunk.step(false, dt); return; }
    const trunk = player.trunk;
    if (player.animal !== 'elephant') { if (trunk.spraying || trunk.water < 1) trunk.reset(); return; }
    const able = player.occupied !== false && !player.swallowedBy && ['ground', 'air'].includes(player.state) && !incapacitated(player);
    const opening = !trunk.spraying;
    if (!trunk.step(able && !!input?.down('KeyL'), dt)) return;
    if (opening) player.skillSerial++;
    trunk.trace(this.activeTrucks(), this.players, this.orders.flatMap(order => order.stains));
    // Recoil is the elephant's own tuned push; its large mass only matters for shoves from others.
    const back = trunk.direction().negate(), velocity = player.externalVelocity;
    const force = pressureForce(trunk.pressure);
    const recoil = (opening ? C.trunkKickSpeed : C.trunkRecoilSpeed) * force, current = velocity.dot(back);
    if (current < recoil) velocity.addScaledVector(back, recoil - current);
    if (trunk.hitPlayer) { pushPlayer(trunk.hitPlayer, trunk.direction(), C.trunkPushSpeed * force); this.tally.shove(player, trunk.hitPlayer); return; }
    this.rinse(player, trunk.hitStain, dt * C.trunkRinseRate * pressureRinse(trunk.pressure));
  }

  nearestTool(player, looseOnly = false) {
    let result = null, distance = C.pickupRange;
    for (const towel of this.tools) {
      if (looseOnly && towel.kind !== 'towel' && towel.kind !== 'soap') continue;
      if (!this.equipmentEnabled(towel.kind)) continue;
      if (towel.holder || towel.swallowedBy || towel.active === false || (player.state !== 'ground' && !towel.flight)) continue;
      const d = player.pos.clone().add(new THREE.Vector3(0, towel.flight ? 0.65 : 0, 0)).distanceTo(towel.worldPosition());
      if (d < distance) { result = towel; distance = d; }
    }
    return result;
  }

  /** Loose towels/soap within reach take precedence over a nearby post's remote recall. */
  /** Slap request this tick for an empty-handed player (co-op and versus). */
  slapInput(player, input, reach) {
    if (player.slapCooldown > 0) return false;
    if (input.down('KeyK') && player.slapArmed) return true;
    // Every J press also opens the catch window (PlayerMotion), so that window cannot gate the slap; a catch that lands
    // sets skipUse, which keeps that J from swinging.
    return !reach && !player.skipUse && input.down('KeyJ');
  }

  emptyHandTarget(player) {
    const hose = this.charging.recallable(player) || this.recallableHose(player);
    const loose = hose && this.nearestTool(player, true);
    if (loose) return { tool: loose, hose: null };
    return { tool: hose?.gun || this.nearestTool(player), hose };
  }

  /** Beak tip in world space; swallowing reaches from here and spitting launches from here. */
  mouthPoint(player, target = new THREE.Vector3()) {
    return target.set(player.pos.x + Math.cos(player.yaw) * 0.5 * K, player.pos.y + 0.6 * K, player.pos.z - Math.sin(player.yaw) * 0.5 * K);
  }

  /** Pelican L: spit out what is in the pouch, otherwise swallow the nearest player or loose tool (not the hose-tied water gun).
   * Players are skipped while the pelican's swallow cooldown runs; tools are not. */
  pouch(player, input) {
    if (!input.hit('KeyL') || player.animal !== 'pelican' || !['ground', 'air'].includes(player.state) || incapacitated(player)) return;
    player.skillSerial++;
    if (player.swallowed) { this.spit(player, true); return; }
    const mouth = this.mouthPoint(player), point = new THREE.Vector3();
    let target = null, distance = C.swallowRange;
    for (const other of this.players) {
      if (player.swallowCooldown > 0) break;
      if (other === player || other.occupied === false || !['ground', 'air'].includes(other.state)) continue;
      const d = mouth.distanceTo(point.copy(other.pos).setY(other.pos.y + 0.5));
      if (d < distance) { target = other; distance = d; }
    }
    for (const tool of this.tools) {
      if (!this.equipmentEnabled(tool.kind)) continue;
      if (tool.kind === 'water' || tool.kind === 'charger' || tool.holder || tool.swallowedBy || tool.active === false || (!tool.truck && !tool.flight)) continue;
      const d = mouth.distanceTo(tool.worldPosition(point));
      if (d < distance) { target = tool; distance = d; }
    }
    if (!target) return;
    this.swallow(player, target);
    if (!target.kind) this.tally.hit(player, target, 'swallows');
  }

  swallow(pelican, target) {
    pelican.swallowed = target; target.swallowedBy = pelican;
    if (target.kind) {
      Object.assign(target, { flight: false, truck: null, thrower: null, ownerGrace: 0, washProgress: 0, charge: 0 });
      target.velocity.set(0, 0, 0); pelican.yawG.add(target.mesh);
      target.mesh.position.set(POUCH_X, POUCH_Y, 0); target.mesh.rotation.set(0, 0, 0);
      return;
    }
    // A swallowed teammate lets go of its tool and coughs up its own pouch.
    if (target.heldTool) { target.heldTool.charge = 0; this.drop(target); }
    if (target.swallowed) this.spit(target, false);
    // The victim may already have acted this tick; do not carry its old jet into wet-field emission.
    target.trunk.reset();
    Object.assign(target, { state: 'swallowed', ground: null, takeoff: null, throwWasDown: false, throwCancelled: false, skipUse: false, useAction: '' });
    target.vel.set(0, 0, 0); target.externalVelocity.set(0, 0, 0);
    target.swallowRemaining = C.swallowSeconds; target.swallowElapsed = 0; target.struggleLog = [];
    target.interactionHint = '被鹈鹕吞下了！连按任意键挣脱';
    target.followPouch(); target.root.position.copy(target.pos);
  }

  /** Empty the pouch from the beak: an L spit flings it forward, falling off only lets it drop out. */
  spit(pelican, launch) {
    const item = pelican.swallowed;
    if (!item) return;
    pelican.swallowed = null; item.swallowedBy = null; item.swallowRemaining = 0;
    if (!item.kind) pelican.swallowCooldown = C.swallowCooldownSeconds;
    const c = Math.cos(pelican.yaw), s = Math.sin(pelican.yaw), mouth = this.mouthPoint(pelican);
    const base = pelican.ground ? pelican.ground.truck.vel : new THREE.Vector3(pelican.airBase.x, 0, pelican.airBase.y);
    const speed = launch ? C.spitSpeed : 0;
    const velocity = new THREE.Vector3(base.x + c * speed, launch ? C.spitLift : 1, base.z - s * speed);
    if (item.kind) {
      item.release(pelican, velocity);
      item.mesh.position.copy(mouth); item.origin.copy(mouth);
      return;
    }
    if (launch) this.tally.shove(pelican, item);
    Object.assign(item, { state: 'air', ground: null, takeoff: pelican.ground?.truck || pelican.takeoff, coyote: 0, jumpBuf: 0, interactionHint: '' });
    item.pos.copy(mouth); item.pos.y = Math.max(0.01, mouth.y - 0.5);
    // A spat player flies at the character scale (relative to the carrier); tools keep their world throw.
    item.vel.set(base.x + (velocity.x - base.x) * K, velocity.y * K, base.z + (velocity.z - base.z) * K); item.airBase.set(base.x, base.z);
    // Carry the spit forward through the air like a dash jump.
    item.dashDirection.set(c, 0, -s); item.jumpBoost = launch ? C.spitJumpBoost : 0;
    item.root.position.copy(item.pos);
  }

  /** Swallowed players shorten their stay by pressing keys; the host accepts at most a fixed number per rolling second. */
  struggle(player, input, dt) {
    player.swallowElapsed = (player.swallowElapsed || 0) + dt;
    const log = (player.struggleLog ||= []);
    while (log.length && log[0] <= player.swallowElapsed - 1) log.shift();
    for (let presses = input?.struggles?.() || 0; presses > 0 && log.length < C.swallowStrugglesPerSecond; presses--) {
      log.push(player.swallowElapsed); player.swallowRemaining -= C.swallowStruggleSeconds;
    }
    player.swallowRemaining = Math.max(0, player.swallowRemaining - dt);
  }

  /** Scene resets and departures: free both sides of a pouch without flinging anyone. */
  releasePouch(player) {
    // Resets and departures are not a swallow the pelican chose to finish; they leave no cooldown.
    if (player.swallowed) { this.spit(player, false); player.swallowCooldown = 0; }
    if (player.swallowedBy) {
      const owner = player.swallowedBy;
      owner.swallowed = null; player.swallowedBy = null; player.swallowRemaining = 0;
      if (player.state === 'swallowed') { player.state = 'air'; player.interactionHint = ''; }
    }
  }

  drop(player) {
    const towel = player.heldTool;
    if (!towel) return;
    if (player.state === 'ground' && player.ground) {
      const truck = player.ground.truck;
      let x = player.pos.x + Math.cos(player.yaw) * 0.65;
      let z = player.pos.z - Math.sin(player.yaw) * 0.65;
      // At a roof edge, place at the feet instead of turning a tap into a throw.
      if (!truck.platformAt(x, z, 0)) { x = player.pos.x; z = player.pos.z; }
      if (truck.platformAt(x, z, 0)) {
        towel.placeOn(truck, new THREE.Vector3(x - truck.pos.x, 0, z - truck.pos.z));
        towel.thrower = player; towel.ownerGrace = C.itemOwnerGrace;
        player.heldTool = null;
        player.throwWasDown = false;
        return;
      }
    }
    towel.release(player);
  }

  interact(player, input, dt) {
    if (isPreparing(this) || this.ended || this.paused) return;
    // Authoritative visual cue for teammates: '' | wipe | wash | soap | spray.
    player.useAction = '';
    if (player.slapCooldown > 0) player.slapCooldown = player.slapCooldown - dt < 1e-9 ? 0 : player.slapCooldown - dt;
    // A K that dropped or threw must be let go before it can slap.
    if (!input.down('KeyK')) player.slapArmed = true;
    // Shock-stunned or knocked down (Wobble.js): hands locked up until it passes; K must be pressed afresh afterwards.
    if (incapacitated(player)) {
      if (player.heldTool) { player.heldTool.charge = 0; player.heldTool.washProgress = 0; }
      player.throwWasDown = false; player.throwCancelled = input.down('KeyK'); player.skipUse = true;
      player.interactionHint = player.stunRemaining > 0 ? '触电麻痹中…' : '晕倒了…';
      return;
    }
    const throwing = input.down('KeyK');
    // Jumping never interrupts a K gesture: players can jump and throw. Slips, shocks and road-sign hits still cancel it,
    // and then K must be released before another gesture can charge or place the item.
    if (player.throwCancelled) {
      if (player.heldTool) { player.heldTool.charge = 0; player.heldTool.washProgress = 0; }
      player.throwWasDown = false; player.interactionHint = '';
      if (!throwing) player.throwCancelled = false;
      return;
    }
    if (player.heldTool) {
      const carried = player.heldTool;
      if (input.hit('KeyK') || throwing && !player.throwWasDown) carried.charge = 0;
      if (throwing) carried.charge = Math.min(C.throwChargeSeconds, carried.charge + dt);
      // A hit with no held state also preserves taps shorter than one network tick.
      if ((player.throwWasDown || input.hit('KeyK')) && !throwing) {
        player.slapArmed = false;
        if (carried.charge < C.throwHoldSeconds) this.drop(player);
        else {
          const power = (carried.charge - C.throwHoldSeconds) / (C.throwChargeSeconds - C.throwHoldSeconds);
          carried.launch(player, power * C.throwChargeSeconds);
        }
        player.throwWasDown = false; player.interactionHint = ''; return;
      }
    }
    player.throwWasDown = !!player.heldTool && throwing;
    if (player.heldTool && throwing) {
      const charge = player.heldTool.charge;
      player.interactionHint = charge < C.throwHoldSeconds ? '松开 K 放下' : `松开 K 投掷 ${Math.round((charge - C.throwHoldSeconds) / (C.throwChargeSeconds - C.throwHoldSeconds) * 100)}%`;
      player.heldTool.washProgress = 0;
      return;
    }
    if (!['ground', 'air'].includes(player.state)) { player.interactionHint = ''; return; }
    const stain = this.nearestStain(player), station = this.nearStation(player);
    if (!input.down('KeyJ')) player.skipUse = false;
    if (input.hit('KeyJ')) {
      if (!player.heldTool) {
        const target = this.emptyHandTarget(player), hose = target.hose;
        const tool = target.tool || (this.nearSoapBox(player) ? this.takeSoap(player) : null);
        const plugged = tool?.kind === 'charger' && tool.connectedSerial !== null ? this.orders.find(order => order.serial === tool.connectedSerial) : null;
        if (tool?.pickup(player)) {
          player.skipUse = true;
          if (hose) hose.reset();
          if (plugged && !plugged.charged && this.enemyOrder(player, plugged)) this.tally.add(player, 'unplug');
        }
      }
    }
    const towel = player.heldTool;
    if (!towel) {
      const { tool: nearest, hose } = this.emptyHandTarget(player);
      // Empty hands slap in every mode. K always; J only with nothing to pick up, and never the press that picked up.
      const reach = !!nearest || this.nearSoapBox(player);
      // Beside the versus hack console J types (HackConsole.js) instead of slapping; K still slaps.
      const hacking = !reach && this.hackConsole.interact(player, input, dt);
      if (this.slapInput(player, input, reach || hacking)) {
        const target = slap(player, this.players, this.random);
        if (target) { this.tally.hit(player, target, 'slaps'); this.tally.shove(player, target); }
        else this.dummy.slapped(player);
      }
      if (hacking) return;
      if (!reach && (slapTarget(player, this.players) || this.dummy.inReach(player))) { player.interactionHint = 'J / K 拍打'; return; }
      player.interactionHint = hose ? nearest.kind === 'charger' ? 'J 拿回充电头' : 'J 拿回水枪' : nearest ? `J 拿起${nearest.kind === 'charger' ? '充电头' : nearest.kind === 'water' ? '水枪' : nearest.kind === 'soap' ? '肥皂' : '毛巾'}` : this.nearSoapBox(player) ? this.soapAvailable ? 'J 取一块肥皂' : '拾取现有肥皂' : '';
      return;
    }
    if (towel.kind === 'water') { this.spray(player, input, dt); return; }
    if (towel.kind === 'charger') { this.charging.interact(player, input); return; }
    if (towel.kind === 'soap') {
      player.interactionHint = stain ? '按住 J 打肥皂泡' : '轻点 K 放下 · 长按 K 投掷';
      // The player scrubs whenever J is held; only a matching stain actually progresses.
      if (input.down('KeyJ') && !player.skipUse && !input.down('KeyK')) player.useAction = 'soap';
      if (stain && input.down('KeyJ') && !player.skipUse) {
        const amount = Math.min(dt * player.workSpeed / C.soapSeconds, 1 - stain.progress, towel.durability);
        stain.progress += amount; towel.consume(amount); this.tally.add(player, 'work', amount);
        if (stain.progress >= 1 - 0.000001) { stain.stage++; stain.progress = 0; }
        if (towel.durability <= 0.000001) towel.retire();
      }
      return;
    }
    const smudge = this.mode === 'versus' ? this.smudgeTarget(player) : null;
    player.interactionHint = towel.dirty ? station ? '按住 J 洗净毛巾' : smudge && towel.canSmudge ? '按住 J 抹脏对面' : towel.filthy ? '毛巾太脏了，带回洗面台'
      : this.mode === 'versus' && Number.isInteger(player.team) ? '毛巾已脏：去对面抹脏，或带回洗面台' : '毛巾已脏，带回洗面台'
      : stain ? '按住 J 擦拭' : station && towel.durability < C.towelDurability ? '按住 J 清洗毛巾' : smudge ? '毛巾用脏后才能抹对面' : '轻点 K 放下 · 长按 K 蓄力投掷';
    if (!input.down('KeyJ') || player.skipUse || input.down('KeyK')) { towel.washProgress = 0; return; }
    const washing = station && towel.durability < C.towelDurability;
    player.useAction = washing ? 'wash' : 'wipe';
    if (washing) {
      towel.grime = 0; // Dirty and filthier towels both wash back to clean.
      const washed = Math.min(C.towelDurability - towel.durability, C.towelDurability * dt / C.washSeconds);
      towel.durability += washed; this.tally.add(player, 'wash', washed / C.towelDurability);
      towel.tint(); towel.washProgress = towel.durabilityRatio;
      player.interactionHint = `清洗毛巾 ${Math.round(towel.washProgress * 100)}%`;
      if (towel.washProgress >= 1) towel.clean();
      return;
    }
    towel.washProgress = 0;
    if (smudge && towel.canSmudge) { this.smudge(player, towel, smudge, dt); return; }
    if (stain && !towel.dirty) {
      // Durability is spent on actual progress, including partial wipes.
      const amount = Math.min(dt * player.workSpeed / C.wipeSeconds, 1 - stain.progress, towel.durability);
      stain.progress += amount;
      towel.consume(amount); this.tally.add(player, 'work', amount);
      stain.mesh.material.opacity = 1 - stain.progress * 0.75;
      if (stain.progress >= 1 - 0.000001) {
        stain.stage++; stain.progress = 0;
        stain.done = stain.stage === stain.steps.length;
        const order = this.orders.find(entry => entry.stains.includes(stain));
        if (stain.done) { stain.mesh.visible = false; stain.cleanedAt = this.elapsed; this.tally.add(player, 'stains'); this.stainFinished(order, stain); }
        if (order.stains.every(item => item.done)) this.completeOrder(order);
      }
    }
  }

  /** Versus: a used-up towel rubs grime back onto an enemy stain. The towel gets filthier by what it undoes. */
  smudge(player, towel, { order, stain }, dt) {
    if (stain.done) { this.stainReopened(order, stain); stain.stage = stain.steps.length - 1; stain.progress = 1; }
    const amount = Math.min(dt * player.workSpeed / PVP_TUNING.smudgeSeconds, stain.progress, C.towelDurability - towel.grime);
    stain.progress -= amount; towel.smear(amount); this.tally.add(player, 'sabotage', amount);
    if (stain.progress < 0.000001) stain.progress = 0;
    stain.mesh.material.opacity = 1 - stain.progress * 0.75;
    player.interactionHint = `抹脏对面 ${Math.round((1 - stain.progress) * 100)}%`;
  }

  /** One stain reached done. Versus scores it per team; the campaign pays per whole order instead. */
  stainFinished(order, stain) {
    if (this.mode !== 'versus' || !this.active || isPreparing(this) || this.ended || this.paused) return;
    const points = stainCompleted(this, order, stain);
    if (points) this.hud.reward(points);
  }

  /** A done stain was pushed back below done (versus rework). Its points come off its team; that team's combo breaks. */
  stainReopened(order, stain) {
    if (this.mode !== 'versus' || !this.active || this.ended) return 0;
    stain.done = false; stain.mesh.visible = true; stain.cleanedAt = -100;
    return stainUndone(this, order, stain);
  }

  completeOrder(order = this.order) {
    if (!this.active || isPreparing(this) || this.ended || this.paused) return;
    this.orderSystem.complete(order);
  }

  /** The round clock: a versus match follows its frozen time limit (off = unlimited); co-op follows its level. */
  roundClock() {
    if (this.mode === 'versus') return this.matchSettings.timeLimit ? { mode: 'countdown', duration: this.matchSettings.timeLimit } : { mode: 'unlimited', duration: 0 };
    return { mode: this.level.clock?.mode || 'countdown', duration: this.level.clock?.duration ?? C.roundSeconds };
  }
  get clock() { return { ...this.roundClock(), remaining: this.remaining || 0 }; }
  get tutorial() { return this.viewOnly ? this.appliedTutorial || null : this.levelScript.presentation(); }
  get ratingProgress() { return this.viewOnly ? this.appliedRatingProgress || null : levelRatingProgress(this.level, this.score); }
  equipmentEnabled(kind) { return this.equipmentVisible && this.equipmentKeys.includes(kind); }
  /** Elephant trunks work with the water tools, and in the tutorial's L lesson before water is unlocked. The authority
   * and the trunk water view share this rule (viewers restore the script step from the snapshot). */
  trunksEnabled() { return this.equipmentEnabled('water') || (this.equipmentVisible && this.levelScript.step?.condition.type === 'skill'); }
  setEquipment(keys) { this.equipmentKeys = [...keys]; this.presentEquipment(); }
  presentEquipment() {
    this.station.visible = this.equipmentEnabled('station');
    this.soapBox.visible = this.equipmentEnabled('soap');
    this.supplyPoints.forEach(point => { point.visible = this.equipmentEnabled('water'); });
    for (const tool of this.tools) {
      tool.mesh.visible = this.equipmentEnabled(tool.kind) && tool.active !== false && !tool.swallowedBy;
    }
    this.charging.present();
    this.dummy?.present();
    this.hackConsole?.present();
  }
  leaveOrder(order) { leaveVehicle(order); }
  finish(reason) {
    if (this.ended) return;
    // Versus results compare the final team scores; they never carry co-op stars or save fields.
    this.result = this.mode === 'versus'
      ? { mode: 'versus', reason, scoreTarget: this.matchSettings.scoreTarget, teamScores: [...this.teamScores], teamCompleted: [...this.teamCompleted], teamMissed: [...this.teamMissed],
        teamCleaned: [...this.teamCleaned], teamUndone: [...this.teamUndone], teamChargeBonus: [...this.teamChargeBonus],
        ...versusOutcome(this.teamScores), partyBalance: { ...this.partyBalance }, roster: this.statsRoster() }
      : { ...evaluateLevel(this.level, this.score, reason), score: this.score, completedOrders: this.completed,
        missed: this.missed, nextLevelId: nextLevelId(this.level.id), partyBalance: { ...this.partyBalance } };
    this.ended = true; this.paused = true; this.roundStage = 'finish'; this.roundStageTime = 0;
    this.waterguns.forEach(gun => { gun.spraying = false; gun.pressure = 0; });
    this.trunks.forEach(trunk => { trunk.spraying = false; trunk.pressure = 0; trunk.sprayNodes = []; });
    this.players.forEach(player => { player.useAction = ''; player.interactionHint = ''; });
    this.onEnd?.();
  }

  /** Final record for the results: every occupied slot with its team, animal and stats (names come from each page's roster). */
  statsRoster() {
    const packed = packStats(this.stats);
    return this.players.flatMap((player, slot) => player.occupied === false ? [] : [{ slot, team: Number.isInteger(player.team) ? player.team : null,
      animal: player.baseAnimal || player.animal, bot: this.bots.some(bot => bot.slot === slot), stats: packed[slot] }]);
  }

  updateActors(dt, time, camera) {
    this.players.forEach((player) => { player.useAction = ''; });
    if ((!this.active && !this.practice) || isPreparing(this) || this.paused || this.ended) return;
    const trucks = this.activeTrucks();
    this.tally.advance(dt);
    const oldPlayerPositions = this.players.map((player) => player.pos.clone());
    // A gun nobody holds (dropped, thrown, recalled) loses its pressure at once.
    this.waterguns.forEach((gun) => { gun.spraying = false; if (!gun.holder || gun.holder.heldTool !== gun) gun.pressure = 0; });
    for (let i = 0; i < this.players.length; i++) {
      const player = this.players[i];
      if (player.occupied === false) continue;
      player.update(dt, time, this.inputs[i], trucks, camera, this.base);
    }
    // Host head stomps (Stomp.js) count as slap hits in the match record.
    this.playerContacts = resolvePlayerContacts(this.players, oldPlayerPositions, dt, null, this.random,
      (stomper, victim) => { this.tally.hit(stomper, victim, 'slaps'); this.tally.shove(stomper, victim); });
    if (this.mode === 'versus' && !this.viewOnly) this.slipperyContacts = spreadSlippery(this.players, this.slipperyContacts || 0, (by, to) => this.tally.hit(by, to, 'soaped'));
    this.charging.beginTick(dt);
    // A pelican that falls off, leaves or stops being a pelican lets its pouch drop out; passengers follow the pouch.
    for (const player of this.players) {
      if (player.swallowed && (player.state === 'fallen' || player.occupied === false || player.animal !== 'pelican')) this.spit(player, false);
    }
    // Passengers count down, struggle to shorten the stay, and break free (spat out forward) when the timer runs out.
    this.players.forEach((player, i) => {
      player.swallowCooldown = Math.max(0, (player.swallowCooldown || 0) - dt);
      if (!player.swallowedBy) return;
      this.struggle(player, this.inputs[i], dt);
      if (player.swallowRemaining <= 1e-9) this.spit(player.swallowedBy, true);
      else player.followPouch();
    });
    for (let i = 0; i < this.players.length; i++) {
      const player = this.players[i];
      // Swallowed or absent elephants close their trunk and refill.
      if (player.occupied === false || player.swallowedBy) { player.trunk.step(false, dt); continue; }
      this.pouch(player, this.inputs[i]);
      this.interact(player, this.inputs[i], dt);
      this.trunkSpray(player, this.inputs[i], dt);
      for (const order of this.orders) if (order.mode === 'working' && order.arrivalProgress === 1) {
        const side = this.orderSide(order.serial);
        const approachingSide = (player.pos.z - this.homeTruck.pos.z) * side > 0.35;
        const movingTowardOrder = this.inputs[i].axis().x * side > 0.1;
        const tryingToInteract = !!player.heldTool && !player.heldTool.dirty && !this.nearStation(player) && this.inputs[i].down('KeyJ');
        if (player.ground?.truck === order.truck || (approachingSide && (movingTowardOrder || tryingToInteract))) {
          order.framingEngaged = true;
        }
      }
    }
    this.hackConsole.update(dt);
    this.tools.forEach((tool) => {
      if (!this.equipmentEnabled(tool.kind)) return;
      if (!tool.holder && tool.truck && !tool.truck.group.visible) {
        if (tool.kind === 'water') tool.release(null, tool.truck.vel);
        else tool.placeOn(this.homeTruck, tool.originalPosition);
      }
      tool.update(dt, trucks, (item, start, end) => this.interceptItem(item, start, end));
    });
    this.soaps.forEach((soap) => {
      if (!soap.active || soap.flight || soap.holder) return;
      this.players.forEach((player, index) => {
        if (player.occupied === false || player.state !== 'ground' || player.ground?.truck !== soap.truck ||
            (soap.thrower === player && soap.ownerGrace > 0) || this.canCatch(player, this.inputs[index])) return;
        const point = soap.worldPosition(), start = oldPlayerPositions[index];
        const dx = player.pos.x - start.x, dz = player.pos.z - start.z;
        const t = THREE.MathUtils.clamp(((point.x-start.x)*dx + (point.z-start.z)*dz) / (dx*dx+dz*dz || 1), 0, 1);
        if (Math.hypot(start.x + dx*t-point.x, start.z + dz*t-point.z) < C.soapStepRadius) player.slip();
      });
    });
    if (this.equipmentEnabled('water')) this.hoses.forEach((hose) => hose.update(dt, trucks, this.players, oldPlayerPositions));
    this.charging.update(dt, oldPlayerPositions);
    this.roadSigns.update(dt, oldPlayerPositions);
    if (this.practice) return;
    this.levelScript.afterActors(dt, oldPlayerPositions);
    if (this.ended) return;
    // Checked once per tick after every payment, so two teams crossing the target together compare final scores.
    const target = this.mode === 'versus' ? this.matchSettings.scoreTarget : null;
    if (target !== null && this.teamScores.some(score => score >= target)) { this.finish('score_target'); return; }
    const unlimited = this.roundClock().mode === 'unlimited';
    this.elapsed += unlimited ? dt : Math.min(dt, this.remaining);
    if (!unlimited) {
      this.remaining = Math.max(0, this.remaining - dt);
      if (this.remaining === 0) this.finish('time_up');
    }
  }

  /** The outro clock continues after gameplay freezes; user pause freezes Ready. */
  updateRoundFlow(dt) {
    if (!this.active) return;
    if (this.roundStage === 'guide') {
      if (!this.paused && this.guide.update(dt, this.players)) { this.roundStage = 'ready'; this.roundStageTime = 0; }
    } else if (this.roundStage === 'ready' && !this.paused) {
      this.roundStageTime = Math.min(ROUND_FLOW.readySeconds, this.roundStageTime + dt);
      if (this.roundStageTime >= ROUND_FLOW.readySeconds - 1e-8) {
        this.roundStage = 'playing'; this.roundStageTime = 0;
      }
    } else if (this.roundStage === 'finish') {
      this.roundStageTime = Math.min(ROUND_FLOW.finishSeconds, this.roundStageTime + dt);
      if (this.roundStageTime >= ROUND_FLOW.finishSeconds - 1e-8) this.roundStage = 'results';
    }
  }

  afterCamera(camera) {
    if (!this.active && !this.practice) return;
    if (!this.viewOnly) for (const order of [...this.orders]) if (order.mode === 'leaving') {
      camera.updateMatrixWorld(); order.truck.group.updateWorldMatrix(true, true);
      this.viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.viewMatrix); this.box.setFromObject(order.truck.group);
      const rider = this.players.some(player => player.ground?.truck === order.truck && player.state !== 'fallen');
      if (!rider && !this.frustum.intersectsBox(this.box)) this.reclaimOrder(order);
    }
    this.hud.update(this, camera);
  }

  cameraTargets() {
    // Spawning, entering, and waiting do not change camera composition.
    // Only a docked order that a player approaches can engage dual-car framing.
    const framedOrders = this.orders.filter(order => order.mode === 'working' && order.arrivalProgress === 1 && (order.framingEngaged || this.orders.length > 1));
    const following = framedOrders.length > 0;
    const focus = new THREE.Vector3(this.homeTruck.pos.x - 0.2, 2.2, this.homeTruck.pos.z);
    if (following) {
      const otherX = framedOrders.reduce((sum, order) => sum + order.truck.pos.x, 0) / framedOrders.length;
      const otherZ = framedOrders.reduce((sum, order) => sum + order.truck.pos.z, 0) / framedOrders.length;
      const composedFocus = new THREE.Vector3(
        this.homeTruck.pos.x + (otherX - this.homeTruck.pos.x) * C.orderFocusWeight - 0.2,
        2.2, this.homeTruck.pos.z + (otherZ - this.homeTruck.pos.z) * C.orderFocusWeight);
      focus.copy(composedFocus);
    }
    const lowestRoof = Math.min(...this.activeTrucks().map((truck) => truck.topY));
    const safetyPoints = this.players.filter((player) => player.occupied !== false && player.state !== 'fallen' &&
      !(player.state === 'air' && player.vel.y <= 0 && player.pos.y < lowestRoof - 0.3))
      .flatMap((player) => [player.pos.clone(), player.pos.clone().add(new THREE.Vector3(0, 1.3, 0))]);
    const points = [...safetyPoints];
    // Whole-vehicle fitting starts only at interaction time, never at spawn.
    // The intro already frames the hero vehicle. Re-fitting its full bounds
    // with HUD padding would create another unsolicited zoom after the intro.
    const framedTrucks = following ? [this.homeTruck, ...framedOrders.map(order => order.truck)] : [];
    for (const truck of framedTrucks) {
      const { x0, x1 } = truck.spec, w = truck.halfWidth;
      for (const x of [x0, x1]) for (const z of [-w, w]) for (const y of [truck.pos.y, truck.topY + 0.45]) points.push(new THREE.Vector3(truck.pos.x + x, y, truck.pos.z + z));
    }
    return { focus, points, safetyPoints, minDistance: this.rig.gameplayOffset.length() + (following ? C.arrivalZoomOut : 0) };
  }
}
