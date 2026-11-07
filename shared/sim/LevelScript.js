import { LevelEvents } from './LevelEvents.js';
import { partyStainLayouts } from './PartyBalance.js';
import { L_SKILL_ANIMALS } from './PlayerMotion.js';

export { validateLevelScript } from './LevelValidation.js';

/** Declarative progression. Waiting advances world time; only ordinary user pause freezes it. */
export class LevelScript {
  constructor(game) { this.game = game; this.events = new LevelEvents(game); this.reset(); }
  reset() {
    this.index = -1; this.enteredAt = 0; this.holdTime = 0; this.revision = 0; this.moved = this.zeroPerSlot(); this.requests = []; this.finished = []; this.behaviorOverrides = {}; this.events.reset();
    this.marks = this.serialMarks(); this.lend(''); this.game.dummy?.setActive(false);
  }
  start() { this.reset(); this.preparePartyLayouts(); if (this.game.level.script?.steps.length) this.enter(0); }
  preparePartyLayouts() {
    if (this.layoutLevel === this.game.level && this.layoutPlayers === this.game.partyBalance.playerCount) return;
    this.layouts = partyStainLayouts(this.game.level, this.game.partyBalance);
    this.layoutLevel = this.game.level; this.layoutPlayers = this.game.partyBalance.playerCount;
  }
  /** One counter per character slot of this world. */
  zeroPerSlot() { return (this.game.players || []).map(() => 0); }
  clearSlot(slot) {
    this.moved[slot] = 0; this.holdTime = 0;
    // A new occupant starts the L / emote lesson from scratch.
    const player = this.game.players?.[slot];
    if (player && this.marks?.[slot]) this.marks[slot] = this.serialMarks()[slot];
  }
  /** Per-slot skill/emote counters when the current step began; a step counts uses after this. */
  serialMarks() { return (this.game.players || []).map((p, slot) => ({ skill: p.skillSerial || 0, emote: p.emoteSerial || 0, dummy: this.game.dummy?.hits[slot] || 0 })); }
  /** Step `morph`: lend that animal to every player without an L ability ('' gives everyone theirs back). Host only. */
  lend(animal) {
    if (this.game.viewOnly) return;
    for (const player of this.game.players || []) {
      const lent = animal && player.occupied !== false && !L_SKILL_ANIMALS.includes(player.baseAnimal) ? animal : '';
      if ((player.morph || '') !== lent) player.setMorph?.(lent);
    }
  }
  get step() { return this.game.level.script?.steps[this.index] || null; }
  definition(id) {
    const order = this.game.level.script?.orders.find(order => order.id === id), stains = this.layouts?.get(id);
    return order && stains ? { ...order, stains } : order;
  }
  enqueue(id) {
    if (this.requests.some(request => request.id === id)) return;
    const definition = this.definition(id);
    const serial = this.game.orderSerial++;
    this.requests.push({ id, serial, status: 'queued', behaviorId: this.behaviorOverrides[id] || definition.behavior, stains: definition.playerCountStains
      ? definition.stains.slice(0, Math.max(1, Math.min(3, this.participants().length))) : definition.stains });
  }
  participants() { return this.game.players.map((p, slot) => ({ p, slot })).filter(({ p }) => p.occupied !== false && p.connected !== false); }
  enter(index) {
    this.index = index; this.enteredAt = this.game.elapsed; this.holdTime = 0; this.revision++;
    this.moved = this.zeroPerSlot(); this.marks = this.serialMarks(); this.lend(this.step?.morph || ''); this.game.dummy?.setActive(!!this.step?.dummy);
    for (const action of this.step?.enter || []) this.execute(action);
  }
  execute(action) {
    if (action.type === 'equipment') this.game.setEquipment(action.keys);
    else if (action.type === 'spawn') this.enqueue(action.orderId);
    else if (action.type === 'leave') this.game.leaveOrder(this.game.orders.find(o => o.id === action.orderId));
    else if (action.type === 'finish') this.game.finish('tutorial_complete');
    else if (action.type === 'event') this.events.trigger(action.eventId);
    else if (action.type === 'stopEvent') this.events.stop(action.eventId);
    else if (action.type === 'behavior') {
      this.behaviorOverrides[action.orderId] = action.behavior;
      const request = this.requests.find(r => r.id === action.orderId); if (request) request.behaviorId = action.behavior;
      const order = this.game.orders.find(o => o.id === action.orderId); if (order) { order.behaviorId = action.behavior; order.behaviorState = {}; }
      const lane = this.game.lanes.find(l => l.serial === request?.serial); if (lane) lane.behaviorId = action.behavior;
    }
  }
  beforeFleet(dt) {
    if (this.game.viewOnly) return;
    for (const order of this.game.level.script?.orders || []) if (order.at !== undefined && this.game.elapsed >= order.at) this.enqueue(order.id);
    for (const request of this.requests) if (request.status === 'queued') {
      const def = this.definition(request.id);
      if (this.game.orders.some(o => o.side === def.side) || this.game.lanes.some(l => l.side === def.side)) continue;
      if (this.game.openLane(request.serial)) request.status = 'active';
    }
    this.events.update(dt);
  }
  targets() {
    const step = this.step;
    if (!step) return [];
    if (step.condition.type === 'clean') {
      const order = this.game.orders.find(o => o.id === step.condition.orderId);
      return (order?.stains || []).map(s => ({ id: s.id, slot: null, active: true, complete: s.done }));
    }
    return this.participants().map(({ p, slot }) => ({ id: `player-${slot}`, slot, active: true,
      complete: step.condition.type === 'moved' ? this.moved[slot] >= (step.condition.distance || .35)
        : step.condition.type === 'emptyHands' ? !p.heldTool && !p.swallowed?.kind
        : step.condition.type === 'home' ? p.state === 'ground' && p.ground?.truck === this.game.homeTruck
        : step.condition.type === 'skill' ? (p.skillSerial || 0) > (this.marks?.[slot]?.skill ?? Infinity)
        : step.condition.type === 'emote' ? (p.emoteSerial || 0) > (this.marks?.[slot]?.emote ?? Infinity)
        : step.condition.type === 'dummy' ? (this.game.dummy?.hits[slot] || 0) > (this.marks?.[slot]?.dummy ?? Infinity) : false }));
  }
  afterActors(dt, oldPositions) {
    if (this.game.viewOnly || !this.step) return;
    // Someone who arrives during a lending step gets the body too.
    if (this.step.morph) this.lend(this.step.morph);
    if (this.step.condition.type === 'moved') for (const { p, slot } of this.participants()) {
      const move = this.game.inputs[slot].worldAxis();
      if (p.state === 'ground' && !p.swallowedBy && p.externalVelocity.lengthSq() < .01 && Math.hypot(move.x, move.z) > .1)
        this.moved[slot] = Math.min(this.step.condition.distance || .35, this.moved[slot] + Math.min(.15, Math.hypot(p.pos.x - oldPositions[slot].x, p.pos.z - oldPositions[slot].z)));
    }
    const step = this.step, targets = this.targets();
    const ready = this.participants().length > 0 && (step.condition.type === 'reclaimed'
      ? this.finished.includes(step.condition.orderId) : step.condition.type === 'elapsed' ? this.game.elapsed - this.enteredAt + dt >= step.condition.seconds : targets.length > 0 && targets.every(t => t.complete));
    this.holdTime = ready ? this.holdTime + dt : 0;
    if (ready && this.holdTime + 1e-9 >= (step.hold || 0) && this.game.elapsed - this.enteredAt + dt >= (step.minimumSeconds || 0)) {
      for (const action of step.exit || []) this.execute(action);
      if (!this.game.ended) this.enter(this.index + 1);
    }
  }
  presentation() {
    const step = this.step;
    if (!step) return null;
    const text = step.praise && this.game.elapsed - this.enteredAt < 1 ? step.praise : step.text;
    return { stepId: step.id, hintId: step.id, text, revision: this.revision,
      dots: { kind: step.condition.type === 'clean' ? 'stains' : ['reclaimed', 'elapsed'].includes(step.condition.type) ? 'none' : 'players',
        entries: ['reclaimed', 'elapsed'].includes(step.condition.type) ? [] : this.targets() } };
  }
  capture() { return structuredClone({ index: this.index, enteredAt: this.enteredAt, holdTime: this.holdTime, revision: this.revision, moved: this.moved, marks: this.marks,
    requests: this.requests, finished: this.finished, behaviorOverrides: this.behaviorOverrides, events: this.events.capture() }); }
  restore(state) { const events = this.events; Object.assign(this, structuredClone(state)); this.events = events; events.apply(state.events); }
  signature() { return `${this.index}:${this.targets().map(t => `${t.id}:${t.complete}`).join(',')}:${this.requests.map(r => r.status).join(',')}:${this.events.active.map(e => e.id).join(',')}`; }
}
