import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, VERSUS_LEVELS, ALL_LEVELS, MAX_PLAYER_SLOTS, getLevel, levelMode, firstLevelFor, nextLevelId, validRoundResult, SAVE_VERSION } from '../shared/levels.js';
import { Simulation } from './fixtures/Simulation.js';
import { room, rosterOf } from './helpers/peerRoom.js';
import { quantize } from '../shared/delta.js';
import { applyWorld } from '../shared/snapshot.js';

test('versus maps live in their own list; co-op cards, next level and saves never see them', () => {
  assert.equal(LEVELS.length, 5); assert.ok(LEVELS.every(level => levelMode(level) === 'coop'));
  assert.deepEqual(VERSUS_LEVELS.map(level => level.id), ['versus-01']);
  assert.equal((getLevel('versus-01') as any).mode, 'versus'); assert.equal(levelMode(getLevel('versus-01')), 'versus');
  assert.deepEqual([firstLevelFor('coop'), firstLevelFor('versus')], ['highway-01', 'versus-01']);
  assert.equal(nextLevelId('highway-05'), null); assert.equal(nextLevelId('versus-01'), null);
  const result = { saveVersion: SAVE_VERSION, roundId: 'r', levelId: 'versus-01', score: 0, completedOrders: 0, missed: 0,
    partyBalance: { playerCount: 2 }, reason: 'tutorial_complete', outcome: 'success', stars: null };
  assert.equal(validRoundResult(result), false, 'a versus result is never accepted into the co-op save');
  // Both modes share one prepared asset manifest; only the slot count differs, and clients prepare the largest.
  for (const level of ALL_LEVELS) for (const key of ['equipment', 'orders'] as const)
    assert.deepEqual(key === 'orders' ? level.orders.vehicles : level.equipment, key === 'orders' ? LEVELS[0].orders.vehicles : LEVELS[0].equipment);
  assert.equal(MAX_PLAYER_SLOTS.length, 8); assert.deepEqual(MAX_PLAYER_SLOTS.slice(0, 4), LEVELS[0].home.playerSlots);
});

test('a world built from a versus level is versus, seats eight and gives each side its team', () => {
  const sim = new Simulation(getLevel('versus-01') as any);
  try {
    assert.equal(sim.mode, 'versus'); assert.equal(sim.game.mode, 'versus'); assert.equal(sim.slotCount, 8);
    sim.phase = 'game'; sim.game.start(30);
    const red = sim.game.spawnOrder(0, { side: -1 }), blue = sim.game.spawnOrder(1, { side: 1 });
    assert.deepEqual([red.team, blue.team], [0, 1]);
  } finally { sim.dispose(); }
  const coop = new Simulation(getLevel('highway-02') as any);
  try { assert.equal(coop.mode, 'coop'); assert.equal(coop.slotCount, 4); } finally { coop.dispose(); }
});

test('the host follows the room mode on the main menu, and every page follows its levelId', () => {
  const r = room(['a']);
  try {
    const { host, members } = r, guest = r.guests[0];
    const versus = members.map((m, i) => ({ ...m, team: i % 2 }));
    const epoch = host.epoch;
    host.setRoster({ ...rosterOf(versus), mode: 'versus' });
    assert.equal(host.levelId, 'versus-01'); assert.equal(host.sim.mode, 'versus'); assert.equal(host.sim.phase, 'home');
    assert.ok(host.epoch > epoch, 'a new world starts a new epoch');
    assert.equal(host.sim.players[0].occupied, true); assert.equal(host.sim.players[1].occupied, true);
    assert.deepEqual([host.sim.players[0].team, host.sim.players[1].team], [0, 1]);
    assert.equal(guest.guest.state?.levelId, 'versus-01', 'the guest learns the new level and reloads through the covered level change');
    assert.equal(host.command('start', { levelId: 'highway-02' }), '这个关卡不属于当前房间模式');
    // A ninth-seat guard: a member beyond this world's slots would wait; within eight they link.
    host.setRoster({ ...rosterOf([...versus, { id: 'b', name: 'b', slot: 5, connected: true, session: 'b-s', team: 1 }]), mode: 'versus' });
    assert.ok(host.guests.has('b'), 'seat 5 exists in a versus world');

    host.setRoster({ ...rosterOf(members), mode: 'coop' });
    assert.equal(host.levelId, 'highway-01'); assert.equal(host.sim.mode, 'coop'); assert.equal(host.sim.slotCount, 4);
    assert.equal(host.sim.players[1].team, null);
  } finally { r.dispose(); }
});

