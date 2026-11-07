/** Dev-only cat/dog preview: every gameplay animation on demand. ?anim=walk&slot=0&animal=dog|pelican|elephant|squirrel&pouch=1&cam=close&t=1.2 for screenshots.
 * anim=cling shows a squirrel sliding down a wall; ?slide=0..1 freezes the slide speed for stills. */
import * as THREE from 'three';
import GUI from 'lil-gui';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Lighting } from '../render/Lighting.js';
import { Player } from '../game/Player.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { holdPoint } from '../../../shared/sim/CarryItem.js';
import { GUN_SCALE } from '../../../shared/sim/WaterGun.js';
import { animalInfo } from '../../../shared/avatar.js';
import { WALL_GAP } from '../../../shared/sim/WallCling.js';
import { WASH_CONFIG } from '../../../shared/sim/washConfig.js';

const gunModel = (await new GLTFLoader().loadAsync(new URL('../../assets/unity/watergun.glb', import.meta.url).href)).scene;

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#79a884');
const camera = new THREE.PerspectiveCamera(params.get('cam') === 'game' ? 29 : 32, 1, 0.1, 200);
const lighting = new Lighting(scene); lighting.follow(new THREE.Vector3());

const roof = new THREE.Mesh(new THREE.BoxGeometry(7, 0.3, 3.2), new THREE.MeshLambertMaterial({ color: '#e9e2d3' }));
roof.position.y = -0.15; roof.receiveShadow = true; scene.add(roof);
const stain = new THREE.Mesh(new THREE.CircleGeometry(0.3, 24), new THREE.MeshLambertMaterial({ color: '#756141' }));
stain.rotation.x = -Math.PI / 2; stain.position.set(0.55, 0.005, 0); scene.add(stain);
// Hull side for the squirrel cling preview, behind the squirrel as seen from the preview cameras; it faces -z into it.
const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 3.2, 0.12), new THREE.MeshLambertMaterial({ color: '#c9d8e6' }));
wall.position.set(0, 1.3, -WALL_GAP - 0.06); wall.receiveShadow = true; wall.visible = false; scene.add(wall);

const ANIMS = ['idle', 'walk', 'dash', 'jump', 'fall', 'carry', 'wipe', 'soap', 'wash', 'spray', 'trunk', 'charge', 'throw', 'pushed', 'slip', 'fallen', 'cling'];
const state = { anim: params.get('anim') || 'idle', slot: Number(params.get('slot') || 0), turntable: params.get('spin') === '1', speed: 1, lineup: params.get('lineup') === '1' };

const fakeTools = {
  towel: () => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.09, 0.43), new THREE.MeshLambertMaterial({ color: '#f7f2e6' })); m.rotation.z = -0.25; return m; },
  soap: () => new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.18, 0.38), new THREE.MeshLambertMaterial({ color: '#f2a9c4' })),
  water: () => { const g = gunModel.clone(true); g.scale.setScalar(GUN_SCALE); return g; },
};

let cats = [];
function spawn() {
  cats.forEach((c) => { scene.remove(c.player.root); });
  const slots = state.lineup ? [0, 1, 2, 3] : [state.slot];
  cats = slots.map((slot, i) => {
    const player = new Player(scene, { slot });
    const animal = animalInfo(params.get('animal'));
    if (animal) player.setAppearance({ animal: animal.id, breed: animal.breeds[slot % animal.breeds.length].id, color: slot % 4 });
    // ?pouch=1 previews a pelican holding a teammate, ?pouch=tool a swallowed tool.
    if (params.get('pouch')) player.swallowed = params.get('pouch') === 'tool' ? { kind: 'soap' } : {};
    player.root.position.set(0, 0, (i - (slots.length - 1) / 2) * 1.3);
    player.root.traverse((o) => { if (o.isMesh) o.castShadow = o.castShadow; });
    player.state = 'ground'; player.yaw = 0;
    player.ground = { truck: { vel: new THREE.Vector3() } };
    return { player, base: player.root.position.clone(), tool: null, kind: null, toolMesh: null };
  });
}
spawn();

function setTool(cat, kind) {
  if (cat.kind === kind) return;
  if (cat.tool) cat.player.yawG.remove(cat.tool.mesh);
  cat.kind = kind; cat.tool = null; cat.player.heldTool = null;
  if (!kind) return;
  const mesh = new THREE.Group(); mesh.add(fakeTools[kind]()); mesh.position.set(...holdPoint(kind), 0);
  mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  cat.tool = { kind, mesh, charge: 0, flight: false };
  cat.player.yawG.add(mesh); cat.player.heldTool = cat.tool;
}

