/** Shared authoritative fixed-step world; owned by the room host's browser, including solo play. */
import * as THREE from 'three';
import { PlayerMotion } from './PlayerMotion.js';
import { TruckState } from './TruckState.js';
import { TruckDirector } from './TruckDirector.js';
import { WashSimulation } from './WashSimulation.js';
import { PAL } from './palette.js';
import { FIRST_LEVEL_ID, getLevel, levelMode } from '../levels.js';
import { matchSettings } from './versusConfig.js';
import { botLook } from './bots/BotSeats.js';
import { BotManager } from './bots/BotManager.js';
import { DEFAULT_BOT_DIFFICULTY } from './bots/BotDifficulty.js';
import { captureWorld } from '../snapshot.js';
import { EMOTES, EMOTE_SECONDS, EMOTE_COOLDOWN_SECONDS } from '../emotes.js';
import { EMPTY_INPUT, packetInput, TICK_SECONDS, INPUT_STALE_SECONDS, PAUSE_COOLDOWN_SECONDS } from '../protocol.js';
import { enqueueInput } from '../inputQueue.js';
import { ROUND_FLOW, isPreparing, isWorldFrozen } from './roundFlow.js';
import { isSharedToolResource } from './ToolModels.js';

/** `seq` is the client's 60 Hz prediction tick; unsent ticks hold the previous sample. */
export type InputPacket = { seq: number; move: number[]; axis: number[]; down: string[]; hits: string[]; struggle?: number };
const noHud = { root: { hidden: true }, lastScore: -1, lastCombo: -1, setStains() {}, reward() {}, update() {} };

/** Holds one world per room. Intro and reclamation depend on simulation time, never a viewer camera. */
export class Simulation {
  scene = new THREE.Scene();
  trucks: any[];
  players: any[];
  director: any;
  game: any;
  time = 0;
  /** Monotonic authority tick, advancing through pauses; snapshots and the client render buffer are keyed by it. */
  tickCount = 0;
  private clockTime = 0;
  scroll = 0;
  phase: 'home' | 'transition' | 'game' = 'home';
  transitionTime = 0;
  transitionStarts: THREE.Vector3[] = [];
  /** Per-slot input state, sized to the level's `home.playerSlots` in the constructor. */
  acks: number[] = [];
  ackTicks: number[] = [];
  queues: InputPacket[][] = [];
  inputs: InputPacket[] = [];
  lastInput: number[] = [];
  connected: boolean[] = [];
  /** Host-run versus bots by slot: present on the field, never network players; input comes from the bot controller. */
  botSlots = new Set<number>();
  /** Players who dropped mid-match: their character stays and a bot plays it until they return or the match ends. */
  standIns = new Set<number>();
  bots = new BotManager();
  camera = { getWorldDirection: (v: THREE.Vector3) => v.set(0,0,-1) };

  /** `mode` selects co-op or versus rules for this world; by default the level's own mode decides it. */
  constructor(readonly level = getLevel(FIRST_LEVEL_ID)!, readonly mode: 'coop' | 'versus' = levelMode(level) as 'coop' | 'versus') {
    const [a, b] = level.home.vehicles.map(({ palette, ...options }) => new TruckState(PAL[palette as keyof typeof PAL], options));
    this.scene.add(a.group, b.group);
    this.director = new TruckDirector(a,b, { motion: level.home.motion });
    this.director.update(0);
    this.players = level.home.playerSlots.map(([x,z]) => {
      const player = new PlayerMotion(this.scene);
      player.occupied = false; player.homeLocal = new THREE.Vector3(x,0,z); player.spawn(a); return player;
    });
    const rig = { followDistance: Math.hypot(8,24), gameplayOffset: new THREE.Vector3(-12,22,0), camera: { aspect: 16/9 } };
    this.game = new WashSimulation({ scene: this.scene, homeTruck: a, players: this.players, inputs: [], rig, hud: noHud, level, practiceTrucks: [a,b], mode, onEnd() {} });
    // Home-menu terminal (versus rooms): a hack sends the partner truck away (HACK_CONSOLE.md).
    this.game.practiceHack = { available: () => this.phase === 'home' && !(this.director.away > 0), fire: () => this.director.sendAway(), truck: b };
    this.game.enterPractice(this.director.base);
    this.trucks = [a,b,...this.game.orderTrucks];
    this.lastInput = this.players.map(() => 0); this.connected = this.players.map(() => false);
    this.resetInputs();
  }

