import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rooms } from '../server/src/Rooms.js';
import { AVATAR_COLORS, DOG_BREEDS, validAvatar, cleanAvatar } from '../shared/avatar.js';
import { Simulation } from './fixtures/Simulation.js';
import { WASH_CONFIG as C } from '../shared/sim/washConfig.js';
import { LEVELS } from '../shared/levels.js';
import { packetInput } from '../shared/protocol.js';
import { Player } from '../client/js/game/Player.js';
import { room, rosterOf } from './helpers/peerRoom.js';

class Peer { readyState=1; messages:any[]=[];send(raw:string){this.messages.push(JSON.parse(raw));}close(){this.readyState=3;} }
const dog=(color:number,breed='corgi')=>({animal:'dog',breed,color});
const keys=(down:string[]=[],hits:string[]=[])=>packetInput({seq:1,down,hits,move:[0,0],axis:[0,0]});

test('registry validates dog breeds per animal and the roster carries the chosen animal',()=>{
 for(const breed of DOG_BREEDS)assert.equal(validAvatar(dog(3,breed.id)),true);
 for(const bad of [dog(1,'ginger'),{animal:'cat',breed:'corgi',color:1},{animal:'fox',breed:'corgi',color:1}])assert.equal(validAvatar(bad),false);
 assert.deepEqual(cleanAvatar({...dog(2,'husky'),extra:1}),dog(2,'husky'));
 const service=new Rooms();try{
  const host=service.connect(new Peer(),'Host'),guest=service.connect(new Peer(),'Guest');service.join(guest,host.room.code);
  service.customize(guest,dog(7,'shiba'),'dog');
  const roster=(host.peer as Peer).messages.filter(m=>m.type==='room').at(-1);
  assert.deepEqual(roster.members.find((m:any)=>m.slot===guest.slot).appearance,dog(7,'shiba'));
 }finally{service.close();}
});

/** One player works the first stain needing `kind` for 0.4 of its base duration; returns progress and durability spent. */
function work(animal:string,kind:string){
 const sim=new Simulation();try{
  sim.occupy(0,true);sim.setAnimal(0,animal);sim.phase='game';sim.game.start(sim.director.base);sim.game.spawnOrder();sim.scene.updateMatrixWorld(true);
  const g=sim.game,p=sim.players[0],stain=g.order.stains.find((entry:any)=>entry.steps.includes(kind));
  stain.stage=stain.steps.indexOf(kind);
  p.state='ground';p.ground={truck:g.orderTruck,plat:g.orderTruck.platforms[0]};p.pos.copy(stain.mesh.getWorldPosition(new THREE.Vector3()));p.vel.set(0,0,0);
  const tool=kind==='soap'?g.takeSoap(p):g.towels[0];tool.pickup(p);p.skipUse=false;
  const seconds=kind==='soap'?C.soapSeconds:C.wipeSeconds;
  for(let i=0;i<Math.round(seconds*0.4*60);i++)g.interact(p,keys(['KeyJ']),1/60);
  assert.equal(p.useAction,kind==='soap'?'soap':'wipe');
  return {progress:stain.progress,spent:(kind==='soap'?C.soapDurability:C.towelDurability)-tool.durability};
 }finally{sim.dispose();}
}

test('dogs wipe and soap dogWorkSpeedBonus faster on the authority (60%), spending the same durability per stain',()=>{
 for(const kind of ['towel','soap']){
  const cat=work('cat',kind),dog=work('dog',kind);
  assert.ok(cat.progress>0.3&&cat.progress<0.5,`${kind}: cat makes partial progress`);
  assert.ok(Math.abs(dog.progress-cat.progress*(1+C.dogWorkSpeedBonus))<1e-6,`${kind}: dog progress is ${1+C.dogWorkSpeedBonus}×`);
  assert.ok(Math.abs(dog.spent/dog.progress-cat.spent/cat.progress)<1e-6,'durability follows progress, not time');
 }
});

test('host applies the roster animal per slot, keeps it across level rebuilds, and passives stay per animal',()=>{
 const r=room(['a']);try{
  const members=r.members.map(m=>m.id==='a'?{...m,appearance:dog(4,'husky')}:m);
  r.host.setRoster(rosterOf(members));
  const [host,guest]=r.host.sim.players;
  assert.equal(guest.animal,'dog');assert.equal(guest.workSpeed,1+C.dogWorkSpeedBonus);assert.equal(guest.respawnReduction,0);
  assert.equal(host.animal,'cat');assert.equal(host.workSpeed,1);assert.equal(host.respawnReduction,C.catRespawnReduction);
  guest.fallOut();assert.ok(Math.abs(guest.fallTimer-C.respawnSeconds)<1e-9,'dogs wait the full respawn');
  r.host.rebuild(LEVELS[1].id);assert.equal(r.host.sim.players[1].animal,'dog');assert.equal(r.host.sim.players[0].animal,'cat');
  r.host.setRoster(rosterOf(r.members));assert.equal(r.host.sim.players[1].animal,'cat','returning to a cat restores its passive');
 }finally{r.dispose();}
});

test('dog breeds reuse one prepared dog model; switching animal only toggles visibility and the presented passive',async()=>{
 const player=new Player(new THREE.Scene());await player.appearanceReady;
 const {base,details,shells}=player.dog.meshes,catBase=player.cat.meshes.base;
 const geometry=base.geometry,detailGeometry=details.geometry,material=base.material;
 assert.equal(player.dog.group.visible,false);assert.equal(player.body,player.cat);
 for(const breed of DOG_BREEDS)for(const color of [0,9,15]){
  player.setAppearance(dog(color,breed.id));
  assert.equal(player.body,player.dog);assert.equal(player.dog.group.visible,true);assert.equal(player.cat.group.visible,false);
  assert.equal(player.dog.meshes.base.geometry,geometry);assert.equal(player.dog.meshes.details.geometry,detailGeometry);
  assert.equal(player.dog.meshes.base.material,material);assert.equal(shells.geometry.attributes.color,geometry.attributes.color);
  assert.equal(player.footRing.material.color.getHexString(),AVATAR_COLORS[color].slice(1));
  assert.equal(player.respawnReduction,0);assert.equal(player.workSpeed,1+C.dogWorkSpeedBonus);
 }
 player.setAppearance(dog(0,'corgi'));const corgiEar=player.dog.bones.earL.scale.x;
 player.setAppearance(dog(0,'shiba'));assert.ok(corgiEar>player.dog.bones.earL.scale.x,'corgi ears are bigger');
 assert.equal(player.dog.furBase.userData.fur,player.cat.furBase.userData.fur,'one wetness/wind uniform set per player');
 player.setWetness(0.5);assert.equal(player.cat.furBase.userData.fur.furWet.value,0.5);
 player.updateVisual(1/60);
 player.setAppearance({animal:'cat',breed:'grey',color:1});
 assert.equal(player.body,player.cat);assert.equal(player.dog.group.visible,false);assert.equal(player.cat.meshes.base,catBase);
 assert.equal(player.respawnReduction,C.catRespawnReduction);
});
