import test from 'node:test';
import assert from 'node:assert/strict';
import { onChargeCompleted, orderReward } from '../shared/sim/ChargingRewards.js';

const order = (serial: number, extra = {}) => ({ id: `order-${serial}`, serial, generation: 1, mode: 'working', paid: false, charged: false, remaining: 30, rewardMultiplier: 1, ...extra });
test('charging boosts only current unpaid orders, does not stack or apply to future arrivals', () => {
  const source = order(1, { charged: true }), current = order(2), paid = order(3, { paid: true }), leaving = order(4, { mode: 'leaving' }), expired = order(5, { remaining: 0 });
  const game = { orders: [source, current, paid, leaving, expired], ended: false, viewOnly: false };
  assert.equal(onChargeCompleted(game, source), 2);
  assert.equal(source.rewardMultiplier, 1.5); assert.equal(current.rewardMultiplier, 1.5);
  for (const ignored of [paid, leaving, expired]) assert.equal(ignored.rewardMultiplier, 1);
  const future = order(6); game.orders.push(future);
  assert.equal(onChargeCompleted(game, source), 0); assert.equal(future.rewardMultiplier, 1, 'duplicate completion cannot grant a future order');
  current.charged = true; assert.equal(onChargeCompleted(game, current), 3);
  assert.equal(source.rewardMultiplier, 1.5); assert.equal(current.rewardMultiplier, 1.5); assert.equal(future.rewardMultiplier, 1.5);
  const newGeneration = order(1, { charged: true, generation: 2 }); game.orders = [newGeneration];
  assert.equal(onChargeCompleted(game, newGeneration), 1, 'new vehicle/order generation can charge again');
  newGeneration.generation++; newGeneration.rewardMultiplier = 1;
  assert.equal(onChargeCompleted(game, newGeneration), 1, 'reused object with a fresh generation is not latched');
});
test('charging awards no standalone points and rounds the complete combo-inclusive order reward once', () => {
  const source = order(1, { charged: true }), game = { orders: [source], score: 7, combo: 0, completed: 0 };
  onChargeCompleted(game, source);
  assert.deepEqual([game.score, game.combo, game.completed], [7, 0, 0]);
  assert.equal(orderReward(game, source, 25), 38); assert.equal(orderReward(game, source, 30), 45); assert.equal(orderReward(game, source, 40), 60);
  assert.equal(orderReward(game, order(2), 25), 25);
});
test('inactive, stale or client presentation sources cannot issue charging bonuses', () => {
  for (const extra of [{ ended: true }, { viewOnly: true }]) {
    const source = order(1, { charged: true }), game = { orders: [source], ...extra };
    assert.equal(onChargeCompleted(game, source), 0); assert.equal(source.rewardMultiplier, 1);
  }
  const live = order(1), game = { orders: [live] };
  assert.equal(onChargeCompleted(game, live), 0);
  assert.equal(onChargeCompleted(game, order(1, { charged: true })), 0, 'same serial is not the current source identity');
});
