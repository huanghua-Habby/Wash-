/** A room owner alone runs the shared world in its own browser: zero gameplay messages, local results under save 0.1. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomConnection } from '../client/js/online/RoomConnection.js';
import { VERSION } from '../shared/protocol.js';
import { SAVE_VERSION } from '../shared/levels.js';

(globalThis as any).WebSocket ??= { OPEN: 1 };
const roster = { type:'room', code:'ABC234', ownCode:'ABC234', hostId:'me', playerId:'me', slot:0, revision:2, phase:'home', members:[{ id:'me',name:'Me',slot:0,connected:true,session:'s1' }] };

test('solo inputs, pause and results never touch the socket; flow and registry updates use it sparingly',async () => {
  const connection: any = new RoomConnection({ endpoint:'ws://unused' }), sent: any[] = [], snapshots: any[] = [], results: any[] = [], rooms: any[] = [];
  connection.socket = { readyState:1, send:(raw: string) => sent.push(JSON.parse(raw)) }; connection.connected = true; connection.session = 's1';
  connection.addEventListener('snapshot',(e: any) => snapshots.push(e.detail));
  connection.addEventListener('round_result',(e: any) => results.push(e.detail));
  connection.addEventListener('room',(e: any) => rooms.push(e.detail));
  try {
    connection.setRoster(roster);
    assert.equal(connection.isHost,true); assert.equal(connection.room.mode,'solo'); assert.equal(connection.room.epoch,1);
    const registry = sent.length;
    connection.send('input',{ seq:1,axis:[1,0],move:[1,0],down:[],hits:[] });
    for (let i = 0; i < 90; i++) connection.advanceLocal();
    assert.equal(sent.length,registry,'no ongoing gameplay traffic'); assert.ok(snapshots.length >= 30);
    connection.send('pause',{ paused:true }); assert.equal(sent.length,registry);
    assert.equal(connection.send('start',{}),true);
    await Promise.resolve(); // command effects arrive after send() returns, like a reply
    assert.deepEqual(sent.slice(registry).map((m) => [m.type,m.phase]),[['host_phase','transition']],'only the join restriction is reported');
    assert.equal(connection.room.epoch,2); assert.ok(connection.room.roundId);
    connection.authority.sim.game.score = 25; connection.authority.sim.game.completed = 1; connection.authority.sim.game.finish('tutorial_complete');
    connection.advanceLocal(); connection.advanceLocal();
    assert.equal(results.length,1); assert.equal(results[0].saveVersion,SAVE_VERSION); assert.equal(results[0].score,25); assert.equal(results[0].v,VERSION);
    assert.equal(connection.send('result_ack',{ roundId:results[0].roundId }),true);
    connection.send('rename',{ name:'Alice' }); assert.equal(sent.at(-1).type,'rename','room metadata still uses the registry');
  } finally { connection.authority?.dispose(); }
});
