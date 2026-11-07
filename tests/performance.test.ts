import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Puffs } from '../client/js/fx/Puffs.js';
import { WindLines } from '../client/js/fx/WindLines.js';
import { GpuTimer } from '../client/js/render/GpuTimer.js';
import { shadowSamples } from '../client/js/render/ShadowWarmup.js';
import { SceneReadiness } from '../client/js/render/SceneReadiness.js';
import { PostFX } from '../client/js/render/PostFX.js';
import { CFG } from '../client/js/core/config.js';

test('ambient particles have two fixed GPU batches and no per-frame particle buffer uploads',()=>{
 const scene=new THREE.Scene(),puffs=new Puffs(scene),wind=new WindLines(scene);
 const savedPuffs={...CFG.puffs},savedWind={...CFG.wind};
 const trucks=[{pos:new THREE.Vector3(0,1.5,0),topY:4.5,halfWidth:1.7,spec:{x0:-6.4,x1:5.8,width:3.4}}],camera=new THREE.PerspectiveCamera();
 try {
  CFG.puffs.exhaust=CFG.puffs.dust=0;CFG.wind.rate=0;CFG.wind.enabled=true;
  puffs.emit(new THREE.Vector3(),new THREE.Vector3(1,2,0),0.2,1,'#ffffff');puffs.pool.flush();wind.spawn(trucks,30);wind.pool.flush();
  const effects=[puffs,wind];
  const copies=effects.map(effect=>Object.values(effect.pool.attributes).map((a:any)=>({version:a.version,data:[...a.array]})));
  for(let i=0;i<20;i++){puffs.update(1/60,trucks,30);wind.update(1/60,i/60,trucks,camera,30);}
  assert.equal(scene.children.length,2,'wind is a single draw, not a mesh per ribbon');
  effects.forEach((effect,i)=>{
   assert.equal(effect.mesh.geometry.isInstancedBufferGeometry,true);assert.equal('instanceMatrix' in effect.mesh,false);
   assert.equal(effect.mesh.layers.isEnabled(1),false,'GPU positions cannot use the CPU override mask');
   Object.values(effect.pool.attributes).forEach((a:any,j)=>{assert.equal(a.version,copies[i][j].version);assert.deepEqual([...a.array],copies[i][j].data);});
   assert.ok(effect.pool.time.value>0);
  });
  CFG.wind.enabled=false;wind.update(0,1,trucks,camera,30);assert.equal(wind.mat.uniforms.uOpacity.value,0);
  assert.ok(wind.pool.expires.every(expiry=>expiry===0));
 }finally{Object.assign(CFG.puffs,savedPuffs);Object.assign(CFG.wind,savedWind);}
});

test('shadow warmup compiles persistent depth variants, retaining instancing, alpha cutoff and sides',()=>{
 const scene=new THREE.Scene(),texture=new THREE.Texture();
 const material=new THREE.MeshLambertMaterial({map:texture,alphaTest:0.5,side:THREE.DoubleSide});
 const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),material,2);mesh.castShadow=true;scene.add(mesh);
 const samples=shadowSamples(scene),sample=samples.children[0] as THREE.InstancedMesh;
 assert.ok(mesh.customDepthMaterial);assert.equal(sample.material,mesh.customDepthMaterial);assert.equal(sample.geometry,mesh.geometry);
 assert.equal(sample.isInstancedMesh,true);assert.equal(sample.count,2);assert.equal(sample.castShadow,false);
 const depth=sample.material as THREE.MeshDepthMaterial;
 assert.equal(depth.map,texture);assert.equal(depth.alphaTest,0.5);assert.equal(depth.side,THREE.DoubleSide);assert.equal(depth.depthPacking,THREE.RGBADepthPacking);
 const again=shadowSamples(scene);assert.equal((again.children[0] as THREE.Mesh).material,depth,'no new material on subsequent preparation');
 const normal=new THREE.Mesh(mesh.geometry,material),same=new THREE.Mesh(mesh.geometry,material);normal.castShadow=same.castShadow=true;scene.add(normal,same);
 shadowSamples(scene);assert.equal(normal.customDepthMaterial,same.customDepthMaterial,'same signatures share depth material instead of extra uniform refresh per caster');
 assert.notEqual(normal.customDepthMaterial,mesh.customDepthMaterial,'instanced and ordinary shaders are waited on independently');
});

