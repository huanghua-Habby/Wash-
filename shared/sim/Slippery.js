/** Versus soap sabotage: a soaped player is "slippery" for a few seconds and moves on ice.
 * Host-only spreading (soap in hand → other team; slippery → anyone it touches); the movement itself runs in
 * PlayerMotion so local prediction slides exactly like the authority. No browser APIs. */
import { CHARACTER_SCALE as K } from './characterScale.js';
export const SLIPPERY = Object.freeze({
  seconds: 3,        // Each soaping (or contagion) sets the timer back to the full duration.
  immunity: 1,       // After it wears off, a player cannot be soaped again for this long (stops ping-pong).
  acceleration: 8.5 * 0.64, // Ground speed approaches the walk input at this rate (m/s²): slow to start and to turn (× walk scale).
  friction: 2.4 * 0.64, // Coasting deceleration with no input (m/s²): about 2.3 s to stop from full walking speed (× walk scale).
  reach: 0.85 * K,   // Body centre distance that counts as touching (two body radii + a little).
});

/** Start or refresh a player's slippery timer. Returns whether it took (false while immune). */
export function soap(player) {
  if (player.occupied === false || !['ground', 'air'].includes(player.state) || player.swallowedBy) return false;
  if (!(player.slipperyRemaining > 0) && player.slipperyImmunity > 0) return false;
  player.slipperyRemaining = SLIPPERY.seconds;
  return true;
}

const touching = (a, b) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) < SLIPPERY.reach && Math.abs(a.pos.y - b.pos.y) < 0.95 * K;
const able = player => player.occupied !== false && !player.swallowedBy && ['ground', 'air'].includes(player.state);

/** One host tick of soaping and contagion, after movement and body contacts. Versus only.
 * Only a contact that starts this tick counts: two bodies that stay pressed together never pass it back and forth
 * (so soaping someone does not soap you right back), they must part and bump again. `previous` is the pair mask
 * returned by the previous tick; the return value is this tick's mask. Host-local, never sent. */
export function spreadSlippery(players, previous = 0, onSoaped = null) {
  // Triangular pair index (28 pairs for 8 slots) with arithmetic flags, as in PlayerContacts: `1 << (i * n + j)` wraps past
  // 32 bits with eight players and would drop or alias contact edges.
  const n = players.length, bit = (i, j) => { const a = Math.min(i, j), b = Math.max(i, j); return 2 ** (a * (2 * n - a - 1) / 2 + b - a - 1); };
  const has = (mask, i, j) => Math.floor(mask / bit(i, j)) % 2 === 1;
  let contacts = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (able(players[i]) && able(players[j]) && touching(players[i], players[j])) contacts += bit(i, j);
  const sources = players.map(player => able(player) && (player.slipperyRemaining > 0 || player.heldTool?.kind === 'soap'));
  // Decide from this tick's sources first so a chain cannot jump through several players in one tick.
  const hits = [];
  for (let i = 0; i < n; i++) {
    if (!sources[i]) continue;
    const from = players[i], spreading = from.slipperyRemaining > 0, soapy = from.heldTool?.kind === 'soap';
    for (let j = 0; j < n; j++) {
      const to = players[j];
      if (i === j || !has(contacts, i, j) || has(previous, i, j)) continue;
      // Soap in hand only marks the other team; a slippery body passes it on to anyone.
      // Teams are 0 (red) and 1 (blue), so test them as integers, not truthiness.
      if (spreading || (soapy && Number.isInteger(from.team) && Number.isInteger(to.team) && from.team !== to.team)) hits.push([to, spreading ? null : from]);
    }
  }
  // `onSoaped(from, to)` credits a soap-in-hand hit that took (the match record); contagion credits nobody.
  for (const [player, by] of hits) if (soap(player) && by) onSoaped?.(by, player);
  return contacts;
}
