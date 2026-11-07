/** Per-player match record for the Tab board, the "+N" chip and the versus awards. Host-only tallies; viewers apply the
 * snapshot copy. Counters are raw facts (steps wiped, slaps landed…); points and titles are derived here, from the same
 * numbers on every page, so the board, the chip and the results never disagree. No browser APIs. */

/** Snapshot order. Appending a key is a wire change (protocol bump); never reorder. */
export const STAT_KEYS = Object.freeze([
  'work',      // Cleaning steps advanced (wipe, lather, rinse); 1 = one whole step.
  'stains',    // Stains this player finished (made the last step).
  'charge',    // Seconds a charger this player plugged in kept charging (versus: own team's truck only).
  'wash',      // Towels washed back at the basin (1 = a full towel).
  'sabotage',  // Versus: enemy steps undone by smearing or washing back.
  'unplug',    // Versus: chargers pulled out of the enemy's truck.
  'slaps',     // Slaps landed (versus: on the other team; co-op: on anyone, it is mischief there).
  'knockoffs', // Bodies that fell off within a few seconds of this player's slap, jet or spit.
  'swallows',  // Pelican: players swallowed.
  'soaped',    // Versus: enemies made slippery with soap in hand.
  'friendly',  // Versus: slaps, knock-offs and swallows on your own team. Recorded for the 内鬼 title only: never scored.
  'slapped',   // Times slapped.
  'falls',     // Times fallen off.
  'hacks',     // Versus: hacks finished at the hack console (HackConsole.js).
]);

/** Points per counter. Balance values (HouJianNan's table, VERSUS_RULES.md §8); keys never on a list score nothing. */
export const STAT_POINTS = Object.freeze({
  contribution: Object.freeze({ work: 10, stains: 5, charge: 1, wash: 4 }),
  disruption: Object.freeze({ sabotage: 10, unplug: 6, slaps: 2, knockoffs: 8, swallows: 5, soaped: 3, hacks: 12 }),
  // Co-op has no opponent: hitting a teammate is mischief, shown beside the work but never subtracted from it.
  mischief: Object.freeze({ slaps: 2, knockoffs: 8, swallows: 5 }),
});

/** A shove is credited for a fall that follows within this long (host seconds). */
export const KNOCKOFF_SECONDS = 3;

export const emptyStats = () => Object.fromEntries(STAT_KEYS.map(key => [key, 0]));
export const createStats = count => Array.from({ length: count }, emptyStats);

/** Snapshot form: one number list per slot, rounded to 0.01 so a steady wipe changes few digits. */
export const packStats = stats => stats.map(entry => STAT_KEYS.map(key => Math.round((entry[key] || 0) * 100) / 100));
export function unpackStats(packed, count) {
  const stats = createStats(count);
  if (Array.isArray(packed)) packed.slice(0, count).forEach((row, slot) => STAT_KEYS.forEach((key, i) => {
    const value = Array.isArray(row) ? row[i] : 0;
    stats[slot][key] = Number.isFinite(value) && value > 0 ? value : 0;
  }));
  return stats;
}

const weigh = (entry, table) => Object.entries(table).reduce((sum, [key, points]) => sum + (entry?.[key] || 0) * points, 0);

/** Board numbers for one player. `contribution` is work for your side; `disruption` is versus sabotage and hits on the
 * enemy, `mischief` the co-op hits on teammates; `rating` ranks the board. Rounded to whole points for display. */
export function statPoints(entry, mode) {
  const contribution = Math.round(weigh(entry, STAT_POINTS.contribution));
  if (mode === 'versus') {
    const disruption = Math.round(weigh(entry, STAT_POINTS.disruption));
    return { contribution, disruption, mischief: 0, rating: contribution + disruption };
  }
  const mischief = Math.round(weigh(entry, STAT_POINTS.mischief));
  return { contribution, disruption: 0, mischief, rating: contribution };
}

