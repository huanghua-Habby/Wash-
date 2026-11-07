import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Truck } from '../client/js/world/Truck.js';
import { TruckState } from '../shared/sim/TruckState.js';
import { PAL } from '../shared/sim/palette.js';
import { VEHICLES } from '../shared/sim/vehicles.js';
import { shadowSamples } from '../client/js/render/ShadowWarmup.js';
import { GLOW, syncGlow } from '../client/js/render/GlowMaterials.js';
import { CFG } from '../client/js/core/config.js';

// Texture drawing isn't under test; construct the actual geometry with a canvas stub.
function truck(type: string, logo?: string) {
 const before=globalThis.document;
 const ctx:any=new Proxy({}, {get:(o:any,k)=>o[k]??(()=>ctx),set:(o:any,k,v)=>{o[k]=v;return true;}});
 (globalThis as any).document={createElement:()=>({getContext:()=>ctx})};
 try{return new Truck(PAL.truckA,{name:'test',phase:0.7,logo,sub:'WASH',icon:'cube',type});}
 finally{(globalThis as any).document=before;}
}
function drawCount(t:any) {
 const counts={main:0,mask:0,shadow:0};
 t.group.traverse((node:any)=>{if(!node.isMesh)return;counts.main++;if(node.layers.isEnabled(1))counts.mask++;if(node.castShadow)counts.shadow++;});
 return counts;
}

test('hover vehicles have no wheels: merged body + outline, one shared HDR glow batch, optional logo pair and one road glow',()=>{
 for(const type of Object.keys(VEHICLES)) {
  const plain=truck(type),branded=truck(type,'test');
  assert.equal((plain as any).wheelBatches,undefined,`${type} has no wheel batches`);
  assert.deepEqual(drawCount(plain),{main:4,mask:4,shadow:1});
  const emissive:any[]=[];plain.body.traverse((o:any)=>{if(o.material===GLOW.vehicle)emissive.push(o);});
  assert.equal(emissive.length,1,`${type} blue parts share the adjustable HDR material`);
  const logo=drawCount(branded).main-4;
  assert.ok(logo===0||logo===2,`${type} logo draws`);
  const scene=new THREE.Scene();scene.add(branded.group);
  assert.equal(shadowSamples(scene).children.length,1,'one shadow draw per vehicle');
 }
});

test('client hover pose matches the authority and the road glow stays on the road at any altitude',()=>{
 for(const type of Object.keys(VEHICLES)) {
  const t=truck(type),authority=new TruckState(PAL.truckA,{name:'authority',phase:0.7,type});
  assert.deepEqual(t.platforms,authority.platforms);
  for(const [dt,y] of [[0,0.9],[1/60,2.4],[0.3,4]]) {
   t.setState(4,-2,3,0.2,30);authority.setState(4,-2,3,0.2,30);
   t.setAltitude(y);authority.setAltitude(y);
   t.update(dt,2);authority.update(dt,2);t.syncHover();
   assert.deepEqual(t.body.position.toArray(),authority.body.position.toArray());
   assert.equal(t.topY,authority.topY);
   t.group.updateMatrixWorld(true);
   const glow=(t as any).groundGlow.getWorldPosition(new THREE.Vector3());
   assert.ok(Math.abs(glow.y-0.05)<0.05,`${type} glow at road level, got ${glow.y}`);
  }
 }
});

test('glow colour and intensity are live HDR values that exceed the Bloom threshold',()=>{
 const saved={...CFG.glow};
 try {
  syncGlow();
  const peak=(c:THREE.Color)=>Math.max(c.r,c.g,c.b);
  assert.ok(peak(GLOW.vehicle.color)>CFG.post.bloomThreshold,'vehicle glow drives Bloom');
  assert.ok(peak(GLOW.road.color)>CFG.post.bloomThreshold,'roadside glow drives Bloom');
  CFG.glow.vehicle=10;CFG.glow.roadColor='#ff0000';CFG.glow.road=2;syncGlow();
  assert.ok(Math.abs(peak(GLOW.vehicle.color)-peak(new THREE.Color(saved.vehicleColor).multiplyScalar(10)))<1e-6);
  assert.deepEqual(GLOW.road.color.toArray(),[2,0,0]);
 } finally { Object.assign(CFG.glow,saved);syncGlow(); }
});
