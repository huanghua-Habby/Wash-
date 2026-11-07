/** Pure host evaluation. Counts are statistics, never a substitute for score thresholds. */
export function levelRatingProgress(level, score) {
  if (level.rating?.mode !== 'score') return null;
  const thresholds = [...level.rating.thresholds];
  return { score, thresholds, stars: thresholds.filter(t => score >= t).length,
    ratio: Math.max(0, Math.min(1, score / thresholds[2])) };
}
export function evaluateLevel(level, score, reason) {
  const rating = level.rating || { mode: 'score', thresholds: [25, 55, 130] };
  const tutorial = rating.mode === 'tutorial';
  const stars = tutorial ? null : rating.thresholds.filter(threshold => score >= threshold).length;
  return { reason, outcome: tutorial ? (reason === 'tutorial_complete' ? 'success' : 'failure') : stars > 0 ? 'success' : 'failure',
    ratingMode: rating.mode, stars, thresholds: tutorial ? [] : [...rating.thresholds] };
}
