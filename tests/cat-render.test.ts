import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player } from '../client/js/game/Player.js';
import { FUR } from '../client/js/game/cat/CatModel.js';
import { shadowSamples } from '../client/js/render/ShadowWarmup.js';
import { CFG } from '../client/js/core/config.js';

test('cat defaults to eight fur shells, reserves Extra capacity, and keeps both shadow casters with one mask draw',()=>{
 const player=new Player(new THREE.Scene()),{base,shells,details,mask}=player.cat.meshes;
 assert.equal(FUR.shells,20);assert.equal((shells.geometry as THREE.InstancedBufferGeometry).instanceCount,8);
 assert.equal(shells.geometry.getAttribute('furShell').count,20,'Extra capacity is not the release quality setting');
 for(const mesh of [base,shells,details]){assert.equal(mesh.layers.mask,1);assert.equal(mesh.receiveShadow,true);}
 assert.equal(base.castShadow,true);assert.equal(details.castShadow,true);assert.equal(shells.castShadow,false);
 assert.equal(mask.layers.mask,2);assert.equal(mask.castShadow,false);assert.equal(mask.receiveShadow,false);
 assert.equal((mask.geometry as THREE.InstancedBufferGeometry).isInstancedBufferGeometry,undefined);
 assert.deepEqual(Object.keys(mask.geometry.attributes).sort(),['position','skinIndex','skinWeight']);
 assert.equal(mask.skeleton,base.skeleton);assert.equal(mask.skeleton,details.skeleton);
 const count=(mesh:THREE.Mesh)=>(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;
 const main=count(base)+count(shells)*FUR.shells+count(details),shadow=count(base)+count(details);
 assert.equal(count(mask),shadow);
 assert.equal(main,224468);assert.equal(main*2+shadow-(main+count(mask)+shadow),210880);
 const scene=new THREE.Scene();scene.add(player.root);
 // Body + details per animal (cat, dog, pelican, elephant, squirrel, goose, kangaroo) plus the hidden team-test hat; hidden objects are warmed too.
 // The mask proxy never adds a shadow caster.
 const samples=shadowSamples(scene).children;assert.equal(samples.length,15,'proxy never adds an extra shadow');
 const dog=player.dog.meshes;assert.equal(player.dog.group.visible,false);
 assert.equal(dog.base.castShadow,true);assert.equal(dog.details.castShadow,true);assert.equal(dog.shells.castShadow,false);assert.equal(dog.mask.layers.mask,2);
});

test('merged mask follows the exact body and facial skin deformation through animated poses',()=>{
 const player=new Player(new THREE.Scene()),{base,details,mask}=player.cat.meshes;
 for(const t of [0,.2,.7,1.1]) {
  player.cat.bones.head.rotation.set(t*.12,t*.4,-t*.3);
  player.cat.bones.eyeL.scale.y=.1+t*.5;player.cat.bones.armR.rotation.z=-t;
  player.cat.bones.tail2.rotation.y=t;player.squash.scale.set(.9,1.2,.9);
  player.root.updateMatrixWorld(true);base.skeleton.update();
  let offset=0;
  for(const source of [base,details]) {
   const position=source.geometry.attributes.position;
   for(let i=0;i<position.count;i++) {
    const expected=new THREE.Vector3().fromBufferAttribute(position,i);source.applyBoneTransform(i,expected);
    const actual=new THREE.Vector3().fromBufferAttribute(mask.geometry.attributes.position,offset+i);mask.applyBoneTransform(offset+i,actual);
    assert.ok(actual.distanceTo(expected)<1e-6,'merged silhouette must keep all facial and limb animation');
   }
   offset+=position.count;
  }
 }
});

test('fur quality reuses buffers and spans the full coat at every layer count for every animal',()=>{
 const player=new Player(new THREE.Scene());
 for(const body of Object.values(player.bodies)) {
  const {shells,base,details,mask}=body.meshes;
  const geometry=shells.geometry as THREE.InstancedBufferGeometry;
  const attribute=geometry.getAttribute('furShell');
  const materials=[base.material,shells.material,details.material];
  for(const count of [0,1,4,8,12,16,20,4,20]) {
   body.setFurShells(count);
   assert.equal(geometry.instanceCount,count);assert.equal(shells.visible,count>0);
   assert.equal(geometry.getAttribute('furShell'),attribute);
   const version=(attribute as THREE.InstancedBufferAttribute).version;
   body.setFurShells(count);
   assert.equal((attribute as THREE.InstancedBufferAttribute).version,version,'unchanged quality never reuploads the buffer');
   assert.equal(shells.geometry,geometry);
   assert.deepEqual([base.material,shells.material,details.material],materials);
   assert.equal(mask.skeleton,base.skeleton);
   if(count>0) {
    const denominator=body.furBase.userData.fur.furShells.value;
    assert.equal(attribute.getX(0)/denominator,1,'outermost shell keeps full fur length');
    assert.equal(attribute.getX(count-1)/denominator,1/count,'evenly spaced down to the root');
   }
  }
  body.setFurShells(-1);assert.equal(geometry.instanceCount,0);
  body.setFurShells(99);assert.equal(geometry.instanceCount,20);
  body.setFurShells(NaN);assert.equal(geometry.instanceCount,20);
  const previous=CFG.fur.shells;
  try { CFG.fur.shells=8;body.setFurForce(new THREE.Vector3(0,-.6,0));assert.equal(geometry.instanceCount,8); }
  finally { CFG.fur.shells=previous; }
 }
});
