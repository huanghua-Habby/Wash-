import * as THREE from 'three';
import { CHARACTER_SCALE } from '../../../shared/sim/characterScale.js';

/** Stars that circle the heads of knocked-down players (shared `downRemaining`, WOBBLE.md §2); never decides anything.
 * One instanced draw: one instance per star (3 per downed player, pool 24); the orbit and twinkle run in the shader,
 * the CPU writes only each downed player's head anchor. Budget: 8-triangle star × 3 per player; nobody down = zero
 * instances, zero draws. */
const PER_PLAYER = 3, HEAD = 1.15 * CHARACTER_SCALE, RADIUS = 0.32 * CHARACTER_SCALE, SIZE = 0.13 * CHARACTER_SCALE;

function starGeometry() {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.42 : 1, a = Math.PI / 2 + i * Math.PI / 5;
    i ? shape.lineTo(Math.cos(a) * r, Math.sin(a) * r) : shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ShapeGeometry(shape);
}

export class DizzyStars {
  constructor(scene, game) {
    this.game = game;
    const capacity = PER_PLAYER * game.players.length, base = starGeometry();
    const geometry = new THREE.InstancedBufferGeometry().copy(base); base.dispose();
    this.anchor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aAnchor', this.anchor); // xyz head, w = star index (phase)
    geometry.instanceCount = 0;
    this.uniforms = { uTime: { value: 0 } };
    const material = new THREE.ShaderMaterial({ uniforms: this.uniforms, side: THREE.DoubleSide,
      vertexShader: `
        uniform float uTime;
        attribute vec4 aAnchor;
        varying float vGlow;
        void main() {
          float a = uTime * 4.0 + aAnchor.w * 2.0944;
          vec3 centre = aAnchor.xyz + vec3(cos(a) * ${RADIUS.toFixed(3)}, sin(uTime * 6.0 + aAnchor.w) * 0.03, sin(a) * ${RADIUS.toFixed(3)});
          vec4 view = viewMatrix * vec4(centre, 1.0);
          float spin = uTime * 5.0 + aAnchor.w;
          vec2 p = mat2(cos(spin), -sin(spin), sin(spin), cos(spin)) * position.xy * ${SIZE.toFixed(3)};
          view.xy += p;
          vGlow = 0.75 + 0.25 * sin(uTime * 9.0 + aAnchor.w * 3.0);
          gl_Position = projectionMatrix * view;
        }`,
      fragmentShader: `
        varying float vGlow;
        void main() {
          gl_FragColor = vec4(vec3(1.0, 0.86, 0.3) * vGlow * 1.2, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false; this.mesh.visible = false;
    scene.add(this.mesh);
  }

  update(dt) {
    let count = 0;
    for (const player of this.game.players) {
      if (!(player.downRemaining > 0) || player.occupied === false || !player.root?.visible) continue;
      const p = player.root.position;
      for (let i = 0; i < PER_PLAYER; i++, count++) this.anchor.setXYZW(count, p.x, p.y + HEAD, p.z, i);
    }
    this.mesh.geometry.instanceCount = count; this.mesh.visible = count > 0;
    if (!count) return;
    this.anchor.needsUpdate = true; this.anchor.clearUpdateRanges(); this.anchor.addUpdateRange(0, count * 4);
    this.uniforms.uTime.value += dt;
  }

  reset() { this.mesh.geometry.instanceCount = 0; this.mesh.visible = false; this.uniforms.uTime.value = 0; }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
