/** Versus hack console (HACK_CONSOLE.md): host-owned typing, one hacker at a time, a weighted effect on the enemy's
 * docked truck, the reboot, the snapshot and the open effect registry. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../shared/sim/RoomSimulation.js';
import { getLevel } from '../shared/levels.js';
import { applyWorld } from '../shared/snapshot.js';
import { quantize } from '../shared/delta.js';
import { HACK } from '../shared/sim/HackConsole.js';
import { hackEffect, pickHackEffect, registerHackEffect, hackEffects } from '../shared/sim/HackEffects.js';
import { STAT_KEYS } from '../shared/sim/PlayerStats.js';

const dt = 1 / 60;
let seq = 0;
const send = (sim: any, slot: number, down: string[] = [], hits: string[] = down) => sim.input(slot, { seq: ++seq, move: [0, 0], axis: [0, 0], down, hits });

/** Red 0 and blue 1 (plus more seats alternating), both team trucks docked. */
function versus(count = 2) {
  const sim = new Simulation(getLevel('versus-01')!);
  for (let slot = 0; slot < count; slot++) { sim.occupy(slot, true); sim.setTeam(slot, slot % 2); }
  sim.phase = 'game'; sim.game.start(sim.director.base);
  for (let i = 0; !(sim.game.orders.length === 2 && sim.game.orders.every((o: any) => o.arrivalProgress === 1)) && i < 1200; i++) sim.tick();
  return sim;
}
/** Stand `player` on the home roof at (`dx`, `dz`) from the console (default: at the keyboard, on its tail side). */
function atConsole(sim: any, player: any, dx = -0.75, dz = 0) {
  const home = sim.game.homeTruck, [cx, cz] = HACK.position, x = home.pos.x + cx + dx, z = home.pos.z + cz + dz;
  player.pos.set(x, home.topYAt(x, z), z); player.vel.set(0, 0, 0); player.externalVelocity.set(0, 0, 0);
  player.state = 'ground'; player.ground = { truck: home, plat: home.platformAt(x, z, 0), solid: -1, stand: -1, offset: { x: 0, z: 0 } };
  player.yaw = dz ? -Math.sign(dz) * Math.PI / 2 : dx < 0 ? 0 : Math.PI;
}
const enemyOf = (sim: any, team: number) => sim.game.orders.find((o: any) => o.team !== team);
/** Hold J for `seconds`, keeping the player parked beside the console. */
function type(sim: any, slot: number, seconds: number) {
  for (let i = 0; i < Math.round(seconds / dt); i++) { send(sim, slot, ['KeyJ'], i ? [] : ['KeyJ']); sim.tick(); }
}

test('the console shows only in a versus match, on the cab roof beside the charging cable, and is solid', () => {
  const coop = new Simulation(getLevel('highway-02')!); try {
    coop.occupy(0, true); coop.phase = 'game'; coop.game.start(coop.director.base);
    assert.equal(coop.game.hackConsole.group.visible, false, 'co-op never shows it');
  } finally { coop.dispose(); }
  const sim = versus(); try {
    const g: any = sim.game;
    assert.equal(g.hackConsole.group.visible, true);
    const cab = g.homeTruck.spec.platforms.find((p: any) => p.name === 'cab');
    assert.ok(HACK.position[0] > cab.x0 && HACK.position[0] < cab.x1 && Math.abs(HACK.position[1]) < cab.z1, 'on the cab roof (the top of the screen)');
    assert.ok(g.homeTruck.solids.some((solid: any) => solid.x === HACK.position[0] && solid.active), 'a solid prop');
    g.stop(); assert.equal(g.hackConsole.group.visible, false, 'hidden once the match stops');
  } finally { sim.dispose(); }
});

