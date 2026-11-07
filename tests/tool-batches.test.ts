import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { batchTool } from '../client/js/render/ToolBatches.js';
import { identityRings } from '../client/js/render/IdentityRings.js';
import { buildWashStation, buildSoapBox, buildSupplyPoint, buildChargingPost, buildChargingGun, buildChargePort } from '../shared/sim/ToolModels.js';

function draws(root: THREE.Object3D) {
  const result = { main: 0, shadow: 0, mask: 0, triangles: 0 };
  root.traverse((node: any) => {
    if (!node.isMesh) return;
    if (node.layers.isEnabled(0)) { result.main++; result.triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3; }
    if (node.castShadow) result.shadow++;
    if (node.layers.isEnabled(1)) result.mask++;
  });
  return result;
}

test('each rigid station/tool retains geometry and material response in single-digit total main/shadow/mask draws', () => {
  for (const [build, budget] of [[buildWashStation, 7], [buildSoapBox, 3], [buildSupplyPoint, 3],
    [buildChargingPost, 9], [buildChargingGun, 7], [buildChargePort, 7]] as const) {
    const root = build(), before = draws(root), sources: THREE.Mesh[] = [];
    root.traverse((node: any) => { if (node.isMesh) sources.push(node); });
    const expected = sources.flatMap(mesh => {
      mesh.updateMatrix(); const p = mesh.geometry.attributes.position, values: number[] = [];
      const indices = mesh.geometry.index;
      for (let i = 0; i < (indices?.count ?? p.count); i++) new THREE.Vector3().fromBufferAttribute(p, indices ? indices.getX(i) : i).applyMatrix4(mesh.matrix).toArray(values, i * 3);
      return values;
    });
    const light = root.userData.light || root.userData.led, lightMaterial = light?.material;
    batchTool(root); const after = draws(root);
    assert.ok(after.main + after.shadow + after.mask <= budget, `${build.name}: ${JSON.stringify(after)}`);
    assert.equal(after.triangles, before.triangles, 'main geometry is preserved exactly');
    assert.equal(after.mask, 1, 'one merged silhouette per independent model');
    const mask = root.getObjectByName('tool-velocity-mask') as THREE.Mesh;
    assert.equal(mask.castShadow, false); assert.equal(mask.receiveShadow, false);
    const position = mask.geometry.attributes.position;
    assert.equal(position.count * 3, expected.length);
    expected.forEach((v, i) => assert.ok(Math.abs(v - position.array[i]) < 1e-5, 'mask follows the original silhouette'));
    if (light) { assert.equal(light.material, lightMaterial); assert.ok(light.parent); light.material.color.set('#ff0000'); }
    const snapshot = draws(root); batchTool(root); assert.deepEqual(draws(root), snapshot, 'batching is idempotent');
  }
});

test('batched station keeps basin double-sided, chrome/water gloss and original linear palette/emission', () => {
  const root = buildWashStation(); batchTool(root);
  const parts = new Map<string, { mesh: THREE.Mesh, part: any }>();
  root.traverse((mesh: any) => { for (const part of mesh.geometry?.userData.toolParts || []) parts.set(part.part, { mesh, part }); });
  assert.equal((parts.get('basin')!.mesh.material as THREE.Material).side, THREE.DoubleSide);
  for (const [name, gloss] of [['water', 90], ['chrome', 110]] as const) {
    const { mesh, part } = parts.get(name)!;
    assert.ok(mesh.material instanceof THREE.MeshPhongMaterial);
    assert.equal(mesh.geometry.attributes.toolGloss.getW(part.start), gloss);
    const color = new THREE.Color().fromBufferAttribute(mesh.geometry.attributes.color as THREE.BufferAttribute, part.start);
    assert.equal(color.getHexString(), part.color);
  }
  const post = buildChargingPost(); batchTool(post);
  let lit = false;
  post.traverse((mesh: any) => { const a = mesh.geometry?.attributes.toolEmission; if (a && [...a.array].some(v => Number(v) > 0)) lit = true; });
  assert.ok(lit, 'lightning badge emission remains present inside the static batch');
});

test('one scene ring batch preserves independent color, transforms, opacity, hidden ancestors and back-to-front order', () => {
  const scene = new THREE.Scene(), rings = identityRings(scene), camera = new THREE.PerspectiveCamera();
  assert.equal(identityRings(scene), rings); assert.equal(rings.mesh.count, 0);
  const a = new THREE.Group(), b = new THREE.Group(); scene.add(a, b);
  const red = rings.create('#ff0000'), blue = rings.create('#0000ff'); a.add(red.node); b.add(blue.node);
  assert.equal((red.node as any).material, undefined, 'render preparation cannot mistake an appearance handle for a mesh');
  a.position.set(1, 2, -3); b.position.set(-1, 4, -7); blue.material.opacity = .34;
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  (scene.onBeforeRender as any)({}, scene, camera, null);
  assert.equal(rings.mesh.count, 2);
  assert.equal(rings.mesh.geometry.attributes.ringOpacity.getX(0), Math.fround(.34));
  const color = new THREE.Color(); rings.mesh.getColorAt(0, color); assert.equal(color.getHexString(), '0000ff');
  const matrix = new THREE.Matrix4(); rings.mesh.getMatrixAt(0, matrix);
  blue.node.matrixWorld.elements.forEach((v: number, i: number) => assert.ok(Math.abs(matrix.elements[i] - v) < 1e-6));
  const versions = [rings.mesh.instanceMatrix.version, rings.mesh.instanceColor!.version, rings.opacity.version];
  rings.sync(camera); assert.deepEqual([rings.mesh.instanceMatrix.version, rings.mesh.instanceColor!.version, rings.opacity.version], versions, 'idle rings do not upload buffers');
  a.visible = b.visible = false; rings.sync(camera); assert.equal(rings.mesh.count, 0);
  a.visible = true; red.material.color.set('#00ff00'); rings.sync(camera); assert.equal(rings.mesh.count, 1);
  rings.mesh.getColorAt(0, color); assert.equal(color.getHexString(), '00ff00');
  assert.equal(rings.mesh.layers.mask, 1); assert.equal(rings.mesh.castShadow, false);
  rings.dispose(); rings.dispose(); assert.equal(rings.mesh.parent, null);
  assert.notEqual(identityRings(scene), rings, 'a later scene lifecycle receives its own live batch'); identityRings(scene).dispose();
});
