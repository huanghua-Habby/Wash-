import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Vector3, InstancedBufferAttribute } from 'three';
import { Simulation } from './fixtures/Simulation.js';
import { ChargerBlast } from '../client/js/fx/ChargerBlast.js';
import { RoadSignImpact } from '../client/js/fx/RoadSignImpact.js';
import { ItemPoof } from '../client/js/fx/ItemPoof.js';

test('merged event effects draw only emitted records and stop after the full tail, including overlapping bursts', () => {
  const sim = new Simulation(), scene = new Scene();
  const effects = [new ChargerBlast(scene, sim.game), new RoadSignImpact(scene, sim.game), new ItemPoof(scene, sim.game)];
  try {
    for (const [index, effect] of effects.entries()) {
      const pool = effect.pool, size = [62, 26, 10][index];
      assert.equal(pool.mesh.geometry.instanceCount, 0); assert.equal(pool.mesh.visible, false);
      (effect.burst as any)(new Vector3(), index === 1 ? 'blue' : 0); pool.flush();
      assert.equal(pool.mesh.geometry.instanceCount, size);
      pool.time.value += .05;
      (effect.burst as any)(new Vector3(), index === 1 ? 'red' : 0); pool.flush();
      assert.equal(pool.mesh.geometry.instanceCount, size * 2);
      const version = (pool.mesh.geometry.getAttribute('aLife') as InstancedBufferAttribute).version;
      for (let i = 0; i < 180; i++) effect.update(1 / 60);
      assert.equal(pool.mesh.geometry.instanceCount, 0); assert.equal(pool.mesh.visible, false);
      assert.equal((pool.mesh.geometry.getAttribute('aLife') as InstancedBufferAttribute).version, version, 'expiry never uploads particle buffers');
      (effect.burst as any)(new Vector3(), index === 1 ? 'yellow' : 0); pool.flush();
      assert.equal(pool.mesh.geometry.instanceCount, size, 'next emission compacts/reuses only current records');
      effect.reset(); assert.equal(pool.mesh.geometry.instanceCount, 0); assert.equal(pool.mesh.visible, false);
    }
  } finally { effects.forEach(effect => effect.dispose()); sim.dispose(); }
});

test('blast cosmetics deduplicate snapshots and ignore stale baseline records after rejoin', () => {
  const sim = new Simulation(), effect = new ChargerBlast(new Scene(), sim.game);
  try {
    sim.game.charging.blast = { id: 1, tick: sim.game.wet.tick, at: [0, 2, 0] };
    effect.update(0); assert.equal(effect.mesh.geometry.instanceCount, 62);
    effect.update(0); assert.equal(effect.mesh.geometry.instanceCount, 62);
    for (let i = 0; i < 120; i++) effect.update(1 / 60);
    sim.game.wet.tick = 600; sim.game.charging.blast = { id: 2, tick: 100, at: [0, 2, 0] };
    effect.update(0); assert.equal(effect.mesh.geometry.instanceCount, 0);
    effect.reset(); effect.update(0); assert.equal(effect.mesh.geometry.instanceCount, 0);
  } finally { effect.dispose(); sim.dispose(); }
});
