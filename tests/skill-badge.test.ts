// Versus skill icon (SkillBadge): which look each animal's own shared state gives.
import test from 'node:test';
import assert from 'node:assert/strict';
import { skillBadgeState } from '../client/js/ui/SkillBadge.js';
import { WASH_CONFIG as C } from '../shared/sim/washConfig.js';

const look = (player: any) => skillBadgeState({ state: 'ground', ...player }).look;

test('passive animals light up only while their skill is in effect', () => {
  assert.equal(look({ animal: 'dog' }), 'idle');
  assert.equal(look({ animal: 'dog', useAction: 'wipe' }), 'on');
  assert.equal(look({ animal: 'dog', useAction: 'spray' }), 'idle', 'the water gun gets no dog bonus');
  assert.equal(look({ animal: 'cat' }), 'idle');
  const wait = C.respawnSeconds * (1 - C.catRespawnReduction);
  const cat = skillBadgeState({ animal: 'cat', state: 'fallen', fallTimer: wait / 2 });
  assert.equal(cat.look, 'on'); assert.ok(Math.abs(cat.left - 0.5) < 1e-9, 'the ring is the respawn wait left');
  assert.equal(look({ animal: 'kangaroo' }), 'on');
  assert.equal(look({ animal: 'dog', state: 'fallen', useAction: 'wipe' }), 'off', 'only the cat is in effect while fallen');
});

test('pelican and elephant show their L recharge', () => {
  assert.equal(look({ animal: 'pelican' }), 'on');
  const pelican = skillBadgeState({ animal: 'pelican', state: 'ground', swallowCooldown: C.swallowCooldownSeconds / 4 });
  assert.equal(pelican.look, 'cool'); assert.ok(Math.abs(pelican.left - 0.25) < 1e-9);
  assert.equal(look({ animal: 'elephant', trunk: { water: 0.6, empty: false } }), 'on');
  const empty = skillBadgeState({ animal: 'elephant', state: 'ground', trunk: { water: 0.2, empty: true } });
  assert.equal(empty.look, 'cool'); assert.ok(Math.abs(empty.left - 0.8) < 1e-9);
  assert.equal(look({ animal: 'pelican', stunRemaining: 1 }), 'off');
});

test('squirrel lights while clinging; goose while it can still glide', () => {
  assert.equal(look({ animal: 'squirrel' }), 'idle');
  assert.equal(look({ animal: 'squirrel', state: 'air', wall: { ladder: -1 }, wallTime: 1 }), 'on');
  assert.equal(look({ animal: 'squirrel', state: 'air', wall: { ladder: 0 } }), 'idle', 'ladders are no wall cling');
  assert.equal(look({ animal: 'squirrel', state: 'air', wallTime: C.squirrelGripSeconds }), 'cool', 'grip spent until landing');
  assert.equal(look({ animal: 'goose' }), 'on', 'on the ground a jump can always glide');
  const gliding = skillBadgeState({ animal: 'goose', state: 'air', gliding: true, glideRemaining: C.gooseGlideSeconds / 2 });
  assert.equal(gliding.look, 'on'); assert.ok(Math.abs(gliding.left - 0.5) < 1e-9);
  assert.equal(look({ animal: 'goose', state: 'air', glideRemaining: 0 }), 'idle');
});
