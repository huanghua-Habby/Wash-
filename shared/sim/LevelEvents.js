import { ROAD_SIGN, ROAD_SIGN_PASS_SECONDS } from './RoadSigns.js';
/** Independent event rules; timeline authoring never embeds collisions or rendering. */
const rules = new Map();
export function registerLevelEvent(id, rule) {
  if (typeof id !== 'string' || !id || rules.has(id) || !rule ||
      ['validate', 'start', 'update', 'stop'].some(key => typeof rule[key] !== 'function')) throw new Error(`Invalid event rule: ${id}`);
  rules.set(id, Object.freeze({ ...rule }));
}
registerLevelEvent('roadSign', {
  validate: (params, event) => [-1, 1].includes(params?.side) && Math.abs(event.duration - ROAD_SIGN.warningSeconds - ROAD_SIGN_PASS_SECONDS) < 1e-9,
  // An invocation starts the warning; a single prepared sign is reused. A new manual invocation cancels the previous one.
  start: (game, params, context) => {
    for (const event of [...game.levelScript.events.active]) if (event.type === 'roadSign') game.levelScript.events.stop(event.id);
    return { id: context.id, side: params.side, launchAt: context.startedAt + ROAD_SIGN.warningSeconds };
  }, update: () => {}, stop: () => {},
});
export function validateEvent(event) {
  const rule = rules.get(event?.type);
  if (!rule || event.at !== undefined && (!Number.isFinite(event.at) || event.at < 0) || !Number.isFinite(event.duration) || event.duration <= 0 || !rule.validate(event.params, event))
    throw new Error(`Invalid level event: ${event?.id}`);
}
export class LevelEvents {
  constructor(game) { this.game = game; this.reset(); }
  reset() { if (!this.game.viewOnly) for (const entry of this.active || []) rules.get(entry.type).stop(this.game, entry.state); this.active = []; this.started = []; }
  update(dt) {
    if (this.game.viewOnly) return;
    for (const event of this.game.level.script?.events || []) if (event.at !== undefined && this.game.elapsed >= event.at) this.trigger(event.id, event.at);
    for (const event of [...this.active]) {
      const rule = rules.get(event.type);
      if (this.game.elapsed >= event.end) { rule.stop(this.game, event.state); this.active = this.active.filter(entry => entry !== event); }
      else rule.update(this.game, event.state, dt);
    }
  }
  trigger(id, startedAt = this.game.elapsed) {
    if (this.game.viewOnly || this.started.includes(id)) return;
    const event = this.game.level.script.events.find(event => event.id === id);
    if (!event) throw new Error(`Unknown level event: ${id}`);
    this.started.push(id);
    if (startedAt + event.duration <= this.game.elapsed) return; // expired windows are not replayed
    this.active.push({ id, type: event.type, end: startedAt + event.duration, state: rules.get(event.type).start(this.game, event.params, { id, startedAt }) });
  }
  stop(id) {
    if (this.game.viewOnly) return;
    const event = this.active.find(entry => entry.id === id);
    if (!event) return;
    rules.get(event.type).stop(this.game, event.state);
    this.active = this.active.filter(entry => entry !== event);
  }
  capture() { return structuredClone({ active: this.active, started: this.started }); }
  apply(state) { this.active = structuredClone(state.active); this.started = [...state.started]; }
}