test('a started round never switches world mid-game', () => {
  const r = room(['a']);
  try {
    assert.equal(r.host.command('start', {}), null);
    r.host.setRoster({ ...rosterOf(r.members), mode: 'versus' });
    assert.equal(r.host.levelId, 'highway-01', 'only the main menu reloads a world');
  } finally { r.dispose(); }
});

test('versus maps never enter the co-op save; a versus resume level written by an earlier build is dropped', async () => {
  const { ProgressStore, decodeProgress, PROGRESS_KEY } = await import('../client/js/save/ProgressStore.js');
  const bytes = new Map<string, string>();
  const storage = () => ({ getItem: (k: string) => bytes.get(k) ?? null, setItem: (k: string, v: string) => { bytes.set(k, v); } });
  const store = new ProgressStore({ storage });
  assert.equal(await store.enter('versus-01'), false); assert.equal(bytes.has(PROGRESS_KEY), false);
  assert.equal(await store.enter('highway-02'), true); assert.equal(store.resumeLevelId, 'highway-02');
  const old = { version: SAVE_VERSION, lastLevelId: 'versus-01', levels: {}, resultIds: [], updatedAt: 1 };
  const decoded = decodeProgress(JSON.stringify(old));
  assert.equal(decoded.status, 'ready'); assert.equal(decoded.data.lastLevelId, null);
});

function versusMatch() {
  const sim = new Simulation(getLevel('versus-01') as any);
  sim.occupy(0, true); sim.occupy(1, true); sim.setTeam(0, 0); sim.setTeam(1, 1);
  sim.phase = 'game'; sim.game.start(30);
  return sim;
}

test('the first team to the target score ends the match; equal final scores are a draw', async () => {
  const probe = versusMatch();
  try { assert.deepEqual(probe.game.matchSettings, { scoreTarget: 250, timeLimit: 300 }); assert.deepEqual([probe.game.clock.mode, probe.game.clock.duration], ['countdown', 300]); }
  finally { probe.dispose(); }
  for (const [scores, winner, tie] of [[[250, 120], 0, false], [[260, 270], 1, false], [[255, 255], null, true]] as const) {
    const sim = versusMatch();
    try {
      sim.game.teamScores = [...scores]; sim.tick();
      const result = sim.game.result;
      assert.equal(sim.game.ended, true);
      assert.deepEqual([result.mode, result.reason, result.winner, result.tie], ['versus', 'score_target', winner, tie]);
      assert.deepEqual(result.teamScores, scores); assert.equal(result.stars, undefined, 'no co-op stars in a versus result');
      assert.equal(result.scoreTarget, 250);
    } finally { sim.dispose(); }
  }
});

