import * as THREE from 'three';
const depthBySource = new WeakMap();

/** Bind cached variants before warmup, or to new wrappers sharing prepared material/geometry signatures. */
export function prepareShadowMaterials(root) {
  root.traverse((object) => {
    if (!object.isMesh || !object.castShadow) return;
    const source = Array.isArray(object.material) ? object.material[0] : object.material;
    if (!source) return;
    if (!object.customDepthMaterial) {
      const variants = depthBySource.get(source) || new Map();
      depthBySource.set(source, variants);
      const geometry = object.geometry;
      const key = [!!object.isInstancedMesh, !!object.instanceColor, !!object.isSkinnedMesh,
        geometry.morphTargetsRelative, geometry.morphAttributes.position?.length || 0,
        geometry.morphAttributes.normal?.length || 0, geometry.morphAttributes.color?.length || 0].join(':');
      let depth = variants.get(key);
      if (!depth) {
        depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
        variants.set(key, depth);
      }
      for (const key of ['map','alphaMap','alphaTest','displacementMap','displacementScale','displacementBias','wireframe','clipShadows','clippingPlanes','clipIntersection']) {
        if (source[key] !== undefined) depth[key] = source[key];
      }
      depth.side = source.shadowSide ?? ({ [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide })[source.side];
      object.customDepthMaterial = depth;
    }
  });
}

/** compileAsync doesn't visit the renderer's private shadow materials in r160.
 * Give casters persistent depth materials and prepare them on the parallel shader path.
 * Clone only render objects; reuse their geometry, instance/bone data and textures. */
export function shadowSamples(scene) {
  prepareShadowMaterials(scene);
  const samples = new THREE.Scene();
  scene.traverse((object) => {
    if (!object.isMesh || !object.castShadow || !object.customDepthMaterial) return;
    const sample = object.clone(false);
    sample.material = object.customDepthMaterial; sample.castShadow = false;
    sample.visible = true; sample.frustumCulled = false;
    samples.add(sample);
  });
  return samples;
}
