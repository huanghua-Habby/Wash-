import * as THREE from 'three';
import { PAL } from '../../../../../shared/sim/palette.js';
import { FIRST_LEVEL_ID, getLevel } from '../../../../../shared/levels.js';
import { mulberry32, wrap } from '../../../../../shared/sim/util.js';
import { ScrollGroup } from '../../../core/scroll.js';
import { CFG } from '../../../core/config.js';
import { Builder } from '../../../render/Builder.js';
import { warningSignTexture, highwaySignTexture } from '../../../render/textures.js';
import { SceneryChunks } from '../SceneryChunks.js';

// 路边布景：塔形松树、圆树、灌木、树篱、草垛、石头、蓝桶花盆、路牌
// 各类布景按 CFG.scenery 的密度筛选：总是按同一种子生成完整布局，再用独立种子决定去留，调密度时其余物件位置不变
// 主页与游玩（CFG.play.scenery）各烘焙一套，启动时一起预热；切换只改可见性，游玩中不重建
export class Meadow {
  constructor(scene, road = getLevel(FIRST_LEVEL_ID).road) {
    this.scene = scene; this.road = road;
    this.group = new ScrollGroup(road.loopLength);
    this.playing = false;
    const [home, play] = this.bakeScenery();
    this.homeScenery = home; this.playScenery = play;
    this.syncPlaying();
    this.buildSigns();
    this.syncSigns();
  }

  /** Debug-panel density change: re-bake the static chunks with the same materials (no new programs). */
  refreshDensity() {
    this.homeScenery.dispose(); this.playScenery.dispose();
    [this.homeScenery, this.playScenery] = this.bakeScenery();
    this.homeScenery.update(this.scroll || 0); this.playScenery.update(this.scroll || 0);
    this.syncPlaying(); this.syncSigns();
  }

  /** Home (CFG.scenery) and play (CFG.play.scenery) bakes from the same seeded layout. */
  bakeScenery() {
    const P = CFG.play.scenery;
    return [this.buildScenery(CFG.scenery), this.buildScenery({ trees: P, bushes: P, hedges: P, hay: P, rocks: P, barrels: P })];
  }

  setPlaying(playing) {
    if (this.playing === playing) return;
    this.playing = playing; this.syncPlaying();
  }

  syncPlaying() { this.homeScenery.visible = !this.playing; this.playScenery.visible = this.playing; }

  syncSigns() {
    const S = CFG.scenery;
    for (const sign of this.warningSigns) sign.visible = S.warningSigns;
    this.highwaySign.visible = S.highwaySign;
  }

