/** Guest side of a room: one direct link to the host's browser authority. Sends inputs only; rebuilds host snapshots. */
import { STATE_CHANNEL, CONTROL_CHANNEL, PEER_CONNECT_SECONDS, INPUT_REDUNDANCY, STATE_BACKLOG_BYTES } from '../../../shared/protocol.js';
import { SnapshotDecoder } from '../../../shared/delta.js';
import { restoreView } from '../../../shared/wire.js';
import { PeerLink } from './PeerLink.js';

/** No host snapshot for this long on an open link means the host is gone or unreachable. */
const STALL_SECONDS = 4;
/** Acknowledge decoded snapshots at least this often so host deltas stay small even while the guest is idle. */
const ACK_MS = 50;
/** Round-trip probe over the state channel, shown in the debug panel; it never affects gameplay. */
const PING_MS = 1000;

export class GuestLink extends EventTarget {
  constructor({ roster, session, iceServers = [], signal, voice = null, createLink = (options) => new PeerLink(options) }) {
    super();
    const host = roster.members.find((m) => m.id === roster.hostId);
    Object.assign(this, { code:roster.code, playerId:roster.playerId, hostId:roster.hostId, hostSession:host?.session, session, signal });
    this.identity = { code:this.code, session, link:`${this.hostSession}:${session}` };
    this.decoder = new SnapshotDecoder(); this.state = null; this.recent = []; this.rounds = new Set();
    this.lastUp = 0; this.lastSnapshot = 0; this.closed = false; this.rtt = []; this.rttMs = 0;
    this.lastContact = performance.now(); this.preparedEpoch = null; this.requestedEpoch = null; this.readyEpoch = null;
    this.link = createLink({ initiator:false, iceServers, voice, identity:this.identity, sendSignal:(data) => this.signal(this.hostId, data) });
    this.link.addEventListener('open', () => { clearTimeout(this.failTimer); this.lastSnapshot = performance.now(); this.emit('open'); });
    this.link.addEventListener('close', (event) => this.end(this.link.wasOpen ? 'host_lost' : 'connect_failed', event.detail));
    this.link.addEventListener('open', () => { this.link.wasOpen = true; });
    this.link.addEventListener('control', (event) => this.control(event.detail.frame, event.detail.bytes));
    this.link.addEventListener('state', (event) => this.stateFrame(event.detail));
    this.link.addEventListener('degraded', () => this.link.close('disconnected'));
    // The host runs another game contract (GAME_VERSION): leave clearly instead of waiting on frames we cannot apply.
    this.link.addEventListener('mismatch', (event) => this.end('version_mismatch', event.detail));
    // Company networks may block direct peer traffic; fail clearly instead of waiting on a loading screen.
    this.failTimer = setTimeout(() => { if (!this.link.open) this.end('connect_failed', 'timeout'); }, PEER_CONNECT_SECONDS * 1000);
    this.watchdog = setInterval(() => {
      if (this.link.open && performance.now() - (this.homePending ? this.lastContact : this.lastSnapshot) > STALL_SECONDS * 1000) this.end('host_lost', 'stalled');
    }, 1000);
    this.pinger = setInterval(() => { if (this.open) this.link.send(STATE_CHANNEL, { type:'ping', t:performance.now() }); }, PING_MS);
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  get open() { return this.link.open && !this.closed; }
  get homePending() { return !!this.state?.homeWaiting.includes(this.playerId); }
  get rejoinRequest() { return this.state?.rejoinWaiting.find(entry => entry.playerId === this.playerId); }
  get rejoinPending() { return !!this.rejoinRequest; }
  get rejoinLeaving() { return !!this.state?.rejoinLeaving.includes(this.playerId); }
  decideRejoin(accept) {
    if (!this.open || !this.rejoinPending) return false;
    return this.sendControl({type:'rejoin_decision', epoch:this.state.epoch, roundId:this.state.roundId,
      recoveryId:this.rejoinRequest.recoveryId, accept});
  }
  requestHome() {
    if (!this.homePending || this.requestedEpoch === this.state.epoch) return false;
    this.requestedEpoch = this.state.epoch;
    if (this.sendControl({type:'home_prepare', epoch:this.state.epoch})) return true;
    this.requestedEpoch = null; return false;
  }
  homeVisible() {
    if (!this.homePending || this.preparedEpoch !== this.state.epoch || this.readyEpoch === this.state.epoch) return false;
    this.readyEpoch = this.state.epoch;
    if (this.sendControl({type:'home_ready', epoch:this.state.epoch})) return true;
    this.readyEpoch = null; return false;
  }

  /** Only the roster's host, in its current session, may negotiate this link. */
  receiveSignal(from, fromSession, data) {
    if (from === this.hostId && fromSession === this.hostSession && data.session === this.hostSession && data.link === this.identity.link) void this.link.receive(data);
  }

  control(frame, bytes = 0) {
    // Keyframes come on the reliable channel (HostAuthority.publish); they decode like any snapshot.
    if (frame.type === 'snapshot') { this.stateFrame({ frame, bytes }); return; }
    if (frame.type === 'state' && Number.isSafeInteger(frame.epoch)) {
      if (this.state && frame.epoch < this.state.epoch) return;
      const wasPending = this.homePending;
      if (frame.epoch !== this.state?.epoch) { this.decoder.reset(); this.recent = []; }
      this.state = { epoch:frame.epoch, levelId:frame.levelId, roundId:frame.roundId ?? null, phase:frame.phase,
        homeWaiting:Array.isArray(frame.homeWaiting) ? frame.homeWaiting : [], rejoinWaiting:Array.isArray(frame.rejoinWaiting) ? frame.rejoinWaiting : [],
        rejoinLeaving:Array.isArray(frame.rejoinLeaving) ? frame.rejoinLeaving : [], mode:'multiplayer' };
      this.lastContact = performance.now();
      if (wasPending && !this.homePending) { this.decoder.reset(); this.recent = []; this.lastSnapshot = performance.now(); }
      this.emit('state', this.state);
    } else if (frame.type === 'home_snapshot' && frame.epoch === this.state?.epoch && frame.data?.phase === 'home') {
      if (!Number.isSafeInteger(frame.data.tick) || frame.data.tick < this.decoder.newest) return;
      this.preparedEpoch = frame.epoch; this.lastContact = this.lastSnapshot = performance.now();
      this.emit('snapshot', frame.data);
    } else if (frame.type === 'round_started' && typeof frame.roundId === 'string') {
      this.rounds.add(frame.roundId); this.emit('round_started', frame);
    } else if (frame.type === 'round_result' && this.rounds.has(frame.roundId)) {
      // Results come only from the host, for a round the host started.
      this.emit('round_result', frame);
    }
  }

  stateFrame({ frame, bytes }) {
    if (frame.type === 'pong' && Number.isFinite(frame.t)) {
      this.lastContact = performance.now();
      this.rtt.push(performance.now() - frame.t); if (this.rtt.length > 9) this.rtt.shift();
      this.rttMs = Math.round([...this.rtt].sort((a, b) => a - b)[this.rtt.length >> 1] * 10) / 10; return;
    }
    if (this.homePending || frame.type !== 'snapshot' || !this.state || frame.epoch !== this.state.epoch) return;
    const decoded = this.decoder.decode(frame);
    if (!decoded) return;
    const data = restoreView(decoded); // derive `local` again from this snapshot's vehicles
    this.lastSnapshot = performance.now(); this.lastSnapshotBytes = bytes;
    this.emit('snapshot', data);
    if (performance.now() - this.lastUp > ACK_MS) this.sendState({ type:'ack', epoch:this.state.epoch, ack:this.decoder.newest });
  }

  /** Each message repeats the newest samples; the host discards those it already applied. */
  sendInput(packet) {
    if (!this.state || !this.open || this.homePending || this.rejoinPending || this.rejoinLeaving) return false;
    this.recent.push({ seq:packet.seq, move:packet.move, axis:packet.axis, down:packet.down, hits:packet.hits, ...(packet.struggle ? { struggle:packet.struggle } : {}) });
    if (this.recent.length > INPUT_REDUNDANCY) this.recent.shift();
    return this.sendState({ type:'input', epoch:this.state.epoch, inputs:this.recent, ack:this.decoder.newest >= 0 ? this.decoder.newest : undefined });
  }

  sendState(frame) {
    if (this.link.buffered(STATE_CHANNEL) > STATE_BACKLOG_BYTES) return false;
    this.lastUp = performance.now();
    return !!this.link.send(STATE_CHANNEL, frame);
  }

  sendControl(frame) { return !!this.link.send(CONTROL_CHANNEL, frame); }

  end(reason, detail) {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.failTimer); clearInterval(this.watchdog); clearInterval(this.pinger);
    this.link.close(reason);
    this.emit('end', { reason, detail });
  }
}
