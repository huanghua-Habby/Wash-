import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceChat } from '../client/js/online/VoiceChat.js';
import { AudioManager } from '../client/js/audio/AudioManager.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function track(kind = 'audio') { return { kind, enabled: true, stopped: false, stop() { this.stopped = true; } }; }
function stream(...tracks: any[]) { return { getTracks: () => tracks, getAudioTracks: () => tracks.filter(t => t.kind === 'audio') }; }

/** Media graph stand-in: each node records what it is connected to. */
function fakeContext() {
  const nodes: any[] = [];
  class Context {
    state = 'running'; closed = false;
    resume() { return Promise.resolve(); }
    close() { this.closed = true; return Promise.resolve(); }
    createMediaStreamDestination() { const node = { stream: stream(track()), id: `mix${nodes.length}` }; nodes.push(node); return node; }
    createMediaStreamSource(input: any) {
      const node = { input, targets: new Set<any>(), connect(target: any) { this.targets.add(target); }, disconnect() { this.targets.clear(); } };
      nodes.push(node); return node;
    }
  }
  return { Context, nodes };
}

function transceiver() { return { sender: { track: null as any, replaceTrack(t: any) { this.track = t; return Promise.resolve(); } } }; }

function setup({ getUserMedia = async () => stream(track()), secure = true, Context = fakeContext().Context } = {}) {
  const played = new Map<string, any>(), storage = new Map<string, string>();
  const audio = { setVoiceStream(key: string, s: any) { if (s) played.set(key, s); else played.delete(key); } };
  const voice = new VoiceChat({ audio, media: { getUserMedia }, secure, Context, target: null,
    storage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) } as any });
  return { voice, played, storage };
}

test('voice stays closed while solo and opens the microphone when a guest link attaches', async () => {
  let asked = 0;
  const { voice } = setup({ getUserMedia: async () => { asked++; return stream(track()); } });
  assert.equal(voice.active, false); assert.equal(voice.mic, 'off'); assert.equal(asked, 0);
  const link = {}, tx = transceiver();
  voice.attach(link, tx, { mixed: false });
  assert.equal(voice.mic, 'pending');
  await flush();
  assert.equal(asked, 1); assert.equal(voice.mic, 'on');
  assert.equal(tx.sender.track, voice.micTrack, 'a guest sends its raw microphone to the host');
});

test('guest plays the host mix and mute disables only the outgoing microphone', async () => {
  const { voice, played, storage } = setup();
  const link: any = {}, tx = transceiver(), remote = stream(track());
  voice.attach(link, tx, { mixed: false }); await flush();
  voice.received(link, remote);
  assert.equal([...played.values()][0], remote); assert.equal(voice.peers, 1);
  voice.toggleMute();
  assert.equal(voice.micTrack.enabled, false); assert.equal(storage.get('wash-voice-muted'), '1');
  assert.equal(played.size, 1, 'muting the microphone keeps hearing teammates');
  voice.setMuted(false); assert.equal(voice.micTrack.enabled, true);
});

test('saved mute applies to a newly opened microphone', async () => {
  const { voice, storage } = setup();
  storage.set('wash-voice-muted', '1');
  const fresh = new VoiceChat({ audio: { setVoiceStream() {} }, media: { getUserMedia: async () => stream(track()) }, Context: fakeContext().Context,
    target: null, storage: { getItem: (k: string) => storage.get(k) ?? null, setItem() {} } as any });
  fresh.attach({}, transceiver(), { mixed: false }); await flush();
  assert.equal(fresh.muted, true); assert.equal(fresh.micTrack.enabled, false);
  voice.dispose(); fresh.dispose();
});

