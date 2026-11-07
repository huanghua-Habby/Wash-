/** Dev-only close-up of the wash tools: station, supply tap, soap crate, soap, towel, water gun and the EV charging set. ?cam=top|ev */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Lighting } from '../render/Lighting.js';
import { PAL } from '../../../shared/sim/palette.js';
import { buildSoapBox, buildSupplyPoint, buildWashStation, buildChargingPost, buildChargePort, buildChargingGun } from '../../../shared/sim/ToolModels.js';
import { Soap } from '../../../shared/sim/Soap.js';
import { Towel } from '../../../shared/sim/Towel.js';
import { WaterGun } from '../../../shared/sim/WaterGun.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = !params.has('noshadow'); renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color(PAL.bg);
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
const lighting = new Lighting(scene); lighting.follow(new THREE.Vector3());
const deck = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), new THREE.MeshLambertMaterial({ color: '#f3e6c4' }));
deck.rotation.x = -Math.PI / 2; deck.receiveShadow = true; scene.add(deck);

// Items are placed on a stand-in roof at y = 0, exactly like they sit on the washer.
const roof = { body: new THREE.Group(), topLocal: 0 }; scene.add(roof.body);
const at = (x, z) => new THREE.Vector3(x, 0, z);
const station = buildWashStation(); station.position.set(-2.4, 0, 0); scene.add(station);
const tap = buildSupplyPoint(0.77); tap.position.set(-1.1, 0.77, 0.9); scene.add(tap);
const crate = buildSoapBox(); crate.position.set(-0.9, 0.3, -0.6); scene.add(crate);
const soap = new Soap(scene, roof, at(0.4, -0.5), 0); soap.activate();
const towel = new Towel(scene, roof, at(0.4, 0.6), 0); towel.mesh.visible = true;
const gun = new WaterGun(scene, roof, at(1.7, 0), 0); gun.mesh.visible = true;
const glb = params.has('glb');
if (glb) new GLTFLoader().loadAsync(new URL('../../assets/unity/watergun.glb', import.meta.url).href).then(({ scene: model }) => {
  for (const child of gun.mesh.children) child.visible = false;
  gun.mesh.add(model);
});
const big = new THREE.Group(); scene.add(big); // Water gun at 3x for detail checks.
const bigGun = new WaterGun(scene, { body: big, topLocal: 0 }, at(0, 0), 1); bigGun.mesh.visible = true;
big.position.set(3.3, 0.1, 0); big.scale.setScalar(3);
// EV charging set behind the tools: post (outlet 0.25 above the roof), a 2x connector and an order-vehicle port.
const post = buildChargingPost(0.25); post.position.set(1.2, 0.25, -1.9); scene.add(post);
const plug = buildChargingGun(); plug.position.set(0.3, 0.3, -1.9); plug.scale.setScalar(2); scene.add(plug);
const port = buildChargePort(); port.position.set(2.3, 0.13, -1.9); scene.add(port);
scene.traverse((node) => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
deck.castShadow = false;

const view = params.get('cam');
camera.position.set(...(view === 'top' ? [0.5, 9, 4] : view === 'gun' ? [3.6, 1.6, 3.2] : view === 'station' ? [-1.4, 2.2, 2.6] : view === 'sink' ? [-2.4, 1.9, 0.6] : view === 'mid' ? [-0.2, 1.8, 2.6] : view === 'back' ? [0.6, 1.6, -2.4] : view === 'ev' ? [-0.6, 1.5, 0.4] : [0.4, 3.4, 6.2]));
const controls = new OrbitControls(camera, canvas);
controls.target.set(...(view === 'gun' ? [3.4, 0.6, 0] : view === 'station' ? [-2.4, 0.7, 0] : view === 'sink' ? [-2.4, 0.6, 0.05] : view === 'mid' ? [-0.3, 0.3, 0] : view === 'back' ? [-0.8, 0.3, 0] : view === 'ev' ? [1.2, 0.4, -1.9] : [0.4, 0.4, 0])); controls.update();
function frame() {
  const w = innerWidth, h = innerHeight;
  if (canvas.width !== w * renderer.getPixelRatio()) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  renderer.render(scene, camera); requestAnimationFrame(frame);
}
frame();
document.body.classList.add('preview-ready');