test('holding J fills the team bar in HACK.seconds, fires one effect on the enemy truck, reboots and scores a hack', () => {
  const sim = versus(); try {
    const g: any = sim.game, hacker = sim.players[0], hc = g.hackConsole;
    atConsole(sim, hacker);
    send(sim, 0); sim.tick(); assert.equal(hacker.interactionHint, 'J 骇入', 'walking up shows the J prompt');
    assert.equal(HACK.cooldownSeconds, 10);
    const before = sim.urgentSignature();
    type(sim, 0, 1);
    assert.equal(hc.slot, 0); assert.equal(hacker.useAction, 'hack', 'typing pose for every page');
    assert.ok(Math.abs(hc.progress[0] - 1 / HACK.seconds) < 0.02); assert.equal(hc.progress[1], 0);
    assert.notEqual(sim.urgentSignature(), before, 'a new hacker is sent at once');
    assert.match(hacker.interactionHint, /^骇入中 \d+%$/);
    const target = enemyOf(sim, 0);
    type(sim, 0, HACK.seconds);
    assert.equal(hc.serial, 1); assert.equal(hc.last.team, 0); assert.equal(hc.last.target, target.serial);
    assert.ok(hackEffect(hc.last.effect), 'a registered effect');
    assert.equal(hc.progress[0], 0); assert.equal(hc.slot, -1);
    assert.ok(hc.cooldown > HACK.cooldownSeconds - 7, 'rebooting');
    assert.ok(STAT_KEYS.includes('hacks')); assert.equal(g.stats[0].hacks, 1, 'counted in the match record');
    // Rebooting: holding J does nothing and says so.
    type(sim, 0, 1); assert.equal(hc.serial, 1); assert.match(hacker.interactionHint, /^黑客台重启中 \d+s$/);
  } finally { sim.dispose(); }
});

test('one hacker at a time; walking away (or being slapped away) stops it and an idle bar drains', () => {
  const sim = versus(3); try {
    const g: any = sim.game, hc = g.hackConsole, [red, blue, red2] = sim.players;
    atConsole(sim, red); atConsole(sim, blue, 0.75, 0);
    type(sim, 0, 1);
    send(sim, 0, ['KeyJ'], []); send(sim, 1, ['KeyJ']); sim.tick();
    assert.equal(hc.slot, 0); assert.equal(hc.progress[1], 0, 'blue cannot type while red holds the keyboard');
    assert.equal(blue.interactionHint, '黑客台被占用：拍走对方！');
    assert.equal(blue.slapSerial, 0, 'J beside the console never slaps');
    const kept = hc.progress[0];
    // Red is shoved out of reach: the seat frees and red's bar drains slowly.
    atConsole(sim, red, -3, 0); send(sim, 0, ['KeyJ'], []); send(sim, 1, [], []); sim.tick();
    assert.equal(hc.slot, -1);
    for (let i = 0; i < 60; i++) { send(sim, 0, [], []); sim.tick(); }
    assert.ok(hc.progress[0] < kept && hc.progress[0] > kept - HACK.decayPerSecond * 1.2, 'drains at decayPerSecond');
    // Red's teammate takes over red's bar where it stands.
    atConsole(sim, red2); const resumed = hc.progress[0]; type(sim, 2, 0.5);
    assert.ok(hc.progress[0] > resumed, 'one bar per team, shared by its members');
    assert.equal(sim.players[2].team, 0);
  } finally { sim.dispose(); }
});

test('no enemy truck docked: nothing to hack', () => {
  const sim = versus(); try {
    const g: any = sim.game, hc = g.hackConsole;
    enemyOf(sim, 0).mode = 'leaving';
    atConsole(sim, sim.players[0]); type(sim, 0, 1);
    assert.equal(hc.progress[0], 0); assert.equal(sim.players[0].interactionHint, '对面暂无车辆可骇入');
  } finally { sim.dispose(); }
});

test('built-in effects: grime reopens washed stains (points back off), runaway drives the truck off, blast throws its riders', () => {
  const sim = versus(); try {
    const g: any = sim.game, order = enemyOf(sim, 0), ctx = { game: g, order, truck: order.truck, team: 0, hacker: sim.players[0], random: () => 0.5 };
    // Blue washed the towel-only stain; another is mid-rinse.
    const [dust, mud] = order.stains;
    dust.done = true; dust.stage = 0; dust.progress = 1; dust.points = 10; g.teamScores[1] = 10;
    mud.stage = 0; mud.progress = 0.5;
    hackEffect('grime')!.apply(ctx);
    assert.equal(dust.done, false); assert.equal(dust.progress, 0); assert.equal(g.teamScores[1], 0, 'its points come back off');
    assert.equal(mud.progress, 0);
    // A rider on the blue truck is thrown by the blast.
    const rider = sim.players[1], truck = order.truck;
    rider.pos.set(truck.pos.x, truck.topY, truck.pos.z + 0.5); rider.state = 'ground';
    rider.ground = { truck, plat: truck.platforms[0], solid: -1, stand: -1, offset: { x: 0, z: 0 } };
    hackEffect('blast')!.apply(ctx);
    assert.equal(rider.state, 'air'); assert.ok(rider.externalVelocity.length() > 1);
    hackEffect('runaway')!.apply(ctx);
    assert.equal(order.mode, 'leaving'); assert.equal(order.paid, false, 'never counts as washed');
  } finally { sim.dispose(); }
});

