import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GameAudio } from '../client/js/audio/GameAudio.js';
import { SFX, BANK_NAMES } from '../client/js/audio/sounds.js';

/** Records what the listener submits to the manager. */
function fakeManager() {
  const posts: { bank: string; pan: number; volume: number; key: number; delay: number; rate: number }[] = [];
  const loops = new Map<number, string>();
  const rates = new Map<number, number>();
  let stopped = 0;
  const manager: any = {
    posts, loops, rates, listeners: [] as any[], now: 0,
    addListener(l: any) { this.listeners.push(l); },
    post(bank: number, pan = 0, volume = 1, key = -1, delay = 0, rate = 1) { posts.push({ bank: BANK_NAMES[bank], pan, volume, key, delay, rate }); },
    music: null as any,
    setMusic(track: number, volume: number, muffled: boolean) { this.music = { track, volume, muffled }; },
    setLoop(channel: number, bank: number, active: boolean, _pan = 0, _volume = 1, rate = 1) {
      if (active) { loops.set(channel, BANK_NAMES[bank]); rates.set(channel, rate); } else loops.delete(channel);
    },
    played: () => posts.map((p) => p.bank).filter((b) => b !== 'progress_bubble'),
    clear() { posts.length = 0; },
    get stopped() { return stopped; },
  };
  return manager;
}

function setup() {
  const manager = fakeManager();
  const players = [0, 1].map(() => ({ root: Object.assign(new THREE.Object3D(), { visible: true }), useAction: '', onSound: null as any }));
  const stain = () => ({ stage: 0, progress: 0, steps: ['soap', 'wipe'], done: false, mesh: new THREE.Object3D() });
  const gun = { spraying: false, holder: null as any, mesh: new THREE.Object3D(), sprayTarget: new THREE.Vector3(5, 0, 5) };
  const game: any = { active: true, practice: false, paused: false, ended: false, equipmentVisible: true,
    order: { serial: 3, paid: false, stains: [stain(), stain()] }, waterguns: [gun] };
  const audio = new GameAudio({ manager, game, players, localPlayer: () => players[0] });
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 5, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const frame = () => audio.audioUpdate(manager, camera);
  return { manager, players, game, gun, audio, frame };
}

test('the game listener registers itself with the audio manager', () => {
  const { manager, audio } = setup();
  assert.deepEqual(manager.listeners, [audio]);
});

test('Ready stops action loops and reactions; final-ten cues play once per observed second and never replay after pause/reset', () => {
  const { manager, game, gun, players, audio, frame } = setup();
  game.roundStage = 'ready'; game.remaining = 180; gun.holder = players[0]; gun.spraying = true;
  players[0].useAction = 'wipe'; frame(); audio.playerEvent(players[0], 0, 'jump');
  assert.equal(manager.loops.size, 0); assert.deepEqual(manager.played(), []);
  gun.spraying = false; players[0].useAction = ''; game.roundStage = 'playing'; game.remaining = 10.1; frame();
  game.remaining = 9.9; frame(); frame(); assert.deepEqual(manager.played(), ['pop']);
  game.paused = true; frame(); game.paused = false; frame(); assert.deepEqual(manager.played(), ['pop']);
  game.remaining = 8.9; frame(); assert.deepEqual(manager.played(), ['pop', 'pop']);
  audio.reset(); manager.clear(); frame(); assert.deepEqual(manager.played(), [], 'a restored timer establishes a baseline');
  game.remaining = 0; game.ended = true; frame(); frame(); assert.deepEqual(manager.played(), ['round_end']);
});

test('first snapshot only seeds: an order already in progress makes no sound', () => {
  const { manager, game, frame } = setup();
  game.order.stains[0].stage = 1;
  frame();
  assert.deepEqual(manager.played(), []);
});

test('authoritative stain steps pop, the final step sparkles and payment chimes exactly once', () => {
  const { manager, game, frame } = setup();
  frame(); manager.clear();
  game.order.stains[0].stage = 1; frame();
  assert.deepEqual(manager.played(), ['pop']);
  manager.clear();
  Object.assign(game.order.stains[0], { stage: 2, done: true });
  Object.assign(game.order.stains[1], { stage: 2, done: true });
  game.order.paid = true;
  frame(); frame();
  assert.deepEqual(manager.played(), ['clean', 'clean', 'order_complete']);
  assert.ok(manager.posts.at(-1).delay > 0, 'payment jingle waits for the sparkle');
});

test('a new order serial re-seeds without replaying the previous order', () => {
  const { manager, game, frame } = setup();
  frame();
  game.order = { serial: 4, paid: false, stains: [{ stage: 0, progress: 0, steps: ['water'], done: false, mesh: new THREE.Object3D() }] };
  manager.clear(); frame();
  assert.deepEqual(manager.played(), []);
});

