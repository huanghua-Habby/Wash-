/** Particle animation must change a uniform, not rewrite per-particle transforms each frame. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WaterParticles } from '../client/js/game/WaterParticles.js';
import { GpuWaterLayer } from '../client/js/game/GpuWaterLayer.js';
import { WetDecalPool } from '../client/js/fx/WetSurfaces.js';

const jet = (distance = 2.5) => ({ spraying: true,
  sprayNodes: [new THREE.Vector3(0, 0.8, 0), new THREE.Vector3(distance, 0.18, 0)],
  nozzle: () => new THREE.Vector3(0, 0.8, 0), direction: () => new THREE.Vector3(1, 0, 0), holder: null });

test('empty water pools submit no instances, and repacking birth records never overwrites a live particle', () => {
  const time = { value: 0 }, layer = new GpuWaterLayer(new THREE.Group(), time, 3, 1);
  const origin = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const emit = (life: number, seed: number) => layer.emit(origin, origin, up, time.value, life, 1, seed);
  assert.equal(layer.mesh.visible, false); assert.equal(layer.mesh.geometry.instanceCount, 0);
  assert.ok(emit(.1, 10)); assert.ok(emit(.5, 11)); assert.ok(emit(.2, 12));
  assert.equal(emit(.4, 99), false, 'a full layer cannot replace a live record');
  layer.flush(); assert.equal(layer.mesh.geometry.instanceCount, 3);
  time.value = .25;
  assert.ok(emit(.5, 13)); layer.flush();
  assert.equal(layer.mesh.geometry.instanceCount, 2, 'only the surviving record and new emission are submitted');
  const life = (layer.attributes as Record<string, THREE.InstancedBufferAttribute>).aLife;
  assert.deepEqual([life.getW(0), life.getW(1)], [11, 13]);
  const version = life.version, records = [...life.array];
  time.value = .6; layer.flush();
  assert.equal(layer.mesh.visible, true, 'the final particle drains naturally');
  time.value = .8; layer.flush();
  assert.equal(layer.mesh.visible, false); assert.equal(layer.mesh.geometry.instanceCount, 0);
  assert.equal(life.version, version); assert.deepEqual([...life.array], records, 'expiry uploads no instance data');
  time.value = 1; assert.ok(emit(.2, 14)); layer.flush();
  assert.equal(layer.mesh.geometry.instanceCount, 1, 'an expired layer wakes without rebuilding resources');
  layer.reset(); assert.equal(layer.mesh.geometry.instanceCount, 0); assert.equal(layer.mesh.visible, false);
  layer.dispose();
});

test('future hits wait as bounded events, survive release, freeze on pause and cancel on reset', () => {
  const particles = new WaterParticles(new THREE.Group(), { players: [] }), gun = jet(2.5);
  particles.update(1 / 60, gun); gun.spraying = false;
  assert.equal(particles.pendingImpacts.length, 1);
  assert.equal(particles.splash.mesh.geometry.instanceCount, 0, 'future splash geometry is not drawn');
  const birth = particles.pendingImpacts[0].birth;
  for (let i = 0; i < 10; i++) particles.update(0, gun);
  assert.equal(particles.time.value, 1 / 60); assert.equal(particles.splash.count, 0);
  while (particles.time.value < birth) particles.update(1 / 60, gun);
  assert.equal(particles.pendingImpacts.length, 0);
  assert.equal(particles.splash.count, 6, 'a travelling jet still splashes after the trigger is released');
  assert.equal(particles.fill.count, 1);
  for (let i = 0; i < 30; i++) particles.update(1 / 60, gun);
  for (const layer of [particles.stream, particles.splash, particles.fill]) {
    assert.equal(layer.mesh.visible, false); assert.equal(layer.mesh.geometry.instanceCount, 0);
  }
  gun.spraying = true; particles.update(.05, gun); particles.reset(); gun.spraying = false;
  for (let i = 0; i < 60; i++) particles.update(1 / 60, gun);
  assert.equal(particles.pendingImpacts.length, 0); assert.equal(particles.splash.count, 0, 'old scene hits never reappear');
  particles.dispose();
});

test('four continuous mesh jets have bounded live records and six times fewer impact droplets, including changing hit distances', () => {
  const sources = Array.from({ length: 4 }, () => ({ particles: new WaterParticles(new THREE.Group(), { players: [] }), gun: jet() }));
  let splashes = 0, maxInstances = 0, maxPending = 0;
  for (const { particles } of sources) {
    const emit = particles.splash.emit.bind(particles.splash);
    particles.splash.emit = (...args: Parameters<typeof emit>) => {
      const accepted = emit(...args); assert.equal(accepted, true, 'the visual budget must not evict live splashes'); splashes++;
      return accepted;
    };
  }
  for (let frame = 0; frame < 600; frame++) {
    let count = 0;
    for (const { particles, gun } of sources) {
      gun.sprayNodes[1].x = frame % 120 < 60 ? 4 : .6;
      particles.update(1 / 60, gun);
      count += particles.stream.count + particles.splash.count + particles.fill.count;
      maxPending = Math.max(maxPending, particles.pendingImpacts.length);
      assert.ok(particles.pendingImpacts.every((event, i, list) => i === 0 || event.birth >= list[i - 1].birth), 'near hits can overtake distant hits');
    }
    maxInstances = Math.max(maxInstances, count);
  }
  assert.ok(maxInstances < 4 * (32 + 48 + 8)); assert.ok(maxPending <= 8);
  assert.ok(splashes >= 4 * 9 * 60 && splashes <= 4 * 10 * 60, 'each source emits about 60 splash droplets/s, instead of 360');
  for (const { particles, gun } of sources) {
    gun.spraying = false;
    for (let i = 0; i < 60; i++) particles.update(1 / 60, gun);
    assert.equal(particles.stream.count + particles.splash.count + particles.fill.count, 0);
    particles.dispose();
  }
});

test('water uses three GPU instance layers; after emission only the time uniform changes',()=>{
  const root=new THREE.Group();
  const particles=new WaterParticles(root,{players:[]});
  const gun={spraying:true,sprayNodes:[new THREE.Vector3(0,0.8,0),new THREE.Vector3(2.5,0.18,0)],
    nozzle:()=>new THREE.Vector3(0,0.8,0),direction:()=>new THREE.Vector3(1,0,0),holder:null};
  particles.update(1/30,gun);gun.spraying=false;
  // Arrival is a separate emission event; sample immutable records after that event has fired.
  while (particles.pendingImpacts.length) particles.update(1 / 60, gun);
  const layers=[particles.stream,particles.splash,particles.fill];
  const before=layers.map(layer=>Object.values(layer.attributes).map((attribute:any)=>({version:attribute.version,data:[...attribute.array]})));
  const clock=particles.time.value;
  for(let i=0;i<20;i++)particles.update(1/30,gun);
  assert.ok(particles.time.value>clock);
  assert.equal(root.children.length,3);
  layers.forEach((layer,i)=>{
    assert.equal(layer.mesh.geometry.isInstancedBufferGeometry,true);
    assert.equal('instanceMatrix' in layer.mesh,false);
    Object.values(layer.attributes).forEach((attribute:any,j:number)=>{
      assert.equal(attribute.version,before[i][j].version,'no per-frame buffer upload');
      assert.deepEqual([...attribute.array],before[i][j].data,'particle positions remain immutable birth records');
    });
  });
  const pausedClock=particles.time.value;particles.update(0,gun);assert.equal(particles.time.value,pausedClock);
});

test('wet decal pools submit only live decals, batch expiries without per-frame uploads, and go to zero instances', () => {
  const pool = new WetDecalPool(new THREE.Group(), 112, { uTime: { value: 0 } }, { y: 0 });
  const geometry = pool.meshes[0].geometry as THREE.InstancedBufferGeometry;
  pool.update(0); assert.equal(geometry.instanceCount, 0); assert.equal(pool.meshes[0].visible, false);
  pool.emit(0, 0, 0, { radius: .5, dry: 2 }); pool.emit(1, 0, 0, { radius: .5, dry: 4 }); pool.emit(2, 0, 0, { radius: .5, dry: 4 });
  pool.update(0); assert.equal(geometry.instanceCount, 3, 'three live decals, not the 112-slot capacity');
  const version = (geometry.getAttribute('aDecal') as THREE.BufferAttribute).version;
  for (let t = 0; t < 2.4; t += 1 / 60) pool.update(t);
  assert.equal((geometry.getAttribute('aDecal') as THREE.BufferAttribute).version, version, 'no uploads while decals only fade on the GPU');
  pool.update(2.6); assert.equal(geometry.instanceCount, 2, 'the dried decal is dropped in one batched repack');
  pool.remove(pool.cursor - 1); pool.update(2.7); assert.equal(geometry.instanceCount, 1);
  pool.update(4.1); assert.equal(geometry.instanceCount, 0); assert.equal(pool.meshes[0].visible, false, 'zero instances and zero draws once dry');
  pool.emit(0, 0, 5, { radius: .5, dry: 2 }); pool.clear(); pool.update(5); assert.equal(geometry.instanceCount, 0);
});
