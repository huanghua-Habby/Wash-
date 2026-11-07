import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioManager } from '../client/js/audio/AudioManager.js';
import { SFX, MUSIC, MUSIC_TRACKS, MUSIC_EQ } from '../client/js/audio/sounds.js';

/** Minimal Web Audio stand-in that counts node creation and AudioParam writes. */
function fakeContext() {
  const counts = { gain: 0, pan: 0, source: 0, paramWrites: 0, started: 0, stopped: 0 };
  const param = (value = 0) => ({ value, lastTarget: value,
    setTargetAtTime(target: number) { this.lastTarget = target; counts.paramWrites++; }, setValueAtTime() { counts.paramWrites++; }, cancelScheduledValues() {} });
  const node = () => ({ connections: [] as any[], connect(target: any) { this.connections.push(target); }, disconnect() { this.connections.length = 0; } });
  class Context {
    state = 'running'; currentTime = 0; destination = node();
    constructor() { (globalThis as any).__ctx = this; }
    resume() { return Promise.resolve(); }
    createGain() { counts.gain++; return { ...node(), gain: param(1) }; }
    createStereoPanner() { counts.pan++; return { ...node(), pan: param(0) }; }
    createBiquadFilter() { return { ...node(), type: '', frequency: param(350), Q: param(1), gain: param(0) }; }
    createDynamicsCompressor() { return { ...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }; }
    createBufferSource() {
      counts.source++;
      return { ...node(), buffer: null as any, loop: false, onended: null as any, playbackRate: param(1),
        start() { counts.started++; }, stop() { counts.stopped++; } };
    }
    decodeAudioData(data: any) { return Promise.resolve({ duration: data.duration }); }
  }
  return { Context, counts };
}

async function setup() {
  const { Context, counts } = fakeContext();
  const files: Record<string, string> = {};
  for (const name of ['jump_1', 'jump_2', 'land_1', 'pop_1', 'clean', 'spray_loop', 'soap_loop', 'fall_hit']) files[`../../assets/audio/${name}.wav`] = name;
  const musicFiles = { '../../assets/music/menu.mp3': 'menu-music', '../../assets/music/game.mp3': 'game-music' };
  const fetch = async (url: string) => ({ ok: true, arrayBuffer: async () => ({ duration: url.includes('music') ? 120 : url.includes('loop') ? 2 : 0.2 }) });
  const manager = new AudioManager({ files, musicFiles, Context, fetch: fetch as any, storage: null, target: null });
  await manager.ready;
  const ctx = (globalThis as any).__ctx;
  return { manager, counts, ctx, nodesAtBoot: { gain: counts.gain, pan: counts.pan } };
}

test('variants load into numeric banks', async () => {
  const { manager } = await setup();
  assert.equal(manager.buffers[SFX.jump].length, 2);
  assert.equal(manager.buffers[SFX.spray_loop].length, 1);
});

test('user music/SFX/master buses change playing sounds independently without creating sources', async () => {
  const { manager, counts } = await setup();
  manager.setMusic(MUSIC.menu); manager.setLoop(0, SFX.spray_loop, true); manager.post(SFX.pop); manager.flush();
  const musicSource = manager.music.source, loopSource = manager.loops[0].chains[0].source;
  const sources = counts.source, gains = counts.gain;
  manager.setVolume('music', .25);
  assert.equal(manager.getVolume('music'), .25);
  assert.equal((manager.musicBus.gain as any).lastTarget, .25);
  assert.equal(manager.sfxBus.gain.value, 1);
  manager.setVolume('sfx', 0); manager.flush();
  assert.equal((manager.sfxBus.gain as any).lastTarget, 0);
  assert.equal(manager.duck.applied, 0, 'muted SFX do not duck the background music');
  assert.ok(manager.voices.every((voice: any) => voice.pan.connections.includes(manager.sfxBus)));
  assert.ok((manager.musicVolume as any).connections.includes(manager.musicBus));
  manager.setVolume('master', .4); manager.setMuted(true); manager.setVolume('master', .3);
  assert.equal((manager.master.gain as any).lastTarget, 0, 'sliders retain mute');
  manager.toggleMute(); assert.ok(Math.abs((manager.master.gain as any).lastTarget - .24) < 1e-10);
  assert.equal(manager.music.source, musicSource); assert.equal(manager.loops[0].chains[0].source, loopSource);
  assert.equal(counts.source, sources); assert.equal(counts.gain, gains);
  const writes = counts.paramWrites; manager.setVolume('music', .25); assert.equal(counts.paramWrites, writes);
});