test('time up compares the final scores; the result never enters the co-op save and is still acknowledged', async () => {
  const sim = versusMatch();
  try {
    sim.game.teamScores = [40, 90]; sim.game.remaining = 1 / 120; sim.tick();
    assert.deepEqual([sim.game.result.reason, sim.game.result.winner, sim.game.result.tie], ['time_up', 1, false]);
    const receipt = { saveVersion: SAVE_VERSION, roundId: 'vs-1', levelId: 'versus-01', ...sim.game.result };
    assert.equal(validRoundResult(receipt), false);
    const { SaveCoordinator } = await import('../client/js/save/SaveCoordinator.js');
    const acks: string[] = [], recorded: any[] = [];
    const connection: any = Object.assign(new EventTarget(), { connected: true, send: (type: string, fields: any) => { if (type === 'result_ack') acks.push(fields.roundId); return true; } });
    const store: any = { record: async (r: any) => { recorded.push(r); return true; }, enter: async () => true, reload() {} };
    // SaveCoordinator listens for cross-tab storage events on the browser global; Node has none.
    const g = globalThis as any, hadListener = 'addEventListener' in g;
    if (!hadListener) g.addEventListener = () => {};
    const saver = new SaveCoordinator(connection, store);
    if (!hadListener) delete g.addEventListener;
    try {
      connection.dispatchEvent(new CustomEvent('round_result', { detail: receipt }));
      await new Promise(resolve => setTimeout(resolve, 0));
      assert.deepEqual(acks, ['vs-1']); assert.equal(recorded.length, 0, 'versus results are acknowledged without saving');
    } finally { saver.dispose(); }
  } finally { sim.dispose(); }
  const tied = versusMatch();
  try { tied.game.teamScores = [70, 70]; tied.game.remaining = 1 / 120; tied.tick(); assert.deepEqual([tied.game.result.winner, tied.game.result.tie], [null, true]); }
  finally { tied.dispose(); }
});

test('room settings: host-only, main menu only, shape-checked by the service and normalized by pages, kept across modes', async () => {
  const { Rooms } = await import('../server/src/Rooms.js');
  const { validVersusSettings, DEFAULT_VERSUS_SETTINGS, normalizeVersusSettings, validRoomSettings } = await import('../shared/protocol.js');
  assert.equal(validVersusSettings({ scoreTarget: 400, timeLimit: null, aiFill: 'off', aiDifficulty: 'normal' }), true);
  assert.equal(validVersusSettings({ scoreTarget: 400, timeLimit: null, aiFill: 'off', aiDifficulty: 'insane' }), false, 'unknown AI difficulty');
  for (const bad of [{ scoreTarget: null, timeLimit: null, aiFill: 'off' }, { scoreTarget: 999, timeLimit: 300, aiFill: 'off' }, { scoreTarget: 250 }, { scoreTarget: 250, timeLimit: 300, aiFill: 'off', extra: 1 }, { scoreTarget: 250, timeLimit: 300, aiFill: 'many' }, { scoreTarget: 250, timeLimit: 300 }, null])
    assert.equal(validVersusSettings(bad), false);
  class Peer { readyState = 1; messages: any[] = []; send(raw: string) { this.messages.push(JSON.parse(raw)); } close() { this.readyState = 3; } }
  const service = new Rooms();
  try {
    const host = service.connect(new Peer() as any, 'Host'), guest = service.connect(new Peer() as any, 'Guest');
    service.join(guest, host.room.code);
    assert.deepEqual(host.room.settings, DEFAULT_VERSUS_SETTINGS);
    assert.throws(() => service.setSettings(guest, { scoreTarget: 150, timeLimit: 180, aiFill: 'off', aiDifficulty: 'hard' }), (e: any) => e.code === 'bad_request');
    // The service checks shape only (REGISTRY_VERSION is content-agnostic): nested values or oversized blobs are refused…
    for (const bad of [{ nested: { a: 1 } }, [1, 2], { long: 'x'.repeat(30) }, Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`k${String.fromCharCode(97 + i)}`, i]))]) {
      assert.equal(validRoomSettings(bad), false);
      assert.throws(() => service.setSettings(host, bad), (e: any) => e.code === 'bad_request');
    }
    // …while meaning is the pages' business: no end condition, unknown values and missing keys normalize to playable ones.
    assert.deepEqual(normalizeVersusSettings({ scoreTarget: null, timeLimit: null, aiFill: 'off', aiDifficulty: 'insane' }),
      { scoreTarget: 250, timeLimit: null, aiFill: 'off', aiDifficulty: 'normal' });
    assert.deepEqual(normalizeVersusSettings({ scoreTarget: 400, timeLimit: 180, aiFill: 'off' }), { scoreTarget: 400, timeLimit: 180, aiFill: 'off', aiDifficulty: 'normal' }, 'an older service shape still plays');
    assert.deepEqual(normalizeVersusSettings(undefined), DEFAULT_VERSUS_SETTINGS);
    service.setSettings(host, { scoreTarget: 150, timeLimit: null, aiFill: 'off', aiDifficulty: 'hard' });
    const roster = (guest.peer as any).messages.filter((m: any) => m.type === 'room').at(-1);
    assert.deepEqual(roster.settings, { scoreTarget: 150, timeLimit: null, aiFill: 'off', aiDifficulty: 'hard' });
    service.setMode(host, 'versus'); service.setMode(host, 'coop');
    assert.deepEqual(host.room.settings, { scoreTarget: 150, timeLimit: null, aiFill: 'off', aiDifficulty: 'hard' }, 'switching mode keeps the settings');
    service.hostPhase(host, 'game');
    assert.throws(() => service.setSettings(host, DEFAULT_VERSUS_SETTINGS), (e: any) => e.code === 'room_started');
  } finally { service.close(); }
});

