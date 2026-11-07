import test from 'node:test';
import assert from 'node:assert/strict';
import { room, rosterOf, FakeLink, pair } from './helpers/peerRoom.js';
import { GuestLink } from '../client/js/online/GuestLink.js';
import { CONTROL_CHANNEL, STATE_CHANNEL, VERSION } from '../shared/protocol.js';

test('home wait retains seats, rejects input/start and sends no streaming snapshots; two acknowledgements refresh only the ready slot', () => {
  const r = room(['a','b'], { autoHome:false });
  try {
    r.host.command('start'); for (let i=0; i<430; i++) r.advance();
    const frames: any[] = [], g = r.guests[0], send = g.hostLink.send.bind(g.hostLink);
    g.hostLink.send = (channel, frame) => { frames.push({channel, frame}); return send(channel, frame); };
    r.host.command('home'); const epoch = r.host.epoch;
    const before = g.received.length;
    for (let i=0; i<360; i++) r.advance();
    assert.equal(g.received.length, before); assert.ok(g.guest.open);
    assert.deepEqual(r.host.state().homeWaiting, ['a','b']); assert.equal(r.host.roster.members.length, 3);
    assert.equal(r.host.sim.players[1].occupied, false, 'seat is reserved in roster, avatar not active in practice');
    assert.equal(g.guest.sendInput({seq:999,axis:[1,0],move:[1,0],down:['KeyJ'],hits:['KeyJ']}), false);
    g.link.send(STATE_CHANNEL, {type:'input',epoch, inputs:[{seq:999,axis:[1,0],move:[1,0],down:[],hits:[]}]});
    assert.equal(r.host.sim.queues[1].length, 0); assert.match(r.host.command('start')!, /返回主菜单/);
    g.guest.sendControl({type:'home_ready', epoch}); assert.ok(r.host.homeWaiting.has('a'), 'no ready without a prepared frame');
    g.guest.sendControl({type:'home_prepare',epoch:epoch-1}); assert.equal(g.received.length, before);
    g.guest.requestHome(); assert.equal(g.received.length, before+1);
    g.guest.sendControl({type:'home_prepare',epoch}); assert.equal(g.received.length,before+1,'duplicate preparation does not resend a full world');
    for (let i=0; i<60; i++) r.advance(); assert.equal(g.received.length, before+1, 'preparation does not enable streaming');
    const other = r.host.sim.players[0]; other.pos.x += .5; const unchanged = other.pos.clone();
    g.guest.homeVisible(); assert.equal(r.host.homeWaiting.has('a'), false); assert.ok(r.host.homeWaiting.has('b'));
    assert.equal(r.host.sim.players[1].occupied, true); assert.equal(r.host.sim.players[1].sceneReady, true);
    assert.ok(other.pos.distanceTo(unchanged) < 1e-8, 'one acknowledgement never resets the other players');
    const homeFrames = frames.filter(f => f.frame.type === 'home_snapshot');
    assert.equal(homeFrames.length, 2); assert.ok(homeFrames.every(f => f.channel === CONTROL_CHANNEL));
    assert.ok(homeFrames.every(f => JSON.stringify(f.frame).length < 20_000), 'bounded full frames, only at the scene boundary');
    assert.equal(frames.filter(f => f.frame.type === 'snapshot').length, 0, 'no 30 Hz world stream during the wait');
    for (let i=0; i<4; i++) r.advance(); assert.ok(g.received.length > before+2);
    const resumed = g.received.at(-1); assert.equal(resumed.players[1].sceneReady, true);
    const afterResume=g.received.length;g.guest.control(homeFrames[0].frame);
    assert.equal(g.received.length,afterResume,'late preparation frames cannot overwrite a newer streaming snapshot');
    assert.equal(r.guests[1].guest.sendInput({seq:1,axis:[0,0],move:[0,0],down:[],hits:[]}), false);
    r.guests[1].guest.requestHome(); r.guests[1].guest.homeVisible();
    assert.equal(r.host.homeWaiting.size, 0); assert.equal(r.host.command('start'), null); assert.equal(VERSION, 42);
  } finally { r.dispose(); }
});

test('new epoch invalidates prepared acknowledgements; disconnected pending seats survive reconnect and disappear on leave', () => {
  const r = room(['a'], {autoHome:false});
  try {
    r.host.command('start'); r.host.command('home'); const g = r.guests[0]; g.guest.requestHome();
    const oldEpoch = r.host.epoch; r.host.resetScene();
    g.guest.sendControl({type:'home_ready', epoch:oldEpoch}); assert.ok(r.host.homeWaiting.has('a'));
    g.guest.homeVisible(); assert.ok(r.host.homeWaiting.has('a'), 'old prepared frame cannot acknowledge a newer world');
    g.link.close(); const reconnect = {...r.members[1],session:'a-new'};
    r.host.setRoster(rosterOf([r.members[0], reconnect]));
    assert.ok(r.host.homeWaiting.has('a')); assert.equal(r.host.sim.players[1].occupied, false);
    let link!: FakeLink;
    const replacement = new GuestLink({roster:rosterOf([r.members[0],reconnect], 'a'),session:'a-new',signal(){},
      createLink: ((options:any) => (link=new FakeLink(options))) as any});
    try {
      pair(r.host.guests.get('a')!.link as any, link);
      assert.ok(replacement.homePending); replacement.requestHome(); replacement.homeVisible();
      assert.equal(r.host.homeWaiting.size, 0); assert.equal(r.host.sim.players[1].occupied, true);
      r.host.command('start'); r.host.command('home');
      r.host.setRoster(rosterOf([r.members[0]])); assert.equal(r.host.homeWaiting.size, 0);
      assert.equal(r.host.command('start'), null);
    } finally { replacement.end('test'); }
  } finally { r.dispose(); }
});
