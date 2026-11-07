import * as THREE from 'three';
import { FX_TUNING } from './fxTuning.js';

/** Independent lightning over live puddles. Does not patch, recolor or replace the puddle materials.
 * One instanced quad per live splash, shaped with the same ellipse/fbm/drying field as `wetCoverage`.
 * Arcs grow outward from the contact point with a bright travelling front; colours are HDR so Bloom glows.
 * Overlapping splashes use MAX blending over one shared surface-space pattern, so they merge seamlessly.
 * CPU writes instance data only when the shared wet revision changes; animation is uniforms only.
 */
export class ElectricWaterEffects {
  constructor(game) {
    this.game = game; this.revision = -1;
    this.pools = game.wet.surfaces.map((surface, index) => {
      const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), geometry = new THREE.InstancedBufferGeometry();
      geometry.setAttribute('position', quad.attributes.position.clone()); geometry.setIndex(quad.index.clone()); quad.dispose();
      const attribute = (size) => {
        const value = new THREE.InstancedBufferAttribute(new Float32Array(surface.marks.length * size), size);
        value.setUsage(THREE.DynamicDrawUsage); return value;
      };
      const wet = attribute(4), shape = attribute(4), live = attribute(1);
      geometry.setAttribute('aWet', wet); geometry.setAttribute('aShape', shape); geometry.setAttribute('aLiveAt', live);
      geometry.instanceCount = 0;
      const truck = index ? game.charging.trucks[index - 1] : null;
      const material = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, toneMapped: false,
        blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
        uniforms: { uTime: { value: 0 }, uScroll: { value: 0 }, uY: { value: truck ? truck.topLocal + 0.08 : 0.07 },
          uSource: { value: new THREE.Vector2() }, uStart: { value: 0 }, uSpread: { value: 7 },
          // Look (FX_TUNING.electric), copied every frame as uniforms.
          uIntensity: { value: 4.2 }, uBand: { value: new THREE.Vector2() }, uRate: { value: 14 },
          uStreak: { value: new THREE.Vector3() }, uWeb: { value: new THREE.Vector2() }, uFine: { value: new THREE.Vector3() },
          uBase: { value: 0.05 }, uCore: { value: new THREE.Color() }, uEdge: { value: new THREE.Color() } },
        vertexShader: `
          attribute vec4 aWet;   // x, z, radius, seed (surface coordinates)
          attribute vec4 aShape; // stretch, angle, birth, dry
          attribute float aLiveAt;
          uniform float uScroll; uniform float uY;
          varying vec2 vSurface; varying vec2 vUV; varying vec4 vShape; varying float vSeed; varying float vLiveAt;
          void main() {
            vLiveAt = aLiveAt; vShape = aShape; vSeed = aWet.w;
            if (aLiveAt < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
            float c = cos(aShape.y), s = sin(aShape.y), size = aWet.z * max(aShape.x, 1.0) * 2.3;
            vec2 offset = position.xz * size;
            vSurface = aWet.xy + offset;
            // The same rotated ellipse frame as wetCoverage: u along the stretch, v across.
            vUV = vec2((offset.x * c - offset.y * s) / (aWet.z * aShape.x), (offset.x * s + offset.y * c) / aWet.z);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(vSurface.x - uScroll, uY, vSurface.y, 1.0);
          }`,
        fragmentShader: `
          uniform float uTime; uniform vec2 uSource; uniform float uStart; uniform float uSpread;
          uniform float uIntensity; uniform vec2 uBand; uniform float uRate; uniform vec3 uStreak; uniform vec2 uWeb; uniform vec3 uFine;
          uniform float uBase; uniform vec3 uCore; uniform vec3 uEdge;
          varying vec2 vSurface; varying vec2 vUV; varying vec4 vShape; varying float vSeed; varying float vLiveAt;
          float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p) {
            vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
          }
          float fbm(vec2 p) { float sum = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { sum += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return sum; }
          // Thin bright ridges where noise crosses its midline: branching filaments.
          float ridge(vec2 p, float sharp) { return pow(1.0 - abs(fbm(p) * 2.0 - 1.0), sharp); }
          void main() {
            if (vLiveAt < 0.0) discard;
            // Puddle outline: wetCoverage's depth field (without the cosmetic drops) against its drying level.
            float r = length(vUV);
            if (r > 1.0) discard;
            float depth = (1.0 - r) * 0.8 + (fbm(vUV * 1.7 + vSeed * 13.0) - 0.5) * 0.75 + 0.12;
            float age = uTime - vShape.z, level = clamp(age / vShape.w, 0.0, 1.0) * 0.95;
            float wet = smoothstep(level, level + 0.1, depth);
            // Growth from the contact point: revealed inside the expanding front, brightest right at it.
            vec2 toward = vSurface - uSource; float d = length(toward);
            float front = (uTime - uStart) * uSpread;
            float reveal = (1.0 - smoothstep(front - 0.35, front + 0.05, d)) * smoothstep(vLiveAt, vLiveAt + 0.12, uTime);
            float band = exp(-pow((d - front) / max(uBand.x, 0.01), 2.0)) * step(d, front + 0.6) * uBand.y;
            // Crackle re-strikes uRate times a second; radial streaks run outward from the source.
            float tick = floor(uTime * uRate);
            float a = atan(toward.y, toward.x);
            float streak = ridge(vec2(a * uStreak.x + tick * 0.37, d * 1.6 - uTime * uStreak.z), uStreak.y);
            float web = ridge(vSurface * uWeb.x + vec2(tick * 0.61, -tick * 0.43), uWeb.y);
            float fine = ridge(vSurface * uFine.x + vec2(-tick * 0.29, tick * 0.53), uFine.y) * uFine.z;
            float bolt = max(max(streak, web), fine);
            float flicker = 0.75 + 0.25 * hash(vec2(tick, vSeed));
            float glow = (bolt * flicker + band + uBase) * wet * reveal;
            if (glow < 0.01) discard;
            gl_FragColor = vec4(mix(uEdge, uCore, clamp(bolt + band, 0.0, 1.0)) * glow * uIntensity, 1.0);
          }`,
      });
      const mesh = new THREE.Mesh(geometry, material); mesh.userData.gpuParticle = true; mesh.frustumCulled = false; mesh.visible = false;
      (truck ? truck.body : game.scene).add(mesh);
      return { mesh, wet, shape, live, truck, active: false, liveAt: new Float32Array(surface.marks.length).fill(-1) };
    });
  }

  /** Contact points of the live heads, in each surface's coordinates (null where no current enters). */
  sources() {
    const { charging, wet } = this.game, points = this.pools.map(() => null);
    for (const head of charging.heads) {
      const contact = charging.contact(head);
      if (!contact) continue;
      const index = contact.truck ? charging.trucks.indexOf(contact.truck) + 1 : 0;
      if (index >= 0 && !points[index]) points[index] = wet.localPoint(contact.truck, contact.x, contact.z);
    }
    return points;
  }

  reset() {
    this.revision = -1;
    this.pools.forEach(pool => { pool.mesh.visible = false; pool.mesh.geometry.instanceCount = 0; pool.active = false; pool.liveAt.fill(-1); });
  }

  update() {
    const wet = this.game.wet, now = wet.tick / 60, changed = this.revision !== wet.revision;
    this.revision = wet.revision;
    // While a growth is young, keep resolving its source: the head's presented placement can settle a frame
    // or two after the shared live flags (tool interpolation), and the growth must start under the head.
    const settling = this.pools.some(pool => pool.active && now - pool.mesh.material.uniforms.uStart.value < 0.2);
    const sources = changed || settling ? this.sources() : null;
    this.pools.forEach((pool, i) => {
      const marks = wet.surfaces[i].marks, uniforms = pool.mesh.material.uniforms;
      uniforms.uTime.value = now; uniforms.uScroll.value = i ? 0 : wet.scroll;
      this.applyLook(uniforms);
      if (changed) {
        const any = marks.some(mark => mark.live);
        // A surface that just became live starts a new growth from where the current enters.
        if (any && !pool.active) {
          uniforms.uStart.value = now;
          const first = marks.find(mark => mark.live), source = sources[i] || [first.x, first.z];
          uniforms.uSource.value.set(source[0], source[1]);
        }
        pool.active = any;
        let count = 0; pool.live.array.fill(-1);
        marks.forEach((mark, slot) => {
          // Splashes joining a live area later fade in from now; ones that went dark are collapsed.
          if (!mark.live) pool.liveAt[slot] = -1;
          else if (pool.liveAt[slot] < 0) pool.liveAt[slot] = now;
          if (!mark.live) return;
          const instance = count++;
          pool.wet.setXYZW(instance, mark.x, mark.z, mark.radius || 0.001, mark.seed);
          pool.shape.setXYZW(instance, mark.stretch, mark.angle, mark.birth, mark.dry || 1);
          pool.live.setX(instance, pool.liveAt[slot]);
        });
        pool.mesh.geometry.instanceCount = count;
        pool.wet.needsUpdate = pool.shape.needsUpdate = pool.live.needsUpdate = true;
      } else if (pool.active && sources?.[i] && now - uniforms.uStart.value < 0.2) uniforms.uSource.value.set(sources[i][0], sources[i][1]);
      pool.mesh.visible = this.game.equipmentEnabled('charger') && pool.active;
    });
  }

  /** Uniform-only look from FX_TUNING.electric (cheap per frame; never recompiles). */
  applyLook(uniforms) {
    const look = FX_TUNING.electric;
    uniforms.uSpread.value = look.spread; uniforms.uIntensity.value = look.intensity; uniforms.uRate.value = look.flickerRate;
    uniforms.uBand.value.set(look.band, look.bandGain); uniforms.uBase.value = look.base;
    uniforms.uStreak.value.set(look.streakScale, look.streakSharp, look.streakSpeed);
    uniforms.uWeb.value.set(look.webScale, look.webSharp); uniforms.uFine.value.set(look.fineScale, look.fineSharp, look.fineAmount);
    uniforms.uCore.value.set(look.core); uniforms.uEdge.value.set(look.edge);
  }

  dispose() { for (const { mesh } of this.pools) { mesh.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose(); } }
}
