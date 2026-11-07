/**
 * Central audio manager. Listeners register once; every frame the manager asks each listener to
 * submit requests (numeric bank id, pan, volume, key), then flushes them in one pass:
 * - one-shots in the same frame and bank are merged into one voice (four cats landing = one call);
 * - voices come from a fixed pool of gain→panner chains built at startup, so a play only creates the
 *   AudioBufferSourceNode that Web Audio requires and reuses a pre-bound `onended` handler;
 * - requests live in preallocated typed arrays, and loops are fixed channels whose AudioParams are
 *   only touched when the target actually changes (no automation events piling up every frame).
 * Nothing in the per-frame path allocates objects, closures or string keys.
 *
 * Music runs on its own bus with frequency avoidance (see MUSIC_EQ): a static carve where the effects
 * live, plus a dynamic mid dip and small level duck that the flush triggers whenever effects sound.
 */
import { BANK_NAMES, MIX, MUSIC_TRACKS, MUSIC_EQ, bankOfFile } from './sounds.js';

/** LOOP_CHANNELS covers GameAudio's per-slot loops for eight characters (GAME_LOOP_CHANNELS, checked by tests). */
export const LOOP_CHANNELS = 42;
const POOL = 24, QUEUE = 64, KEY_SLOTS = 8;
const MASTER = 0.8; // headroom for four cats landing at once
const MUTE_KEY = 'wash-audio-muted';
const VOLUME_KEY = 'wash-audio-volumes';
const DEFAULT_VOLUMES = Object.freeze({ master: 1, music: 1, sfx: 1, voice: 0.5 });
/** Saved-volume revision 2 (2026-10-20): party voice defaults to 50%. An unrevised saved 100% voice was the old default. */
const VOLUME_REVISION = 2;
const DEAFENED_KEY = 'wash-voice-deafened';
const BANKS = BANK_NAMES.length;

/**
 * @typedef {{ audioUpdate(manager: AudioManager, camera?: any): void }} AudioListener
 */

export class AudioManager {
  /**
   * @param {{ files?: Record<string, string>, musicFiles?: Record<string, string>, Context?: any, fetch?: typeof fetch, storage?: Storage | null, target?: EventTarget | null, createVoiceElement?: () => any }} [options]
   */
  constructor({ files = {}, musicFiles = {}, Context = globalThis.AudioContext || globalThis.webkitAudioContext,
    fetch: fetchFile = globalThis.fetch?.bind(globalThis), storage = defaultStorage(), target = globalThis,
    createVoiceElement = () => new Audio() } = {}) {
    /** @type {AudioListener[]} */
    this.listeners = [];
    this.buffers = Array.from({ length: BANKS }, () => /** @type {AudioBuffer[]} */ ([]));
    this.turn = new Int32Array(BANKS);
    this.lastPlayed = new Float64Array(BANKS * KEY_SLOTS).fill(-1e9);
    // Request queue (struct of arrays).
    this.qBank = new Int16Array(QUEUE); this.qPan = new Float32Array(QUEUE); this.qVolume = new Float32Array(QUEUE);
    this.qDelay = new Float32Array(QUEUE); this.qWeight = new Float32Array(QUEUE); this.qRate = new Float32Array(QUEUE).fill(1);
    this.qLength = 0; this.dropped = 0;
    // Loop channels: desired state written by listeners, applied state owned by the manager.
    this.loopBank = new Int16Array(LOOP_CHANNELS).fill(-1); this.loopPan = new Float32Array(LOOP_CHANNELS);
    this.loopVolume = new Float32Array(LOOP_CHANNELS); this.loopRate = new Float32Array(LOOP_CHANNELS).fill(1);
    this.stats = { sources: 0, merged: 0, stolen: 0, paramWrites: 0 };
    /** @type {ReturnType<AudioManager['chain']>[]} */
    this.voices = [];
    /** @type {{ chains: ReturnType<AudioManager['chain']>[], current: number, bank: number, pan: number, volume: number, rate: number }[]} */
    this.loops = [];
    // Music: desired state from listeners; applied state and ducking owned by the manager.
    /** @type {(AudioBuffer | null)[]} */
    this.musicBuffers = MUSIC_TRACKS.map(() => null);
    this.music = { want: -1, wantVolume: 1, wantMuffled: false, track: -1, volume: -1, muffled: false, source: null, gain: null };
    this.duck = { applied: 0, until: 0, depth: 0 };
    this.disposed = false; this.hidden = false;
    this.unlockTarget = target; this.musicSources = new Set();
    this.storage = storage;
    this.muted = readMuted(storage);
    this.volumes = readVolumes(storage);
    this.voiceListening = !readFlag(storage, DEAFENED_KEY);
    // Party voice plays through media elements: WebRTC playout is the echo canceller's reference, Web Audio output is not.
    this.voiceElements = new Map(); this.createVoiceElement = createVoiceElement;
    this.ctx = Context ? new Context({ latencyHint: 'interactive' }) : null;
    if (!this.ctx) { this.ready = Promise.resolve(); return; }
    const ctx = this.ctx;
    // Gentle bus limiter keeps stacked hits from clipping.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6; this.limiter.knee.value = 6; this.limiter.ratio.value = 8;
    this.limiter.attack.value = 0.002; this.limiter.release.value = 0.12;
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : MASTER * this.volumes.master;
    this.master.connect(this.limiter); this.limiter.connect(ctx.destination);
    // User levels are separate buses, so adjusting a slider changes existing
    // one-shots, loops and crossfades without touching their sources or mix.
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this.volumes.sfx; this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.volumes.music; this.musicBus.connect(this.master);
    this.voices = Array.from({ length: POOL }, () => this.chain());
    // Each loop channel owns two chains so a bank change can crossfade.
    this.loops = Array.from({ length: LOOP_CHANNELS }, () => ({ chains: [this.chain(), this.chain()], current: -1, bank: -1, pan: 0, volume: 0, rate: 1 }));
    this.buildMusicBus();
    // Browsers keep audio suspended until a user gesture; resume on the first one.
    this.unlock = () => {
      if (this.disposed) return;
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      for (const element of this.voiceElements.values()) if (element.paused) element.play()?.catch?.(() => {});
    };
    if (target) for (const type of ['pointerdown', 'keydown', 'touchend']) target.addEventListener(type, this.unlock, { capture: true, passive: true });
    this.ready = settleLoads([this.load(files, fetchFile), this.loadMusic(musicFiles, fetchFile)]);
  }

