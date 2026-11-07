/** Versus guest ready nudge: after READY_NUDGE.afterSeconds the button shakes, then again every everySeconds. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadyNudge, READY_NUDGE } from '../client/js/ui/ReadyNudge.js';

function fakeButton() {
  const classes = new Set<string>(); let shakes = 0;
  return { shakes: () => shakes, has: (c: string) => classes.has(c), offsetWidth: 0,
    classList: { toggle: (c: string, on: boolean) => { on ? classes.add(c) : classes.delete(c); }, remove: (c: string) => classes.delete(c),
      add: (c: string) => { if (c === 'nudge-shake') shakes++; classes.add(c); } } };
}
const run = (nudge: ReadyNudge, seconds: number, waiting = true, motion = true) => { for (let t = 0; t < seconds; t += .1) nudge.update(.1, waiting, motion); };

test('no nudge before the wait; then the button shakes, again every few seconds', () => {
  const button = fakeButton(), nudge = new ReadyNudge(button as any);
  run(nudge, READY_NUDGE.afterSeconds - .3);
  assert.equal(button.has('ready-nudge'), false); assert.equal(button.shakes(), 0);
  run(nudge, .5);
  assert.equal(button.has('ready-nudge'), true); assert.equal(button.shakes(), 1, 'one shake as it lights up');
  run(nudge, READY_NUDGE.everySeconds * 2 + .05);
  assert.equal(button.shakes(), 3, 'then one every READY_NUDGE.everySeconds');
});

test('readying (or anything that stops the wait) clears it, and the wait starts over', () => {
  const button = fakeButton(), nudge = new ReadyNudge(button as any);
  run(nudge, READY_NUDGE.afterSeconds + 1);
  assert.equal(button.has('ready-nudge'), true);
  nudge.update(.1, false, true);
  assert.equal(button.has('ready-nudge'), false); assert.equal(button.has('nudge-shake'), false);
  run(nudge, READY_NUDGE.afterSeconds - .5);
  assert.equal(button.has('ready-nudge'), false, 'a new full wait before nudging again (e.g. after a team swap cleared ready)');
});

test('reduced motion never shakes', () => {
  const button = fakeButton(), nudge = new ReadyNudge(button as any);
  run(nudge, READY_NUDGE.afterSeconds + READY_NUDGE.everySeconds * 2, true, false);
  assert.equal(button.has('ready-nudge'), true); assert.equal(button.shakes(), 0);
});
