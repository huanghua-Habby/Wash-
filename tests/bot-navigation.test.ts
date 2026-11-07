import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TruckState } from '../shared/sim/TruckState.js';
import { PlayerMotion, MOTION } from '../shared/sim/PlayerMotion.js';
import { packetInput } from '../shared/protocol.js';
import { BotMotor } from '../shared/sim/bots/BotMotor.js';
import { jumpReach, airTime, navRegions, planRoute, regionAt } from '../shared/sim/bots/BotNavigation.js';
import { getLevel } from '../shared/levels.js';
import { Simulation } from './fixtures/Simulation.js';

const dt = 1 / 60, camera = { getWorldDirection: (v: THREE.Vector3) => v.set(0, 0, -1) };

/** A static test layout of any vehicles, a player on the first, and the bot motor driving that player's inputs. */
function layout(specs: { type: string; x?: number; z?: number; y?: number }[]) {
  const scene = new THREE.Scene();
  const trucks = specs.map(({ type, x = 0, z = 0, y }) => {
    const truck = new TruckState(new THREE.Color(), { name: `${type}@${x},${z}`, type }); scene.add(truck.group);
    truck.setState(x, z, 0, 0, 30); if (y !== undefined) truck.setAltitude(y); truck.pose(0); return truck;
  });
  scene.updateMatrixWorld(true);
  const player = new PlayerMotion(scene); player.homeLocal = new THREE.Vector3(-2, 0, 0); player.spawn(trucks[0]);
  for (let i = 0; i < 90; i++) player.update(dt, i * dt, packetInput({ seq: 1, move: [0, 0], axis: [0, 0], down: [], hits: [] }), trucks, camera, 30);
  const motor = new BotMotor();
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * 60; i++) {
      const intent = motor.update(player, trucks, dt);
      player.update(dt, i * dt, packetInput({ seq: 1, move: [intent.move.x, intent.move.z], axis: [0, 0], down: intent.jump ? ['Space'] : [], hits: intent.jump ? ['Space'] : [] }), trucks, camera, 30);
      if (motor.status === 'arrived' || motor.status === 'unreachable' || player.state === 'fallen') break;
    }
  };
  return { trucks, player, motor, run };
}

test('jump reach comes from the shared jump physics with a safety margin', () => {
  assert.ok(Math.abs(airTime(0)! - 2 * MOTION.jump / MOTION.gravity) < 1e-9);
  assert.ok(jumpReach(0) > 1.4 && jumpReach(0) < MOTION.speed * airTime(0)!, 'flat jumps reach about 1.6 m (character-scaled motion)');
  assert.ok(jumpReach(1) < jumpReach(0) && jumpReach(-2) > jumpReach(0), 'stepping up shortens and down lengthens the reach');
  assert.equal(jumpReach(1.6), 0, 'a step near the jump apex is never attempted');
  assert.ok(jumpReach(0, 1.25) > jumpReach(0), 'faster animals reach further');
});

test('bot motor crosses a gap with a step up, takes a big step down, and walks around a roof prop', () => {
  // Washer hull half-width 1.7, pod 1.1: a 1.1 m hull gap, and the pod roof about 0.5 m higher (character-scaled jump).
  const up = layout([{ type: 'washer' }, { type: 'pod', z: 1.7 + 1.1 + 1.1, y: 1.5 + 3 - 1.5 + 0.5 }]);
  const [, pod] = up.trucks;
  up.motor.setGoal(pod, 0, 0); up.run(8);
  assert.equal(up.motor.status, 'arrived'); assert.equal(up.player.ground?.truck, pod, 'landed on the higher, separate vehicle');
  const down = layout([{ type: 'bus', y: 1 }, { type: 'pod', z: 1.45 + 1 + 1.1, y: 0.9 }]); // about a 2.3 m drop
  down.motor.setGoal(down.trucks[1], 0.5, 0); down.run(8);
  assert.equal(down.player.ground?.truck, down.trucks[1], 'jumped down onto a much lower roof');
  const prop = layout([{ type: 'washer' }]);
  const [washer] = prop.trucks;
  (washer as any).solids = [{ x: -2, z: 0, hx: 0.52, hz: 0.55, height: 1.05, active: true }];
  prop.player.pos.set(washer.pos.x - 4.5, washer.topY, washer.pos.z); prop.player.ground = { truck: washer, plat: washer.platforms[0] };
  prop.motor.setGoal(washer, 0.5, 0); prop.run(6);
  assert.equal(prop.motor.status, 'arrived'); assert.notEqual(prop.player.state, 'fallen');
});

test('a gap beyond the jump reach is reported unreachable and the bot stays put', () => {
  const far = layout([{ type: 'washer' }, { type: 'pod', z: 1.7 + 4.5 + 1.1, y: 3 }]);
  far.motor.setGoal(far.trucks[1], 0, 0); far.run(3);
  assert.equal(far.motor.status, 'unreachable'); assert.equal(far.player.state, 'ground'); assert.equal(far.player.ground?.truck, far.trucks[0]);
  const regions = navRegions(far.trucks);
  assert.equal(planRoute(regions, regions[0], regionAt(regions, far.trucks[1], far.trucks[1].pos.x, far.trucks[1].pos.z)), null);
});

test('in the versus world a bot jumps to its docked order truck and back to the central truck', () => {
  const sim = new Simulation(getLevel('versus-01') as any);
  try {
    sim.placeBots([{ slot: 1, team: 0 }]);
    sim.phase = 'game'; sim.game.start(30);
    const order = sim.game.spawnOrder(0, { side: -1 });
    for (let i = 0; i < 60 * 12 && order.arrivalProgress < 1; i++) sim.tick();
    assert.equal(order.arrivalProgress, 1, 'the order docked');
    // Motor-only check: the work-loop brain would otherwise choose its own goals.
    const controller = sim.bots.controller(1); controller.brain = null; controller.motor.profile = null; // exact jumps, no human misjudge
    const bot = sim.players[1], motor = controller.motor, stain = order.stains[0];
    motor.setGoal(order.truck, stain.position[0], stain.position[1]);
    for (let i = 0; i < 60 * 10 && motor.status !== 'arrived'; i++) sim.tick();
    assert.equal(motor.status, 'arrived'); assert.ok(bot.ground?.truck === order.truck, 'standing on its order roof');
    motor.setGoal(sim.trucks[0], 0, 0);
    for (let i = 0; i < 60 * 10 && motor.status !== 'arrived'; i++) sim.tick();
    assert.ok(bot.ground?.truck === sim.trucks[0], 'back on the central truck'); assert.notEqual(bot.state, 'fallen');
  } finally { sim.dispose(); }
});
