import * as THREE from 'three';
import { writeChargingCablePath } from '../../../shared/sim/ChargingCable.js';
import { CHARGING } from '../../../shared/sim/chargingConfig.js';
import { ElectricWaterEffects } from '../fx/ElectricWaterEffects.js';
import { ShockXRay } from '../fx/ShockXRay.js';
import { FX_TUNING, SHOCK_MAX_BOLTS } from '../fx/fxTuning.js';

// The drawn EV cable: a smoother path than the 7 rule nodes, a thick rubber jacket and rib rings every RIB_SPACING metres.
const VIEW_NODES = 15, CABLE_RADIUS = 0.058, RIB_SPACING = 0.32, MAX_RIBS = Math.ceil(CHARGING.maxLength / RIB_SPACING) + 2;

/** Cable views and bounded GPU lightning, owned and prewarmed by EffectsManager. */
export class ChargingEffects {
  constructor(game) {
    this.game = game; this.dummy = new THREE.Object3D(); this.up = new THREE.Vector3(0, 1, 0); this._segment = new THREE.Vector3();
    this.ground = new ElectricWaterEffects(game);
    this.xray = new ShockXRay(game.players);
    this.views = game.cables.map(() => {
      const root = new THREE.Group(); root.visible = false; game.scene.add(root);
      const material = new THREE.MeshPhongMaterial({ color: '#2b3238', shininess: 38, specular: new THREE.Color('#4a5560') });
      const ribMaterial = new THREE.MeshLambertMaterial({ color: '#46515a' });
      const pipe = new THREE.InstancedMesh(new THREE.CylinderGeometry(CABLE_RADIUS, CABLE_RADIUS, 1, 12), material, VIEW_NODES - 1);
      const joints = new THREE.InstancedMesh(new THREE.SphereGeometry(CABLE_RADIUS, 12, 8), material, VIEW_NODES);
      const ribs = new THREE.InstancedMesh(new THREE.TorusGeometry(CABLE_RADIUS * 1.08, CABLE_RADIUS * 0.22, 6, 14).rotateX(Math.PI / 2), ribMaterial, MAX_RIBS);
      root.add(pipe, joints, ribs);
      root.traverse(node => { node.layers.enable(1); if (node.isMesh) { node.castShadow = true; node.frustumCulled = false; node.instanceMatrix.setUsage(THREE.DynamicDrawUsage); } });
      return { root, pipe, joints, ribs, material, ribMaterial, nodes: Array.from({ length: VIEW_NODES }, () => new THREE.Vector3()) };
    });
    // Electrocuted cat: jagged bolts crawling over the body plus a crackling glow shell. HDR colours feed Bloom.
    const quad = new THREE.PlaneGeometry(1, 1, 1, 12);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute('position', quad.attributes.position.clone()); this.geometry.setIndex(quad.index.clone()); quad.dispose();
    // Up to SHOCK_MAX_BOLTS prepared instances; the tuned count only changes instanceCount and a uniform.
    this.geometry.setAttribute('aIndex', new THREE.InstancedBufferAttribute(Float32Array.from({ length: SHOCK_MAX_BOLTS }, (_, i) => i), 1));
    this.geometry.instanceCount = FX_TUNING.shock.bolts;
    this.shell = new THREE.IcosahedronGeometry(1, 3);
    this.shocks = game.players.map(player => {
      const uniforms = { uTime: { value: 0 }, uStrength: { value: 0 }, uSize: { value: 1 }, uCount: { value: 12 }, uRate: { value: 16 },
        uWidth: { value: 0.085 }, uReach: { value: 1 }, uBoltGain: { value: 5 }, uShell: { value: new THREE.Vector3(1.6, 1.3, 2.2) },
        uCore: { value: new THREE.Color() }, uEdge: { value: new THREE.Color() } };
      const bolts = new THREE.Mesh(this.geometry, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending, uniforms,
        vertexShader: `attribute float aIndex; uniform float uTime; uniform float uStrength; uniform float uSize;
          uniform float uCount; uniform float uRate; uniform float uWidth; uniform float uReach;
          varying float vEdge; varying float vAlong; varying float vSeed;
          float hash(float n) { return fract(sin(n) * 43758.5453); }
          void main() {
            // Each bolt re-strikes ~16 times a second. Even bolts arc from the chest out to the floor (readable from the
            // top-down camera); odd ones crawl up the body. Joints jitter per strike for a jagged line.
            float aSeed = aIndex / max(uCount, 1.0);
            float strike = floor(uTime * uRate + aSeed * 7.0), t = position.y + 0.5;
            float a = (aSeed + hash(strike * 1.7 + aSeed * 31.0) * 0.6) * 6.2831853;
            float joint = floor(t * 12.0);
            vec3 jitter = vec3(hash(joint * 3.1 + strike * 1.3 + aSeed * 9.0), hash(joint * 5.7 + strike * 2.1), hash(joint * 7.3 + strike * 0.7 + aSeed)) - 0.5;
            vec3 radial = vec3(cos(a), 0.0, sin(a));
            vec3 p;
            if (mod(aIndex, 2.0) < 0.5) {
              float reach = (0.75 + hash(strike * 2.3 + aSeed) * 0.55) * uReach;
              p = radial * mix(0.15, reach, t) + vec3(0.0, mix(0.55, 0.03, t * t) + sin(t * 3.14159) * 0.12, 0.0) + jitter * vec3(0.22, 0.08, 0.22) * sin(t * 3.14159);
            } else {
              float spin = a + t * (hash(strike + aSeed) - 0.5) * 5.0, r = 0.34 + sin(t * 3.14159) * 0.16;
              p = vec3(cos(spin) * r, 0.05 + hash(strike * 4.1 + aSeed) * 0.3 + t * 0.95, sin(spin) * r) + jitter * 0.16;
            }
            // Ribbon width faces up/sideways enough to read from above.
            p += normalize(vec3(-radial.z, 0.6, radial.x)) * position.x * uWidth;
            vEdge = position.x * 2.0; vAlong = t; vSeed = aSeed;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p * uSize * step(0.001, uStrength), 1.0);
          }`,
        fragmentShader: `uniform float uTime; uniform float uStrength; uniform float uBoltGain; uniform vec3 uCore; uniform vec3 uEdge;
          varying float vEdge; varying float vAlong; varying float vSeed;
          void main() {
            float core = 1.0 - smoothstep(0.0, 1.0, abs(vEdge));
            float on = step(0.35, fract(sin(floor(uTime * 24.0) * 12.9898 + vSeed * 78.233) * 43758.5453));
            float tip = smoothstep(0.0, 0.1, vAlong) * smoothstep(1.0, 0.85, vAlong);
            vec3 color = mix(uEdge, uCore, core * core);
            gl_FragColor = vec4(color * core * tip * on * uStrength * uBoltGain, 1.0);
          }`,
      }));
      const shell = new THREE.Mesh(this.shell, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, uniforms,
        vertexShader: `uniform float uSize; uniform float uStrength; varying vec3 vNormal; varying vec3 vView; varying vec3 vLocal;
          void main() {
            vLocal = position; vec3 p = position * vec3(0.5, 0.62, 0.5) + vec3(0.0, 0.6, 0.0);
            vec4 view = modelViewMatrix * vec4(p * uSize * step(0.001, uStrength), 1.0);
            vNormal = normalize(normalMatrix * normal); vView = -view.xyz;
            gl_Position = projectionMatrix * view;
          }`,
        fragmentShader: `uniform float uTime; uniform float uStrength; uniform vec3 uShell; uniform vec3 uCore; uniform vec3 uEdge;
          varying vec3 vNormal; varying vec3 vView; varying vec3 vLocal;
          float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
          float noise(vec3 p) {
            vec3 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), u.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), u.x), u.y),
                       mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), u.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), u.x), u.y), u.z);
          }
          void main() {
            float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.4);
            float tick = floor(uTime * 18.0);
            // Thin crawling filaments over the shell (noise midline ridges), re-struck each tick.
            float filament = pow(1.0 - abs(noise(vLocal * 3.2 + vec3(tick * 0.71, -tick * 0.37, tick * 0.53)) * 2.0 - 1.0), 14.0);
            float flash = 0.8 + 0.2 * step(0.5, fract(sin(tick * 91.7) * 4375.85));
            vec3 color = mix(uEdge, uCore, filament);
            gl_FragColor = vec4(color * (rim * uShell.y + filament * uShell.z) * flash * uStrength * uShell.x, 1.0);
          }`,
      }));
      for (const mesh of [bolts, shell]) { mesh.userData.gpuParticle = true; mesh.frustumCulled = false; mesh.visible = false; player.root.add(mesh); }
      return { bolts, shell, uniforms, player };
    });
  }
  reset() { this.ground.reset(); this.xray.reset(); this.views.forEach(view => { view.root.visible = false; }); this.shocks.forEach(({ bolts, shell }) => { bolts.visible = shell.visible = false; }); }
  update() {
    const game = this.game; game.charging.present();
    this.ground.update();
    game.cables.forEach((cable, i) => {
      const view = this.views[i]; view.root.visible = game.equipmentEnabled('charger');
      if (!game.equipmentEnabled('charger')) return;
      const nodes = view.nodes, distance = writeChargingCablePath(cable.anchor(), cable.gun.connector(), nodes);
      cable.length = distance; cable.taut = distance >= cable.maxLength * 0.96;
      for (let j = 0; j < nodes.length - 1; j++) {
        const delta = nodes[j + 1].clone().sub(nodes[j]), length = delta.length();
        this.dummy.position.copy(nodes[j]).lerp(nodes[j + 1], 0.5);
        this.dummy.quaternion.setFromUnitVectors(this.up, delta.divideScalar(length || 1));
        this.dummy.scale.set(1, Math.max(0.001, length), 1); this.dummy.updateMatrix(); view.pipe.setMatrixAt(j, this.dummy.matrix);
      }
      nodes.forEach((node, j) => { this.dummy.position.copy(node); this.dummy.quaternion.identity(); this.dummy.scale.setScalar(1); this.dummy.updateMatrix(); view.joints.setMatrixAt(j, this.dummy.matrix); });
      view.ribs.count = this.placeRibs(view.ribs, nodes);
      view.pipe.instanceMatrix.needsUpdate = view.joints.instanceMatrix.needsUpdate = view.ribs.instanceMatrix.needsUpdate = true;
      // A cable pulled to its reel limit warns with amber ribs; the jacket stays rubber-dark.
      view.ribMaterial.color.set(cable.taut ? '#f0b94a' : '#46515a');
    });
    const look = FX_TUNING.shock, count = Math.max(1, Math.min(SHOCK_MAX_BOLTS, Math.round(look.bolts)));
    this.geometry.instanceCount = count;
    const time = game.wet.tick / 60;
    this.xray.update(time, game.equipmentEnabled('charger'));
    for (const { bolts, shell, uniforms, player } of this.shocks) {
      // Timed from the shared stun countdown: a full jolt for the whole paralysis, sputtering out at the end.
      const remaining = player.stunRemaining || 0, elapsed = CHARGING.stunSeconds - remaining;
      const on = game.equipmentEnabled('charger') && player.occupied !== false && remaining > 0;
      // The additive glow shell would wash out the X-ray silhouette, so it drops out during a strobe flash.
      bolts.visible = on; shell.visible = on && !this.xray.flashing(player);
      if (!on) continue;
      uniforms.uTime.value = time;
      uniforms.uStrength.value = Math.min(1, elapsed / 0.08 + 0.2) * Math.min(1, remaining / 0.35);
      uniforms.uSize.value = player.animal === 'elephant' ? look.elephantScale : 1;
      uniforms.uCount.value = count; uniforms.uRate.value = look.strikeRate; uniforms.uWidth.value = look.width; uniforms.uReach.value = look.reach;
      uniforms.uBoltGain.value = look.boltGain; uniforms.uShell.value.set(look.shellGain, look.shellRim, look.shellFilament);
      uniforms.uCore.value.set(look.core); uniforms.uEdge.value.set(look.edge);
    }
  }
  /** Rib rings at equal arc length along the drawn path, skipping the strain-relief ends. Returns the instance count. */
  placeRibs(ribs, nodes) {
    let count = 0, along = RIB_SPACING * 0.75;
    for (let j = 0; j < nodes.length - 1 && count < MAX_RIBS; j++) {
      const a = nodes[j], b = nodes[j + 1], length = a.distanceTo(b);
      if (length < 1e-6) continue;
      this.dummy.quaternion.setFromUnitVectors(this.up, this._segment.copy(b).sub(a).divideScalar(length));
      while (along <= length && count < MAX_RIBS) {
        this.dummy.position.copy(a).lerp(b, along / length); this.dummy.scale.setScalar(1); this.dummy.updateMatrix();
        ribs.setMatrixAt(count++, this.dummy.matrix); along += RIB_SPACING;
      }
      along -= length;
    }
    return count;
  }
  dispose() {
    this.reset();
    this.ground.dispose(); this.xray.dispose();
    for (const view of this.views) { view.pipe.geometry.dispose(); view.joints.geometry.dispose(); view.ribs.geometry.dispose(); view.material.dispose(); view.ribMaterial.dispose(); view.root.removeFromParent(); }
    for (const { bolts, shell } of this.shocks) { bolts.material.dispose(); shell.material.dispose(); bolts.removeFromParent(); shell.removeFromParent(); }
    this.geometry.dispose(); this.shell.dispose();
    this.game.charging.disposeViews();
  }
}