  /** track gains → high-pass → static carve → dynamic duck EQ → pause low-pass → duck level → music volume → music bus → master. */
  buildMusicBus() {
    const ctx = this.ctx, filter = (type, frequency, Q = 0.7, gain = 0) => {
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = frequency; f.Q.value = Q; f.gain.value = gain; return f;
    };
    const stages = [filter('highpass', MUSIC_EQ.highpass),
      ...MUSIC_EQ.carve.map((band) => filter(band.type, band.frequency, band.Q, band.gain))];
    this.duckEq = filter('peaking', MUSIC_EQ.duck.frequency, MUSIC_EQ.duck.Q, 0);
    this.pauseFilter = filter('lowpass', 20000, 0.5);
    this.duckLevel = ctx.createGain();
    this.musicVolume = ctx.createGain(); this.musicVolume.gain.value = 0;
    stages.push(this.duckEq, this.pauseFilter, this.duckLevel, this.musicVolume);
    for (let i = 0; i < stages.length - 1; i++) stages[i].connect(stages[i + 1]);
    this.musicVolume.connect(this.musicBus);
    this.musicIn = stages[0];
  }

  async loadMusic(files, fetchFile) {
    await settleLoads(Object.entries(files).map(async ([path, url]) => {
      const name = path.split('/').pop().replace(/\.mp3$/, ''), track = MUSIC_TRACKS.findIndex((t) => t.name === name);
      if (track < 0) return;
      const response = await fetchFile(url);
      if (!response.ok) throw new Error(`音乐加载失败：${path}`);
      const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
      if (!this.disposed) this.musicBuffers[track] = buffer;
    }));
  }

  /** gain → panner → SFX bus → master, built once; `release` is bound once and reused by every source. */
  chain() {
    const gain = this.ctx.createGain(), pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    gain.connect(pan || this.sfxBus); pan?.connect(this.sfxBus);
    const chain = { gain, pan, source: null, endsAt: 0, priority: 0, release: () => {} };
    chain.release = () => { chain.source?.disconnect(); chain.source = null; };
    return chain;
  }

  async load(files, fetchFile) {
    await settleLoads(Object.entries(files).map(async ([path, url]) => {
      const bank = bankOfFile(path);
      if (bank === null) return;
      const response = await fetchFile(url);
      if (!response.ok) throw new Error(`音效加载失败：${path}`);
      const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
      if (!this.disposed) this.buffers[bank].push(buffer);
    }));
  }

