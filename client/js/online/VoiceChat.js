/** Party voice chat over the existing host↔guest WebRTC links (docs/domains/wash/VOICE_CHAT.md).
 * The topology matches gameplay: every link carries one sendrecv audio transceiver. A guest sends its microphone and
 * plays the host's mix; the host plays every guest and sends each guest a mix of the host microphone plus the other
 * guests, so guests never negotiate with each other. Voice never passes through the PC room service and never touches
 * gameplay, snapshots, the protocol frames or saves. Playback belongs to AudioManager; this service only owns capture
 * and the host's per-guest mixes. Solo play opens no link, so the microphone is never requested. */
import { shapeVoiceSdp, VOICE_BITRATE } from './voiceSdp.js';

const MUTE_KEY = 'wash-voice-muted';
/** Voice optimization (VOICE_CHAT.md 语音优化): on by default; '0' saved means off. */
const OPTIMIZE_KEY = 'wash-voice-optimized';
/** A refresh or re-negotiation replaces links within a moment; keep the microphone that long instead of re-opening it. */
const RELEASE_MS = 3000;
const CONSTRAINTS = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false };
const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchend'];

/** @typedef {'off' | 'pending' | 'on' | 'blocked' | 'missing' | 'unsupported'} MicState */

export class VoiceChat extends EventTarget {
  /** @param {{ audio: { setVoiceStream(key: string, stream: MediaStream | null): void }, media?: any, storage?: Storage | null,
   *  Context?: any, secure?: boolean, target?: EventTarget | null }} options */
  constructor({ audio, media = globalThis.navigator?.mediaDevices, storage = defaultStorage(),
    Context = globalThis.AudioContext || globalThis.webkitAudioContext, secure = globalThis.isSecureContext !== false, target = globalThis }) {
    super();
    Object.assign(this, { audio, media, storage, Context, target });
    /** @type {Map<object, { key: string, transceiver: any, mixed: boolean, remote: MediaStream | null, source: any, destination: any }>} */
    this.links = new Map();
    this.serial = 0; this.request = 0; this.disposed = false;
    this.supported = secure && typeof media?.getUserMedia === 'function';
    /** @type {MicState} */
    this.mic = 'off'; this.micStream = null; this.micSource = null; this.ctx = null;
    try { this.muted = storage?.getItem(MUTE_KEY) === '1'; } catch { this.muted = false; }
    try { this.optimized = storage?.getItem(OPTIMIZE_KEY) !== '0'; } catch { this.optimized = true; }
    this.unlock = () => { if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {}); };
  }

  /** In a party with at least one direct link. */
  get active() { return this.links.size > 0; }
  /** Links whose remote audio has arrived. */
  get peers() { let count = 0; for (const entry of this.links.values()) if (entry.remote) count++; return count; }
  get micTrack() { return this.micStream?.getAudioTracks()[0] || null; }
  emit() { this.dispatchEvent(new CustomEvent('change')); }

  /** A PeerLink offered/answered its audio transceiver. `mixed` (host) sends this guest a mix instead of the raw mic. */
  attach(link, transceiver, { mixed }) {
    if (this.disposed || this.links.has(link)) return;
    clearTimeout(this.releaseTimer);
    const entry = { key: `voice-${++this.serial}`, transceiver, mixed, remote: null, source: null, destination: null };
    this.links.set(link, entry);
    if (mixed && this.ensureContext()) {
      entry.destination = this.ctx.createMediaStreamDestination();
      this.send(entry, entry.destination.stream.getAudioTracks()[0]);
    } else this.send(entry, this.micTrack);
    if (link.remoteVoice) this.received(link, link.remoteVoice);
    this.tune(link);
    if (this.mic === 'off') this.requestMic();
    this.rewire(); this.emit();
  }

  /** Remote audio for a link: play it and, on the host, feed it into the other guests' mixes. */
  received(link, stream) {
    const entry = this.links.get(link);
    if (!entry || entry.remote === stream) return;
    entry.source?.disconnect(); entry.source = null; entry.remote = stream;
    this.audio.setVoiceStream(entry.key, stream);
    if (this.ctx && this.hasMixes) {
      try { entry.source = this.ctx.createMediaStreamSource(stream); } catch { entry.source = null; }
    }
    this.rewire(); this.emit();
  }

  detach(link) {
    const entry = this.links.get(link);
    if (!entry) return;
    this.links.delete(link);
    this.audio.setVoiceStream(entry.key, null);
    entry.source?.disconnect();
    for (const track of entry.destination?.stream.getTracks() || []) track.stop();
    this.send(entry, null);
    this.rewire();
    if (!this.links.size) { clearTimeout(this.releaseTimer); this.releaseTimer = setTimeout(() => this.release(), RELEASE_MS); }
    this.emit();
  }

  get hasMixes() { for (const entry of this.links.values()) if (entry.mixed) return true; return false; }

  send(entry, track) { try { void entry.transceiver.sender.replaceTrack(track)?.catch?.(() => {}); } catch { /* link closing */ } }

  /** SDP for one of our links, shaped for this page's voice optimization (PeerLink calls it for local and remote SDP). */
  shapeSdp(sdp) { return shapeVoiceSdp(sdp, this.optimized); }

  /** Sender side of the voice: always low priority next to the game channels, and capped while optimized. Encodings
   * exist only after negotiation, so PeerLink calls this again once a description is applied. */
  tune(link) {
    const sender = this.links.get(link)?.transceiver?.sender;
    if (!sender?.getParameters || !sender.setParameters) return;
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) return;
      params.encodings = params.encodings.map((encoding) => {
        const next = { ...encoding, priority: 'low', networkPriority: 'low' };
        if (this.optimized) next.maxBitrate = VOICE_BITRATE; else delete next.maxBitrate;
        return next;
      });
      void sender.setParameters(params)?.catch?.(() => {});
    } catch { /* unsupported or closing: the SDP shaping still applies */ }
  }

  /** Settings toggle. Re-negotiates every link so DTX and the packet size change right away (PeerLink.renegotiateVoice). */
  setOptimized(optimized) {
    if (this.disposed || this.optimized === !!optimized) return this.optimized;
    this.optimized = !!optimized;
    try { this.storage?.setItem(OPTIMIZE_KEY, this.optimized ? '1' : '0'); } catch { /* private mode */ }
    for (const link of this.links.keys()) { this.tune(link); link.renegotiateVoice?.(); }
    this.emit();
    return this.optimized;
  }

  ensureContext() {
    if (this.ctx) return true;
    if (!this.Context) return false;
    this.ctx = new this.Context({ latencyHint: 'interactive' });
    if (this.target) for (const type of UNLOCK_EVENTS) this.target.addEventListener(type, this.unlock, { capture: true, passive: true });
    this.unlock();
    this.syncMicSource();
    return true;
  }

  /** Host mixes: own microphone into every guest's mix, each guest into every other guest's mix, nobody into their own. */
  rewire() {
    if (!this.ctx) return;
    const mixes = [...this.links.values()].filter((entry) => entry.mixed && entry.destination);
    this.micSource?.disconnect();
    for (const entry of this.links.values()) entry.source?.disconnect();
    for (const mix of mixes) {
      this.micSource?.connect(mix.destination);
      for (const entry of this.links.values()) if (entry !== mix && entry.source) entry.source.connect(mix.destination);
    }
  }

  syncMicSource() {
    this.micSource?.disconnect(); this.micSource = null;
    if (this.ctx && this.micStream) this.micSource = this.ctx.createMediaStreamSource(this.micStream);
  }

  /** Called automatically when the first link opens; the UI calls it again to retry a blocked/missing microphone. */
  requestMic() {
    if (this.disposed || !this.active || this.mic === 'pending' || this.mic === 'on') return;
    if (!this.supported) { this.mic = 'unsupported'; this.emit(); return; }
    const request = ++this.request;
    this.mic = 'pending'; this.emit();
    Promise.resolve().then(() => this.media.getUserMedia(CONSTRAINTS)).then((stream) => {
      if (request !== this.request || this.disposed || !this.active) { for (const track of stream.getTracks()) track.stop(); return; }
      this.micStream = stream; this.mic = 'on'; this.applyMute(); this.syncMicSource();
      for (const entry of this.links.values()) if (!entry.mixed) this.send(entry, this.micTrack);
      this.rewire(); this.emit();
    }, (error) => {
      if (request !== this.request || this.disposed) return;
      this.mic = ['NotFoundError', 'OverconstrainedError', 'NotReadableError'].includes(error?.name) ? 'missing' : 'blocked';
      this.emit();
    });
  }

  applyMute() { const track = this.micTrack; if (track) track.enabled = !this.muted; }

  setMuted(muted) {
    if (this.disposed || this.muted === !!muted) return this.muted;
    this.muted = !!muted;
    try { this.storage?.setItem(MUTE_KEY, this.muted ? '1' : '0'); } catch { /* private mode */ }
    this.applyMute(); this.emit();
    return this.muted;
  }
  toggleMute() { return this.setMuted(!this.muted); }

  /** Back to solo: close the microphone so the browser's recording indicator goes away. */
  release() {
    if (this.links.size) return;
    this.request++;
    for (const track of this.micStream?.getTracks() || []) track.stop();
    this.micStream = null; this.micSource?.disconnect(); this.micSource = null;
    if (this.ctx) {
      if (this.target) for (const type of UNLOCK_EVENTS) this.target.removeEventListener(type, this.unlock, true);
      this.ctx.close?.().catch?.(() => {}); this.ctx = null;
    }
    if (this.mic !== 'off') { this.mic = 'off'; this.emit(); }
  }

  dispose() {
    if (this.disposed) return;
    for (const link of [...this.links.keys()]) this.detach(link);
    clearTimeout(this.releaseTimer); this.release();
    this.disposed = true;
  }
}

function defaultStorage() { try { return globalThis.localStorage ?? null; } catch { return null; } }