test('audio preferences persist independently of progress, with safe defaults for invalid or unavailable storage', async () => {
  const values = new Map<string, string>(), storage: any = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
  const a = new AudioManager({ Context: null, target: null, storage }); await a.ready;
  a.setVolume('master', .7); a.setVolume('music', 0); a.setVolume('sfx', .4); a.setMuted(true);
  const b = new AudioManager({ Context: null, target: null, storage }); await b.ready;
  assert.deepEqual(b.volumes, { master: .7, music: 0, sfx: .4, voice: .5 }); assert.equal(b.muted, true);
  b.reset(); assert.deepEqual(b.volumes, a.volumes, 'scene reset preserves user levels');
  b.setVolume('sfx', NaN); assert.equal(b.getVolume('sfx'), .4);
  values.set('wash-audio-volumes', '{"master":3,"music":-1,"sfx":"0.3"}');
  const c = new AudioManager({ Context: null, target: null, storage });
  assert.deepEqual(c.volumes, { master: 1, music: 0, sfx: 1, voice: .5 });
  values.set('wash-audio-volumes', 'broken');
  const d = new AudioManager({ Context: null, target: null, storage }); assert.deepEqual(d.volumes, { master: 1, music: 1, sfx: 1, voice: .5 });
  const blocked: any = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const e = new AudioManager({ Context: null, target: null, storage: blocked });
  e.setVolume('music', .2); e.setMuted(true); assert.equal(e.getVolume('music'), .2);
  for (const manager of [a, b, c, d, e]) manager.dispose();
  assert.ok([...values.keys()].every(key => key.startsWith('wash-audio-')));
});

test('party voice defaults to 50%; an unrevised saved 100% reads as the old default once, a later chosen 100% stays', () => {
  const values = new Map<string, string>(), storage: any = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
  values.set('wash-audio-volumes', '{"master":0.8,"music":1,"sfx":1,"voice":1}');
  const a = new AudioManager({ Context: null, target: null, storage });
  assert.deepEqual(a.volumes, { master: .8, music: 1, sfx: 1, voice: .5 });
  a.setVolume('voice', 1);
  const b = new AudioManager({ Context: null, target: null, storage });
  assert.equal(b.getVolume('voice'), 1, 'a full volume chosen after the revision is kept');
  values.set('wash-audio-volumes', '{"voice":0.3}');
  assert.equal(new AudioManager({ Context: null, target: null, storage }).getVolume('voice'), .3, 'any other old choice is kept');
  for (const manager of [a, b]) manager.dispose();
});

test('the listen toggle mutes only local voice playback and persists per browser', () => {
  const values = new Map<string, string>(), storage: any = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
  const element = () => ({ volume: 1, muted: false, paused: true, srcObject: null as any, play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } });
  const a = new AudioManager({ Context: null, target: null, storage, createVoiceElement: element });
  assert.equal(a.voiceListening, true);
  a.setVoiceStream('p1', {} as any); const first = a.voiceElements.get('p1');
  a.setVoiceListening(false); assert.equal(first.muted, true);
  a.setVoiceStream('p2', {} as any); assert.equal(a.voiceElements.get('p2').muted, true, 'a voice joining later stays silent');
  assert.equal(first.volume, .5, 'the voice volume is untouched');
  const b = new AudioManager({ Context: null, target: null, storage, createVoiceElement: element });
  assert.equal(b.voiceListening, false, 'remembered per browser');
  b.setVoiceListening(true); b.setVoiceStream('p1', {} as any); assert.equal(b.voiceElements.get('p1').muted, false);
  for (const manager of [a, b]) manager.dispose();
});

test('one-shots reuse the pooled chains: a play creates only the required source node', async () => {
  const { manager, counts, ctx, nodesAtBoot } = await setup();
  const handlers = new Set();
  for (let frame = 0; frame < 200; frame++) {
    ctx.currentTime = frame * 0.5;
    manager.post(SFX.pop, 0.2, 1);
    manager.flush();
    handlers.add((manager.voices.find((v: any) => v.source) as any)?.source.onended);
  }
  assert.equal(counts.gain, nodesAtBoot.gain, 'no gain nodes created after boot');
  assert.equal(counts.pan, nodesAtBoot.pan, 'no panners created after boot');
  assert.equal(counts.source, 200);
  assert.ok(handlers.size <= manager.voices.length, 'onended handlers are the pre-bound pool releases');
});

