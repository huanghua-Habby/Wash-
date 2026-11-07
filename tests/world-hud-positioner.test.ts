import test from 'node:test';
import assert from 'node:assert/strict';
import { OrthographicCamera, Vector3 } from 'three';
import { WorldHudPositioner } from '../client/js/ui/WorldHudPositioner.js';
import { SceneCamera } from '../client/js/render/SceneCamera.js';

const node = () => ({ hidden: false, style: { transform: '' } });
const xy = (n: ReturnType<typeof node>) => n.style.transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px/)!.slice(1).map(Number);
function camera() { const c = new OrthographicCamera(-720, 720, 405, -405, .1, 100); c.position.z = 10; c.updateMatrixWorld(true); return c; }

test('world HUD damps anchor jitter while leaving camera pans and zooms aligned', () => {
  const c = camera(), p = new WorldHudPositioner(), n = node(), a = new Vector3();
  let rawEnergy = 0, dampedEnergy = 0;
  for (let i = 0; i < 120; i++) {
    a.x = Math.sin(i * Math.PI / 2) * 3;
    p.begin(c, 1 / 60); p.place(n, a);
    if (i > 30) { rawEnergy += a.x ** 2; dampedEnergy += (xy(n)[0] - 720) ** 2; }
  }
  assert.ok(dampedEnergy < rawEnergy * .1, '15 Hz anchor jitter should be strongly attenuated');
  p.reset(); a.set(0, 0, 0); p.begin(c, 1 / 60); p.place(n, a);
  c.position.x = 120; c.zoom = 1.5; c.updateProjectionMatrix(); c.updateMatrixWorld(true);
  p.begin(c, 1 / 60); p.place(n, a);
  const projected = a.clone().project(c);
  assert.ok(Math.abs(xy(n)[0] - (projected.x + 1) * 720) <= .125, 'camera changes are never damped');
});

test('moving anchors stay within six pixels and reused, hidden or teleported labels snap', () => {
  const c = camera(), p = new WorldHudPositioner(), n = node(), a = new Vector3();
  for (let i = 0; i < 40; i++) {
    a.x = i * 3; p.begin(c, 1 / 60); p.place(n, a, { identity: 'a' });
    assert.ok(Math.abs(xy(n)[0] - 720 - a.x) <= 6.125);
  }
  for (const event of ['identity', 'teleport', 'hide', 'scene', 'quiet', 'long-gap']) {
    if (event === 'hide') p.hide(n);
    a.x += event === 'teleport' ? 100 : 10;
    p.begin(c, event === 'long-gap' ? .3 : 1 / 60, { context: event === 'scene' ? 'new-room' : '', motionEnabled: event !== 'quiet' });
    p.place(n, a, { identity: event === 'identity' ? 'b' : 'a' });
    assert.equal(xy(n)[0], 720 + a.x, event);
  }
  p.begin(c, 1 / 60); p.place(n, new Vector3(0, 0, 20)); assert.equal(n.hidden, true);
});

test('exponential HUD response is consistent across render rates', () => {
  const final = (fps: number) => {
    const c = camera(), p = new WorldHudPositioner({ maxLag: 100 }), n = node();
    p.begin(c, 0); p.place(n, new Vector3());
    for (let i = 0; i < fps / 2; i++) { p.begin(c, 1 / fps); p.place(n, new Vector3(20, 0, 0)); }
    return xy(n)[0];
  };
  assert.equal(final(30), final(60)); assert.equal(final(60), final(120));
});

test('a resumed browser snaps even when the runtime clamps gameplay dt', () => {
  let time = 0;
  const c = camera(), p = new WorldHudPositioner({ now: () => time }), n = node();
  p.begin(c, 1 / 60); p.place(n, new Vector3());
  time = 1000; p.begin(c, .05); p.place(n, new Vector3(20, 0, 0));
  assert.equal(xy(n)[0], 740);
});

test('camera matrices are finalized before world HUD or post-camera consumers', () => {
  const c = camera();
  const rig = { update() { c.position.x = 120; c.rotation.y = .2; }, snap() { c.position.x = 20; } };
  let verified = false;
  const game = { active: false, afterCamera(cam: OrthographicCamera) {
    const old = cam.matrixWorldInverse.clone(); cam.updateMatrixWorld(true);
    assert.deepEqual(cam.matrixWorldInverse.elements, old.elements); verified = true;
  } };
  const director = new SceneCamera({ camera: c, rig, game, practice: { trucks: [{ pos: new Vector3() }, { pos: new Vector3() }] },
    session: { localPlayer: () => ({ state: 'fallen' }) }, transition: { cameraFocus: (v: Vector3) => v, afterCamera() {} } });
  director.snap(); assert.equal(c.matrixWorld.elements[12], 20);
  director.update(1 / 60, 30); assert.ok(verified);
});


test('precision aim cues use immediate projection without changing ordinary label damping', () => {
 const c=camera(),positioner=new WorldHudPositioner(),aim=node(),label=node();
 positioner.begin(c,1/60);positioner.place(aim,new Vector3(),{immediate:true});positioner.place(label,new Vector3());
 positioner.begin(c,1/60);positioner.place(aim,new Vector3(20,0,0),{immediate:true});positioner.place(label,new Vector3(20,0,0));
 assert.equal(xy(aim)[0],740);assert.ok(xy(label)[0]<740);
 positioner.begin(c,1/60);positioner.place(aim,new Vector3(1000,0,0),{immediate:true,margin:.95});
 assert.equal(aim.hidden,true,'offscreen points do not leave a floating reticle on the screen edge');
});

test('large hazard HUD can reserve screen space without clipping its triangle or changing ordinary world labels', () => {
  const c=camera(),p=new WorldHudPositioner(),warning=node(),ordinary=node();
  const screenInsets={left:120,right:120,top:220,bottom:16};
  p.begin(c,1/60);p.place(warning,new Vector3(-1000,1000,0),{immediate:true,screenInsets});
  assert.deepEqual(xy(warning),[120,220]);
  p.place(ordinary,new Vector3(-1000,1000,0),{immediate:true});assert.deepEqual(xy(ordinary),[-280,-595]);
  c.zoom=1.5;c.updateProjectionMatrix();c.updateMatrixWorld(true);
  p.begin(c,1/60);p.place(warning,new Vector3(1000,-1000,0),{immediate:true,screenInsets});
  assert.deepEqual(xy(warning),[1320,794]);
});

test('a label riding the screen edge does not strobe while its anchor wobbles across the cull line', () => {
  const c = camera(), p = new WorldHudPositioner(), n = node(), a = new Vector3();
  const edge = .96 * 720; // design pixels from centre at margin .96
  p.begin(c, 1 / 60); a.x = edge - 10; p.place(n, a, { margin: .96 });
  let flips = 0, last = n.hidden;
  for (let i = 0; i < 60; i++) {
    a.x = edge + (i % 2 ? 6 : -6); p.begin(c, 1 / 60); p.place(n, a, { margin: .96 });
    if (n.hidden !== last) { flips++; last = n.hidden; }
  }
  assert.equal(flips, 0, 'an on-screen label leaves a little later than it enters');
  a.x = 720 * 1.1; p.begin(c, 1 / 60); p.place(n, a, { margin: .96 });
  assert.equal(n.hidden, true, 'it still hides once clearly off screen');
  a.x = edge + 6; p.begin(c, 1 / 60); p.place(n, a, { margin: .96 });
  assert.equal(n.hidden, true, 'a hidden label only re-enters inside the ordinary margin');
});
