import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ShockXRay } from '../client/js/fx/ShockXRay.js';

/** A minimal animal: a skinned-mesh stand-in that parents the bone root, like the real models. */
function fakePlayer() {
  const group = new THREE.Group(), skin = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  group.add(skin);
  const bone = (name: string, parent: THREE.Object3D, x = 0, y = 0, z = 0) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); parent.add(b); return b; };
  const root = bone('root', skin), hips = bone('hips', root, 0, .27), spine = bone('spine', hips, 0, .1), head = bone('head', spine, .03, .2);
  const bones: any = { root, hips, spine, head, eyeL: bone('eyeL', head, .25, .15, -.08), eyeR: bone('eyeR', head, .25, .15, .08) };
  for (const side of ['L', 'R']) {
    bones[`arm${side}`] = bone(`arm${side}`, spine, .1, .05); bones[`paw${side}`] = bone(`paw${side}`, bones[`arm${side}`], 0, -.15);
    bones[`leg${side}`] = bone(`leg${side}`, hips, 0, -.05); bones[`foot${side}`] = bone(`foot${side}`, bones[`leg${side}`], 0, -.15);
  }
  const body = { group, bones };
  return { player: { bodies: { cat: body }, body, occupied: true, root: { visible: true }, slot: 0, stunRemaining: 0 }, skin };
}

test('X-ray parts stay strictly hidden until a stun strobe flash, which swaps the body out via layers and restores it', () => {
  const { player, skin } = fakePlayer(), xray = new ShockXRay([player]);
  try {
    const parts = xray.rigs[0].bodies[0].parts;
    assert.ok(parts.length > 8);
    xray.update(0, true);
    parts.forEach((mesh: any) => assert.equal(mesh.visible, false, 'renderer skips only visible === false; a falsy 0 would still draw'));
    assert.equal(skin.layers.mask, 1);
    player.stunRemaining = 2; xray.update(0, true); // strobe step 0 is the black-body flash
    assert.equal(xray.rigs[0].mode, 1); parts.forEach((mesh: any) => assert.equal(mesh.visible, true));
    assert.equal(skin.layers.mask, 0, 'body hidden by layers, so its bone-root children (the X-ray) still draw');
    assert.equal(skin.visible, true);
    player.stunRemaining = .2; xray.update(0, true); // final moments: no strobe
    parts.forEach((mesh: any) => assert.equal(mesh.visible, false)); assert.equal(skin.layers.mask, 1);
  } finally { xray.dispose(); }
});