test('the water gun holds one loop channel and every stop condition releases it', () => {
  const { manager, game, gun, players, frame } = setup();
  gun.holder = players[1]; gun.spraying = true;
  frame(); frame();
  assert.deepEqual(manager.played(), ['spray_start']);
  assert.deepEqual([...manager.loops.values()], ['spray_loop', 'splash_ground_loop']);
  for (const stop of [() => { game.paused = true; }, () => { gun.holder = null; }, () => { gun.spraying = false; }, () => { game.active = false; }, () => { game.ended = true; }]) {
    gun.holder = players[1]; gun.spraying = true; game.paused = false; game.active = true; game.ended = false;
    frame(); assert.equal(manager.loops.size, 2, 'nozzle + splash');
    stop(); frame();
    assert.equal(manager.loops.size, 0, 'spray loop must stop');
  }
});

test('use actions drive scrub, wipe and rinse loops per cat', () => {
  const { manager, players, frame } = setup();
  players[0].useAction = 'soap'; players[1].useAction = 'wipe';
  frame();
  assert.deepEqual([...manager.loops.values()].sort(), ['soap_loop', 'wipe_loop']);
  players[1].useAction = 'wash'; players[0].useAction = '';
  frame();
  assert.deepEqual([...manager.loops.values()], ['rinse_loop']);
});

test('round end plays the ending once', () => {
  const { manager, game, frame } = setup();
  frame(); game.ended = true; game.paused = true;
  frame(); frame();
  assert.deepEqual(manager.played(), ['round_end']);
});

test('menu music at home, band music in a round, muffled while paused or ended', () => {
  const { manager, game, frame } = setup();
  game.active = false; frame();
  assert.deepEqual(manager.music, { track: 0, volume: 1, muffled: false });
  game.active = true; frame();
  assert.deepEqual(manager.music, { track: 1, volume: 1, muffled: false });
  game.paused = true; frame();
  assert.equal(manager.music.muffled, true);
  game.paused = false; game.ended = true; frame();
  assert.equal(manager.music.muffled, true);
});

test('player reactions map to sounds with the cat slot as key; soft hops stay silent and teammates sit lower', () => {
  const { manager, players } = setup();
  players[0].onSound('jump'); players[0].onSound('land', 1); players[0].onSound('land', 12);
  players[1].onSound('pickup'); players[1].onSound('throw', 1);
  assert.deepEqual(manager.played(), ['jump', 'land', 'pickup', 'throw']);
  const pickup = manager.posts.find((p: any) => p.bank === 'pickup');
  assert.equal(pickup.key, 1);
  assert.ok(pickup.volume < 1);
  assert.equal(SFX.jump, 0);
});

test('the splash follows what the stream lands on: road, vehicle roof, stain or a cat', () => {
  const { manager, game, gun, players, frame } = setup();
  gun.holder = players[0]; gun.spraying = true;
  const splash = () => manager.loops.get(4);
  gun.sprayTarget.set(5, 0, 5); frame(); assert.equal(splash(), 'splash_ground_loop');
  gun.sprayTarget.set(5, 2.1, 5); frame(); assert.equal(splash(), 'splash_truck_loop');
  game.order.stains[1].mesh.position.set(1, 2.1, 1); gun.sprayTarget.set(1.2, 2.15, 1); frame();
  assert.equal(splash(), 'splash_stain_loop');
  game.order.stains[1].done = true; frame(); assert.equal(splash(), 'splash_truck_loop', 'a cleaned stain is just roof');
  players[1].root.position.set(3, 0, 3); gun.sprayTarget.set(3.2, 0.6, 3); frame();
  assert.equal(splash(), 'splash_cat_loop');
});

test('progress bubbles stream while a stain cleans, climb in pitch across all steps, then stop', () => {
  const { manager, game, frame } = setup();
  frame();
  manager.posts.length = 0;
  const bubbles = () => manager.posts.filter((p: any) => p.bank === 'progress_bubble');
  const s = game.order.stains[0];
  // Progress rises over 1 s of 60 fps frames, crossing into the second step halfway.
  for (let i = 1; i <= 60; i++) {
    manager.now = i / 60;
    if (i <= 30) s.progress = i / 30 * 0.99; else { s.stage = 1; s.progress = (i - 30) / 30 * 0.9; }
    frame();
  }
  const stream = bubbles();
  assert.ok(stream.length >= 7 && stream.length <= 12, `about one bubble per 0.09-0.14 s, got ${stream.length}`);
  for (let i = 1; i < stream.length; i++) assert.ok(stream[i].rate >= stream[i - 1].rate, 'pitch never drops, even when the step bar resets');
  assert.ok(stream[0].rate >= 0.6 && stream.at(-1).rate > stream[0].rate * 1.6);
  const count = stream.length;
  for (let i = 1; i <= 40; i++) { manager.now = 1 + i / 60; frame(); }
  assert.ok(bubbles().length <= count + 3, 'bubbling stops shortly after progress stops');
  Object.assign(s, { stage: 2, done: true }); manager.now = 2; manager.posts.length = 0; frame();
  assert.deepEqual(manager.played(), ['clean'], 'finish is the single crisp ting');
});

