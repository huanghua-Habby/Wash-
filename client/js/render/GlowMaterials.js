/** Shared unlit HDR emissive materials. Colour × intensity (> 1) feeds the Bloom threshold directly. */
import * as THREE from 'three';
import { LOOK } from '../core/config.js';

// Unlit, so the rendered value is exactly colour × intensity regardless of scene lighting.
export const GLOW = {
  vehicle: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  road: new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
};

/** Apply the debug-panel glow settings; call once at boot and whenever they change. */
export function syncGlow() {
  const G = LOOK.glow;
  GLOW.vehicle.color.set(G.vehicleColor).multiplyScalar(G.vehicle);
  GLOW.road.color.set(G.roadColor).multiplyScalar(G.road);
}
syncGlow();
