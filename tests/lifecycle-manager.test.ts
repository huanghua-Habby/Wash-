import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourceManager } from '../client/js/lifecycle/ResourceManager.js';
import { AppManager } from '../client/js/lifecycle/AppManager.js';
import { SceneManager } from '../client/js/lifecycle/SceneManager.js';
import * as THREE from 'three';
import { CameraRig } from '../client/js/render/CameraRig.js';
import { Simulation } from './fixtures/Simulation.js';
import { isSharedToolResource } from '../shared/sim/ToolModels.js';

function gate() { let resolve!: (value?: any) => void; const promise = new Promise<any>(done => { resolve = done; }); return { promise, resolve }; }
const turn = () => new Promise(resolve => setImmediate(resolve));

test('disposing a room preserves borrowed tool templates used by another world and releases owned resources exactly once',()=>{
  const first=new Simulation(),second=new Simulation();
  const liveResources=new Set<any>(),ownedResources=new Set<any>(),events=new Map<any,number>();
  second.scene.traverse((o:any)=>{if(o.geometry)liveResources.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])liveResources.add(m);});
  first.scene.traverse((o:any)=>{for(const r of [o.geometry,...(Array.isArray(o.material)?o.material:[o.material])])if(r&&!isSharedToolResource(r))ownedResources.add(r);});
  const borrowed=[...liveResources].filter(isSharedToolResource);
  assert.ok(borrowed.length>0);
  assert.equal(first.game.towels[0].mesh.children[0].children[0].geometry,second.game.towels[0].mesh.children[0].children[0].geometry);
  for(const r of new Set([...liveResources,...ownedResources])){events.set(r,0);r.addEventListener('dispose',()=>events.set(r,events.get(r)!+1));}
  const cloth=first.game.towels[0].material;
  assert.equal(isSharedToolResource(cloth),false,'durability tint is instance-owned');
  const trim=second.game.towels[0].mesh.children[0].children[1].material,clone=trim.clone();
  assert.equal(isSharedToolResource(clone),false,'shared metadata must not make clones borrowed');clone.dispose();
  try{
    first.dispose();first.dispose();
    for(const r of borrowed)assert.equal(events.get(r),0,'another scene still uses this template');
    for(const r of ownedResources)assert.equal(events.get(r),1,'deduplicate resources within the room');
    assert.equal(events.get(cloth),1);assert.ok(second.scene.children.length>0);
    assert.equal(first.scene.children.length,0);
  }finally{first.dispose();second.dispose();}
});
function resourceFixture() {
  const promises: Promise<any>[] = [], samples: any[] = [], order: string[] = [];
  let runs = 0;
  const backend: any = { addAsset(_name: string, promise: Promise<any>) { promises.push(promise); }, addSample(sample: any) { samples.push(sample); },
    async prepare(report: any) { runs++; await Promise.all(promises); order.push('warm'); report('画面', 1); } };
  const resources = new ResourceManager({ readiness: backend });
  return { resources, samples, order, runs: () => runs };
}

test('resource providers prepare once, wait on actual assets and report optional failures; registration seals', async () => {
  const { resources, samples, runs } = resourceFixture(); const asset = gate(), warnings: string[] = [];
  resources.registerProvider('model', r => r.addAsset('model', asset.promise));
  resources.addAsset('audio', Promise.reject(new Error('no audio')), { optional: true, onError: (e: any) => warnings.push(e.message) });
  const sample = {}; resources.addSample(sample); resources.addSample(sample);
  const first = resources.prepare(); assert.equal(resources.prepare(), first);
  await turn(); assert.equal(resources.state, 'preparing'); assert.equal(samples.length, 1);
  assert.throws(() => resources.addAsset('late', Promise.resolve()), /before preparation/);
  asset.resolve(); await first;
  assert.equal(resources.state, 'ready'); assert.equal(runs(), 1); assert.deepEqual(warnings, ['no audio']);
  assert.equal(resources.status.assets.find(a => a.name === 'audio')?.state, 'degraded');
});

test('required resource failure prevents ready; disposal waits for warmup and releases every provider once in reverse order', async () => {
  const { resources, order } = resourceFixture(), asset = gate();
  resources.registerProvider('first', r => r.addAsset('asset', asset.promise), { dispose: () => order.push('first') });
  resources.registerProvider('second', () => {}, { dispose: () => order.push('second') });
  const preparing = resources.prepare(); const released = resources.dispose(); assert.equal(resources.dispose(), released);
  await turn(); assert.deepEqual(order, []); asset.resolve(); await preparing; await released;
  assert.deepEqual(order, ['warm', 'second', 'first']); assert.equal(resources.state, 'disposed');
  const broken = resourceFixture().resources; broken.addAsset('required', Promise.reject(new Error('missing model')));
  await assert.rejects(broken.prepare(), /missing model/); assert.equal(broken.state, 'failed');
});

