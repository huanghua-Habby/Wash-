/** Dev-only hover-vehicle preview: each order type docked beside the player washer at roof level. ?type=pod&cam=side */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Lighting } from '../render/Lighting.js';
import { Truck } from '../world/Truck.js';
import { PAL } from '../../../shared/sim/palette.js';
import { WASH_CONFIG as C } from '../../../shared/sim/washConfig.js';
import { FIRST_LEVEL_ID, getLevel } from '../../../shared/levels.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color(PAL.bg);
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
const lighting = new Lighting(scene); lighting.follow(new THREE.Vector3());
const road = new THREE.Mesh(new THREE.PlaneGeometry(200, 60), new THREE.MeshLambertMaterial({ color: PAL.road }));
road.rotation.x = -Math.PI / 2; road.receiveShadow = true; scene.add(road);

const level = getLevel(FIRST_LEVEL_ID);
const { palette, ...homeOptions } = level.home.vehicles[0];
const washer = new Truck(PAL[palette], homeOptions);
scene.add(washer.group);
const only = params.get('type');
const orders = level.orders.vehicles.filter((entry) => !only || entry.type === only).map(({ palette: p, ...options }, index) => {
  const truck = new Truck(PAL[p], { name: '订单车', phase: index, ...options });
  scene.add(truck.group);
  return truck;
});
// Washer in front, every order type in a row behind it at the roof height the game aligns to.
let x = -((orders.length - 1) * 15) / 2;
washer.group.position.set(0, washer.spec.hover, 6);
orders.forEach((truck) => {
  truck.group.position.set(x, washer.pos.y + washer.topLocal - truck.topLocal, 0);
  x += 15;
});
[washer, ...orders].forEach((truck) => { truck.syncHover(); truck.group.traverse((o) => { if (o.isMesh) o.castShadow = true; }); });
// Player roof reference line.
const roofLine = new THREE.Mesh(new THREE.BoxGeometry(90, 0.04, 0.04), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
roofLine.position.set(0, washer.topY, -2); scene.add(roofLine);

const side = params.get('cam') === 'side';
camera.position.set(side ? 0 : -30, side ? 6 : 34, side ? 70 : 40);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 2.5, 0); controls.update();
function frame() {
  const w = innerWidth, h = innerHeight;
  if (canvas.width !== w * renderer.getPixelRatio()) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  renderer.render(scene, camera); requestAnimationFrame(frame);
}
frame();
