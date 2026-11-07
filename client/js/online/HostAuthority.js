/** The room owner's browser runs the one authoritative world (shared RoomSimulation) for itself and up to three guests.
 * Guests are bound to the slot the registry assigned; they send inputs only. With no guests connected, nothing is sent. */
import { Simulation } from '../../../shared/sim/RoomSimulation.ts';
import { getLevel, FIRST_LEVEL_ID, SAVE_VERSION, levelMode, firstLevelFor } from '../../../shared/levels.js';
import { cleanAvatar } from '../../../shared/avatar.js';
import { planBotSeats } from '../../../shared/sim/bots/BotSeats.js';
import { versusStartCheck, validPauseControl, normalizeVersusSettings, GAME_VERSION, TICK_SECONDS, SNAPSHOT_SECONDS, STATE_CHANNEL, CONTROL_CHANNEL, STATE_BACKLOG_BYTES, GUEST_RECOVERY_SECONDS, validGuestInput, validGuideReady, validRejoinDecision } from '../../../shared/protocol.js';
import { quantize, SnapshotEncoder } from '../../../shared/delta.js';
import { guestView } from '../../../shared/wire.js';
import { validEmote } from '../../../shared/emotes.js';
import { PeerLink } from './PeerLink.js';

const SNAPSHOT_TICKS = Math.round(SNAPSHOT_SECONDS / TICK_SECONDS);
/** Local presentation snapshots never touch the network; every third tick matches the previous solo cadence. */
const LOCAL_SNAPSHOT_TICKS = 3;
const RECEIPTS = 128;

export class HostAuthority {
  /** `emit(type, detail)` reaches the page (snapshot, round_started, round_result, message, state, host_phase, peers);
   *  `signal(to, data)` relays to a guest through the room service. `createLink` is replaceable for tests. */
  constructor({ emit, signal, iceServers = [], voice = null, createLink = (options) => new PeerLink(options), now = () => performance.now() / 1000,
    createSimulation = (level) => new Simulation(level) }) {
    Object.assign(this, { emit, signal, iceServers, voice, createLink, createSimulation }); this.now = now;
    this.levelId = FIRST_LEVEL_ID; this.sim = createSimulation(getLevel(this.levelId));
    this.epoch = 1; this.roundId = null; this.settled = false; this.ticks = 0;
    this.roster = null; this.known = new Set(); this.guests = new Map(); this.reportedPhase = null;
    this.signature = ''; this.sinceState = 0; this.receipts = new Map();
    this.homeWaiting = new Set();
    this.recoveries = new Map(); this.released = new Map();
  }

  get slot() { return this.roster?.slot ?? 0; }
  /** Guests with an open direct link; the mode is multiplayer only while at least one exists. */
  connectedGuests() { return [...this.guests.values()].filter((guest) => guest.link.open); }
  state() { return { epoch:this.epoch,levelId:this.levelId,roundId:this.roundId,phase:this.sim.phase,homeWaiting:[...this.homeWaiting],
    rejoinWaiting: this.sim.phase === 'home' ? [] : [...this.recoveries].map(([playerId, recovery]) => ({playerId, recoveryId:recovery.id})),
    rejoinLeaving:[...this.released.keys()],
    mode:this.connectedGuests().length ? 'multiplayer' : 'solo' }; }

  /** A guest dropped. Mid-match a bot keeps playing their character (stand-in); on the main menu it departs as before. */
  suspendGuest(id, slot) {
    const member = this.roster?.members.find(m => m.id === id);
    if (!member || !this.sim.standIn(slot, { name: member.name, appearance: cleanAvatar(member.appearance, slot) })) this.sim.depart(slot);
    if (this.roster?.members.some(member => member.id === id) && !this.recoveries.has(id) && !this.released.has(id)) {
      this.recoveries.set(id, { id:randomId(), deadline:this.now() + GUEST_RECOVERY_SECONDS });
    }
  }

