import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Builder, SOLID_MAT, HULL_MAT } from '../client/js/render/Builder.js';
import { SceneryChunks } from '../client/js/world/sceneobject/SceneryChunks.js';
import { Props } from '../client/js/world/Props.js';
import { CFG } from '../client/js/core/config.js';

function vertices(root:THREE.Object3D, origin=0) {
 const result:string[]=[];root.updateWorldMatrix(true,true);
 root.traverse((o:any)=>{if(!o.isMesh)return;
  const p=o.geometry.attributes.position,c=o.geometry.attributes.color,n=o.geometry.attributes.normal;
  const normalMatrix=new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
  for(let i=0;i<p.count;i++) {
   const v=new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);
   const normal=new THREE.Vector3().fromBufferAttribute(n,i).applyNormalMatrix(normalMatrix);
   result.push([o.material===HULL_MAT?1:0,v.x-origin,v.y,v.z,...normal.toArray(),c.getX(i),c.getY(i),c.getZ(i)].map(x=>x.toFixed(4)).join(','));
  }
 });return result.sort();
}

test('chunk baking preserves transformed geometry, colors, normals and render flags',()=>{
 const scene=new THREE.Scene();const items=[-29,-24,3,8,29].map((x,i)=>{
  const b=new Builder();b.box(1+i*.13,2,1,i%2?'#75a259':'#f3db81');
  const obj=b.build();obj.position.set(x,0,i%2?8:-12);obj.rotation.y=i*.43;scene.add(obj);
  return {obj,x};
 });
 const before=items.flatMap(({obj})=>vertices(obj)).sort();
 let disposed=0;items.forEach(({obj})=>obj.traverse((o:any)=>{o.geometry?.addEventListener('dispose',()=>disposed++);}));
 const chunks=new SceneryChunks(scene,items,80);
 const after=chunks.chunks.flatMap(({copies}:any)=>vertices(copies[1].group)).sort();
 assert.deepEqual(after,before);assert.equal(disposed,10);
 for(const {copies} of chunks.chunks) {
  const a=copies[0].group.children as THREE.Mesh[],b=copies[1].group.children as THREE.Mesh[];
  a.forEach((mesh,i)=>assert.equal(mesh.geometry,b[i].geometry,'periodic copies share GPU buffers'));
  b.forEach(mesh=>{assert.equal(mesh.castShadow,mesh.material===SOLID_MAT);assert.equal(mesh.layers.mask,1);assert.equal(mesh.frustumCulled,true);assert.ok(mesh.geometry.boundingSphere);});
 }
});

test('periodic copies keep scenery continuous at the loop seam without geometry uploads',()=>{
 const b=new Builder();b.box(2,2,2,'#75a259');const obj=b.build();obj.position.set(33,0,8);
 const chunks=new SceneryChunks(new THREE.Scene(),[{obj,x:33}],80);
 const geometry=chunks.chunks[0].copies[1].group.children[0] as THREE.Mesh;
 const position=geometry.geometry.attributes.position as THREE.BufferAttribute;const version=position.version;
 // Chunk center is 30; wrapping crosses between these scroll values.
 for(const scroll of [69.99,70.01,150.01,-9.99]) {
  chunks.update(scroll);
  const copies=chunks.chunks[0].copies;
  const centers=copies.map(({group}:any)=>group.position.x).sort((a:number,b:number)=>a-b);
  assert.ok(Math.abs(centers[1]-centers[0]-80)<1e-8);assert.ok(Math.abs(centers[2]-centers[1]-80)<1e-8);
  const target=33-((scroll%80+80)%80);
  assert.ok(copies.some(({group}:any)=>Math.abs(group.position.x+3-target)<1e-8),'an adjacent copy covers the continuous unwrapped position');
 }
 assert.equal(position.version,version);assert.equal(geometry.geometry.attributes.position,position);
});