test('the host freezes the room settings at match start; off conditions never end the match', () => {
  const r = room(['a']);
  try {
    const { host, members } = r;
    const versus = members.map((m, i) => ({ ...m, team: i % 2, ready: i > 0 }));
    host.setRoster({ ...rosterOf(versus), mode: 'versus', settings: { scoreTarget: null, timeLimit: 180, aiFill: 'off', aiDifficulty: 'normal' } });
    assert.equal(host.command('start', {}), null);
    assert.deepEqual(host.sim.game.matchSettings, { scoreTarget: null, timeLimit: 180 });
    host.setRoster({ ...rosterOf(versus), mode: 'versus', settings: { scoreTarget: 150, timeLimit: null, aiFill: 'off', aiDifficulty: 'normal' } });
    assert.deepEqual(host.sim.game.matchSettings, { scoreTarget: null, timeLimit: 180 }, 'a running match keeps its copy');
    const peer = new Simulation(getLevel('versus-01') as any);
    try {
      applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, quantize(host.sim.snapshot()));
      assert.deepEqual(peer.game.matchSettings, { scoreTarget: null, timeLimit: 180 }, 'every page sees the frozen settings');
    } finally { peer.dispose(); }
  } finally { r.dispose(); }
  const open = versusMatch();
  try {
    open.game.matchSettings = { scoreTarget: 150, timeLimit: null }; open.game.remaining = open.game.roundClock().duration;
    assert.equal(open.game.clock.mode, 'unlimited');
    for (let i = 0; i < 30; i++) open.tick();
    assert.equal(open.game.ended, false, 'no time limit, no time up');
    open.game.teamScores = [150, 0]; open.tick(); assert.equal(open.game.result.reason, 'score_target');
  } finally { open.dispose(); }
  const timed = versusMatch();
  try {
    timed.game.matchSettings = { scoreTarget: null, timeLimit: 180 };
    timed.game.teamScores = [9999, 0]; timed.tick(); assert.equal(timed.game.ended, false, 'no target, no score end');
  } finally { timed.dispose(); }
});