  /** Number of character slots in this world; the level's home slot list decides it. */
  get slotCount() { return this.players.length; }

  /** Attach an occupant to a stable slot; a fresh occupant does not inherit the previous one's input. */
  occupy(slot: number, occupied: boolean) {
    this.connected[slot] = occupied;
    this.players[slot].connected = occupied; this.players[slot].occupied = occupied;
    this.players[slot].sceneReady = occupied;
    this.game.guide.clearSlot(slot); this.game.guide.reconcile(this.players);
    this.game.levelScript.clearSlot(slot);
    this.queues[slot] = []; this.inputs[slot] = { ...EMPTY_INPUT }; this.acks[slot] = 0;this.ackTicks[slot]=0;
    if (!occupied && this.players[slot].heldTool) this.game.drop(this.players[slot]);
    this.game.releasePouch(this.players[slot]);
    this.players[slot].emoteId = ''; this.players[slot].emoteRemaining = this.players[slot].emoteCooldown = 0;
    // Membership changes can happen while paused: close the jet without waiting for an actor tick.
    this.players[slot].trunk.reset();
    if (occupied) this.players[slot].spawn(this.trucks[0]);
  }

  isBot(slot: number) { return this.botSlots.has(slot); }
  isStandIn(slot: number) { return this.standIns.has(slot); }
  /** Every slot whose input comes from the bot controller: versus seat fill and mid-match stand-ins. */
  botControlled() { return new Set([...this.botSlots, ...this.standIns]); }
  isBotControlled(slot: number) { return this.botSlots.has(slot) || this.standIns.has(slot); }
  syncBots() { this.bots.sync(this.botControlled(), (slot: number) => this.players[slot].team); }

  /** A player dropped during a match (not on the main menu): keep the character as it is and hand it to a bot.
   * `look` keeps their name, team and appearance on every page even after the registry releases the seat. */
  standIn(slot: number, look: { name: string; appearance: any }) {
    const player = this.players[slot];
    if (this.phase === 'home' || !player?.occupied || this.isBotControlled(slot)) return false;
    this.connected[slot] = false; player.connected = false;
    this.queues[slot] = []; this.inputs[slot] = { ...EMPTY_INPUT };
    // A bot never reads a guide: the absent reader leaves the confirmation count at once.
    this.game.guide.clearSlot(slot); this.game.guide.reconcile(this.players);
    this.standIns.add(slot);
    this.game.bots.push({ slot, name: look.name, team: player.team ?? null, appearance: { ...look.appearance }, standIn: true });
    this.syncBots();
    return true;
  }

  /** The player is back: control returns in place (no respawn); the bot's queue, key edges and reservations go. */
  resume(slot: number) {
    if (!this.standIns.delete(slot)) return false;
    this.game.bots = this.game.bots.filter((bot: any) => bot.slot !== slot);
    this.connected[slot] = true; this.players[slot].connected = true; this.players[slot].sceneReady = true;
    this.queues[slot] = []; this.inputs[slot] = { ...EMPTY_INPUT }; this.lastInput[slot] = this.clockTime;
    this.game.guide.clearSlot(slot); this.game.guide.reconcile(this.players); // back as a fresh, unread reader
    this.syncBots();
    return true;
  }