test('footsteps are posted per cat', () => {
  const { manager, players } = setup();
  players[0].onSound('step'); players[1].onSound('step');
  assert.deepEqual(manager.posts.map((p: any) => [p.bank, p.key]), [['step', 0], ['step', 1]]);
});

test('road signs whoosh once per launch and flatten with an anime "kuang" instead of the road thump', () => {
  const { manager, players, game, audio, frame } = setup();
  const home = { pos: new THREE.Vector3(), topY: 1 };
  Object.assign(game, { homeTruck: home, roundStage: 'playing', remaining: 100, elapsed: 18.1,
    level: { road: { laneWidth: 4.5, laneCount: 2 }, roadSigns: [{ id: 'a', atMinutes: .3, side: -1 }, { id: 'b', atMinutes: .75, side: 1 }] } });
  game.roadSigns = { presentationTime: () => game.elapsed };
  frame(); assert.deepEqual(manager.played(), [], 'a sign already passing at the first frame is the baseline');
  game.elapsed = 44; frame(); game.elapsed = 45.05; frame(); frame();
  assert.deepEqual(manager.played(), ['road_sign_whoosh']);
  audio.reset(); manager.clear(); game.elapsed = 18.5; frame(); game.elapsed = 44; frame(); game.elapsed = 45.6; frame();
  assert.deepEqual(manager.played(), [], 'a launch seen too late stays silent');
  (players[0] as any).deathCause = 'road-sign'; players[0].onSound('fall');
  assert.equal(manager.played()[0], 'road_sign_hit'); assert.ok(!manager.played().includes('fall_hit'));
  assert.equal(manager.posts[0].key, 0);
});

test('respawn pops, a freshly spawned vehicle flies in with its horn and a departing one toots once', () => {
  const { manager, players, game, frame } = setup();
  players[1].onSound('respawn');
  assert.deepEqual(manager.played(), ['pop', 'land']); assert.equal(manager.posts[0].key, 1);
  manager.clear();
  const truck = { group: new THREE.Object3D() };
  const order = (serial: number, age: number, mode = 'working') => ({ serial, age, mode, paid: false, truck, stains: [] as any[] });
  game.order = undefined; game.orders = [order(7, 5)];
  frame(); assert.deepEqual(manager.played(), [], 'a docked vehicle seen first is only a baseline');
  game.orders.push(order(8, 0.05)); frame();
  assert.deepEqual(manager.played(), ['vehicle_arrive']);
  game.orders[0].mode = 'leaving'; game.orders[0].paid = true; frame(); frame();
  assert.deepEqual(manager.played(), ['vehicle_arrive', 'order_complete', 'vehicle_leave']);
  assert.ok(manager.posts.at(-1).delay > 0, 'a paid order leaves after its payment chime');
});

test('loop channels cover every per-slot loop for eight characters without overlapping', async () => {
  const { GAME_LOOP_CHANNELS } = await import('../client/js/audio/GameAudio.js');
  const { LOOP_CHANNELS } = await import('../client/js/audio/AudioManager.js');
  const { MAX_PLAYER_SLOTS } = await import('../shared/levels.js');
  assert.equal(MAX_PLAYER_SLOTS.length, 8);
  assert.equal(GAME_LOOP_CHANNELS, 4 + 4 + 8 * 4 + 1 + 1, 'guns, impacts, four blocks of eight slots, the electric hum and the versus slide');
  assert.ok(GAME_LOOP_CHANNELS <= LOOP_CHANNELS, `AudioManager provides ${LOOP_CHANNELS} loops for ${GAME_LOOP_CHANNELS}`);
});

test('a clinging squirrel scrapes without breaking the frame (the versus slide loop must not shadow slideSpeed)', () => {
  const { manager, players, frame } = setup();
  Object.assign(players[0], { state: 'air', wall: { truck: null }, wallTime: 0.4, occupied: true });
  assert.doesNotThrow(() => frame(), 'the merged slide loop once shadowed WallCling.slideSpeed and threw in the TDZ');
  assert.ok(manager.loops.size > 0, 'the claw scrape loop plays');
});