test('versus ready: guests only, main menu only, cleared by every room change and at start', async () => {
  const { Rooms } = await import('../server/src/Rooms.js');
  class Peer { readyState = 1; messages: any[] = []; send(raw: string) { this.messages.push(JSON.parse(raw)); } close() { this.readyState = 3; } }
  const service = new Rooms();
  try {
    const [host, a, b, c] = ['Host', 'A', 'B', 'C'].map(name => service.connect(new Peer() as any, name));
    for (const guest of [a, b]) service.join(guest, host.room.code);
    assert.throws(() => service.setReady(a, true), (e: any) => e.code === 'bad_request', 'co-op rooms have no ready');
    service.setMode(host, 'versus');
    assert.throws(() => service.setReady(host, true), (e: any) => e.code === 'bad_request', 'the host never readies');
    assert.throws(() => service.setReady(a, 'yes'), (e: any) => e.code === 'bad_request');
    const readyAll = () => { service.setReady(a, true); service.setReady(b, true); };
    const anyReady = () => host.room.members.some(m => m.ready);
    readyAll();
    const roster = (host.peer as any).messages.filter((m: any) => m.type === 'room').at(-1);
    assert.deepEqual(roster.members.map((m: any) => m.ready), [false, true, true]);
    service.setTeam(b, 1 - (b.team as number)); assert.equal(anyReady(), false, 'a team switch clears ready');
    readyAll(); service.setSettings(host, { scoreTarget: 150, timeLimit: 300, aiFill: 'off', aiDifficulty: 'easy' }); assert.equal(anyReady(), false, 'a settings change clears ready');
    readyAll(); service.join(c, host.room.code); assert.equal(anyReady(), false, 'a join clears ready');
    readyAll(); service.leave(c); assert.equal(anyReady(), false, 'a leave clears ready');
    readyAll(); service.hostPhase(host, 'transition'); assert.equal(anyReady(), false, 'starting clears ready');
    assert.throws(() => service.setReady(a, true), (e: any) => e.code === 'room_started');
  } finally { service.close(); }
});

test('the host starts versus only with both teams staffed and every guest ready; play again needs only both teams', async () => {
  const { versusStartCheck } = await import('../shared/protocol.js');
  const r = room(['a', 'b']);
  try {
    const { host, members } = r, as = (teams: number[], ready: boolean[]) => members.map((m, i) => ({ ...m, team: teams[i], ready: ready[i] }));
    // AI fill off: both teams need a real player (rosters without settings now read the defaults, where fill is on).
    const noFill = { scoreTarget: 250, timeLimit: 300, aiFill: 'off', aiDifficulty: 'normal' };
    host.setRoster({ ...rosterOf(as([0, 0, 0], [false, true, true])), mode: 'versus', settings: noFill });
    assert.equal(host.command('start', {}), '两队都需要至少一名玩家');
    host.setRoster({ ...rosterOf(as([0, 1, 1], [false, true, false])), mode: 'versus', settings: noFill });
    assert.deepEqual(versusStartCheck(host.roster), { teams: true, ready: 1, total: 2, ok: false });
    assert.equal(host.command('start', {}), '还有玩家没有准备');
    const offline = { ...rosterOf(as([0, 1, 1], [false, true, false]).map(m => m.id === 'b' ? { ...m, connected: false } : m)), mode: 'versus' };
    assert.equal(versusStartCheck(offline).ok, true, 'a reconnecting guest does not block the start');
    host.setRoster({ ...rosterOf(as([0, 1, 1], [false, true, true])), mode: 'versus' });
    assert.equal(host.command('start', {}), null);
    for (let i = 0; i < 240; i++) r.advance();
    assert.equal(host.sim.phase, 'game');
    // After the match everyone is unready (the registry cleared it at start); play again keeps the line-up.
    host.setRoster({ ...rosterOf(as([0, 1, 1], [false, false, false])), mode: 'versus', phase: 'game' });
    assert.equal(host.command('load', { levelId: 'versus-01' }), null);
  } finally { r.dispose(); }
  const coop = room(['a']);
  try { assert.equal(coop.host.command('start', {}), null, 'co-op starts without ready'); } finally { coop.dispose(); }
});

