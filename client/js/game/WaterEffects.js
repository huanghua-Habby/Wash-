/** Client-only rope/spray views. Physics and hit results arrive from the authority. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WASH_CONFIG as C } from '../../../shared/sim/washConfig.js';
import { WaterParticles } from './WaterParticles.js';
import { batchTool } from '../render/ToolBatches.js';

const UP = new THREE.Vector3(0, 1, 0);
let gunAsset, gunPalette;
export class WaterEffects {
  constructor(game) {
    this.game = game; this.dummy = new THREE.Object3D();
    this.views = game.hoses.map(() => {
      const root = new THREE.Group(); root.visible = false; game.scene.add(root);
      const hoseMaterial = new THREE.MeshLambertMaterial({ color: '#76a08a' });
      const pipe = new THREE.InstancedMesh(new THREE.CylinderGeometry(C.hoseRadius, C.hoseRadius, 1, 12), hoseMaterial, C.hoseNodes - 1);
      const joints = new THREE.InstancedMesh(new THREE.SphereGeometry(C.hoseRadius, 12, 8), hoseMaterial, C.hoseNodes);
      root.add(pipe, joints);
      const spray = new WaterParticles(root, game);
      // The post FX override-material velocity mask cannot evaluate particle shaders.
      root.traverse((node) => { if (!node.userData.gpuParticle) node.layers.enable(1); if (node.isMesh) { node.frustumCulled = false; node.instanceMatrix?.setUsage(THREE.DynamicDrawUsage); } });
      pipe.castShadow = joints.castShadow = true;
      return { root, pipe, joints, spray, hoseMaterial };
    });
    // Elephant trunks reuse the same bounded GPU water pools, one set per player slot.
    this.trunkViews = (game.trunks || []).map(() => {
      const root = new THREE.Group(); root.visible = false; game.scene.add(root);
      const spray = new WaterParticles(root, game);
      root.traverse((node) => { if (node.isMesh) node.frustumCulled = false; });
      return { root, spray };
    });
    this.gunMaterials = new Map();
    gunAsset ||= new GLTFLoader().loadAsync(new URL('../../assets/unity/watergun.glb', import.meta.url).href);
    gunPalette ||= new THREE.TextureLoader().loadAsync(new URL('../../assets/unity/watergun-cleaning.png', import.meta.url).href);
    this.ready = Promise.all([gunAsset, gunPalette]).then(([{ scene }, texture]) => {
      if (this.disposed) return;
      this.gunTexture = texture; texture.flipY = false; texture.colorSpace = THREE.SRGBColorSpace;
      for (const gun of game.waterguns) {
        for (const child of gun.mesh.children) { child.geometry?.dispose(); child.material?.dispose(); }
        gun.mesh.clear();
        const model = scene.clone(true);
        model.traverse((node) => {
          node.layers.enable(1); if (!node.isMesh) return;
          node.castShadow = true;
          if (node.material.map) {
            const original = node.material;
            if (!this.gunMaterials.has(original)) {
              const material = original.clone(); material.map = texture; this.gunMaterials.set(original, material);
            }
            node.material = this.gunMaterials.get(original);
          }
        });
        batchTool(model); gun.mesh.add(model);
      }
    });
    this.ready.catch(() => {}); // Boot readiness reports failure and keeps the black loading screen.
  }
  segment(mesh, index, a, b) {
    const delta = b.clone().sub(a), length = delta.length();
    this.dummy.position.copy(a).lerp(b, 0.5);
    this.dummy.quaternion.setFromUnitVectors(UP, delta.divideScalar(length || 1));
    this.dummy.scale.set(1, Math.max(0.001, length), 1); this.dummy.updateMatrix();
    mesh.setMatrixAt(index, this.dummy.matrix);
  }
  reset() { [...this.views, ...this.trunkViews].forEach((view) => { view.root.visible = false; view.spray.reset(); }); }
  dispose() {
    this.disposed = true;
    for (const material of this.gunMaterials.values()) material.dispose();
    this.gunMaterials.clear(); this.gunTexture?.dispose();
    for (const view of this.trunkViews) { view.spray.dispose(); view.root.removeFromParent(); }
    for (const view of this.views) {
      view.spray.dispose();
      view.pipe.geometry.dispose(); view.joints.geometry.dispose(); view.hoseMaterial.dispose();
      view.root.removeFromParent();
    }
  }
  update(dt) {
    const game = this.game;
    game.hoses.forEach((hose, i) => {
      const view = this.views[i], gun = hose.gun;
      view.root.visible = game.equipmentEnabled('water');
      if (!game.equipmentEnabled('water')) return;
      const nodes = hose.nodes.map((node) => node.clone());
      nodes[0].copy(hose.anchor()); nodes.at(-1).copy(gun.connector());
      for (let j = 0; j < nodes.length - 1; j++) this.segment(view.pipe, j, nodes[j], nodes[j + 1]);
      nodes.forEach((node, j) => {
        this.dummy.position.copy(node); this.dummy.quaternion.identity(); this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix(); view.joints.setMatrixAt(j, this.dummy.matrix);
      });
      view.pipe.instanceMatrix.needsUpdate = view.joints.instanceMatrix.needsUpdate = true;
      view.hoseMaterial.color.set(hose.taut ? '#e4b14c' : '#76a08a');
      view.spray.update(game.paused || game.ended ? 0 : dt, gun);
    });
    (game.trunks || []).forEach((trunk, i) => {
      const view = this.trunkViews[i];
      const on = game.trunksEnabled ? game.trunksEnabled() : game.equipmentEnabled('water');
      view.root.visible = on;
      if (on) view.spray.update(game.paused || game.ended ? 0 : dt, trunk);
    });
  }
}
