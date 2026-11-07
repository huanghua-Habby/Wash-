/** One host↔guest WebRTC link with two data channels. The host offers; signaling goes through the room service, which
 * stamps the sender, so a link is bound to the member identity and session the registry assigned.
 * - control: reliable, ordered — lifecycle, round receipts and acknowledgements.
 * - state: unordered, no retransmits — inputs and snapshots that the next message supersedes.
 * With a `voice` service the link also carries one sendrecv audio transceiver for party voice (see VoiceChat.js);
 * it never carries gameplay.
 * Frames are JSON; anything longer than a ping travels deflate-raw compressed as binary (MULTIPLAYER.md 流量: snapshot
 * deltas shrink to about 40%, under one packet). Compression is async, so each channel keeps its own send and receive
 * queue to preserve order; receivers accept plain text too. */
import { GAME_VERSION, STATE_CHANNEL, CONTROL_CHANNEL } from '../../../shared/protocol.js';

const COMPRESS = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
const COMPRESS_FROM = 200;           // Shorter frames (pings, acks, inputs) go as plain text.
const MAX_WIRE = 262_144, MAX_TEXT = 1_048_576; // Compressed size cap, and the most a frame may inflate to.

async function deflate(text) {
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
}
/** Inflate with a hard cap so a hostile frame cannot expand without bound. */
async function inflate(buffer) {
  const reader = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const decoder = new TextDecoder(); let text = '', size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > MAX_TEXT) { reader.cancel().catch(() => {}); return null; }
    text += decoder.decode(value, { stream: true });
  }
}