test('requests for the same bank in one frame merge into one voice', async () => {
  const { manager, counts } = await setup();
  for (let cat = 0; cat < 4; cat++) manager.post(SFX.land, cat % 2 ? 0.5 : -0.5, 0.5 + cat * 0.1, cat);
  manager.post(SFX.pop, 0, 1);
  manager.flush();
  assert.equal(counts.source, 2, 'four landings + one pop = two sources');
  assert.equal(manager.stats.merged, 3);
  assert.equal(manager.qLength, 0);
});

test('retrigger gap is per key: the same cat cannot double-fire, another cat can', async () => {
  const { manager, ctx } = await setup();
  manager.post(SFX.jump, 0, 1, 0); manager.flush();
  ctx.currentTime = 0.02;
  manager.post(SFX.jump, 0, 1, 0); assert.equal(manager.qLength, 0, 'same cat inside the gap');
  manager.post(SFX.jump, 0, 1, 1); assert.equal(manager.qLength, 1, 'other cat plays');
});

test('a full pool steals the lowest-priority voice closest to finishing; rewards are never stolen by hits', async () => {
  const { manager, counts } = await setup();
  for (let i = 0; i < manager.voices.length; i++) { manager.post(SFX.clean, 0, 1, -1, i * 0.001); manager.flush(); }
  manager.post(SFX.land, 0, 1); manager.flush();
  assert.equal(manager.stats.stolen, 0, 'a lower-priority hit cannot steal a reward voice');
  const sources = counts.source;
  manager.post(SFX.clean, 0, 1, -1, 0.5); manager.flush();
  assert.equal(manager.stats.stolen, 1); assert.equal(counts.source, sources + 1);
});

test('loops touch AudioParams only when their target changes, never every frame', async () => {
  const { manager, counts, ctx } = await setup();
  manager.setLoop(0, SFX.spray_loop, true, 0.1, 1); manager.flush();
  const afterStart = counts.paramWrites, sourcesAfterStart = counts.source;
  for (let frame = 0; frame < 600; frame++) {
    ctx.currentTime = frame / 60;
    manager.setLoop(0, SFX.spray_loop, true, 0.1 + (frame % 2) * 0.01, 1); // tiny jitter below threshold
    manager.flush();
  }
  assert.equal(counts.paramWrites, afterStart, 'steady loop: zero automation events over 10 s');
  assert.equal(counts.source, sourcesAfterStart, 'loop source started once');
  manager.setLoop(0, SFX.spray_loop, true, 0.8, 1); manager.flush();
  assert.equal(counts.paramWrites, afterStart + 1, 'a real pan move writes once');
  manager.setLoop(0, SFX.soap_loop, true, 0, 1); manager.flush();
  assert.equal(counts.source, sourcesAfterStart + 1, 'bank change crossfades to the other chain');
  manager.setLoop(0, SFX.soap_loop, false); manager.flush();
  assert.equal(manager.loops[0].current, -1);
});

test('listeners are asked once per update, then the queue is flushed in the same frame', async () => {
  const { manager, counts } = await setup();
  let calls = 0;
  const listener = { audioUpdate(m: any) { calls++; m.post(SFX.pop, 0, 1); } };
  manager.addListener(listener); manager.addListener(listener);
  manager.update(null);
  assert.equal(calls, 1, 'duplicate registration ignored');
  assert.equal(counts.source, 1);
  manager.removeListener(listener); manager.update(null);
  assert.equal(calls, 1);
});

test('without Web Audio the manager is a silent no-op', async () => {
  const manager = new AudioManager({ Context: null, storage: null, target: null });
  await manager.ready;
  manager.post(SFX.pop); manager.setLoop(0, SFX.spray_loop, true); manager.update(null);
  assert.equal(manager.running, false);
});

test('music loops natively between its bar-aligned points and crossfades on track change', async () => {
  const { manager, counts } = await setup();
  manager.setMusic(MUSIC.menu); manager.flush();
  const menu = manager.music.source as any;
  assert.equal(menu.loop, true);
  assert.equal(menu.loopStart, MUSIC_TRACKS[MUSIC.menu].loopStart);
  assert.equal(menu.loopEnd, MUSIC_TRACKS[MUSIC.menu].loopEnd);
  const sources = counts.source;
  for (let i = 0; i < 300; i++) { manager.setMusic(MUSIC.menu); manager.flush(); }
  assert.equal(counts.source, sources, 'steady music: no new sources');
  manager.setMusic(MUSIC.game); manager.flush();
  assert.equal(counts.source, sources + 1);
  assert.equal(counts.stopped, 1, 'previous track is scheduled to stop after its fade');
});