  /** Versus match start: hand each planned seat to a bot. Bots are occupied but not connected, so they never count as
   * online players (votes, readiness); `game.bots` tells every page which slots they are and how they look. */
  placeBots(seats: { slot: number; team: number }[], usedColors = new Set<number>(), difficulty: string = DEFAULT_BOT_DIFFICULTY) {
    this.clearBots();
    if (this.mode !== 'versus') return;
    this.bots.setDifficulty(difficulty); // the room's AI difficulty, frozen for this match (BOTS.md §14.2)
    seats.forEach((seat, index) => {
      const look = botLook(index, usedColors);
      // Not connected on the player either: a bot never reads a guide or counts toward online readiness.
      this.occupy(seat.slot, true); this.connected[seat.slot] = false; this.players[seat.slot].connected = false;
      this.setAnimal(seat.slot, look.appearance.animal); this.setTeam(seat.slot, seat.team);
      this.botSlots.add(seat.slot);
      this.game.bots.push({ slot: seat.slot, name: look.name, team: seat.team, appearance: look.appearance });
    });
    this.syncBots();
  }

  /** Remove every bot quietly (return home, new match); their held items drop like any vacated slot. */
  clearBots() {
    // Stand-ins end with the match too; a player still reconnecting comes back through the main menu.
    for (const slot of this.botControlled()) this.occupy(slot, false);
    this.botSlots.clear(); this.standIns.clear(); this.game.bots = []; this.syncBots();
    // Back to the default between matches, so a co-op stand-in always plays at normal.
    this.bots.setDifficulty(DEFAULT_BOT_DIFFICULTY);
  }

  /** The bot controller's input for a bot slot this tick; frozen worlds hold the bots' timers and plans. */
  botInput(slot: number, frozen = false): InputPacket { return this.bots.input(this, slot, frozen ? 0 : TICK_SECONDS); }

  /** Remove physics/ownership now; viewers consume one bounded departure record for the smoke. */
  depart(slot: number) {
    // A seat beyond this world's slots (after a world with fewer slots replaced a larger one) has no actor to remove.
    const player = this.players[slot];
    if (!player?.occupied) return;
    player.departure = { serial: player.departure.serial + 1, position: player.pos.toArray(),
      visible: player.sceneReady !== false && !player.swallowedBy && player.state !== 'fallen' };
    this.occupy(slot, false); player.sceneReady = false;
    player.vel.set(0, 0, 0); player.externalVelocity.set(0, 0, 0);
    player.useAction = ''; player.interactionHint = '';
  }

  /** The roster's animal selects the slot's ability (respawn time, cleaning speed, pelican swallow, elephant trunk, squirrel speed and cling). */
  setAnimal(slot: number, animal: string) { this.players[slot].setAnimal(animal); }

  /** Freeze the room's versus settings for the next match; a running match keeps its own copy. */
  setMatchSettings(settings: unknown) { if (this.mode === 'versus' && this.phase === 'home') this.game.matchSettings = matchSettings(settings); }

  /** The roster's versus team for this slot (0 red, 1 blue); co-op worlds ignore it. */
  setTeam(slot: number, team: number | null) { this.players[slot].team = this.mode === 'versus' && (team === 0 || team === 1) ? team : null; }

  confirmGuide(slot: number, id: string, pageIndex = 0) {
    if (this.phase !== 'game' || this.game.roundStage !== 'guide' || !this.connected[slot]) return false;
    this.game.guide.reconcile(this.players);
    return this.game.guide.confirm(slot, id, pageIndex);
  }

  /** Connected, occupied character slots: the real players who count toward a versus resume majority. */
  onlineSlots() { return this.players.map((_, slot) => slot).filter((slot) => this.connected[slot] && this.players[slot].occupied); }

  /** An emote from a link-bound slot, this page's own, or a bot-controlled slot: any phase, frozen or not; at most one per cooldown. */
  emote(slot: number, id: string) {
    const player = this.players[slot];
    if (!player?.occupied || (!this.connected[slot] && !this.isBotControlled(slot)) || !EMOTES.includes(id) || player.emoteCooldown > 0) return false;
    player.emoteId = id; player.emoteSerial++; player.emoteRemaining = EMOTE_SECONDS; player.emoteCooldown = EMOTE_COOLDOWN_SECONDS;
    return true;
  }

  /** Versus: any connected player freezes the match at once, unless a pause holds or their cooldown runs. */
  requestPause(slot: number) {
    const g = this.game;
    if (this.mode !== 'versus' || this.phase !== 'game' || !g.active || g.ended || g.pauseVote || !this.connected[slot] || (g.pauseCooldowns[slot] || 0) > 0) return false;
    g.paused = true; g.pauseVote = { by: slot, votes: [], voters: this.onlineSlots() };
    return true;
  }