/** Host side: one tally per slot plus who last shoved whom (host-local, never sent). */
export class StatsTally {
  constructor(game) { this.game = game; this.reset(); }
  reset() {
    this.list = createStats(this.game.players.length);
    this.clock = 0; this.shoves = this.game.players.map(() => null);
  }
  get counting() {
    const g = this.game;
    return !g.viewOnly && g.active && !g.practice && g.roundStage === 'playing' && !g.ended && !g.paused;
  }
  slot(player) { return this.game.players.indexOf(player); }
  add(player, key, amount = 1) {
    const slot = this.slot(player);
    if (!this.counting || slot < 0 || !(amount > 0)) return;
    this.list[slot][key] += amount;
  }
  advance(dt) { if (this.counting) this.clock += dt; }
  /** Versus: same team. Co-op players have no team, so nobody is "friendly" there. */
  sameTeam(a, b) { return this.game.mode === 'versus' && Number.isInteger(a?.team) && a.team === b?.team; }
  /** `attacker` hit `victim` (`slaps`, `knockoffs`, `swallows`, `soaped`). A versus hit on your own team is only
   * recorded as `friendly` (the 内鬼 title): mischief is welcome, it neither scores nor costs points. */
  hit(attacker, victim, key) {
    if (!attacker || !victim || attacker === victim) return;
    this.add(attacker, this.sameTeam(attacker, victim) ? 'friendly' : key);
    if (key === 'slaps') this.add(victim, 'slapped');
  }
  /** Remember the last shove so a fall that follows can be credited (slap, water jet, trunk, pelican spit). */
  shove(attacker, victim) {
    const slot = this.slot(victim);
    if (!this.counting || slot < 0 || !attacker || attacker === victim) return;
    this.shoves[slot] = { by: attacker, at: this.clock };
  }
  fell(victim) {
    const slot = this.slot(victim);
    if (!this.counting || slot < 0) return;
    this.add(victim, 'falls');
    const shove = this.shoves[slot]; this.shoves[slot] = null;
    if (shove && this.clock - shove.at <= KNOCKOFF_SECONDS && shove.by.occupied !== false) {
      this.hit(shove.by, victim, 'knockoffs');
      // Presentation serial for the knock-off feedback (teammates too: the feedback is about the shove, not the score).
      shove.by.knockoutSerial = (shove.by.knockoutSerial || 0) + 1; shove.by.knockoutVictim = slot;
    }
  }
}

/** Award order: each player takes at most one title, the first one they qualify for. `min` is the least a title needs,
 * so a quiet match hands out few titles. `pick` ranks (higher wins); `scope` limits who may take it. */
const VERSUS_TITLES = [
  { id: 'mvp', pick: p => p.points.rating, min: 10, scope: 'winners' },
  { id: 'villain', pick: p => p.points.disruption, min: 12 },
  { id: 'worker', pick: p => p.points.contribution, min: 12 },
  { id: 'smearer', pick: p => p.stats.sabotage, min: 0.6 },
  { id: 'bouncer', pick: p => p.stats.knockoffs, min: 1 },
  { id: 'smacker', pick: p => p.stats.slaps, min: 3 },
  { id: 'battery', pick: p => p.stats.charge, min: 6 },
  { id: 'traitor', pick: p => p.stats.friendly, min: 2 },
  { id: 'punchbag', pick: p => p.stats.slapped + p.stats.falls, min: 3 },
  { id: 'slacker', pick: p => -p.points.rating, min: -Infinity, scope: 'crowd' },
];
const COOP_TITLES = [
  { id: 'worker', pick: p => p.points.contribution, min: 12 },
  { id: 'prankster', pick: p => p.points.mischief, min: 6 },
  { id: 'battery', pick: p => p.stats.charge, min: 6 },
  { id: 'laundry', pick: p => p.stats.wash, min: 0.8 },
  { id: 'punchbag', pick: p => p.stats.slapped + p.stats.falls, min: 3 },
];

/**
 * Rank and title the players of a match.
 * @param {{ slot: number, team?: number|null, stats: Record<string, number> }[]} entries occupied slots only
 * @param {{ mode: 'coop'|'versus', winner?: number|null }} options
 * @returns {{ slot: number, team: number|null, stats: object, points: ReturnType<typeof statPoints>, rank: number, title: string|null }[]}
 *   sorted best first; rank 1 is the top rating (ties share a rank).
 */
export function rankPlayers(entries, { mode, winner = null }) {
  const players = entries.map(entry => ({ slot: entry.slot, team: Number.isInteger(entry.team) ? entry.team : null,
    stats: { ...emptyStats(), ...entry.stats }, points: statPoints(entry.stats, mode), rank: 0, title: null }));
  players.sort((a, b) => b.points.rating - a.points.rating || b.points.contribution - a.points.contribution || a.slot - b.slot);
  players.forEach((player, i) => { player.rank = i && player.points.rating === players[i - 1].points.rating ? players[i - 1].rank : i + 1; });
  for (const title of mode === 'versus' ? VERSUS_TITLES : COOP_TITLES) {
    let pool = players.filter(player => !player.title);
    if (title.scope === 'winners' && (winner === 0 || winner === 1)) pool = pool.filter(player => player.team === winner);
    // "Slacker" only makes sense among enough people, and never for someone who already did well.
    if (title.scope === 'crowd' && (players.length < 3 || pool.length < 1)) continue;
    let best = null;
    for (const player of pool) {
      const value = title.pick(player);
      if (value >= title.min && (best === null || value > best.value)) best = { player, value };
    }
    if (!best) continue;
    if (title.scope === 'crowd' && (players[0].points.rating < 20 || -best.value > players[0].points.rating * 0.4)) continue;
    // A shared top value is not a title: nobody stands out.
    if (title.scope !== 'crowd' && pool.some(player => player !== best.player && title.pick(player) === best.value)) continue;
    best.player.title = title.id;
  }
  return players;
}
