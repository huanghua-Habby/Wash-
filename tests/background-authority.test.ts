import test from 'node:test';
import assert from 'node:assert/strict';
import { BackgroundAuthorityClock } from '../client/js/online/BackgroundAuthorityClock.js';

test('hidden host advances one shared sixty-Hz authority; visibility, solo and guest states stop the worker clock', async () => {
  class Worker extends EventTarget {
    sent: any[] = []; terminated = false;
    postMessage(value: any) { this.sent.push(value); }
    terminate() { this.terminated = true; }
  }
  const worker = new Worker();
  const doc: any = new EventTarget(); doc.visibilityState = 'visible';
  const connection: any = new EventTarget(); connection.isHost = true; connection.room = { mode:'multiplayer' };
  let time = 0, ticks = 0; const modes: boolean[] = [];
  connection.advanceLocal = () => ticks++;
  const clock = new BackgroundAuthorityClock({ connection, doc, now: () => time, createWorker: () => worker, onMode: hidden => modes.push(hidden) });
  try {
    worker.dispatchEvent(new MessageEvent('message', { data: { type:'ready' } })); await clock.ready;
    clock.start(); time = 1000; clock.pulse(); assert.equal(ticks, 0, 'foreground owns its render-driven clock');
    doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange'));
    time = 2000; clock.pulse(); assert.equal(ticks, 60);
    const oldGeneration = clock.generation;
    doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange'));
    time = 3000; worker.dispatchEvent(new MessageEvent('message', { data: { type:'pulse', generation:oldGeneration } }));
    assert.equal(ticks, 60, 'late worker pulse cannot double-tick after foreground returns');
    doc.visibilityState = 'hidden'; connection.isHost = false; doc.dispatchEvent(new Event('visibilitychange'));
    time = 4000; clock.pulse(); assert.equal(ticks, 60, 'guest never advances authority');
    connection.isHost = true; connection.room.mode = 'solo'; connection.dispatchEvent(new Event('room'));
    time = 5000; clock.pulse(); assert.equal(ticks, 60, 'solo does no background work');
    connection.room.mode = 'multiplayer'; connection.dispatchEvent(new Event('room'));
    time = 6000; clock.pulse(); assert.equal(ticks, 120);
    assert.deepEqual(modes, [true, false, true]);
  } finally { clock.dispose(); }
  assert.equal(worker.terminated, true);
});