  releaseGuest(id, reason) {
    const member = this.roster?.members.find(member => member.id === id);
    if (!member) return;
    // A stand-in plays the character to the end of the match; only the seat is released.
    if (!this.sim.isStandIn(member.slot)) this.sim.depart(member.slot);
    this.recoveries.delete(id); this.homeWaiting.delete(id);
    this.released.set(id, reason);
    this.broadcastControl({type:'state', ...this.state()}); this.emit('state', this.state()); this.publish();
    this.emit('release_guest', { member:id, reason });
  }

  rejoinDecision(guest, frame) {
    const recovery = this.recoveries.get(guest.id);
    if (!recovery || !validRejoinDecision(frame) || frame.epoch !== this.epoch || frame.roundId !== this.roundId ||
        frame.recoveryId !== recovery.id || this.sim.phase === 'home') return false;
    if (this.now() >= recovery.deadline) { this.releaseGuest(guest.id, 'expired'); return false; }
    if (!frame.accept) { this.releaseGuest(guest.id, 'declined'); return true; }
    this.recoveries.delete(guest.id);
    // Back in place from the bot; a match that already ended its stand-in spawns them at their respawn point.
    if (!this.sim.resume(guest.slot)) { this.sim.occupy(guest.slot, true); this.sim.players[guest.slot].sceneReady = true; }
    guest.encoder.reset();
    this.broadcastControl({type:'state', ...this.state()}); this.emit('state', this.state()); this.publish();
    return true;
  }

  /** Apply the registry's roster: occupy slots, reset practice when someone new arrives, and keep one link per guest session. */
  setRoster(roster) {
    const previous = this.roster; this.roster = roster;
    for (const id of this.homeWaiting) if (!roster.members.some(m => m.id === id)) this.homeWaiting.delete(id);
    for (const records of [this.recoveries, this.released]) for (const id of records.keys()) if (!roster.members.some(m => m.id === id)) records.delete(id);
    if (previous && previous.code !== roster.code) { this.closeGuests(); this.known.clear(); }
    const others = roster.members.filter((member) => member.id !== roster.playerId);
    const arrived = others.filter((member) => !this.known.has(member.id));
    if (arrived.length && previous && this.sim.phase !== 'home') {
      // Joined in the moment between our start and the registry learning it: send them back, keep the world.
      for (const member of arrived) this.emit('turn_away', member.id);
      roster = { ...roster, members: roster.members.filter((m) => !arrived.includes(m)) }; this.roster = roster;
      others.splice(0, others.length, ...others.filter((m) => !arrived.includes(m)));
    } else if (arrived.length && previous) this.resetScene(); // a newcomer gets a fresh practice scene shared by everyone
    this.matchRoomMode(roster);
    // A refresh can replace a session before its old close is delivered. Suspend it before processing the new link.
    for (const [id, guest] of this.guests) {
      const member = others.find(m => m.id === id);
      if (!member || member.session !== guest.session || !member.connected) {
        if (member) this.suspendGuest(id, guest.slot);
        else if (!this.sim.isStandIn(guest.slot)) this.sim.depart(guest.slot);
        this.guests.delete(id); guest.link.close('roster');
      } else guest.slot = member.slot;
    }
    for (let slot = 0; slot < this.sim.slotCount; slot++) {
      const member = roster.members.find((m) => m.slot === slot);
      // Host-run bots hold seats the registry knows nothing about; a stand-in keeps its character whatever the roster says.
      if (!member && this.sim.isBot(slot) || this.sim.isStandIn(slot)) continue;
      if (member && member.id !== roster.playerId && !member.connected && this.sim.players[slot].occupied) this.suspendGuest(member.id, slot);
      if (!member) this.sim.depart(slot);
      const available = !!member && member.connected && !this.homeWaiting.has(member.id) && !this.recoveries.has(member.id) && !this.released.has(member.id);
      if (available !== !!this.sim.players[slot].occupied) this.sim.occupy(slot, available);
      if (member) { this.sim.setAnimal(slot, cleanAvatar(member.appearance, slot).animal); this.sim.setTeam(slot, member.team ?? null); }
      this.sim.players[slot].sceneReady = available;
      const online = !!(available && (member.id === roster.playerId || member.connected && this.guests.get(member.id)?.link.open));
      this.sim.connected[slot] = online; this.sim.players[slot].connected = online;
      if (member && !online) this.sim.queues[slot] = [];
    }
    this.known = new Set(others.map((member) => member.id));
    for (const [id, reason] of this.released) this.emit('release_guest', {member:id, reason});
    // A seat beyond this level's character slots waits unlinked until a world with that many slots runs.
    for (const member of others) if (member.connected && member.slot < this.sim.slotCount && !this.guests.has(member.id) && !this.released.has(member.id)) this.connectGuest(member);
    // The page waits for an initial authoritative world before it reveals the scene.
    this.reportPhase(); this.broadcastControl({type:'state', ...this.state()}); this.emit('state', this.state()); this.publish();
  }