test('hack state round-trips through the snapshot', () => {
  const host = versus(), view = versus(); try {
    atConsole(host, host.players[0]); type(host, 0, 2);
    const data = quantize(host.snapshot()) as any;
    (view.game as any).viewOnly = true;
    applyWorld({ game: view.game, trucks: view.trucks, players: view.players }, data);
    assert.deepEqual(quantize((view.game as any).hackConsole.capture()), data.game.hack);
    assert.equal(data.game.hack.slot, 0);
  } finally { host.dispose(); view.dispose(); }
});

test('the effect registry is open: a new effect registers once, weights pick deterministically', () => {
  let applied = 0;
  registerHackEffect('test-noop', { label: '测试', weight: 0, apply() { applied++; } });
  assert.throws(() => registerHackEffect('test-noop', { label: '测试', apply() {} }), /duplicate/);
  assert.throws(() => registerHackEffect('test-bad', { label: '', apply() {} } as any));
  assert.ok(hackEffects().some(effect => effect.id === 'test-noop'));
  for (let i = 0; i < 50; i++) assert.notEqual(pickHackEffect(() => i / 50)!.id, 'test-noop', 'weight 0 is never picked');
  assert.equal(pickHackEffect(() => 0)!.id, hackEffects().find(effect => effect.weight > 0)!.id);
  assert.equal(applied, 0);
});

test('a squirrel jumping up to the console lands beside it instead of clinging to its side, then hacks', () => {
  const sim = versus(); try {
    const g: any = sim.game, hc = g.hackConsole, squirrel = sim.players[0], home = g.homeTruck;
    sim.setAnimal(0, 'squirrel');
    // Coming down onto the roof toward the keyboard side (state taken from a run-and-jump that grabbed it before the fix).
    atConsole(sim, squirrel, -0.97, -0.28);
    squirrel.state = 'air'; squirrel.ground = null; squirrel.pos.y += 0.28; squirrel.vel.set(home.vel.x + 3.67, -6.56, home.vel.z + 1.19);
    let clungToConsole = false;
    for (let i = 0; i < 90 && squirrel.state !== 'ground'; i++) {
      send(sim, 0); send(sim, 1); sim.tick();
      if (squirrel.wall && home._wallBoxes?.[squirrel.wall.box]?.solid?.x === HACK.position[0]) clungToConsole = true;
    }
    assert.equal(clungToConsole, false, 'the console side is no squirrel wall');
    assert.equal(squirrel.ground?.truck, home); assert.ok(hc.inRange(squirrel), 'landed on the cab roof beside the console');
    type(sim, 0, 1);
    assert.ok(hc.progress[0] > 0.15, 'J hacks as for any animal');
  } finally { sim.dispose(); }
});

test('home menu (versus room): hacking the terminal sends the partner truck away; a fresh one drives in after 2 s; same reboot', () => {
  const sim: any = new Simulation(getLevel('versus-01')!);
  try {
    sim.occupy(0, true); sim.setTeam(0, 1); sim.tick();
    const g: any = sim.game, hc = g.hackConsole, partner = sim.trucks[1], hacker = sim.players[0];
    assert.equal(sim.phase, 'home'); assert.ok(g.practice); assert.ok(hc.live(), 'the home practice terminal is live');
    atConsole(sim, hacker);
    const startX = partner.pos.x - g.homeTruck.pos.x;
    type(sim, 0, HACK.seconds + 0.1);
    assert.equal(hc.serial, 1); assert.equal(hc.cooldown > 0, true); assert.equal(hc.last.effect, 'practice-away');
    assert.ok(sim.director.away > 0, 'sent away');
    for (let i = 0; i < 60; i++) sim.tick();
    assert.ok(partner.pos.x - g.homeTruck.pos.x > startX + 15, 'it sped off forward');
    const generation = partner.generation || 0;
    for (let i = 0; i < 70; i++) sim.tick();
    assert.equal(sim.director.away, 0);
    assert.equal(sim.snapshot().trucks[1].generation, generation + 1, 'the re-entry is a new generation, so viewers snap instead of sweeping it across the screen');
    assert.ok(partner.pos.x - g.homeTruck.pos.x < -20, 'a fresh partner enters from behind');
    assert.equal(g.stats?.[0]?.hacks || 0, 0, 'no score at home');
  } finally { sim.dispose(); }
});
