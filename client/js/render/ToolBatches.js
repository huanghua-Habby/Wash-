import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { shareToolResource } from '../../../shared/sim/ToolModels.js';
import { prepareShadowMaterials } from './ShadowWarmup.js';

const materials = new Map(), templates = new Map();
const maskMaterial = shareToolResource(new THREE.MeshBasicMaterial({ color: 0xffffff }));
const flags = ['type', 'side', 'shadowSide', 'opacity', 'transparent', 'alphaTest', 'depthTest', 'depthWrite',
  'depthFunc', 'blending', 'premultipliedAlpha', 'flatShading', 'toneMapped', 'fog', 'dithering'];

function batchMaterial(source, key) {
  if (materials.has(key)) return materials.get(key);
  const material = source.clone(), phong = !!source.isMeshPhongMaterial;
  material.color.set('#ffffff'); material.emissive.set('#000000'); material.vertexColors = true;
  material.userData = { toolBatch: true };
  material.customProgramCacheKey = () => `tool-batch-${source.type}`;
  material.onBeforeCompile = shader => {
    const gloss = phong ? 'attribute vec4 toolGloss; varying vec4 vToolGloss;' : '';
    shader.vertexShader = shader.vertexShader.replace('#include <common>',
      `#include <common>\nattribute vec3 toolEmission; varying vec3 vToolEmission; ${gloss}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvToolEmission = toolEmission; ${phong ? 'vToolGloss = toolGloss;' : ''}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      `#include <common>\nvarying vec3 vToolEmission; ${phong ? 'varying vec4 vToolGloss;' : ''}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = vToolEmission;');
    if (phong) shader.fragmentShader = shader.fragmentShader.replace('#include <lights_phong_fragment>',
      '#include <lights_phong_fragment>\nmaterial.specularColor = vToolGloss.rgb; material.specularShininess = max(0.0001, vToolGloss.a);');
  };
  shareToolResource(material); materials.set(key, material); return material;
}

function relativeMatrix(mesh, root) {
  const chain = [];
  for (let node = mesh; node !== root; node = node.parent) { node.updateMatrix(); chain.push(node.matrix); }
  const matrix = new THREE.Matrix4();
  for (let i = chain.length - 1; i >= 0; i--) matrix.multiply(chain[i]);
  return matrix;
}

function bakedGeometry(mesh, matrix) {
  const source = mesh.geometry;
  const geometry = (source.index ? source.toNonIndexed() : source.clone()).applyMatrix4(matrix);
  const count = geometry.attributes.position.count, material = mesh.material;
  const color = new Float32Array(count * 3), emission = new Float32Array(count * 3), gloss = new Float32Array(count * 4);
  const emissive = material.emissive.clone().multiplyScalar(material.emissiveIntensity);
  for (let i = 0; i < count; i++) {
    material.color.toArray(color, i * 3); emissive.toArray(emission, i * 3);
    if (material.isMeshPhongMaterial) { material.specular.toArray(gloss, i * 4); gloss[i * 4 + 3] = material.shininess; }
  }
  for (const name of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
  if (!geometry.attributes.uv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geometry.setAttribute('toolEmission', new THREE.BufferAttribute(emission, 3));
  geometry.setAttribute('toolGloss', new THREE.BufferAttribute(gloss, 4));
  geometry.clearGroups(); return geometry;
}

/** Static parts inside one rigid item only. Dynamic cloth/LED materials remain independently addressable. */
export function batchTool(root, { dynamic = [], cache = false } = {}) {
  if (root.userData.toolBatched) return root;
  const keep = new Set(dynamic), sources = [];
  root.traverse(node => {
    for (const key of ['light', 'led', 'screen']) if (node.userData[key]?.material) keep.add(node.userData[key].material);
    if (node.isMesh && !node.isInstancedMesh && !node.isSkinnedMesh) sources.push(node);
  });
  const entries = sources.map(mesh => ({ mesh, matrix: relativeMatrix(mesh, root) }));
  const eligible = mesh => !keep.has(mesh.material) && !Array.isArray(mesh.material) &&
    (mesh.material.isMeshLambertMaterial || mesh.material.isMeshPhongMaterial) &&
    !mesh.material.transparent && !mesh.material.map && !mesh.material.alphaMap && !mesh.material.envMap && !mesh.material.vertexColors;
  const templateKey = cache ? entries.map(({ mesh, matrix }) => `${mesh.geometry.uuid}:${mesh.material.uuid}:${matrix.elements.join(',')}`).join('|') : null;
  let prepared = templateKey && templates.get(templateKey);
  if (!prepared) {
    const buckets = new Map(), silhouette = [];
    for (const { mesh, matrix } of entries) {
      const shape = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      shape.applyMatrix4(matrix);
      for (const name of Object.keys(shape.attributes)) if (name !== 'position') shape.deleteAttribute(name);
      shape.clearGroups(); silhouette.push(shape);
      if (!eligible(mesh)) continue;
      const key = JSON.stringify([...flags.map(flag => mesh.material[flag]), mesh.castShadow, mesh.receiveShadow]);
      if (!buckets.has(key)) buckets.set(key, { material: batchMaterial(mesh.material, key), geometries: [], parts: [], cast: mesh.castShadow, receive: mesh.receiveShadow });
      const bucket = buckets.get(key), geometry = bakedGeometry(mesh, matrix);
      bucket.parts.push({ part: mesh.material.userData.toolPart, color: mesh.material.color.getHexString(),
        start: bucket.geometries.reduce((sum, g) => sum + g.attributes.position.count, 0), count: geometry.attributes.position.count });
      bucket.geometries.push(geometry);
    }
    const batches = [...buckets.values()].map(bucket => {
      const geometry = mergeGeometries(bucket.geometries); bucket.geometries.forEach(g => g.dispose());
      geometry.computeBoundingBox(); geometry.computeBoundingSphere(); geometry.userData.toolParts = bucket.parts;
      return { geometry, material: bucket.material, cast: bucket.cast, receive: bucket.receive };
    });
    const mask = mergeGeometries(silhouette); silhouette.forEach(g => g.dispose()); mask.computeBoundingBox(); mask.computeBoundingSphere();
    prepared = { batches, mask };
    if (templateKey) { for (const batch of batches) shareToolResource(batch.geometry); shareToolResource(mask); templates.set(templateKey, prepared); }
  }
  for (const { mesh } of entries) {
    if (eligible(mesh)) mesh.removeFromParent();
    else mesh.layers.disable(1);
  }
  for (const batch of prepared.batches) {
    const mesh = new THREE.Mesh(batch.geometry, batch.material);
    mesh.name = `tool-batch-${batch.material.type}`; mesh.castShadow = batch.cast; mesh.receiveShadow = batch.receive;
    root.add(mesh);
  }
  const mask = new THREE.Mesh(prepared.mask, maskMaterial);
  mask.name = 'tool-velocity-mask'; mask.layers.set(1); root.add(mask);
  root.userData.toolBatched = true;
  prepareShadowMaterials(root); return root;
}

export function batchEquipment(game) {
  for (const root of [game.station, game.soapBox, ...game.supplyPoints, game.charging.source,
    ...game.chargers.map(head => head.mesh.children[0]), ...game.charging.ports.values()]) if (root) batchTool(root);
}