  /** Versus: one resume vote per connected player; more than half of the online players resumes the match. */
  voteResume(slot: number) {
    const vote = this.game.pauseVote;
    if (!vote || !this.connected[slot] || vote.votes.includes(slot)) return false;
    vote.votes = [...vote.votes, slot]; this.settlePauseVote();
    return true;
  }

  /** Recount against who is online now: departed players' votes lapse and a smaller room may already be past half. */
  settlePauseVote() {
    const g = this.game, vote = g.pauseVote;
    if (!vote) return;
    const voters = this.onlineSlots(), votes = vote.votes.filter((slot: number) => voters.includes(slot));
    if (voters.join() !== vote.voters.join() || votes.length !== vote.votes.length) g.pauseVote = { by: vote.by, votes, voters };
    if (votes.length > Math.floor(voters.length / 2)) { g.paused = false; g.pauseVote = null; g.pauseCooldowns[vote.by] = PAUSE_COOLDOWN_SECONDS; }
  }

  /** Keep action edges ordered; replace waiting motion samples so network jitter cannot leave permanent input lag. */
  input(slot: number, packet: InputPacket) {
    if (!(slot >= 0 && slot < this.slotCount)) return;
    if (packet.seq <= this.acks[slot] || packet.seq <= (this.queues[slot].at(-1)?.seq || 0)) return;
    if (enqueueInput(this.queues[slot], packet)) this.lastInput[slot] = this.clockTime;
  }

  /** A new room epoch cannot inherit held controls or a prediction timeline from the preceding scene. */
  resetInputs() {
    this.acks=this.players.map(()=>0);this.ackTicks=this.players.map(()=>0);this.queues=this.players.map(()=>[]);
    this.inputs=this.players.map(()=>({...EMPTY_INPUT}));
  }

  /** Begin or return a whole room together. Only the room service may authorize this command. */
  command(command: 'start' | 'home' | 'pause', paused = false) {
    if (command === 'start' && this.phase === 'home') {
      this.phase = 'transition'; this.transitionTime = 0;
      this.game.leavePractice();
      this.transitionStarts = this.players.map((p) => p.pos.clone());
      this.game.homeX = this.trucks[0].pos.x; this.game.homeZ = this.level.home.motion.centerHome ? 0 : this.trucks[0].pos.z;
    } else if (command === 'home') {
      this.clearBots();
      this.game.stop(); this.phase = 'home'; this.trucks[1].group.visible = true;
      this.director.update(0); this.players.forEach((p) => p.spawn(this.trucks[0]));
      this.game.enterPractice(this.director.base);
      this.queues = this.players.map(() => []); this.inputs = this.inputs.map(() => ({ ...EMPTY_INPUT }));
    // Versus pauses only through requests and votes; the host's own menu does not freeze the match.
    } else if (command === 'pause' && this.phase === 'game' && !this.game.ended && this.mode !== 'versus') this.game.paused = paused;
  }