  get running() { return !this.disposed && !this.hidden && !!this.ctx && this.ctx.state === 'running'; }

  /** @param {AudioListener} listener */
  addListener(listener) { if (this.disposed) throw new Error('AudioManager is disposed'); if (!this.listeners.includes(listener)) this.listeners.push(listener); return listener; }
  /** @param {AudioListener} listener */
  removeListener(listener) { const i = this.listeners.indexOf(listener); if (i >= 0) this.listeners.splice(i, 1); }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  setMuted(muted) {
    if (this.disposed || this.muted === !!muted) return this.muted;
    this.muted = !!muted;
    try { this.storage?.setItem(MUTE_KEY, this.muted ? '1' : '0'); } catch { /* private mode */ }
    this.applyVolume('master');
    return this.muted;
  }

  /** User preference (0..1), independent of per-sound/track mix and pause ducking.
   * @param {'master' | 'music' | 'sfx' | 'voice'} channel
   */
  getVolume(channel) { return this.volumes[channel]; }

  /** @param {'master' | 'music' | 'sfx' | 'voice'} channel @param {number} value */
  setVolume(channel, value) {
    if (this.disposed || !Object.hasOwn(DEFAULT_VOLUMES, channel) || !Number.isFinite(value)) return;
    const level = Math.max(0, Math.min(1, value));
    if (this.volumes[channel] === level) return;
    this.volumes[channel] = level;
    saveVolumes(this.storage, this.volumes);
    this.applyVolume(channel);
  }

  /** Listen to party voice on this page (B / speaker button). Only local playback; the mic and the host mix are untouched. */
  setVoiceListening(listening) {
    if (this.disposed || this.voiceListening === !!listening) return this.voiceListening;
    this.voiceListening = !!listening;
    try { this.storage?.setItem(DEAFENED_KEY, this.voiceListening ? '0' : '1'); } catch { /* private mode */ }
    for (const element of this.voiceElements.values()) element.muted = !this.voiceListening;
    return this.voiceListening;
  }

