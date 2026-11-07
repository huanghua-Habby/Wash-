/** Snapshot adapters. Entity ids and platform-local coordinates are independent of render objects. */
import * as THREE from 'three';
import { captureWall, restoreWall } from './sim/WallCling.js';
import { packStats, unpackStats } from './sim/PlayerStats.js';
export const vec = (v) => [v.x, v.y, v.z];
export const setVec = (v, a) => v.set(...a);

/** Capture motion state, including moving-platform parent and inputs acknowledged by the host authority.
 * `parent` is the carrying vehicle: the roof a player stands on or the hull a squirrel clings to (`wall`). */
export function capturePlayer(player, trucks, ack = 0) {
  const parent = player.carrierTruck ?? player.ground?.truck;
  return { occupied: player.occupied !== false, sceneReady: player.sceneReady !== false,
    departure: { ...player.departure, position: [...player.departure.position] },
    pos: vec(player.pos), vel: vec(player.vel), airBase: [player.airBase.x, player.airBase.y],
    state: player.state, parent: parent ? trucks.indexOf(parent) : -1,
    local: parent ? vec(player.pos.clone().sub(parent.pos)) : null,
    takeoff: trucks.indexOf(player.takeoff), yaw: player.yaw, sq: player.sq, sqV: player.sqV, walk: player.walk,
    coyote: player.coyote, jumpBuf: player.jumpBuf, fallTimer: player.fallTimer, deathCause: player.deathCause,
    roadSignAttachment: player.roadSignAttachment ? { id: player.roadSignAttachment.id, offset: [...player.roadSignAttachment.offset] } : null,
    dashDirection: vec(player.dashDirection), dashRemaining: player.dashRemaining, dashCooldown: player.dashCooldown,
    jumpBoost: player.jumpBoost, lean: [player.lean.rotation.x, player.lean.rotation.y, player.lean.rotation.z], ack,
    held: player.heldTowel?.index ?? null, heldTool: player.heldTool?.id ?? null, externalVelocity: vec(player.externalVelocity),
    hint: player.interactionHint || '', throwWasDown: !!player.throwWasDown, skipUse: !!player.skipUse, throwCancelled: !!player.throwCancelled, slipRemaining: player.slipRemaining || 0, slipCooldown: player.slipCooldown || 0, stunRemaining: player.stunRemaining || 0, down: player.downRemaining || 0, guard: player.guardRemaining || 0, hits: [player.downSerial || 0, player.stompSerial || 0, player.stompedSerial || 0], slippery: player.slipperyRemaining || 0, slipperyImmunity: player.slipperyImmunity || 0, ice: vec(player.iceVelocity), catchRemaining: player.catchRemaining || 0, swallowRemaining: player.swallowRemaining || 0, swallowCooldown: player.swallowCooldown || 0, glideRemaining: player.glideRemaining ?? 0, gliding: !!player.gliding, flaps: player.flapsRemaining || 0, flapSerial: player.flapSerial || 0, use: player.useAction || '',
    wall: player.state === 'air' ? captureWall(player.wall, trucks) : null, wallTime: player.wallTime || 0, wallLock: player.wallLock || 0,
    emote: [player.emoteId || '', player.emoteSerial || 0, player.emoteRemaining || 0], emoteCooldown: player.emoteCooldown || 0,
    slap: [player.slapCooldown || 0, player.slapSerial || 0, player.slappedSerial || 0, player.slapArmed === false ? 0 : 1],
    ko: [player.knockoutSerial || 0, player.knockoutVictim ?? -1],
    morph: [player.morph || '', player.morphSerial || 0],
    solid: player.state === 'ground' && player.ground?.solid >= 0 ? player.ground.solid : -1,
    stand: player.state === 'ground' && player.ground?.stand >= 0 ? player.ground.stand : -1,
    standOffset: player.state === 'ground' && player.ground?.stand >= 0 ? [player.ground.offset.x, player.ground.offset.z] : null };
}

