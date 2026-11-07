import * as THREE from 'three';
import { ROAD_SIGN, roadSignFrame, roadSignTone } from '../../../shared/sim/RoadSigns.js';
import { ROAD_SIGN_PALETTE, ROAD_SIGN_RIM_INTENSITY } from './roadSignPalette.js';

/** One prepared sign per level. Only transforms, visibility and tone colours change during the round. No collision here. */
export class RoadSignView {
  constructor(scene, entries = [], road = { laneWidth: 4.5, laneCount: 2 }) {
    this.road = road;
    this.root = new THREE.Group(); this.root.name = 'road-sign'; scene.add(this.root);
    this.geometries = new Set(); this.materials = new Set();
    this.attachmentOffset = new THREE.Vector3();
    const material = (color) => { const m = new THREE.MeshStandardMaterial({ color, roughness: .65 }); this.materials.add(m); return m; };
    const white = material('#fff4d9'), metal = material('#87958c');
    // Tone colours are uniforms on these shared materials; switching signs never compiles a new program.
    this.face = material('#2f86b3'); this.symbol = material('#fff4d9');
    this.rim = new THREE.MeshBasicMaterial({ color: 0xffffff }); this.materials.add(this.rim);
    const box = (w, h, d, mat, x, y, z) => {
      const geometry = new THREE.BoxGeometry(w, h, d); this.geometries.add(geometry);
      const mesh = new THREE.Mesh(geometry, mat); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true;
      this.root.add(mesh); return mesh;
    };
    const width = road.laneWidth * ROAD_SIGN.widthRatio;
    box(ROAD_SIGN.thickness, ROAD_SIGN.height, width, white, 0, ROAD_SIGN.height/2, 0);
    box(ROAD_SIGN.thickness+.015, ROAD_SIGN.height-.12, width-.12, this.face, 0, ROAD_SIGN.height/2, 0);
    // Unlit HDR rim just outside the white border: the post Bloom turns it into the outer glow.
    const rim = .08, rimDepth = ROAD_SIGN.thickness+.04;
    for (const [h, w, y, z] of [[rim, width+rim*2, ROAD_SIGN.height+rim/2, 0], [rim, width+rim*2, -rim/2, 0],
      [ROAD_SIGN.height, rim, ROAD_SIGN.height/2, -(width+rim)/2], [ROAD_SIGN.height, rim, ROAD_SIGN.height/2, (width+rim)/2]]) {
      box(rimDepth, h, w, this.rim, 0, y, z).castShadow = false;
    }
    this.support = new THREE.Group(); this.root.add(this.support);
    const pole = box(.13, 6.4, .13, metal, 0, -1.45, 5.2); this.support.add(pole);
    const arm = box(.13, .13, 5.3, metal, 0, ROAD_SIGN.height+.2, 2.6); this.support.add(arm);
    const arrow = new THREE.Shape(); arrow.moveTo(-.5, -.1); arrow.lineTo(.12, -.1); arrow.lineTo(.12, -.27);
    arrow.lineTo(.5, 0); arrow.lineTo(.12, .27); arrow.lineTo(.12, .1); arrow.lineTo(-.5, .1); arrow.closePath();
    const geometry = new THREE.ShapeGeometry(arrow); this.geometries.add(geometry);
    for (const side of [-1, 1]) {
      const mesh = new THREE.Mesh(geometry, this.symbol); mesh.position.set(side*(ROAD_SIGN.thickness/2+.015), ROAD_SIGN.height/2, 0);
      mesh.rotation.y = side*Math.PI/2; this.root.add(mesh);
      mesh.scale.set(width*.65, 1.5, 1);
    }
    this.root.visible = false; this.tone = null; this.applyTone('blue');
  }
  applyTone(tone) {
    if (this.tone === tone) return;
    const colors = ROAD_SIGN_PALETTE[tone] || ROAD_SIGN_PALETTE.blue; this.tone = tone;
    this.face.color.set(colors.face); this.symbol.color.set(colors.symbol);
    this.rim.color.set(colors.rim).multiplyScalar(ROAD_SIGN_RIM_INTENSITY);
  }
  update(game) {
    const frame = game.active && game.roundStage !== 'ready'
      ? game.roadSigns.entries().map(entry => roadSignFrame(entry, game.roadSigns.presentationTime(), game.homeTruck, this.road))
        .find(frame => frame?.phase === 'passing') : null;
    this.root.visible = !!frame;
    for (const player of game.players) if (player.state === 'fallen' && player.deathCause === 'road-sign') {
      player.root.visible = !!frame && player.roadSignAttachment?.id === frame.id && player.occupied !== false && player.sceneReady !== false;
    }
    if (!frame) return;
    this.root.position.set(frame.x, frame.y, frame.z); this.support.scale.z = frame.side;
    this.applyTone(roadSignTone(game.roadSigns.definitions, frame.id));
    for (const player of game.players) if (player.state === 'fallen' && player.roadSignAttachment?.id === frame.id) {
      // Reattach presentation after prediction/interpolation. Rule positions and death are untouched.
      player.root.position.copy(this.root.position).add(this.attachmentOffset.fromArray(player.roadSignAttachment.offset));
      player.yawG.rotation.y = Math.PI;
    }
  }
  registerReadiness(readiness) {
    // Dedicated sample stays near the camera for real shadow/post warmup; never remove the live sign.
    const sample = this.root.clone(true); sample.position.set(0, 3, 0); sample.visible = true; readiness.addSample(sample);
  }
  dispose() { this.root.removeFromParent(); for (const g of this.geometries) g.dispose(); for (const m of this.materials) m.dispose(); }
}
