import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const UP = new THREE.Vector3(0, 1, 0);
// Cartoon X-ray strobe while stunned: 0 normal body, 1 black body with glowing white bones, 2 white body with black bones.
const STROBE = [1, 0, 2, 0, 1, 2, 0, 0, 2, 1, 0, 0];
const STROBE_RATE = 13;
/** No flashes in the last moments of the stun, so it visibly winds down to plain twitching. */
const STROBE_TAIL = 0.3;
const LOOKS = [
  null,
  { shell: new THREE.Color('#0d1117'), bone: new THREE.Color(2.4, 2.4, 2.3), socket: new THREE.Color('#0d1117') },
  { shell: new THREE.Color('#f2f5fb'), bone: new THREE.Color('#151a22'), socket: new THREE.Color('#f2f5fb') },
];

/** A cartoon bone along `to` (from the parent joint): a shaft with a knob at each end. */
function boneGeometry(to, radius = 0.02) {
  const length = to.length();
  if (length < 1e-4) return null;
  const parts = [new THREE.CylinderGeometry(radius, radius, length, 8, 1).translate(0, length / 2, 0)];
  for (const y of [0, length]) for (const z of [-radius * 0.8, radius * 0.8]) parts.push(new THREE.SphereGeometry(radius * 1.35, 8, 6).translate(0, y, z));
  const merged = mergeGeometries(parts.map(part => part.toNonIndexed()));
  parts.forEach(part => part.dispose());
  return merged.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, to.clone().normalize()));
}

/** Spine column with a small ribcage, in the spine bone frame (y up, x forward). */
function ribcageGeometry() {
  const parts = [];
  for (let i = 0; i < 5; i++) parts.push(new THREE.SphereGeometry(0.03, 8, 6).scale(1, 0.75, 1).translate(-0.06, -0.08 + i * 0.05, 0));
  for (let i = 0; i < 3; i++) {
    const r = 0.15 - i * 0.022;
    parts.push(new THREE.TorusGeometry(r, 0.014, 6, 20, Math.PI * 1.45).rotateX(Math.PI / 2).rotateY(Math.PI * 0.27).scale(1, 1, 1.15).translate(0.02, -0.04 + i * 0.055, 0));
  }
  const merged = mergeGeometries(parts.map(part => part.toNonIndexed()));
  parts.forEach(part => part.dispose());
  return merged;
}

/**
 * Presentation-only X-ray strobe for electrocuted players. Every animal body gets a skeleton and a flat silhouette
 * parented to its own bones at boot (prepared with the scene, hidden), so the X-ray twitches with the stun pose.
 * During a flash the body's own meshes are hidden and restored afterwards; only colours change per frame.
 */
export class ShockXRay {
  constructor(players) {
    this.geometries = [];
    this.rigs = players.filter(player => player.bodies).map(player => {
      const materials = {
        shell: new THREE.MeshBasicMaterial({ color: LOOKS[1].shell }),
        bone: new THREE.MeshBasicMaterial({ color: LOOKS[1].bone, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }),
        socket: new THREE.MeshBasicMaterial({ color: LOOKS[1].socket, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }),
      };
      const bodies = Object.values(player.bodies).map(body => this.dress(body, materials));
      return { player, materials, bodies, mode: 0, body: null };
    });
  }