test('versus pause: a request freezes everyone; more than half of the online players resumes; cooldown after', async () => {
  const { PAUSE_COOLDOWN_SECONDS } = await import('../shared/protocol.js');
  const match = (players: number) => {
    const sim = new Simulation(getLevel('versus-01') as any);
    for (let slot = 0; slot < players; slot++) { sim.occupy(slot, true); sim.setTeam(slot, slot % 2); }
    sim.phase = 'game'; sim.game.start(30); return sim;
  };
  for (const [players, needed] of [[2, 2], [3, 2], [8, 5]] as const) {
    const sim = match(players);
    try {
      const signature = sim.urgentSignature();
      assert.equal(sim.requestPause(1), true); assert.equal(sim.game.paused, true);
      assert.notEqual(sim.urgentSignature(), signature, 'the pause goes out at once');
      assert.deepEqual(sim.game.pauseVote, { by: 1, votes: [], voters: Array.from({ length: players }, (_, i) => i) });
      assert.equal(sim.requestPause(0), false, 'one pause at a time');
      for (let voter = 0; voter < needed - 1; voter++) { assert.equal(sim.voteResume(voter), true); assert.equal(sim.game.paused, true); }
      assert.equal(sim.voteResume(0), false, 'one vote per player');
      assert.equal(sim.voteResume(needed - 1), true);
      assert.equal(sim.game.paused, false, `${needed} of ${players} resumes`); assert.equal(sim.game.pauseVote, null);
      assert.equal(sim.game.pauseCooldowns[1], PAUSE_COOLDOWN_SECONDS);
      assert.equal(sim.requestPause(1), false, 'the requester waits out the cooldown');
      for (let i = 0; i < PAUSE_COOLDOWN_SECONDS * 60 + 2; i++) sim.tick();
      assert.equal(sim.requestPause(1), true, 'after the cooldown the requester may pause again');
    } finally { sim.dispose(); }
  }
  const half = match(3);
  try {
    half.requestPause(2); half.voteResume(0); half.depart(1); half.tick();
    assert.deepEqual(half.game.pauseVote.voters, [0, 2]); assert.equal(half.game.paused, true, '1 of 2 is exactly half: still paused');
    half.voteResume(2); assert.equal(half.game.paused, false);
  } finally { half.dispose(); }
  const tipped = match(4);
  try {
    tipped.requestPause(3); tipped.voteResume(0); tipped.voteResume(1); assert.equal(tipped.game.paused, true, '2 of 4 is not past half');
    tipped.depart(3); tipped.tick();
    assert.equal(tipped.game.paused, false, 'the requester left: 2 of 3 is past half and the match resumes');
  } finally { tipped.dispose(); }
  const coop = new Simulation();
  try {
    coop.occupy(0, true); coop.phase = 'game'; coop.game.start(30);
    assert.equal(coop.requestPause(0), false, 'co-op has no pause requests');
    coop.command('pause', true); assert.equal(coop.game.paused, true, 'co-op host pause unchanged');
  } finally { coop.dispose(); }
  const host = match(2);
  try { host.command('pause', true); assert.equal(host.game.paused, false, "the versus host's menu does not freeze the match"); } finally { host.dispose(); }
});

test('pause control from a guest acts only for its own link slot and reaches every page in the snapshot', () => {
  const r = room(['a', 'b']);
  try {
    const { host, members } = r;
    host.setRoster({ ...rosterOf(members.map((m, i) => ({ ...m, team: i % 2, ready: i > 0 }))), mode: 'versus' });
    assert.equal(host.command('start', {}), null);
    for (let i = 0; i < 240; i++) r.advance();
    const [a] = r.guests;
    a.guest.sendControl({ type: 'pause_request', epoch: host.epoch });
    assert.deepEqual([host.sim.game.paused, host.sim.game.pauseVote.by], [true, 1], 'guest a paused from its own slot');
    a.guest.sendControl({ type: 'resume_vote', epoch: host.epoch, slot: 2 });
    assert.deepEqual(host.sim.game.pauseVote.votes, [1], 'a slot field in the frame is ignored');
    a.guest.sendControl({ type: 'resume_vote', epoch: host.epoch - 1 });
    assert.deepEqual(host.sim.game.pauseVote.votes, [1], 'stale epochs are ignored');
    const peer = new Simulation(getLevel('versus-01') as any);
    try {
      applyWorld({ game: peer.game, trucks: peer.trucks, players: peer.players }, quantize(host.sim.snapshot()));
      assert.deepEqual(peer.game.pauseVote, { by: 1, votes: [1], voters: [0, 1, 2] });
    } finally { peer.dispose(); }
    host.pauseControl(host.slot, 'resume_vote');
    assert.equal(host.sim.game.paused, false, 'host + a = 2 of 3 resumes');
  } finally { r.dispose(); }
});