test('actual seeded scenery uses bounded short batches and keeps textured road signs separate',()=>{
 const previous=(globalThis as any).document;
 const ctx=new Proxy({}, {get:(o:any,k)=>o[k]??(()=>{}),set:(o:any,k,v)=>{o[k]=v;return true;}});
 (globalThis as any).document={createElement:()=>({getContext:()=>ctx})};
 try {
  const props=new Props(new THREE.Scene());
  assert.equal(props.homeScenery.objectCount,142);assert.equal(props.group.items.length,3);
  assert.ok(props.homeScenery.chunks.length<=32);
  for(const {copies} of props.homeScenery.chunks) {
   assert.equal(copies.length,3);assert.equal(copies[1].group.children.length,2);
   const mesh=copies[1].group.children[0] as THREE.Mesh;
   const box=mesh.geometry.boundingBox!;
   assert.ok(box.max.x-box.min.x<32,'short longitudinal bounds allow culling');
  }
 } finally {(globalThis as any).document=previous;}
});

test('scenery density keeps a stable subset, re-bakes without leaking chunks and toggles signs',()=>{
 const previous=(globalThis as any).document,saved={...CFG.scenery};
 const ctx=new Proxy({}, {get:(o:any,k)=>o[k]??(()=>{}),set:(o:any,k,v)=>{o[k]=v;return true;}});
 (globalThis as any).document={createElement:()=>({getContext:()=>ctx})};
 try {
  const scene=new THREE.Scene(),props:any=new Props(scene),children=scene.children.length;
  Object.assign(CFG.scenery,{trees:0,bushes:0,hedges:0,hay:0,rocks:0,barrels:0,warningSigns:false});
  let disposed=0;for(const {copies} of props.homeScenery.chunks) copies[1].group.traverse((o:any)=>o.geometry?.addEventListener('dispose',()=>disposed++));
  props.refreshDensity();
  assert.ok(disposed>0,'old baked buffers are released');assert.equal(props.homeScenery.objectCount,0);
  assert.equal(props.warningSigns.every((g:any)=>!g.visible),true);assert.equal(props.highwaySign.visible,true);
  Object.assign(CFG.scenery,{trees:.5,bushes:.5,hedges:.5,hay:.5,rocks:.5,barrels:.5});props.refreshDensity();
  const half=props.homeScenery.objectCount;assert.ok(half>30&&half<110,`about half kept (${half})`);
  props.refreshDensity();assert.equal(props.homeScenery.objectCount,half,'same seed keeps the same subset');
  Object.assign(CFG.scenery,saved);props.refreshDensity();
  assert.equal(props.homeScenery.objectCount,142);assert.equal(scene.children.length,children,'re-bake replaces chunk groups');
 } finally {(globalThis as any).document=previous;Object.assign(CFG.scenery,saved);}
});

test('an active round shows the thinned play scenery bake and restores home density',()=>{
 const previous=(globalThis as any).document;
 const ctx=new Proxy({}, {get:(o:any,k)=>o[k]??(()=>{}),set:(o:any,k,v)=>{o[k]=v;return true;}});
 (globalThis as any).document={createElement:()=>({getContext:()=>ctx})};
 try {
  const props:any=new Props(new THREE.Scene());
  const shown=(set:any)=>set.chunks.every(({copies}:any)=>copies.every(({group}:any)=>group.visible));
  const hidden=(set:any)=>set.chunks.every(({copies}:any)=>copies.every(({group}:any)=>!group.visible));
  assert.equal(CFG.play.scenery,.1);
  const play=props.playScenery.objectCount;assert.ok(play>0&&play<40,`about a tenth kept (${play})`);
  assert.ok(shown(props.homeScenery)&&hidden(props.playScenery),'home starts at full density');
  props.setPlaying(true);assert.ok(hidden(props.homeScenery)&&shown(props.playScenery));
  props.refreshDensity();assert.ok(hidden(props.homeScenery)&&shown(props.playScenery),'re-bake keeps the play visibility');
  props.setPlaying(false);assert.ok(shown(props.homeScenery)&&hidden(props.playScenery));
 } finally {(globalThis as any).document=previous;}
});