  applyVolume(channel) {
    if (channel === 'voice') { for (const element of this.voiceElements.values()) element.volume = this.volumes.voice; return; }
    const bus = channel === 'master' ? this.master : channel === 'music' ? this.musicBus : this.sfxBus;
    if (!bus) return;
    const gain = channel === 'master' ? this.muted ? 0 : MASTER * this.volumes.master : this.volumes[channel];
    bus.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.02);
  }

  /**
   * Queue a one-shot for this frame. `key` (0…7, e.g. the cat slot; -1 = shared) scopes the retrigger gap.
   * Numbers only, so callers never allocate.
   */
  post(bank, pan = 0, volume = 1, key = -1, delay = 0, rate = 1) {
    if (!this.running || volume <= 0 || !this.buffers[bank]?.length) return;
    const mix = MIX[bank];
    if (mix.gap > 0) {
      const slot = bank * KEY_SLOTS + (key < 0 ? KEY_SLOTS - 1 : key % KEY_SLOTS), now = this.ctx.currentTime;
      if (now - this.lastPlayed[slot] < mix.gap) return;
      this.lastPlayed[slot] = now;
    }
    // Same bank and timing this frame: merge into the queued request (loudest wins, pan weighted).
    for (let i = 0; i < this.qLength; i++) {
      if (this.qBank[i] !== bank || Math.abs(this.qDelay[i] - delay) > 0.01 || Math.abs(this.qRate[i] - rate) > 0.01) continue;
      const w = this.qWeight[i] + volume;
      this.qPan[i] = (this.qPan[i] * this.qWeight[i] + pan * volume) / w; this.qWeight[i] = w;
      if (volume > this.qVolume[i]) this.qVolume[i] = volume;
      this.stats.merged++; return;
    }
    if (this.qLength === QUEUE) { this.dropped++; return; }
    const i = this.qLength++;
    this.qBank[i] = bank; this.qPan[i] = pan; this.qVolume[i] = volume; this.qDelay[i] = delay; this.qWeight[i] = volume; this.qRate[i] = rate;
  }

  /** Desired state of a loop channel; applied on flush only when it changes. */
  setLoop(channel, bank, active, pan = 0, volume = 1, rate = 1) {
    if (this.disposed || channel < 0 || channel >= LOOP_CHANNELS) return;
    this.loopBank[channel] = active ? bank : -1; this.loopPan[channel] = pan; this.loopVolume[channel] = volume; this.loopRate[channel] = rate;
  }

  /** Audio clock (seconds), for listeners that time holds without allocating. */
  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  /** Once per frame: listeners submit, then the manager flushes one-shots and loops. */
  update(camera) {
    if (this.disposed || this.hidden) return;
    for (let i = 0; i < this.listeners.length; i++) this.listeners[i].audioUpdate(this, camera);
    this.flush();
  }

  flush() {
    if (!this.running) { this.qLength = 0; return; }
    const now = this.ctx.currentTime;
    for (let i = 0; i < this.qLength; i++) this.start(this.qBank[i], this.qPan[i], this.qVolume[i], this.qDelay[i], now, this.qRate[i]);
    this.qLength = 0;
    if (!this.running) return;
    let loopsOn = 0;
    for (let c = 0; c < LOOP_CHANNELS; c++) { this.applyLoop(c, now); if (this.loops[c].current >= 0) loopsOn++; }
    this.applyMusic(now);
    this.applyDuck(now, loopsOn);
  }

  /** Desired background track (MUSIC id, -1 = none), its volume scale and the paused/muffled state. */
  setMusic(track, volume = 1, muffled = false) {
    if (this.disposed) return;
    const m = this.music; m.want = track; m.wantVolume = volume; m.wantMuffled = muffled;
  }

  applyMusic(now) {
    const m = this.music, want = m.want >= 0 && this.musicBuffers[m.want] ? m.want : -1;
    if (want !== m.track) {
      // Crossfade tracks: the old one fades and stops on its own; the new one loops natively.
      if (m.source) { m.gain.gain.cancelScheduledValues(now); m.gain.gain.setTargetAtTime(0, now, 0.35); m.source.stop(now + 2); }
      m.source = m.gain = null; m.track = want;
      if (want >= 0) {
        const info = MUSIC_TRACKS[want], source = this.ctx.createBufferSource(), gain = this.ctx.createGain();
        source.buffer = this.musicBuffers[want]; source.loop = true; source.loopStart = info.loopStart; source.loopEnd = info.loopEnd;
        gain.gain.value = 0; gain.gain.setTargetAtTime(1, now, 0.4);
        source.connect(gain); gain.connect(this.musicIn); source.start(now);
        // Bound crossfading tracks even if callers change music repeatedly.
        if (this.musicSources.size >= 2) {
          const old = this.musicSources.values().next().value;
          old.source.onended = null;
          try { old.source.stop(); } catch { /* already stopped */ }
          old.source.disconnect(); old.gain.disconnect(); this.musicSources.delete(old);
        }
        const entry = { source, gain };
        this.musicSources.add(entry);
        source.onended = () => { source.disconnect(); gain.disconnect(); this.musicSources.delete(entry); };
        m.source = source; m.gain = gain; this.stats.sources++; this.stats.paramWrites++;
      }
    }
    const pause = MUSIC_EQ.paused;
    const volume = want < 0 ? 0 : MUSIC_TRACKS[want].volume * m.wantVolume * (m.wantMuffled ? pause.volume : 1);
    if (Math.abs(volume - m.volume) > 0.01) { this.musicVolume.gain.setTargetAtTime(volume, now, 0.3); m.volume = volume; this.stats.paramWrites++; }
    if (m.wantMuffled !== m.muffled) {
      this.pauseFilter.frequency.setTargetAtTime(m.wantMuffled ? pause.lowpass : 20000, now, 0.15);
      m.muffled = m.wantMuffled; this.stats.paramWrites++;
    }
  }

  /** Effects push the music back: fast dip on the effect's band and level, slow release; loops hold it partly. */
  applyDuck(now, loopsOn) {
    const d = this.duck, eq = MUSIC_EQ.duck;
    if (now >= d.until) d.depth = 0;
    const depth = Math.max(loopsOn > 0 ? 0.5 : 0, d.depth) * this.volumes.sfx;
    if (depth === d.applied || depth > 0 && Math.abs(depth - d.applied) < 0.05) return;
    const tau = depth > d.applied ? eq.attack : eq.release;
    this.duckEq.gain.setTargetAtTime(eq.gainDb * depth, now, tau);
    this.duckLevel.gain.setTargetAtTime(Math.pow(10, eq.levelDb * depth / 20), now, tau);
    d.applied = depth; this.stats.paramWrites += 2;
  }

  start(bank, pan, volume, delay, now, baseRate = 1) {
    const buffers = this.buffers[bank], mix = MIX[bank];
    // Rotate variants without immediate repeats.
    const turn = this.turn[bank] + 1 + Math.floor(Math.random() * Math.max(1, buffers.length - 1));
    this.turn[bank] = turn;
    const buffer = buffers[turn % buffers.length];
    const rate = baseRate * (1 + (Math.random() * 2 - 1) * mix.pitch);
    const voice = this.voice(now, mix.priority);
    if (!voice) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer; source.playbackRate.value = rate;
    voice.gain.gain.value = mix.gain * volume;
    if (voice.pan) voice.pan.pan.value = clampPan(pan);
    source.connect(voice.gain); source.onended = voice.release; source.start(now + delay);
    voice.source = source; voice.endsAt = now + delay + buffer.duration / rate; voice.priority = mix.priority;
    this.stats.sources++;
    // Rewards duck the music fully; hits and pops only partly; hold through the sound's body.
    const depth = (mix.priority >= 3 ? 1 : 0.6) * Math.min(1, volume), hold = now + delay + Math.min(0.6, buffer.duration / rate);
    if (hold > this.duck.until) this.duck.until = hold;
    if (depth > this.duck.depth) this.duck.depth = depth;
  }

  /** A free pooled voice, else the lowest-priority one closest to finishing. */
  voice(now, priority) {
    let best = null;
    for (let i = 0; i < POOL; i++) {
      const v = this.voices[i];
      if (!v.source || v.endsAt <= now) { if (v.source) this.stop(v); return v; }
      if (v.priority <= priority && (!best || v.priority < best.priority || (v.priority === best.priority && v.endsAt < best.endsAt))) best = v;
    }
    if (best) { this.stop(best); this.stats.stolen++; }
    return best;
  }

  stop(chain) {
    const source = chain.source;
    if (!source) return;
    source.onended = null;
    try { source.stop(); } catch { /* already stopped */ }
    source.disconnect(); chain.source = null;
  }

  applyLoop(c, now) {
    const loop = this.loops[c], bank = this.loopBank[c];
    if (bank < 0 || !this.buffers[bank]?.length) {
      if (loop.current >= 0) this.fadeOut(loop.chains[loop.current], now);
      loop.current = -1; loop.bank = -1; return;
    }
    const target = MIX[bank].gain * this.loopVolume[c], pan = clampPan(this.loopPan[c]), rate = this.loopRate[c];
    if (loop.bank !== bank || loop.current < 0) {
      if (loop.current >= 0) this.fadeOut(loop.chains[loop.current], now);
      loop.current = loop.current === 0 ? 1 : 0;
      const chain = loop.chains[loop.current];
      this.stop(chain);
      const source = this.ctx.createBufferSource();
      source.buffer = this.buffers[bank][0]; source.loop = true; source.playbackRate.value = rate;
      chain.gain.gain.cancelScheduledValues(now); chain.gain.gain.setValueAtTime(0, now);
      chain.gain.gain.setTargetAtTime(target, now, 0.025);
      if (chain.pan) chain.pan.pan.setValueAtTime(pan, now);
      source.connect(chain.gain); source.onended = chain.release;
      // Random start point so several loops of the same bank never phase together.
      source.start(now, Math.random() * source.buffer.duration);
      chain.source = source;
      loop.bank = bank; loop.volume = target; loop.pan = pan; loop.rate = rate; this.stats.sources++; this.stats.paramWrites += 2;
      return;
    }
    const chain = loop.chains[loop.current];
    // Only write AudioParams on real changes; per-frame writes would queue automation events forever.
    if (Math.abs(target - loop.volume) > 0.02) { chain.gain.gain.setTargetAtTime(target, now, 0.05); loop.volume = target; this.stats.paramWrites++; }
    if (chain.pan && Math.abs(pan - loop.pan) > 0.04) { chain.pan.pan.setTargetAtTime(pan, now, 0.05); loop.pan = pan; this.stats.paramWrites++; }
    // Pitch glides (progress tone) in ~1/6-semitone steps, smoothed so it never stairs audibly.
    if (Math.abs(rate - loop.rate) > 0.01 && chain.source) { chain.source.playbackRate.setTargetAtTime(rate, now, 0.08); loop.rate = rate; this.stats.paramWrites++; }
  }

  fadeOut(chain, now) {
    if (!chain.source) return;
    chain.gain.gain.cancelScheduledValues(now);
    chain.gain.gain.setTargetAtTime(0, now, 0.04);
    chain.source.stop(now + 0.3);
  }

  /** Clear scene sounds immediately, including delayed rewards and fading loops. Keep the service and bank. */
  registerReadiness(resources) {
    resources.addAsset('音效与音乐', this.ready, { optional: true, onError: error => console.warn('音效不可用', error) });
  }

  reset({ music = false } = {}) {
    this.qLength = 0; this.lastPlayed.fill(-1e9); this.loopBank.fill(-1);
    for (const voice of this.voices) this.stop(voice);
    for (const loop of this.loops) {
      for (const chain of loop.chains) this.stop(chain);
      loop.current = loop.bank = -1;
    }
    for (const listener of this.listeners) listener.reset?.();
    if (music) {
      for (const { source, gain } of this.musicSources) {
        source.onended = null;
        try { source.stop(); } catch { /* already stopped */ }
        source.disconnect(); gain.disconnect();
      }
      this.musicSources.clear();
      this.music.source = this.music.gain = null; this.music.track = this.music.want = -1;
    }
  }

  /** Remote party voice (VoiceChat): one element per remote stream, `null` removes it. Only the voice volume applies —
   * the game mute, scene resets and hidden tabs leave a conversation running; dispose ends it. */
  setVoiceStream(key, stream) {
    let element = this.voiceElements.get(key);
    if (!stream || this.disposed) {
      if (element) { element.pause(); element.srcObject = null; this.voiceElements.delete(key); }
      return;
    }
    if (!element) {
      try { element = this.createVoiceElement(); } catch { return; }
      element.autoplay = true; this.voiceElements.set(key, element);
    }
    if (element.srcObject !== stream) element.srcObject = stream;
    element.volume = this.volumes.voice; element.muted = !this.voiceListening;
    element.play()?.catch?.(() => {}); // blocked until a gesture; unlock retries
  }

  /** Hidden browsers keep host authority ticking, but do not keep local sounds alive. */
  setHidden(hidden) {
    if (this.hidden === hidden || this.disposed) return;
    this.hidden = hidden; this.reset({ music: true });
  }

  /** Permanent teardown; returning home only uses reset. */
  dispose() {
    if (this.disposed) return;
    this.reset({ music: true });
    for (const key of [...this.voiceElements.keys()]) this.setVoiceStream(key, null);
    for (const listener of [...this.listeners]) listener.dispose?.();
    this.listeners.length = 0;
    if (this.unlockTarget && this.unlock) for (const type of ['pointerdown', 'keydown', 'touchend']) this.unlockTarget.removeEventListener(type, this.unlock, true);
    for (const chain of [...this.voices, ...this.loops.flatMap(loop => loop.chains)]) { chain.gain.disconnect(); chain.pan?.disconnect(); }
    this.sfxBus?.disconnect(); this.musicBus?.disconnect();
    this.buffers.forEach(bank => { bank.length = 0; }); this.musicBuffers.fill(null);
    this.disposed = true;
    this.ctx?.close?.().catch(() => {});
  }
}

