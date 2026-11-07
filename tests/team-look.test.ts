import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player } from '../client/js/game/Player.js';
import { CFG, DEFAULTS } from '../client/js/core/config.js';
import { teamPalette } from '../client/js/game/TeamHat.js';
import { AVATAR_COLORS } from '../shared/avatar.js';

const reset = () => Object.assign(CFG.team, structuredClone(DEFAULTS.team));

test('team palette shades derive from the team color', () => {
 const palette = teamPalette('#ec5547');
 assert.equal(palette.main, '#ec5547');
 assert.notEqual(palette.dark, palette.main); assert.notEqual(palette.light, palette.main);
});

test('plate look (HouJianNan, default): the plain ring takes the team color and no hat is shown', () => {
 reset(); assert.equal(CFG.team.style, 'plate');
 const scene = new THREE.Scene(), player = new Player(scene, { slot: 0 });
 player.setAppearance({ animal: 'cat', breed: 'ginger', color: 4 }); player.team = 1; player.applyTeamLook();
 assert.equal(player.hat.group.visible, false); assert.equal(player.footRing.material.style, 0);
 assert.equal(`#${player.footRing.material.color.getHexString()}`, CFG.team.blue);
 CFG.team.style = 'hat'; player.applyTeamLook();
 assert.equal(player.hat.group.visible, true); assert.equal(player.footRing.material.style, 1, 'switching to the hat look applies at once');
 player.team = null; player.applyTeamLook();
 assert.equal(`#${player.footRing.material.color.getHexString()}`, AVATAR_COLORS[4]);
 reset();
});

test('hat look (Mayulong): the versus team from the roster drives the look; without a team (co-op) the identity ring stays', () => {
 reset(); CFG.team.style = 'hat';
 const scene = new THREE.Scene(), players = [0, 1].map(slot => new Player(scene, { slot }));
 players.forEach((p, i) => p.setAppearance({ animal: 'cat', breed: 'ginger', color: 4 + i }));
 for (const p of players) { p.applyTeamLook(); assert.equal(p.team, null); assert.equal(p.hat.group.visible, false); assert.equal(p.footRing.material.style, 0); }
 // Team is not guessed from the slot: slot 0 can be blue and slot 1 red, as chosen in the room.
 const [blue, red] = players; blue.team = 1; red.team = 0;
 players.forEach(p => p.applyTeamLook());
 assert.equal(red.team, 0); assert.equal(blue.team, 1);
 assert.equal(`#${red.footRing.material.color.getHexString()}`, CFG.team.red); assert.equal(red.footRing.material.style, 1);
 assert.equal(`#${blue.footRing.material.color.getHexString()}`, CFG.team.blue);
 assert.equal(red.hat.group.visible, true); assert.equal(red.hat.group.parent, red.cat.bones.head);
 assert.equal(red.identityColor, AVATAR_COLORS[5], 'personal color (name tag, collar) stays');
 // Animal switches move the hat to the new head; appearance updates keep the team ring.
 red.setAppearance({ animal: 'elephant', breed: 'grey', color: 5 });
 assert.equal(red.hat.group.parent, red.elephant.bones.head); assert.equal(red.footRing.material.style, 1);
 CFG.team.red = '#ff0000'; red.applyTeamLook();
 const color = red.hat.mesh.geometry.attributes.color;
 assert.ok(color.array.some((v: number, i: number) => i % 3 === 0 && v > 0.9 && color.array[i + 1] < 0.1), 'felt recolored to the tuned team color');
 CFG.team.hats = false; red.applyTeamLook(); assert.equal(red.hat.group.visible, false);
 red.team = null; red.applyTeamLook();
 assert.equal(red.footRing.material.style, 0); assert.equal(`#${red.footRing.material.color.getHexString()}`, AVATAR_COLORS[5], 'back to co-op restores the identity ring');
 reset();
});

test('the foot ring lies on the leaned roof even though the rider leans only partly with it', async () => {
  const { Truck } = await import('../client/js/world/Truck.js');
  const { VehicleSuspension } = await import('../client/js/world/VehicleSuspension.js');
  const { PAL } = await import('../shared/sim/palette.js');
  const { getLevel, FIRST_LEVEL_ID } = await import('../shared/levels.js');
  const { palette, ...options } = getLevel(FIRST_LEVEL_ID)!.home.vehicles[0];
  // Texture drawing isn't under test: build the real truck with a canvas stub.
  const before = globalThis.document, ctx: any = new Proxy({}, { get: (o: any, k) => o[k] ?? (() => ctx), set: (o: any, k, v) => { o[k] = v; return true; } });
  (globalThis as any).document = { createElement: () => ({ getContext: () => ctx }) };
  let truck: any;
  try { truck = new Truck((PAL as any)[palette], options); } finally { (globalThis as any).document = before; }
  const scene = new THREE.Scene(); scene.add(truck.group);
  const heavy = new Player(scene, { slot: 0 });
  heavy.setAppearance({ animal: 'elephant', breed: 'grey', color: 0 });
  heavy.occupied = true; heavy.root.visible = true; heavy.state = 'ground'; heavy.ground = { truck, plat: null };
  heavy.pos.set(truck.pos.x + 1.2, truck.topY, truck.pos.z + truck.halfWidth * 0.8); heavy.root.position.copy(heavy.pos);
  const suspension = new VehicleSuspension([truck], [heavy]);
  for (let i = 0; i < 240; i++) { heavy.root.position.copy(heavy.pos); suspension.update(1 / 60); }
  scene.updateMatrixWorld(true);
  const lean = Math.hypot(suspension.loads[0].roll, suspension.loads[0].pitch);
  assert.ok(lean > 0.02, 'the rider tips the roof noticeably');
  const roofUp = new THREE.Vector3(0, 1, 0).applyQuaternion(truck.loadInner.getWorldQuaternion(new THREE.Quaternion()));
  const ringUp = new THREE.Vector3(0, 0, 1).applyQuaternion(heavy.footRing.node.getWorldQuaternion(new THREE.Quaternion()));
  const bodyUp = new THREE.Vector3(0, 1, 0).applyQuaternion(heavy.root.getWorldQuaternion(new THREE.Quaternion()));
  assert.ok(ringUp.angleTo(roofUp) < 0.01, `ring follows the roof slope (${ringUp.angleTo(roofUp)})`);
  assert.ok(bodyUp.angleTo(roofUp) > lean * 0.4, 'the body itself stays mostly upright');
});