/** Restore authoritative motion, using the current platform transform for grounded actors. */
export function applyPlayer(player, data, trucks) {
  player.occupied = data.occupied !== false;
  player.departure = { ...data.departure, position: [...data.departure.position] };
  player.sceneReady = data.sceneReady !== false;
  player.root.visible = player.occupied !== false && player.sceneReady &&
    !(data.state === 'fallen' && data.deathCause === 'road-sign' && !data.roadSignAttachment);
  setVec(player.pos, data.pos); setVec(player.vel, data.vel); player.airBase.set(...data.airBase);
  // A guest receives prediction-only fields (shared/wire.js OWN_ONLY) for its own character only; others keep zeros.
  for (const key of ['state','yaw','sq','sqV','walk','coyote','jumpBuf','fallTimer','dashRemaining','dashCooldown','jumpBoost','throwWasDown','skipUse','throwCancelled','slipRemaining','slipCooldown','catchRemaining']) player[key] = data[key] ?? (typeof player[key] === 'boolean' ? false : 0);
  player.swallowRemaining = data.swallowRemaining || 0;
  player.swallowCooldown = data.swallowCooldown || 0; player.glideRemaining = data.glideRemaining ?? 0; player.gliding = !!data.gliding; player.flapsRemaining = data.flaps || 0; player.flapSerial = data.flapSerial || 0;
  // Hits (WOBBLE.md): shock stun, knockdown and guard timers plus presentation serials; the wobble value stays on the host.
  player.stunRemaining = data.stunRemaining || 0; player.downRemaining = data.down || 0; player.guardRemaining = data.guard || 0;
  [player.downSerial, player.stompSerial, player.stompedSerial] = data.hits || [0, 0, 0];
  player.wall = data.state === 'air' ? restoreWall(data.wall, trucks) : null; player.wallTime = data.wallTime || 0; player.wallLock = data.wallLock || 0;
  player.slipperyRemaining = data.slippery || 0; player.slipperyImmunity = data.slipperyImmunity || 0;
  if (data.ice) setVec(player.iceVelocity, data.ice);
  player.useAction = data.use || '';
  [player.emoteId, player.emoteSerial, player.emoteRemaining] = data.emote || ['', 0, 0]; player.emoteCooldown = data.emoteCooldown || 0;
  const slapState = data.slap || [0, 0, 0, 1];
  [player.slapCooldown, player.slapSerial, player.slappedSerial] = slapState; player.slapArmed = slapState[3] !== 0;
  [player.knockoutSerial, player.knockoutVictim] = data.ko || [0, -1];
  // A lent body (tutorial L lesson): swap first, then take the authority's swap count so the poof plays once.
  const [morph = '', morphSerial = 0] = data.morph || [];
  if (morph !== (player.morph || '')) player.setMorph(morph);
  player.morphSerial = morphSerial;
  player.deathCause = data.deathCause;
  player.roadSignAttachment = data.roadSignAttachment ? { id: data.roadSignAttachment.id, offset: [...data.roadSignAttachment.offset] } : null;
  setVec(player.dashDirection, data.dashDirection);
  setVec(player.externalVelocity, data.externalVelocity);
  const parent = trucks[data.parent];
  if (parent && data.local) player.pos.copy(parent.pos).add(setVec(player.pos.clone(), data.local));
  player.ground = parent && !player.wall ? { truck: parent, plat: parent.platformAt(player.pos.x, player.pos.z, 0.3) || parent.platforms[0],
    solid: data.solid ?? -1, stand: data.stand ?? -1, offset: data.standOffset ? { x: data.standOffset[0], z: data.standOffset[1] } : { x: 0, z: 0 } } : null;
  player.takeoff = trucks[data.takeoff] || null;
  player.lean.rotation.set(...data.lean); player.root.position.copy(player.pos); player.yawG.rotation.y = player.yaw;
  player.interactionHint = data.hint ?? '';
}

