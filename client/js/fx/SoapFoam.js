import * as THREE from 'three';
import { SLIPPERY } from '../../../shared/sim/Slippery.js';
import { mulberry32 } from '../../../shared/sim/util.js';

/** White foam clumps stuck to a slippery (soaped) player. Presentation only: reads the shared `slipperyRemaining`.
 * Each player owns one instanced mesh parented to its body, with blob offsets fixed at boot. A single `uCover`
 * uniform (time left / full time) is the only per-frame write: blobs pop away one by one as the timer runs out, the
 * rest shrink and wobble, and the last moments blink — so the coat itself shows the slipperiness is about to end.
 * Budget: 22 blobs × 80-triangle icosphere = 1.8k triangles and 1 draw per slippery player; zero draws otherwise. */
const BLOBS = 22;
const SCALE = { cat: 1, dog: 1.05, pelican: 1.1, elephant: 1.55 };

export class SoapFoam {
  constructor(players) {
    this.geometry = new THREE.InstancedBufferGeometry().copy(new THREE.IcosahedronGeometry(1, 1));
    const random = mulberry32(7331), offsets = new Float32Array(BLOBS * 4);
    for (let i = 0; i < BLOBS; i++) {
      // On the outside of the upper body (back, shoulders, head) so the top-down camera sees them over the fur:
      // a half-ellipsoid hugging the body (x ±0.42, z ±0.3, top ≈1.07), blobs half sunk into the fur.
      const theta = random() * Math.PI * 2, lift = 0.25 + random() * 0.75;
      const ring = Math.sqrt(1 - lift * lift);
      offsets.set([Math.cos(theta) * 0.42 * ring, 0.52 + lift * 0.55, Math.sin(theta) * 0.3 * ring,
        // w: the cover level below which this blob is gone; evenly spread so they leave one at a time.
        (i + 0.5) / BLOBS], i * 4);
    }
    this.geometry.setAttribute('aBlob', new THREE.InstancedBufferAttribute(offsets, 4));
    this.geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(Float32Array.from({ length: BLOBS }, () => 0.095 + random() * 0.06), 1));
    this.geometry.instanceCount = BLOBS;
    this.views = players.filter(player => player.squash).map(player => {
      const uniforms = { uCover: { value: 0 }, uTime: { value: 0 } };
      const mesh = new THREE.Mesh(this.geometry, new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT }));
      mesh.name = `player-${(player.slot || 0) + 1}-soap-foam`;
      mesh.visible = false; mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = false;
      player.squash.add(mesh);
      return { player, mesh, uniforms };
    });
  }

  update(time) {
    for (const { player, mesh, uniforms } of this.views) {
      const remaining = player.slipperyRemaining || 0;
      const on = remaining > 0 && player.occupied !== false && player.root.visible && player.state !== 'fallen' && player.state !== 'swallowed';
      mesh.visible = on;
      if (!on) continue;
      uniforms.uCover.value = Math.min(1, remaining / SLIPPERY.seconds); uniforms.uTime.value = time;
      mesh.scale.setScalar(SCALE[player.animal] || 1);
    }
  }
  reset() { for (const view of this.views) view.mesh.visible = false; }
  dispose() {
    for (const view of this.views) { view.mesh.removeFromParent(); view.mesh.material.dispose(); }
    this.geometry.dispose(); this.views = [];
  }
}

const VERTEX = /* glsl */`
  uniform float uCover, uTime;
  attribute vec4 aBlob; attribute float aSize;
  varying vec3 vNormal; varying float vFade;
  void main() {
    // A blob lives while the cover is above its threshold; it swells in, then shrinks and pops near its turn to leave.
    float life = clamp((uCover - aBlob.w) / 0.12, 0.0, 1.0);
    // Last 25% of the time: everything left blinks faster and faster.
    float blink = uCover < 0.25 ? step(0.0, sin(uTime * mix(26.0, 12.0, uCover * 4.0))) * 0.35 + 0.65 : 1.0;
    float wobble = 1.0 + 0.12 * sin(uTime * 7.0 + aBlob.w * 40.0);
    float size = aSize * life * wobble * blink;
    vec3 p = aBlob.xyz + position * size;
    vNormal = normalize(normalMatrix * position);
    vFade = life;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const FRAGMENT = /* glsl */`
  varying vec3 vNormal; varying float vFade;
  void main() {
    if (vFade <= 0.0) discard;
    // Soft white suds: bright top, a faint cool shade underneath and a pearly rim.
    vec3 n = normalize(vNormal);
    float light = 0.78 + 0.22 * max(dot(n, normalize(vec3(0.3, 1.0, 0.4))), 0.0);
    float rim = pow(1.0 - abs(n.z), 2.5);
    vec3 color = mix(vec3(0.88, 0.92, 0.98), vec3(1.0), light) + vec3(0.12, 0.1, 0.18) * rim;
    // Slightly over 1 so Bloom gives the suds a soft sheen on the fur.
    gl_FragColor = vec4(color * 1.15, 1.0);
  }`;