function appFixture() {
  const prepared = gate(), frames = new Map<number, any>(), log: string[] = []; let serial = 0;
  const ui: any = { progress(_label: string, value: number) { if (value === 1) log.push('100'); }, fail() { log.push('fail'); }, reveal() { log.push('reveal'); } };
  const resources: any = { prepare: () => prepared.promise, async dispose() { log.push('release'); } };
  const app = new AppManager({ ui, resources, nextFrame: async () => { log.push('frame-ready'); }, requestFrame(callback: any) { frames.set(++serial, callback); return serial; }, cancelFrame(id: number) { frames.delete(id); } });
  const sceneManager: any = { state: 'boot', seal() {}, activate() { this.state = 'running'; }, snapshotApplied() { log.push('applied'); }, dispose() { log.push('scene-stop'); } };
  const connection = new EventTarget(), doc: any = new EventTarget(), target = new EventTarget();
  app.bind({ sceneManager, connection, doc, target });
  return { app, prepared, frames, log, doc, connection };
}

test('AppManager stops camera pointer updates on permanent disposal and a new rig has only its own listener',async()=>{
  const oldDocument=(globalThis as any).document,target=new EventTarget();
  (globalThis as any).document={getElementById:()=>({getBoundingClientRect:()=>({left:10,top:20,width:200,height:100})})};
  const pointer=(x:number,y:number)=>{const e=new Event('pointermove');Object.assign(e,{clientX:x,clientY:y});target.dispatchEvent(e);};
  const {app}=appFixture(),rig=new CameraRig(new THREE.PerspectiveCamera());
  app.listen(target,'pointermove',rig.handlePointerMove.bind(rig));
  let next:any;
  try{
    pointer(210,120);assert.deepEqual(rig.mouse.toArray(),[1,1]);
    await app.dispose();pointer(10,20);assert.deepEqual(rig.mouse.toArray(),[1,1]);
    next=appFixture().app;const replacement=new CameraRig(new THREE.PerspectiveCamera());
    next.listen(target,'pointermove',replacement.handlePointerMove.bind(replacement));
    pointer(10,20);assert.deepEqual(replacement.mouse.toArray(),[-1,-1]);assert.deepEqual(rig.mouse.toArray(),[1,1]);
  }finally{await app.dispose();await next?.dispose();(globalThis as any).document=oldDocument;}
});

test('startup connects after preparation and reveals only after an applied snapshot and real first frame; one frame loop', async () => {
  const { app, prepared, frames, log, connection } = appFixture();
  const options = { connect() { log.push('connect'); }, renderFirst() { log.push('render'); }, frame() { log.push('tick'); } };
  const starting = app.start(options); assert.equal(app.start(options), starting);
  await turn(); assert.deepEqual(log, []); prepared.resolve(); await turn(); assert.deepEqual(log, ['connect']);
  connection.dispatchEvent(new Event('snapshot')); await turn(); assert.deepEqual(log, ['connect'], 'received is not applied');
  app.snapshotApplied({}); await starting;
  assert.deepEqual(log, ['connect', 'applied', 'render', 'frame-ready', 'frame-ready', '100', 'reveal']); assert.equal(frames.size, 1);
  const tick = [...frames.values()][0]; await app.dispose(); tick();
  assert.equal(frames.size, 0); assert.equal(log.join('|').includes('tick'), false);
});

test('disposal during startup cancels waits and browser listeners without later reveal', async () => {
  const { app, prepared, log, doc, connection } = appFixture(); let calls = 0;
  app.registerService('audio', { visibility() { calls++; }, disconnect() { calls++; } });
  doc.dispatchEvent(new Event('visibilitychange')); assert.equal(calls, 1);
  const starting = app.start({ connect() { log.push('connect'); }, renderFirst() {}, frame() {} });
  await app.dispose(); await assert.rejects(starting, /stopped/); prepared.resolve(); await turn();
  doc.dispatchEvent(new Event('visibilitychange')); connection.dispatchEvent(new Event('disconnect'));
  assert.equal(calls, 1); assert.equal(log.includes('100'), false); assert.equal(log.includes('reveal'), false);
});