/** Capture a scene without geometry, materials or browser-dependent camera state. */
export function captureWorld({ game, trucks, players, phase, time, scroll, acks, ackTicks }) {
  return { phase, time, scroll, base: game.active ? game.base : trucks[0].speed - trucks[0].vel.x,
    trucks: trucks.map((truck) => ({ pos: vec(truck.pos), vel: vec(truck.vel), rotation: [truck.group.rotation.x,truck.group.rotation.y,truck.group.rotation.z], visible: truck.group.visible, speed: truck.speed, instanceId: truck.instanceId || null, generation: truck.generation || 0 })),
    players: players.map((player, i) => ({...capturePlayer(player, trucks, acks?.[i] || 0),ackTick:ackTicks?.[i] ?? acks?.[i] ?? 0,swallowedBy:players.indexOf(player.swallowedBy)})),
    game: { clock: game.clock, tutorial: game.tutorial, ratingProgress: game.ratingProgress, result: game.result, partyBalance: { ...game.partyBalance }, equipmentKeys: [...game.equipmentKeys], scriptState: game.levelScript.capture(), active: game.active, roundStage: game.roundStage, roundStageTime: game.roundStageTime, guide: game.guide.capture(), practice: !!game.practice, paused: game.paused, ended: !!game.ended, remaining: game.remaining || 0, elapsed: game.elapsed || 0, score: game.score || 0,
      combo: game.combo || 0, completed: game.completed || 0, missed: game.missed || 0, mode: game.mode || 'coop', matchSettings: { ...game.matchSettings },
      bots: game.bots.map(bot => ({ ...bot, appearance: { ...bot.appearance } })),
      pauseVote: game.pauseVote ? { by: game.pauseVote.by, votes: [...game.pauseVote.votes], voters: [...game.pauseVote.voters] } : null, pauseCooldowns: [...game.pauseCooldowns],
      teamScores: [...game.teamScores], teamCombos: [...game.teamCombos], teamCompleted: [...game.teamCompleted], teamMissed: [...game.teamMissed],
      teamCleaned: [...game.teamCleaned], teamUndone: [...game.teamUndone], teamChargeBonus: [...game.teamChargeBonus], stats: packStats(game.stats), dummy: game.dummy.capture(), hack: game.hackConsole.capture(), homeX: game.homeX || 0, homeZ: game.homeZ || 0, base: game.base || 30,
      waveIndex: game.waveIndex || 0, orders: game.orders.map(captureOrder), lanes: game.lanes.map(lane => ({ ...lane })),
      orderSerial: game.orderSerial || 0, lane: game.lane ? { ...game.lane } : null,
      order: game.order ? captureOrder(game.order) : null,
      waterguns: game.waterguns.map((gun) => ({ ...captureItem(gun, players, trucks), spraying: !!gun.spraying, pressure: gun.pressure || 0, sprayTarget: vec(gun.sprayTarget), sprayNodes: gun.sprayNodes.map(vec) })),
      hoses: game.hoses.map((hose) => ({ nodes: hose.nodes.map(vec), tension: hose.tension, taut: hose.taut })),
      trunks: game.trunks.map((trunk) => ({ water: trunk.water, empty: trunk.empty, refillDelay: trunk.refillDelay, spraying: trunk.spraying, pressure: trunk.pressure,
        sprayTime: trunk.sprayTime, sprayTarget: vec(trunk.sprayTarget), sprayNodes: trunk.sprayNodes.map(vec) })),
      soaps: game.soaps.map((soap) => ({ ...captureItem(soap, players, trucks), active: soap.active, generation: soap.generation, durability: soap.durability })),
      chargers: game.chargers.map(head => ({ ...captureItem(head, players, trucks), connectedSerial: head.connectedSerial, groundedRoad: head.groundedRoad })),
      wet: game.wet.capture(), blast: { ...game.charging.blast, at: [...game.charging.blast.at] }, roadSigns: game.roadSigns.capture(),
      towels: game.towels.map((towel) => ({ ...captureItem(towel, players, trucks), durability: towel.durability, grime: towel.grime || 0 })) } };

}

function captureOrder(order) {
  return { id: order.id, serial: order.serial, type: order.type, vehicleSlot: order.vehicleSlot, generation: order.generation,
    side: order.side, team: order.team ?? null, definition: structuredClone(order.definition), behaviorId: order.behaviorId, behaviorState: structuredClone(order.behaviorState), initialPatience: order.initialPatience,
    rewardMultiplier: order.rewardMultiplier, chargeRequired: order.chargeRequired, age: order.age, dockAge: order.dockAge,
    mode: order.mode, remaining: Number.isFinite(order.remaining) ? order.remaining : null, paid: order.paid, chargeProgress: order.chargeProgress, charged: order.charged,
    arrivalProgress: order.arrivalProgress, framingEngaged: order.framingEngaged, leaveSpeed: order.leaveSpeed, leaveAge: order.leaveAge || 0,
    stains: order.stains.map(({ steps, stage, progress, done, cleanedAt, points }) => ({ steps, stage, progress, done, cleanedAt, points: points || 0 })) };
}

