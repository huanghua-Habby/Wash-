import * as THREE from 'three';
import { PAL } from '../../../shared/sim/palette.js';
import { ScrollInstances } from '../core/scroll.js';
import { FIRST_LEVEL_ID, getLevel } from '../../../shared/levels.js';
import { Builder, instancedBox } from '../render/Builder.js';
import { roadTexture, groundTexture, drawGround } from '../render/textures.js';
import { CFG } from '../core/config.js';
import { GLOW } from '../render/GlowMaterials.js';

export class Road {
  constructor(scene, config = getLevel(FIRST_LEVEL_ID).road) {
    this.config = config;
    const length = config.visibleLength, loopLength = config.loopLength;
    const halfWidth = config.laneCount * config.laneWidth / 2;
    // 草地底面
    this.groundTex = groundTexture(CFG.grass);
    this.setGroundScale();
    this.groundMat = new THREE.MeshLambertMaterial({ map: this.groundTex });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // 路面
    this.roadPeriod = config.texturePeriod;
    this.roadTex = roadTexture(config);
    this.roadTex.repeat.set(length / this.roadPeriod, 1);
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(length, halfWidth * 2),
      new THREE.MeshLambertMaterial({ map: this.roadTex })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0.02;
    road.receiveShadow = true;
    scene.add(road);

    // 路缘石、护栏横梁、木栅栏横杆（静态长条）
    const b = new Builder(0.03);
    b.box(length, 0.14, 0.26, PAL.curb, { p: [0, 0.07, (halfWidth + 0.13)] });
    b.box(length, 0.14, 0.26, PAL.curb, { p: [0, 0.07, -(halfWidth + 0.13)] });
    // 路缘顶部的导航光带（共享可调 HDR 材质，联动 Bloom）
    const glow = new Builder(0);
    glow.box(length, 0.04, 0.1, '#ffffff', { p: [0, 0.16, (halfWidth + 0.13)], outline: false });
    glow.box(length, 0.04, 0.1, '#ffffff', { p: [0, 0.16, -(halfWidth + 0.13)], outline: false });
    scene.add(glow.build({ cast: false, receive: false, material: GLOW.road }));
    b.box(length, 0.3, 0.08, PAL.rail, { p: [0, 0.72, -(halfWidth + 1.28)] });
    b.box(length, 0.09, 0.07, PAL.wood, { p: [0, 0.42, (halfWidth + 4.05)] });
    b.box(length, 0.09, 0.07, PAL.wood, { p: [0, 0.82, (halfWidth + 4.05)] });
    scene.add(b.build());

    // 滚动的护栏柱
    const posts = instancedBox(0.14, 0.86, 0.14, PAL.railPost, loopLength / 2.5);
    const postItems = [];
    for (let i = 0; i < loopLength / 2.5; i++) postItems.push({ x: i * 2.5, z: -(halfWidth + 1.18) });
    posts.forEach((m) => scene.add(m));
    this.posts = new ScrollInstances(posts, postItems, loopLength);
    // 护栏柱顶的指示灯
    const beacons = instancedBox(0.18, 0.1, 0.18, PAL.laneGlow, postItems.length, 0.02);
    beacons[0].material.dispose(); beacons[0].material = GLOW.road; beacons[0].castShadow = false;
    beacons.forEach((m) => scene.add(m));
    this.beacons = new ScrollInstances(beacons, postItems.map((item) => ({ ...item, y: 0.86 })), loopLength);

    // 滚动的白色木栅栏板
    const n = Math.round(loopLength / 0.62);
    const pickets = instancedBox(0.16, 1.05, 0.06, PAL.picket, n, 0.03);
    const picketItems = [];
    for (let i = 0; i < n; i++) picketItems.push({ x: i * 0.62, z: halfWidth + 4, sy: 0.92 + ((i * 37) % 11) / 70 });
    pickets.forEach((m) => scene.add(m));
    this.pickets = new ScrollInstances(pickets, picketItems, loopLength);
  }

  /** Debug-panel ground patches: redraw the same canvas texture; no new GPU program. */
  refreshGround() { drawGround(this.groundTex, CFG.grass); this.setGroundScale(); }
  setGroundScale() {
    this.groundPeriod = CFG.grass.groundScale;
    this.groundTex.repeat.set(400 / this.groundPeriod, 400 / this.groundPeriod);
  }

  update(scroll) {
    this.roadTex.offset.x = scroll / this.roadPeriod;
    this.groundTex.offset.x = scroll / this.groundPeriod;
    this.posts.update(scroll);
    this.beacons.update(scroll);
    this.pickets.update(scroll);
  }
}