  buildScenery(density) {
    const road = this.road, L = road.loopLength;
    const rng = mulberry32(road.scenerySeed);
    const keep = mulberry32(road.scenerySeed + 1);
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    const scenery = [];
    // 预留路牌位置
    const placed = [{ x: -52, z: -6.6, r: 1 }, { x: 28, z: -6.6, r: 1 }, { x: -12, z: -8.2, r: 2.6 }];

    const place = (kind, make, zMin, zMax, r, tries = 40) => {
      for (let k = 0; k < tries; k++) {
        const x = rng() * L - L / 2;
        const z = zMin + rng() * (zMax - zMin);
        const free = placed.every((p) => Math.hypot(wrap(x - p.x, L), z - p.z) > r + p.r);
        if (!free) continue;
        placed.push({ x, z, r });
        const obj = make();
        obj.position.z = z;
        obj.rotation.y = rng() * Math.PI * 2;
        obj.position.x = x;
        if (keep() < density[kind]) scenery.push({ obj, x });
        else obj.traverse((mesh) => mesh.geometry?.dispose());
        return obj;
      }
      return null;
    };

    const conifer = () => {
      const s = 0.8 + rng() * 0.6, b = new Builder();
      const c1 = pick(PAL.leaf), c2 = pick(PAL.leaf);
      b.box(0.32 * s, 0.9 * s, 0.32 * s, PAL.trunk, { p: [0, 0.45 * s, 0] });
      b.cone(1.25 * s, 1.6 * s, 7, c1, { p: [0, 1.5 * s, 0] });
      b.cone(0.98 * s, 1.4 * s, 7, c2, { p: [0, 2.35 * s, 0], r: [0, 0.4, 0] });
      b.cone(0.68 * s, 1.2 * s, 7, c1, { p: [0, 3.15 * s, 0], r: [0, 0.9, 0] });
      return b.build();
    };
    const roundTree = () => {
      const s = 0.8 + rng() * 0.5, b = new Builder();
      b.box(0.34 * s, 1.5 * s, 0.34 * s, PAL.trunk, { p: [0, 0.75 * s, 0] });
      b.dodeca(1.25 * s, pick(PAL.leaf), { p: [0, 2.3 * s, 0] });
      b.dodeca(0.8 * s, pick(PAL.leaf), { p: [0.75 * s, 1.95 * s, 0.35 * s] });
      b.dodeca(0.7 * s, pick(PAL.leaf), { p: [-0.6 * s, 2.0 * s, -0.4 * s] });
      return b.build();
    };
    const bush = () => {
      const b = new Builder(), n = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const r = 0.4 + rng() * 0.35;
        b.ico(r, pick(PAL.leaf), { p: [(rng() - 0.5) * 1.1, r * 0.75, (rng() - 0.5) * 0.7], s: [1, 0.85, 1] });
      }
      if (rng() < 0.5) {
        for (let i = 0; i < 5; i++) {
          b.box(0.09, 0.09, 0.09, PAL.flower[0], { p: [(rng() - 0.5) * 0.9, 0.55 + rng() * 0.35, (rng() - 0.5) * 0.6], outline: false });
        }
      }
      return b.build();
    };
    const hedge = () => {
      const len = 3 + rng() * 5, b = new Builder();
      const c = pick(PAL.leaf);
      b.box(len, 1.05, 1.15, c, { p: [0, 0.525, 0] });
      for (let x = -len / 2 + 0.4; x < len / 2; x += 0.7 + rng() * 0.4) {
        b.ico(0.32, c, { p: [x, 1.05, (rng() - 0.5) * 0.6], s: [1, 0.6, 1] });
      }
      return b.build();
    };
    const hay = () => {
      const b = new Builder();
      b.cyl(0.7, 0.7, 1.25, 10, PAL.hay, { p: [0, 0.7, 0], r: [Math.PI / 2, 0, 0] });
      b.cyl(0.72, 0.72, 0.08, 10, '#CFAE69', { p: [0, 0.7, 0.3], r: [Math.PI / 2, 0, 0], outline: false });
      b.cyl(0.72, 0.72, 0.08, 10, '#CFAE69', { p: [0, 0.7, -0.3], r: [Math.PI / 2, 0, 0], outline: false });
      if (rng() < 0.5) b.cyl(0.7, 0.7, 1.25, 10, PAL.hay, { p: [1.5, 0.7, 0.2], r: [Math.PI / 2, 0, 0.3] });
      return b.build();
    };
    const rock = () => {
      const b = new Builder(), r = 0.25 + rng() * 0.35;
      b.dodeca(r, PAL.rock, { p: [0, r * 0.4, 0], s: [1.3, 0.7, 1] });
      return b.build();
    };
    const barrel = () => {
      const b = new Builder();
      b.cyl(0.55, 0.48, 1.0, 12, PAL.barrel, { p: [0, 0.5, 0] });
      b.cyl(0.565, 0.565, 0.08, 12, '#5B79B3', { p: [0, 0.82, 0], outline: false });
      b.cyl(0.52, 0.52, 0.08, 12, '#5B79B3', { p: [0, 0.22, 0], outline: false });
      b.ico(0.55, PAL.leaf[1], { p: [0, 1.05, 0], s: [1, 0.55, 1] });
      b.ico(0.32, PAL.leaf[3], { p: [0.2, 1.2, -0.1], s: [1, 0.6, 1] });
      for (let i = 0; i < 6; i++) {
        const a = rng() * Math.PI * 2, rr = rng() * 0.4;
        b.box(0.1, 0.06, 0.1, PAL.flower[0], { p: [Math.cos(a) * rr, 1.25 + rng() * 0.08, Math.sin(a) * rr], outline: false });
      }
      return b.build();
    };