function captureItem(tool, players, trucks) {
  return { id: tool.id, holder: players.indexOf(tool.holder), truck: trucks.indexOf(tool.truck), pos: vec(tool.mesh.position),
    rotation: [tool.mesh.rotation.x,tool.mesh.rotation.y,tool.mesh.rotation.z], velocity: vec(tool.velocity), origin: vec(tool.origin),
    thrower: players.indexOf(tool.thrower), swallowedBy: players.indexOf(tool.swallowedBy), ownerGrace: tool.ownerGrace || 0, flight: !!tool.flight,
    returnSerial: tool.returnSerial || 0, returnFrom: vec(tool.returnFrom), returnAge: tool.returnAge || 0, floorTime: tool.floorTime || 0, washProgress: tool.washProgress, charge: tool.charge };
}

/** Apply host-owned wash interactions; clients cannot award points or claim towel ownership. */
export function applyWorld({ game, trucks, players }, data) {
  if (data.game.active && !game.active) game.start(data.game.base);
  if (!data.game.active && game.active) game.stop();
  if (data.game.practice && !game.practice) game.enterPractice(data.base);
  if (!data.game.practice && game.practice) game.leavePractice();
  // `order`/`orders` are rebuilt below from the incoming list. They must not be assigned here: the legacy `order`
  // setter replaces `orders` with a one-element array, which dropped the second truck and re-spawned its stains
  // (and every stain badge) on every snapshot.
  const { clock, tutorial, ratingProgress, scriptState, stats, dummy, hack, order: _order, orders: _orders, ...gameState } = data.game;
  game.stats = unpackStats(stats, players.length);
  game.appliedRatingProgress = structuredClone(ratingProgress);
  game.partyBalance = Object.freeze({ ...data.game.partyBalance });
  game.levelScript.preparePartyLayouts();
  game.appliedTutorial = structuredClone(tutorial);
  game.levelScript.restore(scriptState);
  Object.assign(game, { ...gameState, partyBalance: game.partyBalance, guide: game.guide, roundStage: data.game.roundStage ?? (data.game.ended ? 'results' : data.game.active ? 'playing' : 'idle'), roundStageTime: data.game.roundStageTime ?? 0, waveIndex: data.game.waveIndex ?? 0, lanes: game.lanes, towels: game.towels, waterguns: game.waterguns, hoses: game.hoses, trunks: game.trunks, soaps: game.soaps, chargers: game.chargers, cables: game.cables, wet: game.wet, roadSigns: game.roadSigns });
  delete game.blast; // Charging owns the authoritative event record.
  game.guide.apply(data.game.guide);
  game.equipmentVisible = data.game.active || data.game.practice || data.phase === 'transition';
  game.station.visible = game.equipmentVisible; game.soapBox.visible = game.equipmentVisible && game.equipment.soap.enabled;
  game.supplyPoints.forEach((point) => { point.visible = game.equipmentVisible; });
  game.hackConsole.apply(hack);
  const incoming = data.game.orders || (data.game.order ? [data.game.order] : []);
  for (const order of [...game.orders]) if (!incoming.some(entry => entry.serial === order.serial)) game.clearStains(order);
  for (const entry of incoming) {
    const stale = game.orders.find(order => order.serial === entry.serial && order.generation !== entry.generation);
    if (stale) game.clearStains(stale);
    const order = game.orders.find(order => order.serial === entry.serial) || game.spawnOrder(entry.serial, entry);
    if (!order) throw new Error('Snapshot orders exceed the prepared side/vehicle capacity');
    Object.assign(order, { ...entry, truck: order.truck, stains: order.stains, remaining: entry.remaining ?? Infinity });
    order.truck.departing = order.mode === 'leaving';
    game.syncOrderCargo(order);
    order.stains.forEach((stain, i) => {
      Object.assign(stain, entry.stains[i]); stain.mesh.visible = !stain.done; stain.mesh.material.opacity = 1 - stain.progress * 0.75;
      stain.mesh.material.color.set(stain.steps[0] === 'water' && stain.stage > 0 ? '#9b8063' : '#756141');
    });
  }
  game.lanes = (data.game.lanes || (data.game.lane ? [data.game.lane] : [])).map(lane => ({ ...lane }));
  game.orderSerial = data.game.orderSerial;
  data.trucks.forEach((state, i) => {
    const truck = trucks[i]; setVec(truck.pos, state.pos); setVec(truck.vel, state.vel);
    truck.group.rotation.set(...state.rotation); truck.pose(data.time);
    truck.group.visible = state.visible; truck.speed = state.speed; truck.generation = state.generation;
  });
  data.game.soaps.forEach((_, index) => game.ensureSoap(index));
  // A new authority can have a smaller pool than this prepared client view.
  // Clear obsolete ownership before rebuilding the incoming pouch relationships.
  for (let i = data.game.soaps.length; i < game.soaps.length; i++) {
    const soap = game.soaps[i];
    if (soap.active || soap.holder || soap.swallowedBy) soap.reset();
  }
  players.forEach((player) => { player.heldTool = null; player.swallowed = null; });
  // Pelican pouches: a swallowed teammate or tool belongs to the pelican named by the authority.
  players.forEach((player, i) => {
    const owner = players[data.players[i]?.swallowedBy] || null;
    player.swallowedBy = owner; if (owner) owner.swallowed = player;
  });
  const toolsById = new Map(game.tools.map(tool => [tool.id, tool]));
  [...data.game.towels, ...data.game.waterguns, ...data.game.soaps, ...data.game.chargers].forEach(state => {
    const towel = toolsById.get(state.id);
    if (!towel) throw new Error('Snapshot tool identity is not registered in this world');
    const pouch = players[state.swallowedBy] || null;
    const parent = players[state.holder]?.yawG || pouch?.yawG || trucks[state.truck]?.body || game.scene;
    parent.add(towel.mesh); towel.holder = players[state.holder] || null; towel.truck = trucks[state.truck] || null;
    if (towel.holder) towel.holder.heldTool = towel;
    towel.swallowedBy = pouch; if (pouch) pouch.swallowed = towel;
    setVec(towel.mesh.position, state.pos); towel.mesh.rotation.set(...state.rotation);
    setVec(towel.velocity, state.velocity); setVec(towel.origin, state.origin);
    for (const key of ['flight','floorTime','washProgress','charge','ownerGrace']) towel[key] = state[key];
    towel.returnSerial = state.returnSerial || 0; towel.returnAge = state.returnAge ?? 10; if (state.returnFrom) setVec(towel.returnFrom, state.returnFrom);
    towel.thrower = players[state.thrower] || null;
    if (towel.kind === 'soap') { towel.active = state.active; towel.generation = state.generation; }
    if (towel.kind === 'charger') { towel.connectedSerial = state.connectedSerial; towel.groundedRoad = state.groundedRoad; }
    else if (towel.kind !== 'water') { towel.durability = state.durability; if (towel.kind === 'towel') towel.grime = state.grime ?? 0; towel.tint(); }
    else {
      towel.spraying = state.spraying; towel.pressure = state.pressure ?? 0; setVec(towel.sprayTarget, state.sprayTarget);
      towel.sprayNodes = state.sprayNodes.map((node) => setVec(towel.mesh.position.clone(), node));
    }
    towel.mesh.visible = game.equipmentVisible && towel.active !== false && !pouch;
  });
  data.game.hoses.forEach((state, i) => {
    const hose = game.hoses[i];
    state.nodes.forEach((node, j) => setVec(hose.nodes[j], node));
    hose.tension = state.tension; hose.taut = state.taut; hose.initialized = game.equipmentVisible;
  });
  data.game.trunks.forEach((state, i) => {
    const trunk = game.trunks[i];
    for (const key of ['water', 'empty', 'refillDelay', 'spraying', 'sprayTime', 'pressure']) trunk[key] = state[key];
    setVec(trunk.sprayTarget, state.sprayTarget);
    trunk.sprayNodes = state.sprayNodes.map((node) => setVec(new THREE.Vector3(), node));
  });
  game.wet.apply(data.game.wet);
  game.charging.blast = data.game.blast ? { ...data.game.blast, at: [...data.game.blast.at] } : { id: 0, tick: 0, at: [0, 0, 0] };
  game.roadSigns.apply(data.game.roadSigns);
  game.dummy.apply(dummy);
  game.presentEquipment();
}
