import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GameAudio } from '../client/js/audio/GameAudio.js';
import { SFX } from '../client/js/audio/sounds.js';
import { WashGame } from '../client/js/game/WashGame.js';
import { createStainMesh } from '../client/js/game/StainLook.js';
import { WetSurfaces } from '../client/js/fx/WetSurfaces.js';

function setup() {
  const posts: number[] = [], loops = new Map<number, number>();
  const manager: any = { now: 0, listeners: [] as any[], post: (bank: number) => posts.push(bank),
    addListener(l: any) { this.listeners.push(l); }, removeListener(l: any) { this.listeners = this.listeners.filter((v: any) => v !== l); },
    setLoop(c: number, bank: number, on: boolean) { if (on) loops.set(c, bank); else loops.delete(c); }, setMusic() {} };
  const players: any[] = [0, 1].map(() => ({ root: new THREE.Object3D(), occupied: true, connected: true, state: 'ground', useAction: '', onSound: null }));
  const order = (serial: number) => ({ serial, paid: false, stains: [{ mesh: new THREE.Object3D(), stage: 0, progress: 0, steps: ['soap', 'water', 'towel'], done: false }] });
  const game: any = { active: true, practice: false, paused: false, ended: false, equipmentVisible: true,
    orders: [order(0), order(1)], waterguns: [{ spraying: true, holder: players[0], mesh: new THREE.Object3D(), sprayTarget: new THREE.Vector3(20, 0, 20) }] };
  const audio = new GameAudio({ manager, game, players, localPlayer: () => players[0] });
  const frame = () => audio.audioUpdate(manager, null);
  return { manager, posts, loops, game, players, audio, frame };
}

test('paired orders independently clean/pay, retain neighbour baseline and reject regressed presentation values', () => {
  const { game, posts, frame } = setup(); frame(); posts.length = 0;
  for (const order of game.orders) { order.stains[0].stage = 3; order.stains[0].done = true; order.paid = true; }
  frame(); frame();
  assert.deepEqual(posts, [SFX.clean, SFX.order_complete, SFX.clean, SFX.order_complete]);
  posts.length = 0;
  game.orders.shift(); frame();
  game.orders[0].stains[0].stage = 1; game.orders[0].paid = false; frame();
  game.orders[0].stains[0].stage = 3; game.orders[0].paid = true; frame();
  assert.deepEqual(posts, []);
});

test('reconnection/end baselines never replay past rewards; fallen or disconnected holders stop loops', () => {
  const { game, players, posts, loops, audio, frame } = setup(); frame();
  players[0].state = 'fallen'; frame(); assert.equal(loops.size, 0);
  players[0].state = 'ground'; players[0].connected = false; frame(); assert.equal(loops.size, 0);
  players[0].connected = true;
  audio.reset(); game.ended = true; game.orders[0].paid = true; game.orders[0].stains[0].stage = 3;
  posts.length = 0; frame(); frame(); assert.deepEqual(posts, []);
  game.ended = false; frame(); game.ended = true; frame(); frame();
  assert.deepEqual(posts.filter(bank => bank === SFX.round_end), [SFX.round_end]);
});

test('removing a gun clears both channels and disposing the listener restores hooks without duplicate listeners', () => {
  const { game, loops, audio, manager, players, frame } = setup(); frame(); assert.equal(loops.size, 2);
  game.waterguns = []; frame(); assert.equal(loops.size, 0);
  audio.dispose(); audio.dispose(); assert.equal(manager.listeners.length, 0); assert.equal(players[0].onSound, null);
});

test('prepared stain meshes return to their vehicle pool and both orders update shader state', () => {
  const game: any = Object.create(WashGame.prototype), trucks = [{}, {}];
  const meshes = trucks.map(() => createStainMesh(0, ['water', 'towel']));
  game.stainPools = new Map(trucks.map((truck, i) => [truck, [meshes[i]]]));
  let disposed = 0;
  for (const mesh of meshes) { mesh.geometry.addEventListener('dispose', () => disposed++); mesh.material.addEventListener('dispose', () => disposed++); }
  const samples: any[] = []; game.registerStainReadiness({ addSample(mesh: any) { samples.push(mesh); } });
  assert.deepEqual(samples, meshes);
  game.elapsed = 5;
  game.orders = meshes.map((mesh, serial) => ({ serial, stains: [{ mesh, steps: ['water', 'towel'], stage: 1, progress: .4 }] }));
  game.active = true; game.viewOnly = true; game.hud = { update() {} };
  game.afterCamera(new THREE.PerspectiveCamera());
  for (const mesh of meshes) {
    assert.equal(mesh.material.userData.stain.uStage.value, 1);
    assert.equal(mesh.material.userData.stain.uProgress.value, .4);
  }
  for (let i = 0; i < meshes.length; i++) {
    game.releaseStainMesh(meshes[i]);
    assert.equal(game.makeStainMesh(0, ['water', 'towel'], trucks[i]), meshes[i]);
    assert.equal(meshes[i].material.userData.stain.uStage.value, 0);
  }
  assert.equal(disposed, 0, 'order removal keeps prepared GPU assets');
});

test('wet decal and drip pools do not upload buffers on idle frames and shared pause freezes their GPU clock', () => {
  const scene = new THREE.Scene();
  const game: any = { paused: false, ended: false, equipmentVisible: false, waterguns: [] };
  const lighting = { hemi: { color: new THREE.Color('white'), groundColor: new THREE.Color('grey'), intensity: 1 }, sun: { color: new THREE.Color('white'), intensity: 1 }, offset: new THREE.Vector3(1, 2, 3) };
  const wet: any = new WetSurfaces({ scene, game, trucks: [], players: [], lighting });
  const attribute = wet.road.attributes.aShape;
  const before = attribute.version;
  for (let i = 0; i < 100; i++) wet.update(1 / 60, i);
  assert.equal(attribute.version, before);
  const time = wet.time; game.paused = true; wet.update(.5, 100); assert.equal(wet.time, time);
  let released = 0; wet.road.meshes[0].geometry.addEventListener('dispose', () => released++);
  wet.dispose(); assert.equal(released, 1, 'three passes share one geometry, released once');
});
