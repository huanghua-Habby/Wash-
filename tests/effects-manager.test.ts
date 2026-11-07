import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EffectsManager } from '../client/js/fx/EffectsManager.js';
import { WaterParticles } from '../client/js/game/WaterParticles.js';
import { Simulation } from './fixtures/Simulation.js';
import { CFG } from '../client/js/core/config.js';

test('manager routes calls, freezes gameplay effects, registers assets once and releases owned callbacks', () => {
  const previous = () => {};
  const game: any = { players: [{ onDust: previous }], paused: false, ended: false };
  const systems: any = {}, create: any = {};
  for (const name of ['wind', 'puffs', 'dust', 'water', 'cleaning', 'charging', 'chargerBlast', 'itemPoof', 'soapSlip', 'soapFoam', 'slapHit', 'slapSwipe', 'glideWind', 'dizzyStars', 'morphPoof', 'dummyWobble', 'roadSign', 'departure', 'pelican', 'wallCling', 'hackBurst']) {
    create[name] = () => systems[name] = {
      ready: name === 'water' ? Promise.resolve() : null,
      updates: [] as any[], bursts: [] as any[], resets: 0, disposals: 0,
      update(...args: any[]) { this.updates.push(args); },
      burst(...args: any[]) { this.bursts.push(args); },
      reset() { this.resets++; }, dispose() { this.disposals++; },
    };
  }
  let base = 31;
  const effects = new EffectsManager({ scene: new THREE.Scene(), game, getBase: () => base, create });
  const assets: any[] = [], readiness = { addAsset: (...args: any[]) => assets.push(args) };
  effects.registerReadiness(readiness); effects.registerReadiness(readiness);
  assert.equal(assets.length, 1); assert.equal(assets[0][1], systems.water.ready);
  assert.throws(() => effects.register('late', {}, { update() {} }), /before scene preparation/);
  const position = new THREE.Vector3(1, 2, 3);
  game.players[0].onDust(position, 0.5, false);
  base = 34; game.players[0].onDust(position, 1, true);
  assert.deepEqual(systems.dust.bursts, [[position, 0.5, 0], [position, 1, -34]]);
  assert.throws(() => effects.play('typo', {}), /Unknown callable effect/);
  const frame = { dt: 1 / 60, time: 4, trucks: [], camera: {}, base };
  effects.update(frame); game.paused = true; effects.update(frame);
  assert.deepEqual(systems.water.updates, [[1 / 60], [0]]);
  assert.deepEqual(systems.cleaning.updates, [[1 / 60], [0]]);
  assert.deepEqual(systems.dust.updates, [[1 / 60], [1 / 60]], 'world cosmetics retain their existing pause policy');
  game.paused=false; game.roundStage='guide'; effects.update(frame);
  for(const name of ['wind','puffs','dust','water','cleaning']) assert.equal(systems[name].updates.at(-1)[0],0,'reading freezes world and gameplay effect clocks');
  game.roundStage='playing';
  game.paused = false; game.ended = true; effects.update(frame);
  assert.equal(systems.water.updates.at(-1)[0], 0);
  effects.reset('gameplay'); assert.equal(systems.water.resets, 1); assert.equal(systems.wind.resets, 0);
  effects.dispose(); effects.dispose();
  assert.equal(game.players[0].onDust, previous);
  for (const system of Object.values(systems) as any[]) assert.equal(system.disposals, 1);
  assert.equal(effects.play('dust', { position, strength: 1 }), false);
  const count = systems.dust.updates.length; effects.update(frame); assert.equal(systems.dust.updates.length, count);
});

test('managed GPU pools animate without buffer rewrites, reset without changing authority and dispose every batch', () => {
  const sim = new Simulation(), game = sim.game;
  const settings = { exhaust: CFG.puffs.exhaust, dust: CFG.puffs.dust, wind: CFG.wind.rate };
  CFG.puffs.exhaust = CFG.puffs.dust = CFG.wind.rate = 0;
  const root = new THREE.Group(); sim.scene.add(root);
  const particles = new WaterParticles(root, game);
  const gun = { spraying: true, sprayNodes: [new THREE.Vector3(0, 1, 0), new THREE.Vector3(2, 0, 0)],
    nozzle: () => new THREE.Vector3(0, 1, 0), direction: () => new THREE.Vector3(1, 0, 0), holder: null };
  const effects = new EffectsManager({ scene: sim.scene, game, create: {
    water: () => ({ ready: Promise.resolve(), update: (dt: number) => particles.update(dt, gun),
      reset: () => particles.reset(), dispose: () => { particles.dispose(); root.removeFromParent(); } }),
  } });
  try {
    const before = sim.snapshot();
    effects.play('dust', { position: new THREE.Vector3(), strength: 1 });
    for (const type of ['gulp', 'spit']) effects.play('pelican', { type, mouth: new THREE.Vector3(0, 1, 0), forward: new THREE.Vector3(1, 0, 0), carry: new THREE.Vector3(30, 0, 0), feather: '#f7f3ee' });
    for (const type of ['grab', 'slide', 'kick', 'slip']) effects.play('wallCling', { type, contact: new THREE.Vector3(0, 1, 1.3), normal: { x: 0, z: 1 }, carry: new THREE.Vector3(30, 0, 0), strength: 1 });
    const frame = { dt: 1 / 30, time: 0, trucks: sim.trucks, camera: new THREE.PerspectiveCamera(), base: 30 };
    effects.update(frame); gun.spraying = false;
    // A released stream can still arrive and emit a splash; its motion thereafter must not upload records.
    while (particles.pendingImpacts.length) effects.update(frame);
    const batches: THREE.Mesh[] = [];
    sim.scene.traverse((node: any) => { if (node.userData.gpuParticle) batches.push(node); });
    assert.equal(batches.length, 42, 'ambient, departure smoke, road sign impact, charger blast, hack burst, item poof, soap slip, slap hit, slap swipe, glide wind, morph poof smoke + stars, pelican, squirrel wall bits + haze, water, cleaning, actor bolts + glow shells and wet lightning pools');
    const attributes = batches.flatMap(mesh => Object.values(mesh.geometry.attributes)
      .filter((a): a is THREE.InstancedBufferAttribute => a instanceof THREE.InstancedBufferAttribute));
    const versions = attributes.map(a => a.version);
    for (let i = 0; i < 20; i++) effects.update(frame);
    attributes.forEach((a, i) => assert.equal(a.version, versions[i], 'GPU motion never rewrites instance records'));
    const clock = particles.time.value; game.paused = true; effects.update(frame);
    assert.equal(particles.time.value, clock); game.paused = false;
    effects.reset();
    for (const mesh of batches) {
      const life = mesh.geometry.attributes.aLife;
      if (life) assert.ok([...life.array].every(value => value === 0), 'reset clears scheduled/active particle births');
    }
    assert.deepEqual(sim.snapshot(), before, 'effects never award score, change ownership or alter physics');
    let freed = 0;
    batches.forEach(mesh => mesh.geometry.addEventListener('dispose', () => freed++));
    effects.dispose(); assert.equal(freed, batches.length);
    sim.scene.traverse(node => assert.equal(!!node.userData.gpuParticle, false));
  } finally {
    effects.dispose(); sim.dispose();
    CFG.puffs.exhaust = settings.exhaust; CFG.puffs.dust = settings.dust; CFG.wind.rate = settings.wind;
  }
});
