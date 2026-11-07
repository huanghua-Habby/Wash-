import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { NetworkGame } from '../client/js/online/NetworkGame.js';
import { GameRuntime } from '../client/js/runtime/GameRuntime.js';
import { CFG } from '../client/js/core/config.js';

test('main remains a composition entry with delegation, not algorithms or mutable service internals', () => {
  const source = ts.createSourceFile('main.js', readFileSync(new URL('../client/js/main.js', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const violations: string[] = [];
  const forbidden = new Set([ts.SyntaxKind.IfStatement, ts.SyntaxKind.SwitchStatement, ts.SyntaxKind.ConditionalExpression,
    ts.SyntaxKind.ForStatement, ts.SyntaxKind.ForOfStatement, ts.SyntaxKind.ForInStatement, ts.SyntaxKind.WhileStatement,
    ts.SyntaxKind.DoStatement, ts.SyntaxKind.TryStatement, ts.SyntaxKind.BinaryExpression, ts.SyntaxKind.PrefixUnaryExpression,
    ts.SyntaxKind.PostfixUnaryExpression, ts.SyntaxKind.ClassDeclaration]);
  function visit(node: ts.Node) {
    if (forbidden.has(node.kind)) violations.push(ts.SyntaxKind[node.kind]);
    if (ts.isArrowFunction(node) && !(ts.isCallExpression(node.body) || ts.isBlock(node.body) && node.body.statements.length === 0)) violations.push('inline callback behavior');
    if (ts.isFunctionDeclaration(node) && node.name?.text !== 'boot') violations.push('entry-owned helper');
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['requestAnimationFrame', 'setTimeout', 'setInterval', 'addEventListener'].includes(node.expression.text)) violations.push('entry-owned scheduling/event handler');
    ts.forEachChild(node, visit);
  }
  visit(source); assert.deepEqual(violations, []);
});

test('network owns background handoff: discard stale inputs, release held controls, preserve authoritative world', () => {
  const packets: any[] = []; let clears = 0;
  const connection: any = Object.assign(new EventTarget(), { playing: true, send(type: string, value: any) { packets.push({ type, ...value }); } });
  const input: any = { clear() { clears++; } };
  const network = new NetworkGame({ connection, players: [], trucks: [], game: {}, input, camera: {}, onPhase() {} });
  const world = { phase: 'game', time: 12 }; network.latest = world as any;
  network.pending = [{ seq: 6 }] as any; network.hits.add('KeyJ'); network.accumulator = .015;
  network.seq = 6; network.clockReset = network.renderReset = false;
  network.backgroundModeChanged(true);
  assert.equal(network.latest, world); assert.equal(network.accumulator, 0); assert.deepEqual(network.pending, []); assert.equal(network.hits.size, 0);
  assert.equal(network.clockReset && network.renderReset, true); assert.equal(clears, 1);
  assert.deepEqual(packets, [{ type: 'input', seq: 7, axis: [0, 0], move: [0, 0], down: [], hits: [] }]);
  network.backgroundModeChanged(false); assert.equal(packets.length, 1);
  connection.playing = false; network.backgroundModeChanged(true); assert.equal(packets.length, 1);
});

function runtimeFixture() {
  const calls: string[] = [], visual = { time: 0, cameraReady: false }, context: any = {};
  const record = (name: string) => () => { calls.push(name); };
  const game: any = { paused: false, ended: false, active: false,
    effects: { update(frame: any) { assert.equal(visual.cameraReady, true); context.effects = frame; calls.push('effects'); } } };
  const network: any = { latest: { base: 30 }, phase: 'transition', homeHold: false, renderTime: 17.3, renderScroll: 4,
    step() { calls.push('authority'); game.paused = true; }, present() { visual.time = this.renderTime; calls.push('present'); } };
  const ui: any = { menu: { mode: 'home', blocksPlayer: false }, setSceneStage: record('home-stage'), syncInteraction: record('interaction'), update: record('ui'), handleShortcuts: record('ui-shortcut'),
    updateWorld() { assert.equal(visual.cameraReady, true); calls.push('hud'); } };
  const render: any = { camera: {}, beginFrame: () => 10, handleShortcuts: record('render-shortcut'), updateResolution: record('resolution'),
    draw(frame: any) { context.draw = frame; calls.push('draw'); }, drawFirst: record('first-draw'), recordFrame: record('perf') };
  const session: any = { connection: { connected: true }, presentationBase: () => 30 };
  const environment: any = { prepareWorld: record('prepare'), follow: record('light-follow'), update(frame: any) {
    assert.equal(frame.time, visual.time); context.environment = frame; calls.push('environment'); } };
  const sceneCamera: any = { rig: { target: {} }, vehicleFocus: () => ({}), snap: record('snap'), update(dt: number) { context.cameraDt = dt; visual.cameraReady = true; calls.push('camera'); } };
  const runtime = new GameRuntime({ ui, render, session, environment, sceneCamera, game, network,
    input: { endFrame: record('input-end') }, localInput: { beginFrame: record('input-begin'), endFrame: record('pad-end') },
    practice: { updatePlayers(dt: number) { context.playerDt = dt; calls.push('players'); }, visibleTrucks: () => [] }, suspension: { update(dt: number) { context.suspensionDt = dt; calls.push('suspension'); } },
    debug: { update: record('debug'), handleShortcuts: record('debug-shortcut') }, audio: { update: record('audio') },
    transition: { updatePlayers: record('entry-players') }, tasks: { update: record('tasks') }, backgroundClock: { start: record('background') },
    clock: { getDelta: () => .1 } as any });
  calls.length = 0;
  return { runtime, game, ui, calls, context, network, session };
}

test('frame consumers see presented authority time and updated camera; authority pause freezes suspension and draw still runs', () => {
  const { runtime, calls, context } = runtimeFixture(); runtime.frame();
  assert.ok(calls.indexOf('authority') < calls.indexOf('players'));
  assert.ok(calls.indexOf('present') < calls.indexOf('environment'));
  assert.ok(calls.indexOf('camera') < calls.indexOf('effects'));
  assert.ok(calls.indexOf('effects') < calls.indexOf('input-end'));
  assert.ok(calls.indexOf('pad-end') < calls.indexOf('draw'));
  assert.equal(context.effects.dt, .05, 'real .1-second gap is clamped to the existing 50ms client frame budget');
  assert.equal(context.suspensionDt, 0); assert.equal(context.effects.time, 17.3); assert.equal(context.effects.scroll, 4);
  assert.equal(context.draw.time, 17.3); assert.equal(calls.filter(call => call === 'draw').length, 1);
});

test('debug pause keeps UI and rendering alive without advancing the world, and held home presentation blocks entry animation', () => {
  const saved = CFG.world.pause;
  try {
    CFG.world.pause = true;
    const paused = runtimeFixture(); paused.session.connection.connected = false; paused.runtime.frame();
    assert.equal(paused.calls.includes('authority'), false); assert.equal(paused.calls.includes('input-begin'), false);
    assert.equal(paused.calls.includes('ui'), true); assert.equal(paused.calls.includes('draw'), true);
    assert.equal(paused.calls.filter(call => call === 'ui-shortcut').length, 1);
    CFG.world.pause = false;
    const held = runtimeFixture(); held.network.homeHold = true; held.runtime.step(.016);
    assert.equal(held.calls.includes('entry-players'), false);
  } finally { CFG.world.pause = saved; }
});

test('guide reading freezes character, vehicle, camera and effect deltas while UI, rendering and authority transport stay alive', () => {
  const {runtime,game,ui,network,calls,context} = runtimeFixture();
  game.roundStage='guide'; game.active=true; game.activeTrucks=()=>[];
  ui.menu.mode='game'; network.phase='game'; network.step=()=>calls.push('authority');
  runtime.frame();
  assert.equal(context.playerDt,0); assert.equal(context.suspensionDt,0); assert.equal(context.cameraDt,0); assert.equal(context.effects.dt,0);
  for(const name of ['ui','authority','present','hud','draw']) assert.ok(calls.includes(name));
});

test('guide presentation uses the frozen authority clock even through snapshot gaps, then resumes during Ready', () => {
  const network: any=Object.create(NetworkGame.prototype);
  Object.assign(network,{game:{paused:false,roundStage:'guide'},latest:{time:10,scroll:300,base:30},received:performance.now()-200,
    renderTime:10.1,renderScroll:303,clockReset:false,publishStats() {}});
  for(let i=0;i<30;i++) { network.present(1/30); assert.equal(network.renderTime,10); assert.equal(network.renderScroll,300); }
  assert.deepEqual(network.sample(1/30),{a:network.latest,b:network.latest,alpha:1});
  network.game.roundStage='ready'; network.received=performance.now(); network.present(1/30);
  assert.ok(network.renderTime>10); assert.ok(network.renderScroll>300);
});