export class PeerLink extends EventTarget {
  /** `sendSignal(data)` relays to the other side; `identity` scopes every frame to this room and session pair. */
  constructor({ initiator, iceServers = [], sendSignal, identity, voice = null }) {
    super();
    Object.assign(this, { initiator, sendSignal, identity, voice });
    this.channels = {}; this.closed = false; this.open = false; this.pendingCandidates = [];
    this.outbox = {}; this.inbox = {}; // per-channel promise chains keeping compressed frames in order
    this.pc = new RTCPeerConnection({ iceServers });
    this.pc.addEventListener('icecandidate', (event) => this.signal({ kind: 'ice', candidate: event.candidate ? event.candidate.toJSON() : null }));
    this.pc.addEventListener('connectionstatechange', () => {
      const state = this.pc.connectionState;
      if (state === 'failed' || state === 'closed') this.close(state);
      if (state === 'disconnected') this.emit('degraded');
    });
    this.pc.addEventListener('track', (event) => {
      if (event.track.kind !== 'audio') return;
      this.remoteVoice = event.streams[0] || new MediaStream([event.track]);
      this.voice?.received(this, this.remoteVoice);
    });
    if (initiator) {
      if (voice) voice.attach(this, this.pc.addTransceiver('audio', { direction: 'sendrecv' }), { mixed: true });
      // Game channels ask for high priority; the voice sender is low (VoiceChat.tune), so congestion squeezes voice first.
      this.attach(this.pc.createDataChannel(CONTROL_CHANNEL, { ordered: true, priority: 'high' }));
      this.attach(this.pc.createDataChannel(STATE_CHANNEL, { ordered: false, maxRetransmits: 0, priority: 'high' }));
      void this.offer();
    } else this.pc.addEventListener('datachannel', (event) => this.attach(event.channel));
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  signal(data) { if (!this.closed) this.sendSignal({ ...data, session: this.identity.session, link:this.identity.link }); }

  /** Voice settings shape every SDP this link applies (VoiceChat.shapeSdp): our encoder and our request to the peer. */
  shape(sdp) { return this.voice ? this.voice.shapeSdp(sdp) : sdp; }

  async offer() {
    try {
      const offer = await this.pc.createOffer(), sdp = this.shape(offer.sdp);
      await this.pc.setLocalDescription({ type: 'offer', sdp }); this.signal({ kind: 'offer', sdp });
    } catch (error) { this.close(`offer:${error?.message || error}`); }
  }

  /** Voice optimization changed: the host re-offers at once; a guest asks the host to (at most every 2 s per link). */
  renegotiateVoice() {
    if (this.closed) return;
    const now = performance.now();
    if (now - (this.renegotiatedAt ?? -Infinity) < 2000) return;
    this.renegotiatedAt = now;
    if (!this.initiator) { this.send(CONTROL_CHANNEL, { type: 'voice_renegotiate' }); return; }
    if (this.pc.signalingState === 'stable') void this.offer();
  }

  /** Apply a relayed signal from the bound peer. */
  async receive(data) {
    if (this.closed || data.link !== this.identity.link) return;
    try {
      if (data.kind === 'offer' && !this.initiator) {
        await this.pc.setRemoteDescription({ type: 'offer', sdp: this.shape(data.sdp) });
        // The host offers one audio transceiver; answering sendrecv lets the microphone track be swapped in later.
        const audio = this.voice && this.pc.getTransceivers().find((t) => t.receiver.track?.kind === 'audio');
        if (audio) { audio.direction = 'sendrecv'; this.voice.attach(this, audio, { mixed: false }); }
        const answer = await this.pc.createAnswer(), sdp = this.shape(answer.sdp);
        await this.pc.setLocalDescription({ type: 'answer', sdp });
        this.signal({ kind: 'answer', sdp });
        this.voice?.tune(this);
        await this.flushCandidates();
      } else if (data.kind === 'answer' && this.initiator) {
        await this.pc.setRemoteDescription({ type: 'answer', sdp: this.shape(data.sdp) });
        this.voice?.tune(this);
        await this.flushCandidates();
      } else if (data.kind === 'ice') {
        if (!this.pc.remoteDescription) this.pendingCandidates.push(data.candidate);
        else if (data.candidate) await this.pc.addIceCandidate(data.candidate);
      } else if (data.kind === 'bye') this.close('bye');
    } catch (error) { this.close(`signal:${error?.message || error}`); }
  }

  async flushCandidates() {
    for (const candidate of this.pendingCandidates.splice(0)) if (candidate) await this.pc.addIceCandidate(candidate);
  }

  attach(channel) {
    if (channel.label !== CONTROL_CHANNEL && channel.label !== STATE_CHANNEL) { channel.close(); return; }
    this.channels[channel.label] = channel; channel.binaryType = 'arraybuffer';
    channel.addEventListener('open', () => {
      if (!this.open && this.channels[CONTROL_CHANNEL]?.readyState === 'open' && this.channels[STATE_CHANNEL]?.readyState === 'open') { this.open = true; this.emit('open'); }
    });
    channel.addEventListener('close', () => this.close('channel'));
    channel.addEventListener('message', (event) => {
      const data = event.data, label = channel.label;
      if (typeof data === 'string' ? data.length > MAX_WIRE : !(data instanceof ArrayBuffer) || data.byteLength > MAX_WIRE) return;
      // Text and binary frames share one queue per channel, so a quick text frame never overtakes an inflating one.
      this.inbox[label] = (this.inbox[label] || Promise.resolve()).then(async () => {
        const text = typeof data === 'string' ? data : await inflate(data);
        if (text !== null && !this.closed) this.deliver(label, text, typeof data === 'string' ? data.length : data.byteLength);
      }).catch(() => {});
    });
  }

  /** One decoded frame: scope checks, then 'control' / 'state' with its wire size. (Not `receive`: that is the signaling input.) */
  deliver(label, text, bytes) {
    let frame; try { frame = JSON.parse(text); } catch { return; }
    // Frames from another room or session pair are never applied.
    if (frame?.code !== this.identity.code || frame.link !== this.identity.link) return;
    // Our own link speaking another game contract: say so once (the guest leaves with a "refresh" notice), never apply.
    if (frame.v !== GAME_VERSION) { if (!this.mismatch) { this.mismatch = true; this.emit('mismatch', { version: frame.v }); } return; }
    this.emit(label === CONTROL_CHANNEL ? 'control' : 'state', { frame, bytes });
  }

  /** Bytes still waiting on a channel; state senders skip rather than queue behind it. */
  buffered(label) { return this.channels[label]?.bufferedAmount ?? Infinity; }

  send(label, frame) {
    const channel = this.channels[label];
    if (!this.open || channel?.readyState !== 'open') return false;
    const text = JSON.stringify({ v: GAME_VERSION, code: this.identity.code, link: this.identity.link, ...frame });
    const queued = this.outbox[label];
    if (!COMPRESS || (text.length < COMPRESS_FROM && !queued)) { channel.send(text); return text.length; }
    // Compressed frames leave in call order; a short frame waits behind any compression still running on this channel.
    const next = (queued || Promise.resolve()).then(async () => {
      const data = text.length < COMPRESS_FROM ? text : await deflate(text);
      if (this.open && channel.readyState === 'open') channel.send(data);
    }).catch(() => {});
    this.outbox[label] = next;
    next.finally(() => { if (this.outbox[label] === next) this.outbox[label] = null; });
    return text.length;
  }

  close(reason = 'closed') {
    if (this.closed) return;
    this.closed = true; this.open = false;
    this.voice?.detach(this);
    try { this.sendSignal({ kind: 'bye', session: this.identity.session, link:this.identity.link }); } catch { /* signaling may already be gone */ }
    for (const channel of Object.values(this.channels)) try { channel.close(); } catch { /* already closed */ }
    try { this.pc.close(); } catch { /* already closed */ }
    this.emit('close', reason);
  }
}