  /** Advance exactly one authoritative tick, then expose a serializable snapshot. */
  tick() {
    const dt = TICK_SECONDS;
    this.clockTime += dt; this.tickCount++;
    const paused = this.game.active && isWorldFrozen(this.game);
    if (!paused) this.time += dt;
    // Emote bubbles run on the room clock, so a paused world does not hold them on screen.
    for (const player of this.players) {
      player.emoteCooldown = player.emoteCooldown - dt < 1e-9 ? 0 : player.emoteCooldown - dt;
      if (player.emoteRemaining > 0 && (player.emoteRemaining = player.emoteRemaining - dt) < 1e-9) { player.emoteRemaining = 0; player.emoteId = ''; }
    }
    if (this.game.pauseVote) this.settlePauseVote();
    else if (!paused) for (let slot = 0; slot < this.game.pauseCooldowns.length; slot++) this.game.pauseCooldowns[slot] = Math.max(0, this.game.pauseCooldowns[slot] - dt);
    const frameInputs = this.players.map((_, i) => {
      const next = this.queues[i].shift();
      if (next) { this.inputs[i] = next; this.acks[i] = next.seq;this.ackTicks[i]=next.seq; }
      else { if(this.inputs[i].seq>0)this.ackTicks[i]++;this.inputs[i] = { ...this.inputs[i], hits: [], struggle: undefined }; }
      if (!this.connected[i] || this.clockTime - this.lastInput[i] > INPUT_STALE_SECONDS) this.inputs[i] = { ...EMPTY_INPUT };
      return packetInput(this.inputs[i]);
    });
    for (const slot of this.botControlled()) {
      this.inputs[slot] = this.botInput(slot, paused || this.phase !== 'game'); frameInputs[slot] = packetInput(this.inputs[slot]);
      const emote = this.bots.takeEmote(slot); if (emote) this.emote(slot, emote);
    }
    this.game.inputs = frameInputs;
    if (this.phase === 'home') this.director.update(dt);
    else if (this.phase === 'transition') {
      this.transitionTime += dt;
      const a = this.trucks[0], b = this.trucks[1];
      a.setState(this.game.homeX,this.game.homeZ,0,0,this.director.base);
      b.setState(b.pos.x + Math.min(22, this.transitionTime * 12) * dt,b.pos.z,22,0,this.director.base);
      const progress = Math.min(1,this.transitionTime / 0.75), ease = progress * progress * (3 - 2 * progress);
      this.players.forEach((p,i) => {
        if (!p.occupied) return;
        const [sx, sz] = this.level.home.playerSlots[i];
        const target = new THREE.Vector3(a.pos.x + sx,a.topYAt(a.pos.x + sx,a.pos.z + sz),a.pos.z + sz);
        p.pos.copy(this.transitionStarts[i]).lerp(target,ease); p.pos.y += Math.sin(Math.PI * progress)*1.9;
        p.state = progress === 1 ? 'ground' : 'returning'; p.ground = progress === 1 ? { truck:a,plat:a.platformAt(p.pos.x,p.pos.z,0.3) } : null;
        p.vel.set(0,0,0); p.animate(dt,this.time,new THREE.Vector3());
      });
      if (this.transitionTime >= 3.6) { b.group.visible = false; this.phase = 'game'; this.game.start(this.director.base, true); }
    } else {
      const preparing = isPreparing(this.game);
      this.game.updateRoundFlow(dt);
      if (preparing) {
        // Drain Ready controls without resetting sequence acknowledgements; Go starts with fresh input.
        this.queues = this.players.map(() => []);
        this.inputs = this.inputs.map(input => ({ ...input, move: [0,0], axis: [0,0], down: [], hits: [], struggle: undefined }));
        this.game.inputs = this.inputs.map(packetInput);
      }
      this.game.updateFleet(dt);
    }
    const base = this.game.active ? this.game.base : this.director.base;
    if (!paused) this.scroll += base * dt;
    this.trucks.forEach((t) => t.update(paused ? 0 : dt,this.time));
    if (this.phase === 'home') {
      this.game.base = base; this.scene.updateMatrixWorld(true);
      this.game.updateActors(dt,this.time,this.camera);
    }
    if (this.phase === 'game') {
      this.scene.updateMatrixWorld(true);
      this.game.updateActors(dt,this.time,this.camera);
      // A departed vehicle is reclaimed by distance on the authority, not by each client's frustum.
      for (const order of [...this.game.orders]) if (order.mode === 'leaving' && order.truck.pos.x - this.game.homeX > 38) this.game.reclaimOrder(order);
    }
  }