  /** Versus: empty seats go to bots per the room's frozen AI fill setting and play at its AI difficulty; humans keep
   * their own slots. */
  placeBots() {
    const members = (this.roster?.members || []).filter((member) => member.slot < this.sim.slotCount);
    const settings = normalizeVersusSettings(this.roster?.settings);
    const seats = planBotSeats(members.map((member) => ({ slot: member.slot, team: member.team })), this.sim.slotCount, settings.aiFill);
    this.sim.placeBots(seats, new Set(members.map((member) => cleanAvatar(member.appearance, member.slot).color)), settings.aiDifficulty);
  }

  /** The registry's room mode chooses the world: on the main menu a world of the other mode reloads that mode's first
   * level. Every page then follows the new levelId through the covered level change. */
  matchRoomMode(roster) {
    const mode = roster.mode === 'versus' ? 'versus' : 'coop';
    if (this.sim.phase !== 'home' || levelMode(getLevel(this.levelId)) === mode) return false;
    this.rebuild(firstLevelFor(mode)); this.advanceEpoch();
    return true;
  }

  connectGuest(member) {
    const identity = { code:this.roster.code, session:this.roster.members.find((m) => m.id === this.roster.playerId)?.session, link:'' };
    identity.link = `${identity.session}:${member.session}`;
    const link = this.createLink({ initiator:true, iceServers:this.iceServers, voice:this.voice, identity, sendSignal:(data) => this.signal(member.id, data) });
    const guest = { id:member.id, session:member.session, slot:member.slot, link, encoder:new SnapshotEncoder() };
    this.guests.set(member.id, guest);
    link.addEventListener('open', () => {
      if (this.guests.get(guest.id) !== guest) return;
      if (this.sim.phase === 'home' && this.recoveries.has(guest.id)) {
        this.recoveries.delete(guest.id);
        if (!this.homeWaiting.has(guest.id)) { this.sim.occupy(guest.slot, true); this.sim.players[guest.slot].sceneReady = true; }
      }
      const active = !this.recoveries.has(guest.id) && !this.homeWaiting.has(guest.id) && !this.released.has(guest.id);
      this.sim.connected[guest.slot] = this.sim.players[guest.slot].connected = active;
      this.sendControl(guest); this.emit('state', this.state()); this.emit('peers', this.connectedGuests().length);
    });
    link.addEventListener('close', () => {
      if (this.guests.get(member.id) !== guest) return;
      this.guests.delete(member.id);
      this.suspendGuest(member.id, guest.slot);
      this.broadcastControl({type:'state', ...this.state()}); this.publish();
      this.emit('state', this.state()); this.emit('peers', this.connectedGuests().length);
    });
    link.addEventListener('state', (event) => this.guestState(guest, event.detail.frame));
    link.addEventListener('control', (event) => this.guestControl(guest, event.detail.frame));
    link.addEventListener('degraded', () => link.close('disconnected'));
  }