const clampPan = (pan) => (pan < -1 ? -1 : pan > 1 ? 1 : pan || 0);
function readMuted(storage) { return readFlag(storage, MUTE_KEY); }
function readFlag(storage, key) { try { return storage?.getItem(key) === '1'; } catch { return false; } }
function saveVolumes(storage, volumes) {
  try { storage?.setItem(VOLUME_KEY, JSON.stringify({ ...volumes, revision: VOLUME_REVISION })); } catch { /* private mode */ }
}
function readVolumes(storage) {
  const levels = { ...DEFAULT_VOLUMES };
  try {
    const saved = JSON.parse(storage?.getItem(VOLUME_KEY) || 'null');
    for (const key of Object.keys(levels)) if (typeof saved?.[key] === 'number' && Number.isFinite(saved[key])) {
      levels[key] = Math.max(0, Math.min(1, saved[key]));
    }
    // Saved before revision 2: a full voice volume was the old default, not a choice. Re-save once with the revision.
    if (saved && saved.revision !== VOLUME_REVISION) {
      if (saved.voice === 1) levels.voice = DEFAULT_VOLUMES.voice;
      saveVolumes(storage, levels);
    }
  } catch { /* Missing/corrupt/blocked preferences keep the original mix. */ }
  return levels;
}

function defaultStorage() { try { return globalThis.localStorage ?? null; } catch { return null; } }
async function settleLoads(promises) {
  const results = await Promise.allSettled(promises);
  const failed = results.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
}