  /** Build one animal's X-ray parts on its bones. */
  dress(body, materials) {
    const bones = body.bones, parts = [];
    const add = (bone, geometry, material, order) => {
      if (!bone || !geometry) return;
      this.geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = order; mesh.castShadow = mesh.receiveShadow = false;
      bone.add(mesh); parts.push(mesh);
    };
    // Skull and sockets from the eye bones, so every species' head gets a fitting skull.
    const eyeL = bones.eyeL?.position, eyeR = bones.eyeR?.position;
    if (eyeL && eyeR) {
      const mid = eyeL.clone().add(eyeR).multiplyScalar(0.5), r = THREE.MathUtils.clamp(eyeL.distanceTo(eyeR) * 1.05, 0.12, 0.26);
      const center = mid.clone().add(new THREE.Vector3(-r * 0.55, 0, 0));
      add(bones.head, new THREE.SphereGeometry(r * 1.4, 18, 12).scale(1, 0.95, 1.1).translate(center.x, center.y, center.z), materials.shell, 0);
      add(bones.head, new THREE.SphereGeometry(r, 16, 12).scale(1, 0.92, 0.95).translate(center.x, center.y, center.z), materials.bone, 30);
      add(bones.head, new THREE.BoxGeometry(r * 0.5, r * 0.32, r * 1.1).translate(center.x + r * 0.62, center.y - r * 0.78, center.z), materials.bone, 30);
      for (const eye of [eyeL, eyeR]) {
        const socket = center.clone().lerp(eye, 1.05);
        add(bones.head, new THREE.SphereGeometry(r * 0.3, 10, 8).translate(socket.x, socket.y, socket.z), materials.socket, 31);
      }
    }
    // Torso silhouette and ribcage.
    add(bones.hips, new THREE.SphereGeometry(1, 16, 12).scale(0.27, 0.24, 0.28).translate(0, 0.08, 0), materials.shell, 0);
    add(bones.spine, ribcageGeometry(), materials.bone, 30);
    add(bones.hips, new THREE.TorusGeometry(0.08, 0.02, 6, 14).rotateX(Math.PI / 2).scale(0.8, 1, 1.3), materials.bone, 30);
    // Limbs: a silhouette sleeve and a bone from each joint to its child.
    for (const [joint, end, radius] of [['armL', 'pawL', 0.06], ['armR', 'pawR', 0.06], ['legL', 'footL', 0.075], ['legR', 'footR', 0.075]]) {
      const to = bones[end]?.position;
      if (!bones[joint] || !to) continue;
      const length = to.length(), direction = to.clone().normalize();
      add(bones[joint], new THREE.CapsuleGeometry(radius, length, 4, 10).translate(0, length / 2, 0)
        .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, direction)), materials.shell, 0);
      add(bones[joint], boneGeometry(to), materials.bone, 30);
    }
    // Tail and trunk chains: one bone per link.
    for (const chain of ['tail', 'trunk']) for (let i = 0; i < 4; i++) {
      const next = bones[`${chain}${i + 1}`]?.position;
      if (bones[`${chain}${i}`] && next) add(bones[`${chain}${i}`], boneGeometry(next, 0.016), materials.bone, 30);
    }
    return { body, parts, owned: new Set(parts), saved: new Map() };
  }

  /** Strobe mode (0 = normal) for a stun with `remaining` seconds left. */
  static mode(time, slot, remaining) {
    if (!(remaining > STROBE_TAIL)) return 0;
    return STROBE[Math.floor(time * STROBE_RATE + slot * 5) % STROBE.length];
  }

  update(time, visible) {
    for (const rig of this.rigs) {
      const { player } = rig;
      const mode = visible && player.occupied !== false && player.root.visible ? ShockXRay.mode(time, player.slot || 0, player.stunRemaining) : 0;
      if (mode === rig.mode && player.body === rig.body) continue;
      for (const entry of rig.bodies) this.show(entry, mode !== 0 && entry.body === player.body);
      rig.mode = mode; rig.body = player.body;
      if (!mode) continue;
      const look = LOOKS[mode];
      rig.materials.shell.color.copy(look.shell); rig.materials.bone.color.copy(look.bone); rig.materials.socket.color.copy(look.socket);
    }
  }

  /** Swap a body between its own meshes and the X-ray parts.
   * The body is hidden through render layers, not `visible`: its bone root (and so the X-ray parts) is parented under one
   * of its skinned meshes, and fur quality owns shell visibility. Layer masks are restored exactly. */
  show(entry, xray) {
    xray = !!xray; // three.js skips drawing only for visible === false; never store a falsy number.
    if (xray === entry.saved.size > 0) return;
    if (xray) entry.body.group.traverse(node => { if (node.isMesh && !entry.owned.has(node)) { entry.saved.set(node, node.layers.mask); node.layers.disableAll(); } });
    else { for (const [mesh, mask] of entry.saved) mesh.layers.mask = mask; entry.saved.clear(); }
    for (const mesh of entry.parts) mesh.visible = xray;
  }

  flashing(player) { return this.rigs.some(rig => rig.player === player && rig.mode !== 0); }

  reset() { for (const rig of this.rigs) { for (const entry of rig.bodies) this.show(entry, false); rig.mode = 0; rig.body = null; } }

  dispose() {
    this.reset();
    for (const rig of this.rigs) {
      for (const entry of rig.bodies) for (const mesh of entry.parts) mesh.removeFromParent();
      Object.values(rig.materials).forEach(material => material.dispose());
    }
    this.geometries.forEach(geometry => geometry.dispose());
    this.rigs = []; this.geometries = [];
  }
}