test('main and shadow shader preparation starts concurrently and leaves the event loop free',async()=>{
 const saved=globalThis.requestAnimationFrame;(globalThis as any).requestAnimationFrame=(fn:any)=>setImmediate(fn);
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),caster=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshLambertMaterial());
 caster.castShadow=true;scene.add(caster);
 const sample=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshLambertMaterial({transparent:true}));let disposed=false;sample.material.addEventListener('dispose',()=>disposed=true);
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let started=0,renders=0;
 const readiness=new SceneReadiness({scene,camera,renderer:{async compileAsync(){started++;await gate;}},post:{view:0,render(){renders++;}}});
 try {
  readiness.addSample(sample);const ready=readiness.prepare();await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(started,2,'both shaders submitted before either promise completes');assert.equal(renders,0);
  let frameAdvanced=false;await new Promise<void>(resolve=>setImmediate(()=>{frameAdvanced=true;resolve();}));assert.equal(frameAdvanced,true);
  release();await ready;assert.equal(renders,3);assert.equal(disposed,false,'retain unique future-entity shader programs');assert.equal(sample.parent,null);
 }finally{globalThis.requestAnimationFrame=saved;}
});

test('GPU query pool never blocks for unfinished results; bounded queue and disjoint cleanup',()=>{
 const deleted:number[]=[],reads:number[]=[],available=new Set<number>();let next=0,disjoint=false;
 const gl={QUERY_RESULT_AVAILABLE:1,QUERY_RESULT:2,createQuery:()=>++next,getExtension:()=>({GPU_DISJOINT_EXT:3,TIME_ELAPSED_EXT:4}),isContextLost:()=>false,
  beginQuery(){},endQuery(){},getParameter:()=>disjoint,deleteQuery:(q:number)=>deleted.push(q),
  getQueryParameter(q:number,p:number){if(p===1)return available.has(q);assert.ok(available.has(q),'must not read unavailable GPU time');reads.push(q);return 2e6;}};
 const timer=new GpuTimer({getContext:()=>gl,capabilities:{isWebGL2:true}},2,0);
 timer.begin();timer.end();timer.begin();timer.end();timer.begin();assert.equal(timer.active,null);assert.equal(next,2);assert.equal(reads.length,0);
 available.add(1);timer.poll();assert.equal(timer.lastMs,2);assert.deepEqual(reads,[1]);assert.deepEqual(deleted,[1]);
 disjoint=true;timer.poll();assert.equal(timer.pending.length,0);assert.equal(timer.lastMs,null);
 assert.deepEqual(deleted,[1,2]);
});

test('zero-contribution effects skip mask and bloom without stale mask samples',()=>{
 const saved={...CFG.post},scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();let renders=0,bloom=0,tilt=0;
 const post:any=Object.create(PostFX.prototype);
 post.renderer={shadowMap:{autoUpdate:true},setRenderTarget(){},setClearColor(){},render(){renders++;}};
 post.rt={width:100,height:100};post.maskRT={texture:{}};post.black={black:true};post.view=0;
 post.material={uniforms:{tMask:{value:null},tBloom:{value:null},uTime:{value:0},uBlurDir:{value:new THREE.Vector2()},uBloom:{value:0},tTilt:{value:null},uTilt:{value:0}}};
 post.quad={};post.quadScene={};post.quadCam={};post.syncUniforms=()=>{};post.renderBloom=()=>{bloom++;return {};};
 const tiltTexture={};post.renderTilt=(mask:any)=>{tilt++;assert.equal(mask,post.maskRT.texture);return tiltTexture;};
 try {
  Object.assign(CFG.post,{enabled:true,bloomOn:true,bloom:0,blurOn:true,linesOn:true,lines:0,maskSharp:true,tiltOn:false});
  post.render(scene,camera,{time:0,blurDir:new THREE.Vector2(),lines:1});
  assert.equal(renders,2);assert.equal(bloom,0);assert.equal(post.passCount,2);assert.equal(post.material.uniforms.tMask.value,post.black);
  CFG.post.lines=1;CFG.post.bloom=0.35;
  post.render(scene,camera,{time:1,blurDir:new THREE.Vector2(0.1,0),lines:1});
  assert.equal(renders,5);assert.equal(bloom,1);assert.equal(post.material.uniforms.tMask.value,post.maskRT.texture);
  assert.equal(scene.overrideMaterial,null);assert.equal(camera.layers.mask,1);
  assert.equal(tilt,0);assert.equal(post.material.uniforms.tTilt.value,post.black);assert.equal(post.material.uniforms.uTilt.value,0);
  // Tilt-shift needs the vehicle mask so cars stay sharp, even with no motion blur or speed lines.
  Object.assign(CFG.post,{lines:0,bloom:0,tiltOn:true,tilt:1});
  post.render(scene,camera,{time:2,blurDir:new THREE.Vector2(),lines:1});
  assert.equal(tilt,1);assert.equal(renders,8);assert.equal(post.material.uniforms.tTilt.value,tiltTexture);assert.equal(post.material.uniforms.uTilt.value,1);
  CFG.post.tilt=0;
  post.render(scene,camera,{time:3,blurDir:new THREE.Vector2(),lines:1});
  assert.equal(tilt,1);assert.equal(post.material.uniforms.tTilt.value,post.black);
 }finally{Object.assign(CFG.post,saved);}
});