  /** Relayed offer/answer/ICE from a guest; the service stamps `from`, and the session must match the roster. */
  receiveSignal(from, fromSession, data) {
    const guest = this.guests.get(from);
    if (guest && guest.session === fromSession && data.session === fromSession && data.link === guest.link.identity.link) void guest.link.receive(data);
  }

  /** A guest's inputs drive only the slot the registry bound to its link; stale epochs and malformed frames are ignored. */
  guestState(guest, frame) {
    if (frame.type === 'ping' && Number.isFinite(frame.t)) { guest.link.send(STATE_CHANNEL, { type:'pong', t:frame.t }); return; }
    if (frame.type === 'ack') { if (frame.epoch === this.epoch) guest.encoder.ack(frame.ack); return; }
    if (this.homeWaiting.has(guest.id) || this.recoveries.has(guest.id) || this.released.has(guest.id) || frame.type !== 'input' || !validGuestInput(frame) || frame.epoch !== this.epoch) return;
    guest.encoder.ack(frame.ack);
    for (const packet of frame.inputs) this.sim.input(guest.slot, { seq:packet.seq,move:packet.move,axis:packet.axis,down:packet.down,hits:packet.hits,struggle:packet.struggle });
  }

  guestControl(guest, frame) {
    if (this.guests.get(guest.id) !== guest || !guest.link.open) return;
    if (frame.type === 'rejoin_decision') { this.rejoinDecision(guest, frame); return; }
    if (frame.type === 'guide_ready') { this.guideReady(guest.slot, frame); return; }
    // A guest changed its voice optimization: re-offer this link so the new Opus settings apply (throttled in PeerLink).
    if (frame.type === 'voice_renegotiate') { guest.link.renegotiateVoice?.(); return; }
    if (frame.type === 'pause_request' || frame.type === 'resume_vote') { if (validPauseControl(frame) && frame.epoch === this.epoch) this.pauseControl(guest.slot, frame.type); return; }
    if (frame.type === 'emote') { if (validEmote(frame) && frame.epoch === this.epoch) this.emote(guest.slot, frame.id); return; }
    if (frame.type === 'result_ack' && typeof frame.roundId === 'string') this.receipts.get(guest.id)?.delete(frame.roundId);
    if (!this.homeWaiting.has(guest.id) || this.sim.phase !== 'home' || frame.epoch !== this.epoch) return;
    if (frame.type === 'home_prepare' && guest.preparedEpoch !== this.epoch) {
      guest.preparedEpoch = this.epoch;
      guest.link.send(CONTROL_CHANNEL, { type:'home_snapshot', epoch:this.epoch, data:this.sim.snapshot() });
    } else if (frame.type === 'home_ready' && guest.preparedEpoch === this.epoch) {
      this.homeWaiting.delete(guest.id);
      this.sim.occupy(guest.slot, true); this.sim.players[guest.slot].sceneReady = true;
      guest.encoder.reset();
      this.broadcastControl({ type:'state', ...this.state() }); this.emit('state', this.state());
      // Refresh only this avatar, and send a fresh full world before ordinary deltas resume.
      guest.link.send(CONTROL_CHANNEL, { type:'home_snapshot', epoch:this.epoch, data:this.sim.snapshot() });
      this.publish();
    }
  }

  /** Lifecycle for one guest: current scene epoch, the round in progress and any undelivered results. */
  sendControl(guest) {
    guest.link.send(CONTROL_CHANNEL, { type:'state', ...this.state() });
    if (this.roundId) guest.link.send(CONTROL_CHANNEL, { type:'round_started', saveVersion:SAVE_VERSION, roundId:this.roundId, levelId:this.levelId });
    for (const result of this.receipts.get(guest.id)?.values() || []) guest.link.send(CONTROL_CHANNEL, result);
  }

  broadcastControl(frame) { for (const guest of this.connectedGuests()) guest.link.send(CONTROL_CHANNEL, frame); }

