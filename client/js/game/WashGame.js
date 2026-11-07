/** Client view adapters for the shared washing simulation. */
import { WashSimulation } from '../../../shared/sim/WashSimulation.js';
import { Truck } from '../world/Truck.js';
import { EffectsManager } from '../fx/EffectsManager.js';
import { createStainMesh, updateStainLook } from './StainLook.js';
import { CleaningTowel, CleaningSoap, colorCleaningStations } from './CleaningTools.js';
import { batchEquipment } from '../render/ToolBatches.js';
import * as THREE from 'three';
import { buildWoodCrate, buildWoodPile } from '../world/Cargo/index.js';
import { MAX_STAINS } from '../../../shared/sim/StainDefinitions.js';
import { HackConsoleView } from '../world/HackConsoleView.js';
export class WashGame extends WashSimulation {
  constructor(options) {
    if (!options.hud) throw new Error('WashGame requires the UIManager HUD adapter');
    super({ ...options, TruckClass: Truck, TowelClass: CleaningTowel, SoapClass: CleaningSoap });
    colorCleaningStations(this);
    batchEquipment(this);
    // Water, cleaning, dust, wind, puffs and (registered by main) wet surfaces all live in the EffectsManager.
    this.effects = new EffectsManager({ scene: this.scene, game: this, getBase: options.effectsBase });
    // One prepared set per vehicle; returned to the pool when an order leaves.
    this.stainPools = new Map(this.orderTrucks.map(truck => [truck,
      Array.from({ length: MAX_STAINS }, (_, index) => createStainMesh(index, ['towel']))]));
    // Cargo art (Xiexufeng) is built once per kind at startup and prewarmed; orders place clones that share its
    // geometry and materials, so spawning cargo never builds or compiles anything.
    this.cargoModels = new Map([['wood-crate', buildWoodCrate()], ['wood-pile', buildWoodPile()]].map(([kind, model]) => {
      const box = new THREE.Box3().setFromObject(model);
      return [kind, { model, box, size: box.getSize(new THREE.Vector3()) }];
    }));
    // Versus hack console screens and glow (read-only view of the host state).
    this.hackView = new HackConsoleView(this); this.hackClock = performance.now();
  }
  /** ResourceManager provider. The console already sits (hidden) on the home truck, and SceneReadiness prepares every
   * hidden scene object with its programs and screen texture; registering it as a detached sample would unparent it. */
  registerHackReadiness(_readiness) {}
  disposeHack() { this.hackView?.dispose(); this.hackView = null; }
  /** These presets share prepared actors/equipment; refuse unsupported asset swaps. Modes differ only in slot count. */
  selectLevel(level) {
    for (const [before, after] of [[this.level.equipment, level.equipment], [this.level.home.vehicles, level.home.vehicles],
      [this.level.orders.vehicles, level.orders.vehicles]]) {
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Level assets must be registered and prepared before switching');
    }
    if (level.home.playerSlots.length > this.players.length) throw new Error('Level characters must be prepared before switching');
    this.stop(); this.level = level; this.equipment = level.equipment;
    this.roadSigns.reset();
  }
  makeStainMesh(index, steps, truck) {
    const mesh = this.stainPools.get(truck)?.[index];
    if (!mesh) throw new Error('Stain assets must be prepared before spawning');
    mesh.visible = true; mesh.scale.set(1, 1, 1); mesh.material.opacity = 1;
    Object.assign(mesh.userData.look, { lastProgress: 0, lastStage: 0, wetAt: -1e9 });
    const u = mesh.material.userData.stain;
    u.uStainKind.value = steps[0] === 'soap' ? 2 : steps[0] === 'water' ? 1 : 0;
    u.uSoapIdx.value = steps.indexOf('soap'); u.uWaterIdx.value = steps.indexOf('water'); u.uTowelIdx.value = steps.indexOf('towel');
    u.uStage.value = u.uProgress.value = u.uWet.value = 0;
    return mesh;
  }
  /** A placed clone of the prepared cargo model, scaled to the authored box (its collider); `floor` lifts it onto the deck. */
  makeCargoMesh(cargo) {
    const prepared = this.cargoModels.get(cargo.kind);
    if (!prepared) return null;
    const mesh = prepared.model.clone(), { box, size } = prepared;
    mesh.scale.set(cargo.size[0] / Math.max(1e-3, size.x), cargo.height / Math.max(1e-3, size.y), cargo.size[1] / Math.max(1e-3, size.z));
    mesh.userData.floor = -box.min.y * mesh.scale.y;
    return mesh;
  }
  releaseStainMesh(mesh) { mesh.removeFromParent(); mesh.visible = false; }
  registerStainReadiness(readiness) {
    for (const meshes of this.stainPools.values()) for (const mesh of meshes) readiness.addSample(mesh);
    for (const { model } of this.cargoModels?.values() || []) readiness.addSample(model);
  }
  disposeStains() {
    for (const meshes of this.stainPools.values()) for (const mesh of meshes) {
      mesh.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose();
    }
    this.stainPools.clear();
  }
  stop() { super.stop(); this.effects?.reset(); }
  afterCamera(camera) {
    const now = performance.now(), dt = Math.min(0.1, (now - this.hackClock) / 1000); this.hackClock = now;
    this.hackView?.update(dt);
    for (const order of this.orders) order.stains.forEach((stain, index) => updateStainLook(stain, order.serial, index, this.elapsed || 0));
    super.afterCamera(camera);
  }
}
