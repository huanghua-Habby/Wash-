import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../shared/sim/RoomSimulation.js';
import { getLevel } from '../shared/levels.js';
import { CleaningEffects } from '../client/js/game/CleaningEffects.js';
import { order } from '../shared/levels/authoring.js';

test('five dirt banks submit only born foam/sparkles, idle is zero and GPU seed buffers stay unchanged during steady tails', () => {
  const level:any=structuredClone(getLevel('highway-03'));level.partyScaling=false;
  level.script.orders=[order('fx',0,-1,'cargo',['grease','grease','grease','grease','grease'])];
  const sim=new Simulation(level);sim.occupy(0,true);sim.phase='game';sim.game.start(sim.director.base);
  const fx=new CleaningEffects(sim.game),g=sim.game;
  try {
    for (const bank of [fx,fx.secondary!]) {
      assert.deepEqual(bank.layers.map((mesh:any)=>mesh.geometry.attributes.aSeed.count),[160,5,15]);
      assert.deepEqual(bank.layers.map((mesh:any)=>mesh.geometry.index!.count/3),[274,2,2]);
      assert.ok(bank.layers.every((mesh:any)=>!mesh.castShadow&&!mesh.layers.isEnabled(1)), 'cleaning particles cannot multiply into shadow/mask draws');
    }
    fx.update();for(const bank of [fx,fx.secondary!]) for(const mesh of bank.layers) { assert.equal(mesh.visible,false);assert.equal(mesh.geometry.instanceCount,0); }
    g.levelScript.beforeFleet(1/60);for(let i=0;g.orders.length<1&&i<200;i++)sim.tick();
    const o=g.orders.find((o:any)=>o.stains.length===5);assert.ok(o);const bank=g.orders.indexOf(o)===0?fx:fx.secondary!;
    o.stains[4].progress=.1;fx.update();assert.equal(bank.states.value.length,5);assert.equal(bank.layers[0].geometry.instanceCount,4);
    const version=bank.layers[0].geometry.attributes.aSeed.version;fx.update();assert.equal(bank.layers[0].geometry.attributes.aSeed.version,version);
    o.stains[4].progress=1;fx.update();assert.equal(bank.layers[0].geometry.instanceCount,32);
    o.stains[4].done=true;o.stains[4].cleanedAt=g.elapsed;fx.update();assert.equal(bank.layers[0].geometry.instanceCount,0);
    assert.equal(bank.layers[1].geometry.instanceCount,1);assert.equal(bank.layers[2].geometry.instanceCount,1,'future sparkles are not submitted');
    g.elapsed+=.3;fx.update();assert.equal(bank.layers[2].geometry.instanceCount,3);
    const seedVersion=bank.layers[2].geometry.attributes.aSeed.version;g.elapsed+=.1;fx.update();assert.equal(bank.layers[2].geometry.attributes.aSeed.version,seedVersion,'tail animation does not rewrite records');
    g.elapsed+=1.1;fx.update();for(const mesh of bank.layers)assert.equal(mesh.geometry.instanceCount,0);
    fx.reset();for(const bank of [fx,fx.secondary!])for(const mesh of bank.layers)assert.equal(mesh.visible,false);
  } finally {fx.dispose();sim.dispose();}
});