function sceneFixture() {
  const ready = gate(), log: string[] = [];
  const iris: any = { phase: 'idle', active: false, start(covered: any, done: any) { this.active = true; this.phase = 'close'; this.covered = covered; this.done = done; },
    async cover() { this.phase = 'wait'; await this.covered(); this.phase = 'open'; }, finish() { this.active = false; this.phase = 'idle'; this.done(); } };
  const ui: any = { ready: true, iris, page: 'game', menu: { updateFraming() {}, finishTransition() {} }, syncInteraction() {}, focusGame() {},
    setPage(page: string) { this.page = page; log.push(page); }, requestPause() {}, setSceneStage() {}, open() {} };
  const connection: any = Object.assign(new EventTarget(), { room: { code: 'ABCDEF', epoch: 1 }, connected: true, send() { log.push('home-request'); return true; } });
  const game: any = { level: null, selectLevel(level: any) { this.level = level; log.push('level'); } };
  const scenes = new SceneManager({ ui, resources: { prepare: () => ready.promise }, connection, game, director: { restoreState() {}, motion: null },
    levelScenes: { select() {} }, grass: { setRoad() {} }, transition: { reset() {}, phase: 'home', start() {} }, rig: {}, nextFrame: async () => {} });
  const home = gate();
  scenes.bindNetwork({ holdHomePresentation() { log.push('hold'); }, async commitHomePresentation() { await home.promise; log.push('home-commit'); } });
  return { scenes, iris, ui, connection, ready, home, log };
}

test('scene reset follows applied room scope, and switching preserves the outgoing scene until black and ready', async () => {
  const { scenes, connection, iris, ready, log } = sceneFixture(); let resets = 0;
  scenes.registerReset('effects', () => resets++); scenes.snapshotApplied({}); scenes.snapshotApplied({}); assert.equal(resets, 1);
  connection.room.epoch++; scenes.snapshotApplied({}); assert.equal(resets, 2);
  const changing = scenes.changeLevel('highway-02', () => { log.push('commit'); });
  assert.deepEqual(log, []); const covering = iris.cover(); await turn(); assert.deepEqual(log, []);
  ready.resolve(); await covering; assert.deepEqual(log, ['level', 'commit']); iris.finish(); await changing;
  assert.equal(scenes.state, 'running');
});

test('nested level changes reuse a covered home commit, and delayed home authority keeps the mask closed', async () => {
  const { scenes, iris, ready, home, log } = sceneFixture(); ready.resolve();
  const returning = scenes.returnHome(); const covering = iris.cover(); await turn();
  assert.deepEqual(log, ['leaving', 'hold', 'home-request']); assert.equal(iris.phase, 'wait');
  await scenes.changeLevel('highway-02', () => { log.push('nested-commit'); });
  home.resolve(); await covering;
  assert.deepEqual(log, ['leaving', 'hold', 'home-request', 'level', 'nested-commit', 'home-commit', 'home']);
  iris.finish(); await returning;
});

test('cancelled covered work never commits after resource readiness arrives late', async () => {
  const { scenes, iris, ready, log } = sceneFixture();
  const changing = scenes.changeLevel('highway-02', () => { log.push('commit'); });
  const covering = iris.cover(); scenes.dispose();
  await assert.rejects(changing, /disposed/); await assert.rejects(covering, /disposed/);
  ready.resolve(); await turn(); assert.deepEqual(log, []);
});

test('late covered callbacks reject before asking disposed resources to prepare', async () => {
  const { scenes } = sceneFixture(); let prepared = false, committed = false;
  (scenes as any).resources.prepare = () => { prepared = true; return Promise.reject(new Error('disposed resources')); };
  scenes.dispose();
  await assert.rejects(scenes.applyCovered(() => { committed = true; }), /disposed/);
  assert.equal(prepared, false); assert.equal(committed, false);
});


test('a frame failure stops further scheduling and keeps failure state visible', async () => {
  const { app, prepared, frames, log } = appFixture(); const original = console.error;
  let calls = 0; console.error = () => {};
  try {
    const starting = app.start({ connect() {}, renderFirst() {}, frame() { calls++; throw new Error('render failed'); } });
    prepared.resolve(); await turn(); app.snapshotApplied({}); await starting;
    const tick = [...frames.values()][0]; tick(); tick();
    assert.equal(calls, 1); assert.equal(app.state, 'failed'); assert.equal(frames.size, 1); assert.ok(log.includes('fail'));
    await app.dispose();
  } finally { console.error = original; }
});