    // 远侧田野
    for (let i = 0; i < 34; i++) place('trees', rng() < 0.55 ? conifer : roundTree, -38, -9.5, 1.6);
    for (let i = 0; i < 9; i++) place('hedges', hedge, -30, -10, 3);
    for (let i = 0; i < 8; i++) place('hay', hay, -34, -13, 1.8);
    for (let i = 0; i < 34; i++) place('bushes', bush, -32, -7.2, 0.9);
    for (let i = 0; i < 12; i++) place('rocks', rock, -30, -6.6, 0.5);
    // 近侧（镜头这边）
    for (let i = 0; i < 9; i++) place('bushes', bush, 5.9, 7.7, 0.8);
    for (let i = 0; i < 8; i++) place('trees', rng() < 0.5 ? conifer : roundTree, 11, 26, 1.8);
    for (let i = 0; i < 16; i++) place('bushes', bush, 9.8, 24, 0.9);
    for (let i = 0; i < 4; i++) place('barrels', barrel, 9.6, 11, 0.8);
    for (let i = 0; i < 8; i++) place('rocks', rock, 9.5, 22, 0.5);

    // Widen the roadside clearance with the road; retain merged short chunks.
    const extraWidth = this.extraWidth();
    scenery.forEach(({ obj }) => { obj.position.z += Math.sign(obj.position.z) * extraWidth; });
    return new SceneryChunks(this.scene, scenery, L);
  }

  extraWidth() { return (this.road.laneCount - 2) * this.road.laneWidth / 2; }

  buildSigns() {
    const scene = this.scene, extraWidth = this.extraWidth();
    this.warningSigns = [];
    // 路牌（固定朝向，面向镜头与来车之间）
    const signTex = warningSignTexture();
    for (const x of [-52, 28]) {
      const g = new THREE.Group();
      const b = new Builder(0.03);
      b.box(0.12, 2.3, 0.12, PAL.railPost, { p: [0, 1.15, -0.04] });
      g.add(b.build());
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(1.7, 1.7),
        new THREE.MeshLambertMaterial({ map: signTex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide })
      );
      plate.position.set(0, 2.25, 0.03);
      g.add(plate);
      g.position.z = -6.6 - extraWidth;
      g.rotation.y = -0.45;
      scene.add(g);
      this.group.add(g, x);
      this.warningSigns.push(g);
    }

    const boardTex = highwaySignTexture();
    {
      const g = new THREE.Group();
      const b = new Builder(0.04);
      b.box(0.2, 3.6, 0.2, PAL.railPost, { p: [-1.7, 1.8, -0.15] });
      b.box(0.2, 3.6, 0.2, PAL.railPost, { p: [1.7, 1.8, -0.15] });
      g.add(b.build());
      const side = new THREE.MeshLambertMaterial({ color: '#46679F' });
      const board = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.72, 0.12), [
        side, side, side, side, new THREE.MeshLambertMaterial({ map: boardTex }), side,
      ]);
      board.position.set(0, 3.3, 0);
      board.castShadow = true;
      g.add(board);
      g.position.z = -8.2 - extraWidth;
      g.rotation.y = -0.3;
      scene.add(g);
      this.group.add(g, -12);
      this.highwaySign = g;
    }
  }

  update(scroll) {
    this.scroll = scroll;
    this.homeScenery.update(scroll); this.playScenery.update(scroll);
    this.group.update(scroll);
  }
}
