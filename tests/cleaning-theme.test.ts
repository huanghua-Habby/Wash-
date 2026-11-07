import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { orderCleaningProgress } from '../client/js/ui/VehicleOrderHud.js';
import { CLEANING_THEME } from '../client/js/core/cleaningTheme.js';
import { CleaningTowel, CleaningSoap } from '../client/js/game/CleaningTools.js';
import { Towel } from '../shared/sim/Towel.js';
import { TruckState } from '../shared/sim/TruckState.js';
import { PAL } from '../shared/sim/palette.js';

function luminance(hex: string) {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}

test('cleaning actions remain readable by words and shape; every tool ink contrasts with every route paper', () => {
  assert.deepEqual(Object.values(CLEANING_THEME).map(tool => tool.action), ['打皂', '冲洗', '擦净']);
  for (const tool of Object.values(CLEANING_THEME)) for (const backdrop of Object.values(CLEANING_THEME)) {
    assert.ok((luminance(backdrop.paper) + .05) / (luminance(tool.ink) + .05) >= 4.5, `${tool.name} on ${backdrop.name} route`);
  }
});

test('client tool palettes survive durability, dirty state, washing and soap reuse without changing shared tools', () => {
  const scene = new THREE.Scene(), truck = new TruckState(PAL.truckA, { name: '工具配色测试', phase: 0 });
  const towel = new CleaningTowel(scene, truck, new THREE.Vector3(), 0), plain = new Towel(scene, truck, new THREE.Vector3(), 1);
  const soap = new CleaningSoap(scene, truck, new THREE.Vector3(), 0);
  const hex = () => towel.material.color.getHexString();
  assert.equal(hex(), 'e8c468'); assert.equal(plain.material.color.getHexString(), 'fff9dd');
  towel.consume(.5); assert.ok(towel.durability > 0); assert.notEqual(hex(), 'e8c468');
  towel.consume(99); assert.equal(towel.dirty, true); assert.equal(hex(), '343e43');
  towel.clean(); assert.equal(towel.dirty, false); assert.equal(hex(), 'e8c468');
  towel.durability = 0; towel.tint(); assert.equal(hex(), '343e43');
  towel.durability = 2; towel.tint(); assert.equal(hex(), 'e8c468', 'snapshot-driven tint keeps the client palette');
  soap.activate(); soap.consume(.5); soap.retire(); soap.reset();
  const soapParts: THREE.Mesh[] = [];
  soap.mesh.traverse((node: any) => { if (node.isMesh) soapParts.push(node); });
  const batch = soapParts.find(node => node.geometry.userData.toolParts?.some((part: any) => part.part === 'soap'))!;
  assert.ok(batch.material instanceof THREE.MeshLambertMaterial);
  const soapPart = batch.geometry.userData.toolParts.find((part: any) => part.part === 'soap');
  const actual = new THREE.Color().fromBufferAttribute(batch.geometry.attributes.color as THREE.BufferAttribute, soapPart.start);
  assert.equal(actual.getHexString(), 'eba394', 'soap palette survives as vertex color');
  assert.ok(batch.geometry.userData.toolParts.some((part: any) => part.part === 'stamp'), 'retain embossed soap detail in the same draw');
  assert.equal(soap.active, false); assert.equal(soap.durabilityRatio, 1);
});


test('vehicle cleaning progress includes partial work and remains continuous across cleaning stages', () => {
 const stains = [
  {steps:['towel'],stage:0,progress:0,done:false},
  {steps:['water','towel'],stage:0,progress:0,done:false},
  {steps:['soap','water','towel'],stage:0,progress:0,done:false},
 ];
 assert.equal(orderCleaningProgress(stains),0);
 stains[0].done=true;stains[0].stage=1;stains[1].stage=1;stains[1].progress=.5;stains[2].progress=.5;
 assert.equal(orderCleaningProgress(stains),.5,'three completed work units out of six');
 stains[1].progress=1;const before=orderCleaningProgress(stains);
 stains[1].stage=2;stains[1].progress=0;stains[1].done=true;
 assert.equal(orderCleaningProgress(stains),before,'changing step cannot reset the vehicle bar');
 stains.forEach(stain=>{stain.done=true;stain.stage=stain.steps.length;stain.progress=0;});
 assert.equal(orderCleaningProgress(stains),1);
 assert.equal(orderCleaningProgress([]),0,'an uninitialized badge never claims completion');
 assert.equal(orderCleaningProgress([{steps:['towel'],stage:0,progress:-2,done:false}]),0);
 assert.equal(orderCleaningProgress([{steps:['towel'],stage:10,progress:4,done:false}]),1);
});
