import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DustBurst } from '../client/js/fx/DustBurst.js';

// The cat model draws fur textures; stub a chainable 2D canvas before importing the client player.
const ctx: any = new Proxy({}, { get: (o: any, k) => o[k] ?? (() => ctx), set: (o: any, k, v) => { o[k] = v; return true; } });
(globalThis as any).document ??= { createElement: () => ({ getContext: () => ctx, width: 0, height: 0 }) };
const { Player, fallBounce } = await import('../client/js/game/Player.js');

test('fall bounce curve: three ever-lower hops that finish inside the one-second fallen timer', () => {
  const peaks = [0, 0, 0]; let end = 0;
  for (let t = 0; t < 1.2; t += 1 / 240) {
    const { height, hop } = fallBounce(t);
    assert.ok(height >= -1e-9);
    if (hop < 3) peaks[hop] = Math.max(peaks[hop], height); else if (!end) end = t;
  }
  assert.ok(peaks[0] > peaks[1] && peaks[1] > peaks[2] && peaks[2] > 0.05, `peaks ${peaks}`);
  assert.ok(end > 0.6 && end < 0.98, `bounces settle at ${end}s, before respawn`);
});

test('hitting the road spins the cat on its side, bounces it and throws dust on every impact', () => {
  const player = new Player(new THREE.Scene(), { slot: 0 });
  const hits: number[] = [];
  player.onDust = (_: THREE.Vector3, strength: number, onRoad: boolean) => { assert.equal(onRoad, true); hits.push(strength); };
  player.state = 'air'; player.updateVisual(1 / 60);
  player.state = 'fallen'; player.pos.set(0, 0, 0);
  let maxHeight = 0, maxTip = 0; const angles: number[] = [];
  for (let i = 0; i < 60; i++) {
    player.root.position.copy(player.pos);
    player.updateVisual(1 / 60);
    maxHeight = Math.max(maxHeight, player.root.position.y);
    maxTip = Math.max(maxTip, Math.abs(player.lean.rotation.x)); angles.push(player.lean.rotation.y);
  }
  assert.equal(hits.length, 4, 'first impact, two re-landings and the final settle');
  assert.ok(hits[0] > hits[1] && hits[1] > hits[2], 'each dust ring is weaker');
  assert.ok(maxHeight > 0.5, 'visibly bounces off the road');
  assert.ok(maxTip > 1.2, 'lies on its side');
  const early = Math.abs(angles[10] - angles[0]), late = Math.abs(angles[59] - angles[49]);
  assert.ok(early > 1 && late < early, 'spins flat, slowing with friction');
  player.state = 'air'; player.root.position.copy(player.pos); player.updateVisual(1 / 60);
  assert.equal(player.lean.rotation.order, 'XYZ'); assert.equal(player.visual.fall, null, 'respawn clears the presentation');
});

test('dust burst is one bounded GPU instance batch; frames without impacts upload nothing', () => {
  const scene = new THREE.Scene(), dust = new DustBurst(scene);
  dust.burst(new THREE.Vector3(1, 0, 2), 1, -30); dust.update(1 / 60);
  assert.equal(scene.children.length, 1); assert.equal(dust.mesh.geometry.isInstancedBufferGeometry, true);
  const versions = Object.values(dust.pool.attributes).map((a: any) => a.version);
  for (let i = 0; i < 30; i++) dust.update(1 / 60);
  Object.values(dust.pool.attributes).forEach((a: any, i) => assert.equal(a.version, versions[i], 'motion and size curves stay on the GPU'));
  for (let i = 0; i < 40; i++) dust.burst(new THREE.Vector3(), 1, -30);
  assert.ok(dust.pool.expires.filter((e: number) => e > dust.pool.time.value).length <= dust.pool.capacity);
});

test('jump stretches and puffs from the roof; landing squashes and kicks up dust scaled by impact', () => {
  const player = new Player(new THREE.Scene(), { slot: 1 });
  const puffs: { strength: number, y: number, onRoad: boolean }[] = [];
  player.onDust = (position: THREE.Vector3, strength: number, onRoad: boolean) => puffs.push({ strength, y: position.y, onRoad });
  const frame = () => { player.root.position.copy(player.pos); player.updateVisual(1 / 60); };
  player.state = 'ground'; player.pos.set(0, 4.5, 0); frame(); frame();
  const rest = player.squash.scale.y;
  player.state = 'air'; player.pos.y += 0.2; frame();
  assert.equal(puffs.length, 1, 'take-off puff'); assert.equal(puffs[0].onRoad, false); assert.ok(Math.abs(puffs[0].y - 4.7) < 1e-6, 'from the roof surface');
  let tallest = 0; for (let i = 0; i < 6; i++) { frame(); tallest = Math.max(tallest, player.squash.scale.y); }
  assert.ok(tallest > rest + 0.04, 'stretch on take-off');
  const land = (vy: number) => {
    player.state = 'air'; player.visual.airVy = vy; player.visual.lastState = 'air';
    player.visual.pulse = player.visual.pulseV = 0; player.sq = player.sqV = 0;
    player.state = 'ground'; let flattest = 2;
    for (let i = 0; i < 8; i++) { player.root.position.copy(player.pos); player.updateVisual(1 / 60); player.visual.airVy = vy; flattest = Math.min(flattest, player.squash.scale.y); }
    return flattest;
  };
  const before = puffs.length, soft = land(-5), hard = land(-16);
  assert.ok(hard < soft && hard < 0.9, `harder landings squash more (${soft} vs ${hard})`);
  const landing = puffs.slice(before);
  assert.equal(landing.length, 2); assert.ok(landing[1].strength > landing[0].strength, 'harder landings kick up more dust');
  assert.ok(landing.every((p) => !p.onRoad), 'roof dust rides with the vehicle');
});
