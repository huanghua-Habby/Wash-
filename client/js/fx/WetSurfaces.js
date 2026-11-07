/** Wet marks left by the water gun on the road, vehicle roofs and cats; they glisten, then dry from the edges in.
 * Client presentation only: hits are read from the authoritative spray path (gun.sprayNodes) and never feed back.
 * A towel being scrubbed (authoritative use = 'wipe') soaks up marks under it and rubs wet teammates dry.
 * Decals are instanced per surface. CPU keeps logical ring slots in `records` and packs only live decals into the
 * instance buffer when water lands, a towel dries, or a batch of decals has expired (never per frame); fading,
 * evaporation, ripples and road scrolling all run on the GPU. With no live decal a pool submits zero instances.
 * Overlaps never darken further: each pixel keeps only its wettest layer. Three passes share one geometry and
 * use the colour target's alpha as scratch — 0 resets alpha to 1 under every decal, 1 MIN-blends in
 * 1 - darken·wetness, 2 applies the result once (then restores alpha to 1 so later overlaps are no-ops). */
import * as THREE from 'three';
import { GpuWaterLayer } from '../game/GpuWaterLayer.js';

const vertexShader = /* glsl */`
uniform float uTime;
uniform float uScroll;
uniform float uY;
attribute vec4 aDecal;   // x, z, birth, seed
attribute vec4 aShape;   // radius, stretch along the facing, dry seconds, kind (0 splash, 1 paw)
attribute float aAngle;
varying vec2 vUv;
varying vec2 vLocal;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vAge;
varying vec4 vShape;
varying float vSeed;
void main() {
  vAge = uTime - aDecal.z; vShape = aShape; vSeed = aDecal.w; vUv = position.xy;
  // Fully dried or not yet born: collapse so the rasterizer skips it.
  float alive = step(0.0, vAge) * step(vAge, aShape.z) * step(0.001, aShape.x);
  vec2 dir = vec2(cos(aAngle), -sin(aAngle)), side = vec2(sin(aAngle), cos(aAngle));
  vec2 p = vec2(aDecal.x - uScroll, aDecal.y) + (dir * position.x * aShape.y + side * position.y) * aShape.x * alive;
  vLocal = p;
  vec4 world = modelMatrix * vec4(p.x, uY, p.y, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const fragmentShader = /* glsl */`
uniform float uTime;
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform vec3 uSun;
uniform vec3 uSunDir;
uniform float uDarken;
uniform float uReflect;
uniform vec4 uClip[2];
uniform float uClipCount;
varying vec2 vUv;
varying vec2 vLocal;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vAge;
varying vec4 vShape;
varying float vSeed;
float wh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wn(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wh(i), wh(i + vec2(1, 0)), f.x), mix(wh(i + vec2(0, 1)), wh(i + vec2(1, 1)), f.x), f.y);
}
float wfbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * wn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
float blob(vec2 p, vec2 c, vec2 r) { return 1.0 - length((p - c) / r); }
void main() {
  // Roof decals stop at the standing area instead of hanging into the air past the edge.
  if (uClipCount > 0.5) {
    bool inside = false;
    for (int i = 0; i < 2; i++) {
      if (float(i) >= uClipCount) break;
      vec4 c = uClip[i];
      inside = inside || (vLocal.x > c.x && vLocal.x < c.z && vLocal.y > c.y && vLocal.y < c.w);
    }
    if (!inside) discard;
  }
#if WET_PASS == 0
  gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
  return;
#endif
  float t = clamp(vAge / vShape.z, 0.0, 1.0);
  float depth;
  if (vShape.w < 0.5) {
    // Splash: thick, noisy middle plus a ring of thrown droplets. Evaporation lowers a water level
    // through this depth field, so thin rims and small drops go first and the core shrinks last.
    float r = length(vUv);
    depth = (1.0 - r) * 0.8 + (wfbm(vUv * 1.7 + vSeed * 13.0) - 0.5) * 0.75 + 0.12;
    vec2 g = vUv * 3.3 + vSeed * 7.0, cell = floor(g), f = fract(g) - 0.5;
    vec2 off = (vec2(wh(cell + 1.3), wh(cell + 2.7)) - 0.5) * 0.45;
    float drop = (0.06 + 0.16 * wh(cell + vSeed) - length(f - off)) * 2.2 * step(0.45, wh(cell + 4.1)) * step(r, 1.0);
    depth = max(depth, drop);
  } else {
    // Paw print: heel pad and four toe beans, facing +x.
    vec2 p = vUv;
    float pad = blob(p, vec2(-0.28, 0.0), vec2(0.42, 0.5));
    float toes = max(max(blob(p, vec2(0.38, -0.52), vec2(0.2, 0.2)), blob(p, vec2(0.55, -0.18), vec2(0.21, 0.21))),
                     max(blob(p, vec2(0.55, 0.18), vec2(0.21, 0.21)), blob(p, vec2(0.38, 0.52), vec2(0.2, 0.2))));
    depth = max(pad, toes) * 0.9 + (wn(p * 6.0 + vSeed * 9.0) - 0.5) * 0.15;
  }
  float level = t * 0.95;
  float m = smoothstep(level, level + 0.1, depth) * smoothstep(0.0, FADE_IN, vAge);
#if WET_PASS == 1
  if (m < 0.004) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0 - uDarken * m);
  return;
