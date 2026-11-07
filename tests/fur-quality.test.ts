import test from 'node:test';
import assert from 'node:assert/strict';
import { FurQuality } from '../client/js/render/FurQuality.js';
import { normalizeFurShells } from '../client/js/core/furSettings.js';
import { CFG, DEFAULTS, applyConfig } from '../client/js/core/config.js';
import { Resolution } from '../client/js/render/Resolution.js';

function fixture() {
 const config={shells:12,auto:true},status={shells:12,reason:''};
 return { config,status,quality:new FurQuality({config,status,renderConfig:{...CFG.render,targetFps:60}}) };
}
function advance(q:FurQuality, seconds:number, {fps=60,cpuMs=2,gpuMs=null as number|null,fullResolution=true,eligible=true,stale=false}={}) {
 for(let i=0;i<Math.ceil(seconds*fps);i++) q.update(1/fps,{cpuMs,gpuMs,gpuId:stale?7:i,fullResolution,eligible});
}

test('release fur defaults to automatic eight and clamps old settings away from zero and Extra',()=>{
 assert.deepEqual(DEFAULTS.fur,{shells:8,auto:true});
 for(const [input,expected] of [[0,4],[-1,4],[4,4],[8,8],[12,12],[16,12],[20,12],[100,12],[NaN,8]]) assert.equal(normalizeFurShells(input),expected);
 const saved={...CFG.fur};
 try {
  applyConfig({fur:{shells:20,auto:'invalid'}});assert.deepEqual(CFG.fur,{shells:12,auto:true});
  applyConfig({fur:{shells:0}});assert.equal(CFG.fur.shells,4);
 } finally { Object.assign(CFG.fur,saved); }
});

test('sustained slow frames descend one tier at a time, settle before resolution drops and never remove fur',()=>{
 const {quality:q,status}=fixture();
 advance(q,3.2);advance(q,2.2,{fps:30});assert.equal(status.shells,8);
 assert.equal(q.deferResolutionDrop,true);
 advance(q,5.5,{fps:30});assert.equal(status.shells,4);
 assert.equal(q.deferResolutionDrop,true,'allow the four-layer result to settle');
 advance(q,4,{fps:30});assert.equal(q.deferResolutionDrop,false,'resolution can now handle remaining pressure');
 advance(q,20,{fps:20});assert.equal(status.shells,4);
});

test('GPU or CPU budget pressure can lower fur before frame rate falls; missing queries fall back to frames',()=>{
 for(const source of ['gpu','cpu']) {
  const {quality:q,status}=fixture();advance(q,6,{gpuMs:source==='gpu'?15:null,cpuMs:source==='cpu'?15:2});
  assert.equal(status.shells,8);assert.match(status.reason,source==='gpu'?/GPU/:/CPU/);
 }
 const {quality:q,status}=fixture();advance(q,6,{fps:30});assert.equal(status.shells,8);
});

test('one spike, stale GPU results, hidden/modal/transition time and resume gaps do not lower fur',()=>{
 const {quality:q,status}=fixture();advance(q,4);q.update(.1,{cpuMs:100});advance(q,4);
 assert.equal(status.shells,12);
 advance(q,12,{gpuMs:15,stale:true});assert.equal(status.shells,12,'one old query is not twelve seconds of GPU load');
 advance(q,10,{fps:20,cpuMs:30,gpuMs:30,eligible:false});assert.equal(status.shells,12);
 q.update(2,{cpuMs:100});advance(q,3);assert.equal(status.shells,12);
});

test('recovery waits for full resolution and stable headroom, probes slowly and backs off after a failed probe',()=>{
 const {quality:q,status}=fixture();advance(q,15,{fps:30});assert.equal(status.shells,4);
 advance(q,40,{gpuMs:3,fullResolution:false});assert.equal(status.shells,4);
 advance(q,24,{gpuMs:3});assert.equal(status.shells,8);
 advance(q,6,{fps:30});assert.equal(status.shells,4,'a failed probe returns to the previous tier');
 advance(q,30,{gpuMs:3});assert.equal(status.shells,4,'no repeated quality jumps during backoff');
 advance(q,35,{gpuMs:3});assert.equal(status.shells,8);
 advance(q,26,{gpuMs:3});assert.equal(status.shells,12);
 advance(q,60,{gpuMs:3});assert.equal(status.shells,12,'never automatically enter Extra');
});

test('manual tiers stay fixed and automatic recovery respects the configured ceiling',()=>{
 const {quality:q,status,config}=fixture();config.auto=false;config.shells=8;
 advance(q,30,{fps:20,cpuMs:30});assert.equal(status.shells,8);assert.equal(q.deferResolutionDrop,false);
 config.auto=true;advance(q,12,{fps:30});assert.equal(status.shells,4);
 advance(q,70,{gpuMs:2});assert.equal(status.shells,8);
});

test('resolution defers only reductions while fur adapts; its independent recovery can still run',()=>{
 const saved={...CFG.render};let applied=0;
 const resolution:any={scale:1,frames:0,time:0,cooldown:0,goodTime:0,info:{},apply(){applied++;}};
 try {
  Object.assign(CFG.render,{autoRes:true,scale:1,minScale:.6,targetFps:60});
  for(let i=0;i<90;i++) Resolution.prototype.update.call(resolution,1/30,{deferDrop:true});
  assert.equal(resolution.scale,1);assert.equal(applied,0);
  for(let i=0;i<30;i++) Resolution.prototype.update.call(resolution,1/30);
  assert.ok(resolution.scale<1);
  for(let i=0;i<1000;i++) Resolution.prototype.update.call(resolution,1/60,{deferDrop:true});
  assert.equal(resolution.scale,1,'recover screen clarity before probing higher fur tiers');
 } finally { Object.assign(CFG.render,saved); }
});