test('host sends each guest its own mix: host microphone plus the other guests, never their own voice', async () => {
  const { Context, nodes } = fakeContext();
  const { voice, played } = setup({ Context });
  const a: any = {}, b: any = {}, c: any = {}, ta = transceiver(), tb = transceiver(), tc = transceiver();
  voice.attach(a, ta, { mixed: true }); voice.attach(b, tb, { mixed: true }); voice.attach(c, tc, { mixed: true });
  await flush();
  const [voiceA, voiceB, voiceC] = [stream(track()), stream(track()), stream(track())];
  voice.received(a, voiceA); voice.received(b, voiceB); voice.received(c, voiceC);
  assert.equal(played.size, 3, 'the host hears every guest');
  const entry = (link: any) => voice.links.get(link)!;
  for (const [link, tx] of [[a, ta], [b, tb], [c, tc]] as const) assert.equal(tx.sender.track, entry(link).destination.stream.getAudioTracks()[0]);
  const mic = voice.micSource, source = (s: any) => nodes.find(n => n.input === s);
  for (const link of [a, b, c]) assert.ok(mic.targets.has(entry(link).destination), 'host microphone reaches every guest');
  assert.deepEqual([...source(voiceA).targets].sort(), [entry(b).destination, entry(c).destination].sort());
  assert.ok(!source(voiceA).targets.has(entry(a).destination), 'no guest hears themselves');
  voice.detach(b);
  assert.deepEqual([...source(voiceA).targets], [entry(c).destination], 'a departed guest leaves every mix');
  assert.equal(played.size, 2);
});

test('last link closing releases the microphone after a short grace period; a quick re-link keeps it', async () => {
  const { voice } = setup();
  const link = {};
  voice.attach(link, transceiver(), { mixed: false }); await flush();
  const mic = voice.micTrack;
  voice.detach(link);
  voice.attach({}, transceiver(), { mixed: false });
  await new Promise(resolve => setTimeout(resolve, 3100));
  assert.equal(voice.micTrack, mic); assert.equal(mic.stopped, false, 'reconnect within the grace period reuses the mic');
  voice.detach([...voice.links.keys()][0]);
  await new Promise(resolve => setTimeout(resolve, 3100));
  assert.equal(mic.stopped, true); assert.equal(voice.mic, 'off'); assert.equal(voice.micStream, null);
});

test('insecure pages and denied permission fall back to listen-only; retry asks again', async () => {
  const insecure = setup({ secure: false }).voice;
  insecure.attach({}, transceiver(), { mixed: false });
  assert.equal(insecure.mic, 'unsupported');
  let allow = false;
  const { voice, played } = setup({ getUserMedia: async () => { if (!allow) throw Object.assign(new Error('no'), { name: 'NotAllowedError' }); return stream(track()); } });
  const link = {}, tx = transceiver();
  voice.attach(link, tx, { mixed: false }); await flush();
  assert.equal(voice.mic, 'blocked'); assert.equal(tx.sender.track, null);
  voice.received(link, stream(track())); assert.equal(played.size, 1, 'listen-only still plays teammates');
  allow = true; voice.requestMic(); await flush();
  assert.equal(voice.mic, 'on'); assert.equal(tx.sender.track, voice.micTrack);
  insecure.dispose(); voice.dispose();
});

test('a microphone granted after leaving the party is stopped immediately', async () => {
  let resolve: (s: any) => void = () => {};
  const { voice } = setup({ getUserMedia: () => new Promise(r => { resolve = r; }) });
  const link = {};
  voice.attach(link, transceiver(), { mixed: false }); await flush();
  voice.detach(link); voice.release();
  const late = stream(track()); resolve(late); await flush();
  assert.equal(late.getTracks()[0].stopped, true); assert.equal(voice.micStream, null);
});

test('AudioManager plays voice on media elements with its own volume, outside game mute and resets', () => {
  const elements: any[] = [];
  const createVoiceElement = () => { const el = { srcObject: null as any, volume: 1, autoplay: false, paused: true,
    play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } }; elements.push(el); return el; };
  const store = new Map<string, string>();
  const audio = new AudioManager({ Context: null, target: null, createVoiceElement,
    storage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) } as any });
  const remote = {};
  audio.setVoiceStream('voice-1', remote as any);
  assert.equal(elements[0].srcObject, remote); assert.equal(elements[0].paused, false);
  audio.setVolume('voice', 0.4); assert.equal(elements[0].volume, 0.4);
  assert.equal(JSON.parse(store.get('wash-audio-volumes')!).voice, 0.4);
  audio.setMuted(true); audio.reset({ music: true }); audio.setHidden(true);
  assert.equal(elements[0].paused, false, 'game mute, scene resets and hidden tabs keep the conversation');
  audio.setVoiceStream('voice-1', null);
  assert.equal(elements[0].srcObject, null); assert.equal(elements[0].paused, true);
  audio.setVoiceStream('voice-2', remote as any); audio.dispose();
  assert.equal(elements[1].paused, true, 'dispose ends voice playback');
});