  /** Discrete state a viewer should see without waiting for the next periodic snapshot: ownership, throws,
   *  cleaning steps, orders and score, and shoves/slips that correct a predicting player. */
  urgentSignature() {
    const g = this.game, items = [...g.towels, ...g.waterguns, ...g.soaps, ...g.chargers];
    return [this.phase, g.paused, g.ended, g.roundStage, g.playerContacts || 0, Object.values(g.partyBalance).join(':'), g.guide.id, g.guide.pageIndex, g.guide.participants, g.guide.ready, g.levelScript.signature(), g.equipmentKeys.join(','), g.roundStage === 'ready' ? Math.ceil(ROUND_FLOW.readySeconds - g.roundStageTime) : '', g.score, g.completed, g.missed, g.bots.map((bot: any) => `${bot.slot}${bot.standIn ? 's' : ''}`).join('.'), g.pauseVote ? `${g.pauseVote.by}:${g.pauseVote.votes.join('.')}:${g.pauseVote.voters.join('.')}` : '', g.teamScores.join(':'), g.teamCombos.join(':'), g.teamCompleted.join(':'), g.teamMissed.join(':'), g.lane?.serial,
      g.order?.serial, g.order?.type, g.order?.mode, g.order?.paid,
      g.orders.map((order: any) => `${order.serial}:${order.mode}:${order.paid}:${order.stains.map((s: any) => s.stage + (s.done ? "d" : "")).join("")}`).join(","),
      g.lanes.map((lane: any) => lane.serial).join(","), g.waveIndex, g.roadSigns.signature(),
      g.chargers.map((head: any) => `${head.connectedSerial}:${head.groundedRoad}`).join(','), `${g.dummy.active}:${g.dummy.hitSerial}`, `${g.hackConsole.slot}:${g.hackConsole.serial}:${g.hackConsole.cooldown > 0 ? 1 : 0}`, g.wet.liveRevision, g.wet.dryRevision, g.charging.blast.id,
      g.orders.map((order: any) => `${order.serial}:${order.generation}:${order.team}:${order.behaviorId}:${order.charged}:${order.rewardMultiplier}`).join(','),
      g.order?.stains.map((s: any) => `${s.stage}${s.done ? 'd' : ''}`).join(''),
      items.map((t: any) => `${this.players.indexOf(t.holder)}:${this.trucks.indexOf(t.truck)}:${t.flight ? 1 : 0}:${t.active === false ? 0 : 1}:${t.generation ?? 0}:${this.players.indexOf(t.swallowedBy)}:${t.returnSerial || 0}`).join(','),
      this.players.map((p: any) => `${p.occupied}:${p.sceneReady}:${p.departure.serial}:${p.state === 'fallen' ? 1 : 0}${p.externalVelocity.lengthSq() > 0 ? 1 : 0}${(p.slipRemaining || 0) > 0 ? 1 : 0}${(p.stunRemaining || 0) > 0 ? 1 : 0}${(p.downRemaining || 0) > 0 ? 1 : 0}${(p.slipperyRemaining || 0) > 0 ? 1 : 0}${this.players.indexOf(p.swallowedBy)}${p.wall ? 1 : 0}:${p.emoteSerial}:${p.slapSerial}:${p.slappedSerial}:${p.knockoutSerial || 0}:${p.stompSerial || 0}:${p.morph}:${p.state === 'ground' ? `${p.ground?.solid ?? -1}.${p.ground?.stand ?? -1}` : ''}`).join(''),
      // Elephant trunks: the jet opening/closing and running dry show immediately.
      g.trunks.map((t: any) => `${t.spraying ? 1 : 0}${t.empty ? 1 : 0}`).join('')].join('|');
  }

  snapshot() { return { tick:this.tickCount, director:this.director.captureState(), ...captureWorld({ game:this.game,trucks:this.trucks,players:this.players,phase:this.phase,time:this.time,scroll:this.scroll,acks:this.acks,ackTicks:this.ackTicks }) }; }

  /** Release room-owned scene resources when a room closes. */
  dispose() {
    this.game.levelScript.reset();
    const resources = new Set<any>();
    this.scene.traverse((o: any) => {
      if (o.geometry) resources.add(o.geometry);
      if (o.material) for (const material of Array.isArray(o.material) ? o.material : [o.material]) resources.add(material);
    });
    // A room borrows cached tool geometry/palettes also used by the live client.
    // Their GPU allocations belong to the rendering context, not this authority.
    for (const resource of resources) if (!isSharedToolResource(resource)) resource.dispose();
    this.scene.clear();
  }
}
