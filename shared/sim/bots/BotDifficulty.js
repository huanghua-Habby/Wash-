/** Bot v2 difficulty presets (BOTS.md §14.2, §14.7): every human limit and the provocation rate in one place.
 * Lower difficulty is slower, sloppier, more easily distracted and picks fewer fights. Host only; nothing here is synced. */
export const BOT_DIFFICULTY = Object.freeze({
  easy: Object.freeze({
    think: [1.4, 2.4], topK: 3, ignoreBoard: 0.25, aimAngle: 16 * Math.PI / 180, aimRange: 0.8,
    hesitate: 0.6, misjump: 0.08, retaliate: 0.6, reaction: [0.4, 0.7], aggression: 0.2, huntCap: 1, recall: [2, 5], distract: 0.15, signReaction: [0.6, 1.0],
  }),
  normal: Object.freeze({
    think: [0.9, 1.8], topK: 3, ignoreBoard: 0.15, aimAngle: 10 * Math.PI / 180, aimRange: 0.5,
    hesitate: 0.4, misjump: 0.05, retaliate: 0.85, reaction: [0.2, 0.5], aggression: 0.4, huntCap: 2, recall: [1, 3], distract: 0.1, signReaction: [0.3, 0.6],
  }),
  hard: Object.freeze({
    think: [0.6, 1.0], topK: 2, ignoreBoard: 0.05, aimAngle: 4 * Math.PI / 180, aimRange: 0.2,
    hesitate: 0.15, misjump: 0.02, retaliate: 1, reaction: [0.15, 0.3], aggression: 0.55, huntCap: 2, recall: [0.5, 1.5], distract: 0.05, signReaction: [0.1, 0.3],
  }),
});
export const DEFAULT_BOT_DIFFICULTY = 'normal';

/** A profile by preset name, or a full profile object as given (tests tune single knobs this way). */
export function botProfile(difficulty = DEFAULT_BOT_DIFFICULTY) {
  return typeof difficulty === 'string' ? BOT_DIFFICULTY[difficulty] || BOT_DIFFICULTY[DEFAULT_BOT_DIFFICULTY] : difficulty;
}

/** Small seeded generator (mulberry32) so each bot's choices are reproducible in tests. */
export function botRandom(seed) {
  let state = (seed >>> 0) || 1;
  const next = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (pair) => pair[0] + (pair[1] - pair[0]) * next();
  next.chance = (p) => next() < p;
  return next;
}