test('music sits behind effects: carved bus, effects duck it and it recovers; steady state writes nothing', async () => {
  const { manager, ctx } = await setup();
  manager.setMusic(MUSIC.game); manager.flush();
  assert.equal(manager.musicVolume.gain.value, 0, 'music fades in from silence');
  const writes = () => manager.stats.paramWrites;
  for (let i = 0; i < 120; i++) { ctx.currentTime = 1 + i / 60; manager.setMusic(MUSIC.game); manager.flush(); }
  const steady = writes();
  for (let i = 0; i < 120; i++) { ctx.currentTime = 3 + i / 60; manager.setMusic(MUSIC.game); manager.flush(); }
  assert.equal(writes(), steady, 'no AudioParam writes while nothing changes');
  manager.post(SFX.clean); manager.flush();
  assert.equal(manager.duck.applied, 1, 'a reward ducks the music fully');
  manager.post(SFX.pop, 0, 1); manager.flush();
  ctx.currentTime += 1; manager.flush();
  assert.equal(manager.duck.applied, 0, 'released after the sound');
  manager.setLoop(0, SFX.spray_loop, true); manager.flush();
  assert.equal(manager.duck.applied, 0.5, 'a running loop holds a partial duck');
  assert.ok(MUSIC_EQ.carve.every((band) => band.gain < 0));
});

test('pause muffles the music to half volume and restores it', async () => {
  const { manager } = await setup();
  manager.setMusic(MUSIC.game, 1, true); manager.flush();
  assert.equal(manager.music.volume, MUSIC_TRACKS[MUSIC.game].volume * MUSIC_EQ.paused.volume);
  assert.equal(manager.music.muffled, true);
  manager.setMusic(MUSIC.game, 1, false); manager.flush();
  assert.equal(manager.music.muffled, false);
  assert.equal(manager.music.volume, MUSIC_TRACKS[MUSIC.game].volume);
});

test('loop pitch glides only on real rate changes', async () => {
  const { manager, counts } = await setup();
  manager.setLoop(12, SFX.soap_loop, true, 0, 1, 0.7); manager.flush();
  const base = counts.paramWrites;
  for (let i = 0; i < 100; i++) { manager.setLoop(12, SFX.soap_loop, true, 0, 1, 0.7 + (i % 2) * 0.004); manager.flush(); }
  assert.equal(counts.paramWrites, base, 'sub-threshold jitter writes nothing');
  manager.setLoop(12, SFX.soap_loop, true, 0, 1, 0.9); manager.flush();
  assert.equal(counts.paramWrites, base + 1);
  assert.ok(Math.abs(manager.loops[12].rate - 0.9) < 1e-6);
});

test('reset cancels delayed rewards and every loop chain while reusing decoded resources', async () => {
  const { manager } = await setup();
  manager.post(SFX.clean, 0, 1, -1, .22); manager.flush();
  manager.setLoop(0, SFX.spray_loop, true); manager.flush();
  const banks = manager.buffers, gains = manager.voices.map((v: any) => v.gain);
  manager.reset();
  assert.equal(manager.qLength, 0);
  assert.ok(manager.voices.every((v: any) => !v.source));
  assert.ok(manager.loops.every((loop: any) => loop.current === -1 && loop.chains.every((v: any) => !v.source)));
  assert.equal(manager.buffers, banks); assert.deepEqual(manager.voices.map((v: any) => v.gain), gains);
  manager.post(SFX.clean); manager.flush(); assert.ok(manager.voices.some((v: any) => v.source));
});

test('disposing releases unlock listeners, fading music and scene listeners exactly once', async () => {
  const { Context, counts } = fakeContext();
  const target = new EventTarget(); let resumes = 0, disposed = 0;
  const manager = new AudioManager({ Context, target, storage: null }); await manager.ready;
  const ctx = (globalThis as any).__ctx; ctx.state = 'suspended'; ctx.resume = async () => { resumes++; };
  target.dispatchEvent(new Event('pointerdown')); assert.equal(resumes, 1);
  manager.addListener({ audioUpdate() {}, dispose() { disposed++; } } as any);
  ctx.state = 'running'; manager.musicBuffers[0] = { duration: 120 } as any; manager.musicBuffers[1] = { duration: 120 } as any;
  manager.setMusic(0); manager.flush(); manager.setMusic(1); manager.flush();
  assert.equal(manager.musicSources.size, 2);
  manager.dispose(); manager.dispose();
  assert.equal(manager.musicSources.size, 0); assert.equal(disposed, 1); assert.equal(manager.listeners.length, 0);
  ctx.state = 'suspended'; target.dispatchEvent(new Event('keydown')); assert.equal(resumes, 1);
  const started = counts.started; manager.post(SFX.clean); manager.update(null); assert.equal(counts.started, started);
});
