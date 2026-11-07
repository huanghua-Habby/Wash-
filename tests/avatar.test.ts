import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rooms } from '../server/src/Rooms.js';
import { AVATAR_COLORS, CAT_BREEDS, validAvatar } from '../shared/avatar.js';
import { Player } from '../client/js/game/Player.js';

class Peer { readyState=1; messages:any[]=[];send(raw:string){this.messages.push(JSON.parse(raw));}close(){this.readyState=3;} }
const profile=(color:number,breed='ginger')=>({animal:'cat',breed,color});

test('registry reserves one of 16 colors per identity, rejects races atomically and preserves only confirmed profiles',()=>{
 const service=new Rooms();
 try{
  const players=[0,1,2,3].map(i=>service.connect(new Peer(),`P${i}`));
  for(const member of players.slice(1))service.join(member,players[0].room.code);
  assert.deepEqual(players.map(p=>p.appearance.color),[0,1,2,3]);
  service.customize(players[1],profile(5,'cream'),'first');
  const old={...players[2].appearance};
  assert.throws(()=>service.customize(players[2],profile(5,'tuxedo'),'race'),(e:any)=>e.code==='color_taken');
  assert.deepEqual(players[2].appearance,old,'failed color claim never changes the breed');
  const roster=(players[0].peer as Peer).messages.filter(m=>m.type==='room').at(-1);
  assert.deepEqual(roster.members[1].appearance,profile(5,'cream'));
  assert.equal((players[1].peer as Peer).messages.at(-1).requestId,'first');
  service.disconnect(players[1],players[1].peer as Peer);
  assert.throws(()=>service.customize(players[2],profile(5),'offline'),(e:any)=>e.code==='color_taken');
  const recovered=service.connect(new Peer(),'ignored',players[1].token);assert.deepEqual(recovered.appearance,profile(5,'cream'));
  service.customize(players[1],profile(6,'tuxedo'),'release');service.customize(players[2],profile(5),'next');
  service.hostPhase(players[0],'game');assert.throws(()=>service.customize(players[0],profile(7),'playing'),(e:any)=>e.code==='room_started');
  service.hostPhase(players[0],'home');service.leave(players[1]);assert.deepEqual(players[1].appearance,profile(6,'tuxedo'));
 }finally{service.close();}
});

test('selected profiles survive hello and joining a conflicting room chooses an available color without losing breed',()=>{
 const service=new Rooms();try{
  const host=service.connect(new Peer(),'Host'),guest=service.connect(new Peer(),'Guest',undefined,undefined,profile(0,'cream'));
  service.join(guest,host.room.code);assert.equal(guest.appearance.color,1);assert.equal(guest.appearance.breed,'cream');
  // Pages check meaning (validAvatar: palette colour, the animal's own breeds); the room service checks only shape
  // (REGISTRY_VERSION is content-agnostic), so a new animal never needs a service update.
  for(const bad of [profile(16),profile(1,'dog'),{...profile(1),animal:'dog'}]) assert.equal(validAvatar(bad),false);
  for(const bad of [profile(-1),profile(64),profile(1.5),{...profile(1),animal:'Dog!'},{...profile(1),breed:'x'.repeat(30)},null]){
   assert.equal(validAvatar(bad),false);const before={...guest.appearance};
   assert.throws(()=>service.customize(guest,bad,'bad'),(e:any)=>e.code==='invalid_avatar');assert.deepEqual(guest.appearance,before);
  }
  assert.equal(AVATAR_COLORS.length,16);assert.equal(CAT_BREEDS.length,4);
 }finally{service.close();}
});

test('all cosmetic breeds and colors reuse existing geometry, skeleton, fur instances and prepared materials',async()=>{
 const player=new Player(new THREE.Scene()),meshes={...player.cat.meshes};
 await player.cat.appearanceReady;
 const geometry=meshes.base.geometry,details=meshes.details.geometry,skeleton=player.cat.skeleton;
 const original=Array.from(geometry.attributes.color.array);
 const baseMaterial=meshes.base.material;
 for(const breed of CAT_BREEDS)for(let color=0;color<16;color++){
  player.setAppearance(profile(color,breed.id));
  assert.equal(player.cat.meshes.base.geometry,geometry);assert.equal(player.cat.meshes.details.geometry,details);
  assert.equal(player.cat.skeleton,skeleton);assert.equal(player.cat.meshes.base.material,baseMaterial);
  assert.equal(player.cat.meshes.shells.geometry.attributes.color,geometry.attributes.color);
  assert.equal(player.footRing.material.color.getHexString(),AVATAR_COLORS[color].slice(1));
 }
 player.setAppearance(profile(0));assert.deepEqual(Array.from(geometry.attributes.color.array),original,'ginger colors return exactly');
 assert.equal(player.respawnReduction,0.6,'cosmetic breed never changes gameplay');
});