#endif
  // Rippled water normal: slow drifting noise, strongest where the water is deep.
  vec2 rp = vWorld.xz * 2.6 + vec2(uTime * 0.35, uTime * 0.2) + vSeed;
  float h0 = wfbm(rp), hx = wfbm(rp + vec2(0.07, 0.0)), hz = wfbm(rp + vec2(0.0, 0.07));
  vec3 N = normalize(normalize(vNormal) + vec3(h0 - hx, 0.0, h0 - hz) * 0.5);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 R = reflect(-V, N);
  // Stylized Fresnel: the top-down camera still catches a clear sky sheen on wet surfaces.
  float fres = 0.12 + 0.88 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
  vec3 sky = mix(uHorizon, uSky, smoothstep(-0.1, 0.8, R.y));
  float nh = max(dot(N, normalize(uSunDir + V)), 0.0);
  // The top-down camera sits near the sun's mirror direction, so a smooth highlight would whiten the whole
  // patch. Keep it to scattered ripple glints.
  float sparkle = smoothstep(0.72, 0.92, wn(vWorld.xz * 14.0 + vec2(uTime * 1.3, -uTime * 0.9) + vSeed * 3.0));
  vec3 spec = uSun * pow(nh, 400.0) * 0.5 * sparkle;
  // Blended toward this colour by the stored wetness: dst·(1 - darken·m) + light·m for the wettest layer.
  vec3 light = (sky * fres * 0.18 + spec) * uReflect;
  gl_FragColor = vec4(light / uDarken, 1.0);
}`;

const FADE_IN = 0.1;          // seconds a new splash takes to appear (shader define)
const SURFACE_Y = 0.035;      // just above the road quad (0.02)
const ROOF_LIFT = 0.055;      // above roof stains (top + 0.045)
const EXPIRY_SLACK = 0.5;     // dried decals may linger this long (shader-collapsed) so expiries repack in batches

/** Ring of decal slots on one surface. `records` holds every logical slot; the GPU buffer holds only live ones. */
export class WetDecalPool {
  constructor(parent, capacity, uniforms, { y, scroll = null, clip = [], renderOrder = 2 }) {
    this.capacity = capacity; this.cursor = 0; this.dirty = false; this.lastDry = -Infinity; this.repackAt = Infinity;
    this.records = Array.from({ length: capacity }, () => ({ x: 0, z: 0, birth: -1e9, seed: 0, radius: 0, stretch: 1, dry: 0, kind: 0, angle: 0 }));
    const quad = new THREE.PlaneGeometry(2, 2);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', quad.attributes.position.clone());
    geometry.setIndex(quad.index.clone()); quad.dispose();
    geometry.instanceCount = 0;
    this.geometry = geometry; this.attributes = {};
    for (const [name, size] of [['aDecal', 4], ['aShape', 4], ['aAngle', 1]]) {
      const attribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
      attribute.setUsage(THREE.DynamicDrawUsage); geometry.setAttribute(name, attribute); this.attributes[name] = attribute;
    }
    const clips = [0, 1].map((i) => clip[i] ? new THREE.Vector4(clip[i].x0 - 0.04, clip[i].z0 - 0.04, clip[i].x1 + 0.04, clip[i].z1 + 0.04) : new THREE.Vector4());
    const shared = { ...uniforms, uScroll: scroll || { value: 0 }, uY: { value: y }, uClip: { value: clips }, uClipCount: { value: clip.length } };
    const KEEP = { blendSrc: THREE.ZeroFactor, blendDst: THREE.OneFactor }; // colour untouched
    const PASSES = [
      { ...KEEP, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.ZeroFactor },
      { ...KEEP, blendEquationAlpha: THREE.MinEquation, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor },
      { blendSrc: THREE.OneMinusDstAlphaFactor, blendDst: THREE.DstAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.ZeroFactor },
    ];
    // Global transparent sorting runs every pool's pass 0, then every pass 1, then every pass 2.
    this.meshes = PASSES.map((blend, pass) => {
      const material = new THREE.ShaderMaterial({
        // The quad's xy maps onto world xz, which mirrors its winding: draw both faces.
        vertexShader, fragmentShader, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendEquationAlpha: THREE.AddEquation, ...blend,
        defines: { WET_PASS: pass, FADE_IN: FADE_IN.toFixed(3) }, uniforms: shared,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false; mesh.renderOrder = renderOrder + pass; mesh.visible = false;
      mesh.userData.gpuParticle = true;
      parent.add(mesh);
      return mesh;
    });
  }

  setVisible(visible) { for (const mesh of this.meshes) mesh.visible = visible; }

  /** A still-wet splash near (x, z) to refresh instead of stacking another layer on top of it. */
  near(x, z, time, distance) {
    for (let i = 0; i < this.capacity; i++) {
      const r = this.records[i];
      if (r.kind === 0 && time - r.birth < r.dry * 0.45 && Math.hypot(r.x - x, r.z - z) < distance) return i;
    }
    return -1;
  }

  write(slot, x, z, birth, seed, radius, stretch, dry, kind, angle) {
    Object.assign(this.records[slot], { x, z, birth, seed, radius, stretch, dry, kind, angle });
    this.lastDry = Math.max(this.lastDry, birth + dry);
    this.dirty = true; this.setVisible(true);
  }

  /** Drop one logical slot (shared mark removed by the host); repacked on the next update. */
  remove(slot) {
    const r = this.records[slot];
    if (!r.radius) return;
    r.radius = 0; this.dirty = true;
  }

  /** Copy live records to the front of the instance buffer; expired, empty and removed slots are not submitted. */
  pack(time) {
    const { aDecal, aShape, aAngle } = this.attributes;
    let count = 0, nextExpiry = Infinity;
    for (const r of this.records) {
      const end = r.birth + r.dry;
      if (r.radius < 0.001 || end <= time) continue;
      aDecal.setXYZW(count, r.x, r.z, r.birth, r.seed);
      aShape.setXYZW(count, r.radius, r.stretch, r.dry, r.kind);
      aAngle.setX(count, r.angle);
      nextExpiry = Math.min(nextExpiry, end); count++;
    }
    for (const attribute of [aDecal, aShape, aAngle]) {
      attribute.clearUpdateRanges?.(); attribute.addUpdateRange?.(0, count * attribute.itemSize);
      if (count) attribute.needsUpdate = true;
    }
    this.geometry.instanceCount = count;
    this.repackAt = nextExpiry + EXPIRY_SLACK;
    this.dirty = false;
    if (!count) this.setVisible(false);
  }

  emit(x, z, time, { radius, stretch = 1, dry, kind = 0, angle = Math.random() * Math.PI * 2 }) {
    const slot = this.cursor++ % this.capacity;
    this.write(slot, x, z, time, Math.random() * 10, radius, stretch, dry, kind, angle);
    return slot;
  }

  /** Keep a puddle under a steady stream fresh, letting it spread a little. */
  refresh(slot, time, maxRadius) {
    const r = this.records[slot];
    // Restart only the drying clock. Keeping the fade-in progress stops a held stream from re-fading
    // the puddle on every refresh (visible as flicker).
    const birth = time - Math.min(time - r.birth, FADE_IN);
    this.write(slot, r.x, r.z, birth, r.seed, Math.min(maxRadius, r.radius + 0.035), r.stretch, r.dry, 0, r.angle);
  }

  /**
   * A towel soaks up every still-wet mark within `radius`: each finishes drying in about `seconds`, continuing from
   * its current drying progress (age/dry kept). A faded-in mark keeps age ≥ FADE_IN, so the window may stretch a
   * little for very fresh marks instead of replaying the fade-in. Returns how many marks it touched.
   */
  dryNear(x, z, time, radius, seconds) {
    let count = 0;
    for (let i = 0; i < this.capacity; i++) {
      const r = this.records[i], age = time - r.birth, remaining = r.dry - age;
      if (remaining <= seconds || age < 0 || Math.hypot(r.x - x, r.z - z) > radius + r.radius * 0.6) continue;
      const progress = Math.max(0, age / r.dry);
      let dry = seconds / (1 - progress), newAge = progress * dry;
      if (age < FADE_IN) { newAge = age; dry = age + seconds; }
      else if (newAge < FADE_IN) { dry = FADE_IN / progress; newAge = FADE_IN; }
      this.write(i, r.x, r.z, time - newAge, r.seed, r.radius, r.stretch, dry, r.kind, r.angle);
      count++;
    }
    return count;
  }

  update(time) {
    if (this.dirty || time >= this.repackAt) this.pack(time);
    if (this.meshes[0].visible && time > this.lastDry) { this.geometry.instanceCount = 0; this.repackAt = Infinity; this.setVisible(false); }
  }

  clear() {
    this.records.forEach((r) => { r.birth = -1e9; r.radius = 0; });
    this.geometry.instanceCount = 0; this.lastDry = -Infinity; this.repackAt = Infinity; this.dirty = false; this.setVisible(false);
  }
}

/**
 * A vehicle's roof wetness drawn as one decal layer per standing level (multi-level roofs: the new washer's 1 m rear
 * deck and 3 m box roof, the flatbed's bed and cab). Platforms of one height share a layer, two clip rectangles per
 * layer, so any number of levels or platforms works. A mark goes to the layer under it; empty layers draw nothing.
 * Same API as one WetDecalPool; `records` are the logical per-slot records the shared adapter tracks ids on.
 */
export class LevelDecalPools {
  constructor(parent, capacity, uniforms, truck) {
    const levels = new Map();
    for (const plat of truck.spec.platforms) {
      const y = plat.y ?? truck.spec.top;
      if (!levels.has(y)) levels.set(y, []);
      levels.get(y).push(plat);
    }
    this.layers = [];
    for (const [y, plats] of levels) for (let i = 0; i < plats.length; i += 2) {
      const clip = plats.slice(i, i + 2);
      this.layers.push({ clip, pool: new WetDecalPool(parent, capacity, uniforms, { y: y + ROOF_LIFT, clip }) });
    }
    this.capacity = capacity;
    this.records = Array.from({ length: capacity }, () => ({ id: 0, x: 0, z: 0, birth: -1e9, radius: 0, dry: 0 }));
    this.slotLayer = new Int16Array(capacity).fill(-1);
  }
  get meshes() { return this.layers.flatMap(layer => layer.pool.meshes); }
  /** The layer whose platforms hold truck-local (x, z); the first layer off every platform. */
  layerAt(x, z) {
    const index = this.layers.findIndex(({ clip }) => clip.some(p => x >= p.x0 - 0.05 && x <= p.x1 + 0.05 && z >= p.z0 - 0.05 && z <= p.z1 + 0.05));
    return index < 0 ? 0 : index;
  }
  write(slot, x, z, birth, seed, radius, stretch, dry, kind, angle) {
    const layer = this.layerAt(x, z), previous = this.slotLayer[slot];
    if (previous >= 0 && previous !== layer) this.layers[previous].pool.remove(slot);
    this.slotLayer[slot] = layer;
    this.layers[layer].pool.write(slot, x, z, birth, seed, radius, stretch, dry, kind, angle);
    Object.assign(this.records[slot], { x, z, birth, radius, dry });
  }
  remove(slot) {
    const layer = this.slotLayer[slot];
    if (layer >= 0) this.layers[layer].pool.remove(slot);
    this.records[slot].radius = 0;
  }
  refresh(slot, time, maxRadius) { const layer = this.slotLayer[slot]; if (layer >= 0) this.layers[layer].pool.refresh(slot, time, maxRadius); }
  near(x, z, time, distance) { return this.layers[this.layerAt(x, z)].pool.near(x, z, time, distance); }
  emit(x, z, time, options) { return this.layers[this.layerAt(x, z)].pool.emit(x, z, time, options); }
  dryNear(x, z, time, radius, seconds) { return this.layers[this.layerAt(x, z)].pool.dryNear(x, z, time, radius, seconds); }
  setVisible(visible) { for (const { pool } of this.layers) pool.setVisible(visible); }
  update(time) { for (const { pool } of this.layers) pool.update(time); }
  clear() {
    for (const { pool } of this.layers) pool.clear();
    for (const record of this.records) { record.id = 0; record.radius = 0; record.birth = -1e9; }
    this.slotLayer.fill(-1);
  }
}

const EMIT_ROOF = 0.07, EMIT_ROAD = 0.025, PLAYER_WET_RATE = 2.4, PLAYER_DRY_SECONDS = 9, PLAYER_DRY_DELAY = 1.2;
// Towel drying: a scrubbing towel (authoritative use = 'wipe') soaks up roof water and rubs wet teammates dry.
const TOWEL_REACH = 0.55, TOWEL_DRY_SECONDS = 0.45, TOWEL_INTERVAL = 0.08, TOWEL_RUB_RATE = 2.5, TOWEL_RUB_RANGE = 0.9;

export class WetSurfaces {
  constructor({ scene, game, trucks, players, lighting }) {
    Object.assign(this, { scene, game, trucks, players, lighting });
    this.time = 0; this.scroll = { value: 0 };
    this.uniforms = {
      uTime: { value: 0 }, uSky: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uSun: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0.3, 0.9, 0.2) },
      uDarken: { value: 0.46 }, uReflect: { value: 1 },
    };
    this.road = new WetDecalPool(scene, 160, this.uniforms, { y: SURFACE_Y, scroll: this.scroll });
    this.roofs = trucks.map((truck) => new LevelDecalPools(truck.body, 112, this.uniforms, truck));
    this.emitClock = new Map();
    this.wet = players.map(() => 0); this.lastHit = players.map(() => -1e9);
    this.steps = players.map((player) => Math.floor(player.walk / Math.PI)); this.pawSide = players.map(() => 1);
    // Drops falling off a soaked cat: the shared water-puff GPU stream layer, emitted at a rate set by wetness.
    this.dripTime = { value: 0 };
    this.dripRoot = new THREE.Group(); scene.add(this.dripRoot);
    this.drips = new GpuWaterLayer(this.dripRoot, this.dripTime, 48, 0);
    this.dripCarry = players.map(() => 0);
    this._hit = new THREE.Vector3();
  }

  /** Readiness samples: every pool and the drip layer render once behind the loading screen. */
  samples() { return [...this.road.meshes, ...this.roofs.flatMap((pool) => pool.meshes), this.drips.mesh]; }

  /** Release every pool mesh and the drip layer (EffectsManager.dispose). */
  dispose() {
    const geometries = new Set();
    for (const mesh of this.samples()) { mesh.removeFromParent(); geometries.add(mesh.geometry); mesh.material.dispose(); }
    for (const geometry of geometries) geometry.dispose();
    this.dripRoot.removeFromParent();
  }

  reset() {
    this.road.clear(); this.roofs.forEach((pool) => pool.clear());
    this.wet.fill(0); this.lastHit.fill(-1e9); this.emitClock.clear(); this.drips.reset();
    this.dripCarry.fill(0);
    this.players.forEach((player, i) => { this.steps[i] = Math.floor(player.walk / Math.PI); });
    this.players.forEach((player) => player.setWetness?.(0));
  }

  syncLight() {
    const { hemi, sun, offset } = this.lighting, u = this.uniforms;
    u.uSky.value.copy(hemi.color).multiplyScalar(hemi.intensity * 0.42);
    u.uHorizon.value.copy(hemi.groundColor).lerp(hemi.color, 0.5).multiplyScalar(hemi.intensity * 0.3);
    u.uSun.value.copy(sun.color).multiplyScalar(sun.intensity);
    u.uSunDir.value.copy(offset).normalize();
  }

  /** Throttle per gun and surface so a steady stream lays an even trail. */
  due(key, dt, interval) {
    const value = (this.emitClock.get(key) || 0) + dt;
    if (value < interval) { this.emitClock.set(key, value); return false; }
    this.emitClock.set(key, Math.min(value - interval, interval)); return true;
  }

  splash(pool, x, z, { radius, stretch = 1, dry, angle }) {
    const slot = pool.near(x, z, this.time, radius * 0.55);
    if (slot >= 0) pool.refresh(slot, this.time, radius * 1.7);
    else pool.emit(x + (Math.random() - 0.5) * 0.18, z + (Math.random() - 0.5) * 0.18, this.time, { radius: radius * (0.85 + Math.random() * 0.3), stretch, dry, angle });
  }

  /** Which surface the spray's end point is on. Mirrors the authority's trace order: cats, roofs, then road. */
  landWater(gun, dt, index) {
    const hit = this._hit.copy(gun.sprayNodes.at(-1));
    for (let i = 0; i < this.players.length; i++) {
      const player = this.players[i], p = player.root.position;
      if (player === gun.holder || player.occupied === false || !player.root.visible) continue;
      if (Math.hypot(hit.x - p.x, hit.z - p.z) < 0.85 && hit.y > p.y - 0.15 && hit.y < p.y + 1.55) {
        this.wet[i] = Math.min(1, this.wet[i] + dt * PLAYER_WET_RATE); this.lastHit[i] = this.time; return;
      }
    }
    for (let i = 0; i < this.trucks.length; i++) {
      const truck = this.trucks[i];
      if (!truck.group.visible || Math.abs(hit.y - truck.topY) > 0.45 || !truck.platformAt(hit.x, hit.z, 0.1)) continue;
      if (!this.due(`${index}:roof`, dt, EMIT_ROOF)) return;
      truck.body.updateWorldMatrix(true, false);
      const local = truck.body.worldToLocal(hit);
      this.splash(this.roofs[i], local.x, local.z, { radius: 0.5, dry: 8 + Math.random() * 3 });
      return;
    }
    if (hit.y < 0.4 && this.due(`${index}:road`, dt, EMIT_ROAD)) {
      // The road runs backwards under a fixed stream: stretched splashes merge into one wet trail.
      this.splash(this.road, hit.x + this.scroll.value, hit.z, { radius: 0.55, stretch: 1.7, dry: 5 + Math.random() * 2, angle: (Math.random() - 0.5) * 0.3 });
    }
  }

  /** Wet paws print on the roof they walk on; each step alternates left and right. */
  pawPrints(player, i) {
    const step = Math.floor(player.walk / Math.PI);
    if (step === this.steps[i]) return;
    this.steps[i] = step;
    const truck = player.state === 'ground' ? player.ground?.truck : null, index = this.trucks.indexOf(truck);
    if (index < 0 || this.wet[i] < 0.18 || !truck.group.visible || Math.hypot(player.visual.vel.x, player.visual.vel.z) < 1.2) return;
    const side = (this.pawSide[i] = -this.pawSide[i]) * 0.1, yaw = player.yaw;
    const at = this._hit.set(player.pos.x + Math.sin(yaw) * side, truck.topYAt(player.pos.x, player.pos.z), player.pos.z + Math.cos(yaw) * side);
    truck.body.updateWorldMatrix(true, false);
    const local = truck.body.worldToLocal(at);
    this.roofs[index].emit(local.x, local.z, this.time, { radius: 0.12, dry: 2 + 3 * this.wet[i], kind: 1, angle: yaw - truck.group.rotation.y });
  }

  dryRoof(index, local) { return this.roofs[index].dryNear(local.x, local.z, this.time, TOWEL_REACH, TOWEL_DRY_SECONDS); }
  /** While a player scrubs with a towel, nearby roof water and wet teammates dry fast; squeezed drops show it soaking up. */
  towelDry(player, i, dt) {
    const towel = player.heldTool, truck = player.state === 'ground' ? player.ground?.truck : null;
    if (player.useAction !== 'wipe' || towel?.kind !== 'towel' || !player.root.visible) { this.emitClock.delete(`towel:${i}`); return; }
    towel.mesh.updateWorldMatrix(true, false);
    const at = towel.mesh.getWorldPosition(this._hit);
    for (let j = 0; j < this.players.length; j++) {
      const other = this.players[j], p = other.root.position;
      if (j !== i && this.wet[j] > 0 && other.root.visible && Math.hypot(at.x - p.x, at.z - p.z) < TOWEL_RUB_RANGE && Math.abs(at.y - p.y - 0.5) < 0.9) {
        this.wet[j] = Math.max(0, this.wet[j] - dt * TOWEL_RUB_RATE); this.lastHit[j] = Math.min(this.lastHit[j], this.time - PLAYER_DRY_DELAY);
      }
    }
    const index = this.trucks.indexOf(truck);
    if (index < 0 || !truck.group.visible || !this.due(`towel:${i}`, dt, TOWEL_INTERVAL)) return;
    truck.body.updateWorldMatrix(true, false);
    const local = truck.body.worldToLocal(at.clone());
    if (this.dryRoof(index, local) > 0) {
      // Soaking up: a few drops squeezed out of the towel.
      for (let k = 0; k < 3; k++) {
        const origin = at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.05, (Math.random() - 0.5) * 0.3));
        const velocity = new THREE.Vector3(truck.vel.x, -0.8 - Math.random(), truck.vel.z);
        this.drips.emit(origin, velocity, new THREE.Vector3(0, 1, 0), this.dripTime.value, 0.3, 0.035 + Math.random() * 0.02, Math.random() * 100);
      }
    }
  }

  drip(player, i, dt) {
    const wet = this.wet[i];
    if (wet < 0.08 || !player.root.visible) { this.dripCarry[i] = 0; return; }
    this.dripCarry[i] += dt * wet * 14;
    const base = player.ground?.truck?.vel;
    while (this.dripCarry[i] >= 1) {
      this.dripCarry[i] -= 1;
      const a = Math.random() * Math.PI * 2, r = 0.12 + Math.random() * 0.16, p = player.root.position;
      const origin = this._hit.set(p.x + Math.cos(a) * r, p.y + 0.25 + Math.random() * 0.55, p.z + Math.sin(a) * r);
      const velocity = new THREE.Vector3(base?.x || 0, -0.6 - Math.random(), base?.z || 0);
      this.drips.emit(origin, velocity, new THREE.Vector3(0, 1, 0), this.dripTime.value, 0.3 + Math.random() * 0.15, 0.03 + Math.random() * 0.02, Math.random() * 100);
    }
  }

  /** Once per rendered frame after the authoritative spray path and player roots are presented. */
  update(dt, scroll) {
    const game = this.game, running = !(game.paused || game.ended);
    if (running) { this.time += dt; this.dripTime.value += dt; }
    this.uniforms.uTime.value = this.time; this.scroll.value = scroll;
    this.syncLight();
    if (running && game.equipmentVisible) {
      (game.sprayers?.() ?? game.waterguns).forEach((gun, index) => {
        if (gun.spraying && gun.mesh.visible && gun.sprayNodes.length > 1) this.landWater(gun, dt, index);
        else { this.emitClock.delete(`${index}:roof`); this.emitClock.delete(`${index}:road`); }
      });
    }
    this.players.forEach((player, i) => {
      if (running && this.time - this.lastHit[i] > PLAYER_DRY_DELAY) this.wet[i] = Math.max(0, this.wet[i] - dt / PLAYER_DRY_SECONDS);
      if (player.occupied === false) this.wet[i] = 0;
      player.setWetness?.(this.wet[i]);
      if (running) { this.towelDry(player, i, dt); this.pawPrints(player, i); this.drip(player, i, dt); }
    });
    this.road.update(this.time); this.roofs.forEach((pool) => pool.update(this.time)); this.drips.flush();
  }
}
