const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual movement methods without constructing a WebGL scene.
class Vector {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z = 0) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  lengthSq() { return this.x ** 2 + this.y ** 2 + this.z ** 2; }
  normalize() { const l = Math.sqrt(this.lengthSq()) || 1; return this.set(this.x / l, this.y / l, this.z / l); }
  addScaledVector(v, dt) { this.x += v.x * dt; this.y += v.y * dt; this.z += v.z * dt; return this; }
}
const source = fs.readFileSync(path.join(__dirname, '../shared/sim/PlayerMotion.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/^export const /gm, 'const ').replace('export class PlayerMotion', 'class Player');
const Player = vm.runInNewContext(`${source}\nPlayer`, {
  C: { catchSeconds: 0.25, soapSlipCooldown: 0.35 }, THREE: { Vector3: Vector }, damp: (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt)),
  STAND: { propTolerance: 0.08, headRadius: 0.42, landWindow: 0.3 }, solidUnder: () => -1, solidTopY: () => 0, SOLID_RADIUS: 0.36, K: 0.8, WALK_SPEED_SCALE: 0.8,
  // Ladders and air abilities live in their own modules (Ladder.js, AirAbilities.js); flat-roof walking never reaches them.
  ladderAt: () => -1, grabLadder: () => false, updateLadder: () => false, refillAir: () => {}, glide: () => false, flap: () => false,
  incapacitated: (p) => p.downRemaining > 0 || p.stunRemaining > 0, shockStun: () => false, tickWobble: () => {}, resetWobble: () => {},
});
const truck = { vel: new Vector(), pos: new Vector(), topY: 3, halfWidth: 1.3, spec: { x0: -5.5, x1: 4.9, top: 3 }, platformAt: () => ({ name: 'box' }),
  platformTop: () => 3, platTopY: () => 3, topYAt: () => 3, localTopForLocal: () => 3, platforms: [] };
const camera = { getWorldDirection: (v) => v.set(0, 0, -1) };
const dt = 1 / 120;
function createPlayer() {
  return Object.assign(Object.create(Player.prototype), {
    state: 'ground', ground: { truck }, takeoff: truck, pos: new Vector(0, 3, 0), vel: new Vector(),
    airBase: new Vector(), externalVelocity: new Vector(), _fwd: new Vector(), dashDirection: new Vector(1, 0, 0),
    yaw: 0, dashRemaining: 0, dashCooldown: 0, jumpBoost: 0, jumpBuf: 0, coyote: 0, sqV: 0, speedScale: 1, wall: null, wallTime: 0, wallLock: 0,
    events: [], emit(name) { this.events.push(name); }, animate() {},
  });
}
function step(player, hits = [], axis = { x: 1, y: 0 }) {
  player.update(dt, 0, { axis: () => axis, hit: (key) => hits.includes(key) }, [truck], camera, 30);
}
function jumpDistance(hits) {
  const p = createPlayer();
  step(p, hits);
  assert.equal(p.state, 'air');
  for (let n = 0; n < 150 && p.state === 'air'; n++) step(p);
  assert.equal(p.state, 'ground', 'jump lands on the moving-platform path');
  return p.pos.x;
}
const ordinary = jumpDistance(['Space']);
for (const key of ['ShiftLeft', 'ShiftRight']) {
  assert.equal(jumpDistance([key, 'Space']), ordinary, `${key} cannot change a normal jump`);
  const grounded = createPlayer();
  step(grounded, [key]);
  assert.ok(Math.abs(grounded.pos.x - 5.5 * 0.8 * 0.8 * dt) < 1e-12, `${key} keeps normal ground movement (walk at character scale x walk scale)`);
  assert.equal(grounded.dashRemaining, 0);
  assert.ok(!grounded.events.includes('dash'));
  const airborne = createPlayer();
  step(airborne, ['Space']); step(airborne, [key]);
  assert.equal(airborne.jumpBoost, 0, `${key} cannot grant an airborne boost`);
  assert.ok(!airborne.events.includes('dash'));
}
const slipping = createPlayer();
assert.equal(slipping.slip(), true, 'soap can still trigger the shared impulse');
step(slipping);
assert.ok(slipping.pos.x > 5.5 * dt, 'soap slip still moves faster');
assert.equal(slipping.slip(), false, 'slip cooldown still blocks repeated hits');
step(slipping, ['Space']);
assert.ok(slipping.jumpBoost > 0, 'jumping during a soap slip keeps its momentum');
assert.ok(slipping.events.includes('dash'), 'slip still emits the existing presentation event');
console.log(`PASS Shift disabled on ground/in air; normal jump ${ordinary.toFixed(2)}, soap impulse and landing preserved`);