  /** Host-only flow. Returns an error message instead of applying an invalid command. */
  command(type, fields = {}) {
    if (type === 'pause') { this.sim.command('pause', !!fields.paused); this.publish(); return null; }
    if (type === 'start' || type === 'load') {
      if (this.homeWaiting.size) return '队友正在返回主菜单，请等大家准备好再出发';
      const roomMode = this.roster?.mode === 'versus' ? 'versus' : 'coop';
      const levelId = fields.levelId ?? firstLevelFor(roomMode);
      if (!getLevel(levelId)) return '这个关卡尚未开放';
      if (levelMode(getLevel(levelId)) !== roomMode) return '这个关卡不属于当前房间模式';
      if (roomMode === 'versus') {
        // Starting from the main menu needs every guest ready; "play again" from the results keeps the line-up.
        const gate = versusStartCheck(this.roster);
        if (!gate.teams) return '两队都需要至少一名玩家';
        if (type === 'start' && !gate.ok) return '还有玩家没有准备';
      }
      if (type === 'start' && this.sim.phase !== 'home') return '当前关卡已经出发';
      if (type === 'load' && this.sim.phase === 'transition') return '请等入场完成再读取';
      const missing = this.roster?.members.some((m) => m.id !== this.roster.playerId && (!m.connected || !this.guests.get(m.id)?.link.open));
      if (missing) return '队友正在连接，请稍后出发';
      if (levelId !== this.levelId) this.rebuild(levelId);
      else if (type === 'load') this.sim.command('home');
      this.sim.setMatchSettings(this.roster?.settings);
      if (roomMode === 'versus') this.placeBots();
      this.roundId = randomId(); this.settled = false; this.levelId = levelId;
      this.advanceEpoch(); this.sim.command('start');
      const started = { v:GAME_VERSION, type:'round_started', saveVersion:SAVE_VERSION, roundId:this.roundId, levelId };
      this.emit('round_started', started); this.broadcastControl(started);
    } else if (type === 'home') {
      this.settle(); this.sim.command('home'); this.advanceEpoch();
      this.homeWaiting = new Set((this.roster?.members || []).filter(m => m.id !== this.roster.playerId).map(m => m.id));
      for (const guest of this.connectedGuests()) this.recoveries.delete(guest.id);
      for (const member of this.roster?.members || []) if (this.homeWaiting.has(member.id)) {
        this.sim.occupy(member.slot, false); this.sim.players[member.slot].sceneReady = false;
      }
    } else return '未知操作';
    this.reportPhase(); this.emit('state', this.state()); this.broadcastControl({ type:'state', ...this.state() }); this.publish();
    return null;
  }

  /** A new scene epoch drops every in-flight input and snapshot of the previous one. */
  advanceEpoch() { this.epoch++; this.sim.resetInputs(); for (const guest of this.guests.values()) guest.encoder.reset(); this.signature = ''; }

  resetScene() { this.sim.command('home'); this.advanceEpoch(); this.broadcastControl({ type:'state', ...this.state() }); }

  /** A different level preset is a new world; occupied slots carry over. */
  rebuild(levelId) {
    const old = this.sim; this.levelId = levelId; this.sim = this.createSimulation(getLevel(levelId));
    // Carry the slots both worlds have; a level never offers fewer slots than the room's members hold.
    const slots = Math.min(old.slotCount, this.sim.slotCount);
    for (let slot = 0; slot < slots; slot++) if (old.players[slot].occupied && !old.isBotControlled(slot)) { this.sim.occupy(slot, true); this.sim.connected[slot] = old.connected[slot]; this.sim.players[slot].connected = old.connected[slot]; }
    for (let slot = 0; slot < slots; slot++) { this.sim.setAnimal(slot, old.players[slot].baseAnimal); this.sim.setTeam(slot, old.players[slot].team); }
    old.dispose();
  }

  localInput(packet) { this.sim.input(this.slot, packet); }