let clock = Number(params.get('t') || 0);
function drive(cat, dt) {
  const p = cat.player, a = state.anim, t = clock;
  p.useAction = ''; p.dashRemaining = 0; p.slipRemaining = 0; p.externalVelocity.set(0, 0, 0);
  p.state = 'ground'; p.lean.rotation.set(0, 0, 0);
  let x = 0, y = 0, z = 0;
  const tool = { carry: 'towel', wipe: 'towel', wash: 'towel', soap: 'soap', spray: 'water', charge: 'towel', throw: 'towel' }[a] || null;
  if (a === 'throw') {
    const cycle = t % 2.2;
    setTool(cat, cycle < 1.4 ? 'towel' : null);
    if (cat.tool) cat.tool.charge = Math.max(0, cycle - 0.2);
    else { const last = cat.player.visual.held; if (last) last.flight = true; }
  } else setTool(cat, tool);
  if (a === 'charge' && cat.tool) cat.tool.charge = Math.min(1, (t % 2) * 0.8);
  if (a === 'walk' || a === 'dash') {
    const r = 1.6, w = a === 'dash' ? 12 / r : 5.5 / r;
    x = Math.cos(t * w) * r - r; z = Math.sin(t * w) * r;
    p.yaw = Math.atan2(-Math.cos(t * w), -Math.sin(t * w));
    if (a === 'dash') p.dashRemaining = 0.1;
  }
  if (a === 'jump' || a === 'fall') {
    const period = a === 'jump' ? 1.0 : 1.8, c = t % period, vy0 = 10;
    const height = a === 'jump' ? Math.max(0, vy0 * c - 14 * c * c) : Math.max(0, 3.2 - 14 * c * c * 0.5);
    p.state = height > 0.001 ? 'air' : 'ground';
    p.ground = p.state === 'ground' ? { truck: { vel: new THREE.Vector3() } } : null;
    y = height;
    if (p.state === 'ground' && p.visual.lastState === 'air') p.sqV -= 5;
  }
  if (a === 'wipe' || a === 'soap' || a === 'wash' || a === 'spray') p.useAction = a;
  // Elephant trunk jet: 1.6 s bursts with a 0.8 s pause; ?hold=1 keeps it open for stills.
  p.trunk = { spraying: a === 'trunk' && (params.get('hold') === '1' || t % 2.4 < 1.6), water: 1 - (t % 2.4) / 2.4, empty: false };
  if (a === 'pushed') p.externalVelocity.set(-3.5 + Math.sin(t * 3) * 0.6, 0, Math.sin(t * 1.3) * 1.5);
  if (a === 'slip') p.slipRemaining = (t % 1.2) < 0.5 ? 0.1 : 0;
  if (a === 'fallen') { p.state = 'fallen'; p.lean.rotation.z = t * 6; y = 0.4; }
  // Squirrel cling: grab high on the wall, slide down faster and faster over the grip time, then start again.
  wall.visible = a === 'cling';
  p.wall = null;
  if (a === 'cling') {
    const grip = WASH_CONFIG.squirrelGripSeconds, c = params.has('slide') ? Number(params.get('slide')) * grip * 0.8 : t % grip;
    p.state = 'air'; p.ground = null; p.yaw = Math.PI / 2;
    p.wall = { truck: { vel: new THREE.Vector3() }, axis: 'z', side: 1, along: 0, y: 0 };
    // A lineup hangs side by side along the wall instead of one behind another.
    x = cat.base.z - cat.base.x; z = -cat.base.z;
    p.wallTime = c; y = params.has('slide') ? 1.2 : Math.max(0.1, 2.4 - 0.25 * c - 0.225 * c * c - 0.2 * c * c * c);
  }
  if (p.state === 'air') { p.airBase.set(0, 0); }
  if (state.turntable && a !== 'walk' && a !== 'dash') p.yaw = t * 0.6;
  p.yawG.rotation.y = p.yaw;
  // Shared squash spring, as PlayerMotion.animate would run it.
  p.sqV += (-140 * p.sq - 11 * p.sqV) * dt; p.sq += p.sqV * dt;
  p.root.position.set(cat.base.x + x, y, cat.base.z + z);
  p.updateVisual(dt);
}

const gui = new GUI({ title: '猫角色预览' });
gui.add(state, 'anim', ANIMS).name('动画');
gui.add(state, 'slot', [0, 1, 2, 3]).name('毛色').onChange(spawn);
gui.add(state, 'lineup').name('四只并排').onChange(spawn);
gui.add(state, 'turntable').name('旋转');
gui.add(state, 'speed', 0.1, 2, 0.05).name('速度');
if (params.has('nogui')) gui.hide();

const controls = new OrbitControls(camera, canvas);
const camMode = params.get('cam') || 'close';
if (camMode === 'game') camera.position.set(-12, 22, 0).multiplyScalar(0.55);
else if (camMode === 'side') camera.position.set(0.2, 1.0, 4.2);
else if (camMode === 'profile') camera.position.set(4.2, 1.2, 0.6);
else camera.position.set(2.6, 1.6, 2.6);
controls.target.set(0, 0.5, 0); controls.update();

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// Deterministic warm-up so screenshots at ?t= show a settled pose.
const warm = Number(params.get('t') || 0);
if (warm > 0) { clock = 0; for (let i = 0; i < warm * 60; i++) { clock += 1 / 60; cats.forEach((c) => drive(c, 1 / 60)); } }

// Keep the lead cat framed while it runs laps.
const followOffset = camera.position.clone().sub(controls.target);
controls.addEventListener('change', () => followOffset.copy(camera.position).sub(controls.target));
function follow() {
  if (state.lineup) return;
  const p = cats[0].player.root.position;
  controls.target.set(p.x, p.y * 0.8 + 0.5, p.z); camera.position.copy(controls.target).add(followOffset);
}
follow();
const timer = new THREE.Clock();
function frame() {
  const dt = Math.min(1 / 20, timer.getDelta()) * state.speed;
  if (!params.has('freeze')) { clock += dt; cats.forEach((c) => drive(c, dt)); }
  follow();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
window.__catReady = true;
