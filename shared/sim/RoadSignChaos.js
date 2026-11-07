/** Versus road-sign chaos (VERSUS_RULES.md §1.1): a level's `roadSignChaos` turns the frozen match settings into a sign
 * schedule. Deterministic from the level seed and the time limit, so host and guests derive the same list from the
 * snapshot's `matchSettings`; only the host judges hits. No browser APIs. */
import { mulberry32 } from './util.js';

/** Sign definitions `{ id, side, tone, atMinutes }` for `chaos` under a time limit in seconds (null: score-only);
 * `tones` are the sign colours to draw from. */
export function chaosSigns(chaos, timeLimit, tones) {
  const { every = 15, firstAt = 20, endGap = 10, jitter = 3, seed = 1, max = 60 } = chaos;
  const random = mulberry32((seed * 9973 + (timeLimit || 0)) | 0);
  const end = timeLimit ? timeLimit - endGap : Infinity, signs = [];
  let lastSide = 0, run = 0;
  for (let i = 0, at = firstAt; signs.length < max && at <= end; i++, at = firstAt + i * every) {
    const t = Math.min(end, Math.max(firstAt, at + (random() * 2 - 1) * jitter));
    // Random side, never three in a row on one side.
    let side = random() < 0.5 ? -1 : 1;
    if (side === lastSide && run >= 2) side = -side;
    run = side === lastSide ? run + 1 : 1; lastSide = side;
    signs.push({ id: `chaos-${i + 1}`, side, tone: tones[Math.floor(random() * tones.length)], atMinutes: t / 60 });
  }
  return signs;
}