  /** Versus pause request / resume vote for a link-bound slot (or this page's own slot); applied by the authority. */
  pauseControl(slot, type) {
    const applied = type === 'pause_request' ? this.sim.requestPause(slot) : this.sim.voteResume(slot);
    if (applied) this.publish();
    return applied;
  }

  /** An emote for a link-bound slot (or this page's own slot); applied by the authority, shown via the next snapshot. */
  emote(slot, id) {
    const applied = this.sim.emote(slot, id);
    if (applied) this.publish();
    return applied;
  }

  guideReady(slot, frame) {
    if (!validGuideReady(frame) || frame.epoch !== this.epoch || frame.roundId !== this.roundId) return false;
    return this.sim.confirmGuide(slot, frame.guideId, frame.pageIndex);
  }

  /** One authoritative tick, driven by the host page's fixed-step loop. */
  advance() {
    this.sim.tick(); this.ticks++; this.sinceState++;
    for (const [id, recovery] of this.recoveries) if (this.now() >= recovery.deadline) this.releaseGuest(id, 'expired');
    this.settle(); this.reportPhase();
    if (this.ticks % LOCAL_SNAPSHOT_TICKS === 0) this.publish();
    const guests = this.connectedGuests().filter(guest => !this.homeWaiting.has(guest.id));
    if (!guests.length) return;
    // A pickup, throw, cleaning step, score or shove goes out in the tick it happens; otherwise 30 Hz.
    const signature = this.sim.urgentSignature();
    if (signature === this.signature && this.sinceState < SNAPSHOT_TICKS) return;
    this.signature = signature; this.sinceState = 0;
    const state = quantize(this.sim.snapshot()), scope = `${this.roster.code}:${this.epoch}`;
    for (const guest of guests) {
      // Never queue behind a congested channel: the next snapshot supersedes this one.
      if (guest.link.buffered(STATE_CHANNEL) > STATE_BACKLOG_BYTES) continue;
      // Each guest gets its own wire view (shared/wire.js): own prediction fields, no derivable `local`, rounded values.
      const frame = guest.encoder.encode(guestView(state, guest.slot), scope);
      if (frame.data) {
        // A keyframe (no acknowledged base yet) is many packets: send it on the reliable channel, which delivers it for
        // certain, and count it as acknowledged at once. Later frames are small deltas against it on the state channel; one
        // that outruns the keyframe finds no base and is dropped, and the stream picks up the moment the keyframe lands —
        // no keyframe is ever repeated while an acknowledgement is on its way.
        guest.link.send(CONTROL_CHANNEL, { type:'snapshot', epoch:this.epoch, ...frame });
        guest.encoder.ack(frame.tick);
      } else guest.link.send(STATE_CHANNEL, { type:'snapshot', epoch:this.epoch, ...frame });
    }
  }

  publish() { this.emit('snapshot', this.sim.snapshot()); }

  reportPhase() {
    if (this.sim.phase === this.reportedPhase) return;
    this.reportedPhase = this.sim.phase; this.emit('host_phase', this.sim.phase);
  }

  /** Issue a finished round once, to this page's save coordinator and to every participant's browser until acknowledged. */
  settle() {
    if (!this.roundId || this.settled || !this.sim.game.ended) return;
    this.settled = true;
    const result = { v:GAME_VERSION, type:'round_result', saveVersion:SAVE_VERSION, roundId:this.roundId, levelId:this.levelId,
      ...this.sim.game.result };
    this.emit('round_result', result);
    for (const member of this.roster?.members || []) if (member.id !== this.roster.playerId) {
      const receipts = this.receipts.get(member.id) || new Map(); receipts.set(result.roundId, result);
      while (receipts.size > RECEIPTS) receipts.delete(receipts.keys().next().value);
      this.receipts.set(member.id, receipts);
    }
    this.broadcastControl(result);
  }

  closeGuests() { for (const guest of this.guests.values()) guest.link.close('room'); this.guests.clear(); }
  dispose() { this.closeGuests(); this.sim.dispose(); }
}

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, '0')).join('');
