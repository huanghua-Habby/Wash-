/** Host-only bot controllers. Each bot slot gets a controller that turns its brain's intent into the same input
 * packet a player sends; the shared RoomSimulation consumes it like any other input. Nothing here is synced. */
import { BotMotor } from './BotMotor.js';
import { BotBrain, BotTaskBoard } from './BotBrain.js';
import { botProfile, botRandom } from './BotDifficulty.js';

export class BotController {
  constructor(slot, board, profile) {
    // One seeded generator per bot: brain and motor draw from it, so a test run repeats exactly.
    const random = botRandom(0x9E3779B1 ^ (slot + 1) * 7919);
    this.slot = slot; this.motor = new BotMotor(profile, random); this.brain = new BotBrain(slot, board, profile, random);
  }
  /** One fixed tick for this bot; `dt` is 0 while the world is frozen so timers and plans hold still. */
  update(sim, dt) {
    const player = sim.players[this.slot];
    const intent = this.brain?.update(player, sim, dt, this.motor) || this.motor.update(player, sim.game.activeTrucks(), dt);
    const hits = [], down = [];
    if (intent.jump) { hits.push('Space'); down.push('Space'); }
    for (const key of intent.press || []) { if (!hits.includes(key)) hits.push(key); if (!down.includes(key)) down.push(key); }
    for (const key of intent.hold || []) if (!down.includes(key)) down.push(key);
    return { move: [intent.move.x, intent.move.z], axis: [intent.move.x, intent.move.z], down, hits };
  }
}

export class BotManager {
  constructor(difficulty) { this.controllers = new Map(); this.boards = new Map(); this.seq = 0; this.lastTick = -1; this.profile = botProfile(difficulty); }
  /** Preset name or full profile (BOTS.md §14.2); every bot, current and future, uses it from the next tick. */
  setDifficulty(difficulty) { this.profile = botProfile(difficulty); for (const c of this.controllers.values()) { c.brain.profile = c.motor.profile = this.profile; } }
  /** Keep exactly one controller per bot slot; bots of one team share one task board.
   * @param {Set<number>} slots @param {(slot: number) => number} [teamOf] */
  sync(slots, teamOf = (_slot) => 0) {
    for (const slot of [...this.controllers.keys()]) if (!slots.has(slot)) {
      this.controllers.delete(slot);
      for (const board of this.boards.values()) board.release(slot); // a handed-back character keeps no bot claims
    }
    if (!slots.size) this.boards.clear();
    for (const slot of slots) if (!this.controllers.has(slot)) {
      const team = teamOf(slot);
      if (!this.boards.has(team)) this.boards.set(team, new BotTaskBoard());
      this.controllers.set(slot, new BotController(slot, this.boards.get(team), this.profile));
    }
  }
  controller(slot) { return this.controllers.get(slot) || null; }
  /** The emote this bot's brain chose this tick, once; the room applies it with the shared emote rule. */
  takeEmote(slot) { const brain = this.controllers.get(slot)?.brain; const id = brain?.emote || ''; if (brain) brain.emote = ''; return id; }
  input(sim, slot, dt) {
    // Reservations age once per authority tick, however many bots ask.
    if (this.lastTick !== sim.tickCount) { this.lastTick = sim.tickCount; for (const board of this.boards.values()) board.tick(dt); }
    const controller = this.controllers.get(slot);
    const packet = controller ? controller.update(sim, dt) : { move: [0, 0], axis: [0, 0], down: [], hits: [] };
    return { seq: ++this.seq, ...packet };
  }
}
