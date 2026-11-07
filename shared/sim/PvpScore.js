/** Versus scoring, host-only (HouJianNan's rules). A team scores per stain on its own truck; a stain that is undone
 * loses exactly the points it was awarded (so a later charge bonus cannot be farmed) and breaks that team's combo.
 * The team score therefore always equals the sum of `stain.points` over its truck's currently-done stains, plus the
 * charge bonuses already paid. Teams are the world's indices (0 red, 1 blue); tallies live on the WashSimulation. */

export const PVP_SCORE = Object.freeze({
  stainPoints: 10,   // One finished stain.
  comboTip: 2,       // Added per consecutive finished stain, capped below.
  maximumCombo: 4,
});

/** Versus sabotage tuning (towel smudge / water rollback). Kept beside scoring for playtest edits. */
export const PVP_TUNING = Object.freeze({
  smudgeSeconds: 1.15,   // A dirty towel undoes one towel step in this long (same as a normal wipe).
  rinseBackSeconds: 1.2, // A jet on the enemy truck undoes one rinse step in this long (same as a normal rinse).
  // Water-gun shove in versus. Campaign is 2.75 (half of walking 5.5); above walking speed a full jet holds a
  // player back and can drive them off a roof, so the gun is worth fighting over. Mass still divides it.
  sprayPushSpeed: 7,
  // Seconds to fill one truck's charge bar in versus (campaign keeps CHARGING.seconds = 6). Longer, so a plugged-in
  // connector stays exposed long enough for the other team to come and pull it.
  chargeSeconds: 12,
});

/** Versus: whether a dirty towel can rub this stain back (a done stain ending in a towel step, or towel progress made).
 * Shared by the host rule and the local "go smear it" cue so the two never disagree. */
export const smudgeable = stain => stain.done ? stain.steps.at(-1) === 'towel' : stain.steps[stain.stage] === 'towel' && stain.progress > 0.000001;

/** Whether `order` belongs to the other team from `player` in a versus world. */
export const enemyOrder = (game, player, order) => game.mode === 'versus' && Number.isInteger(order?.team) && Number.isInteger(player?.team) && order.team !== player.team;

/** Points a team earns for its next finished stain. The charge ×1.5 is not applied here; see versusChargeBonus. */
export function stainReward(combo) {
  return PVP_SCORE.stainPoints + PVP_SCORE.comboTip * Math.min(combo, PVP_SCORE.maximumCombo);
}

const scoring = (game, order) => game.mode === 'versus' && !game.viewOnly && Number.isInteger(order?.team);

/** A truck leaves fully washed: if its charge bar was full by then, its team gains the extra (×1.5 − 1) on all of
 * that truck's stains in one go. A bar still short of full is simply lost with the truck. Returns the bonus. */
export function versusChargeBonus(game, order) {
  if (!scoring(game, order) || !order.charged) return 0;
  const earned = order.stains.reduce((sum, stain) => sum + (stain.points || 0), 0);
  const bonus = Math.round(earned * ((order.rewardMultiplier || 1) - 1));
  game.teamScores[order.team] += bonus; game.teamChargeBonus[order.team] += bonus;
  return bonus;
}

/** A stain on `order` just became done. Only the owning team's own truck scores. Returns the points awarded. */
export function stainCompleted(game, order, stain) {
  if (!scoring(game, order) || game.ended || stain.points > 0) return 0;
  const team = order.team;
  game.teamCombos[team]++;
  const points = stainReward(game.teamCombos[team]);
  stain.points = points; game.teamScores[team] += points; game.teamCleaned[team]++;
  return points;
}

/** A done stain on `order` was knocked back below done. Removes what it was worth and breaks the combo. */
export function stainUndone(game, order, stain) {
  if (!scoring(game, order) || game.ended) return 0;
  const team = order.team, lost = stain.points || 0;
  stain.points = 0; game.teamCombos[team] = 0;
  if (!lost) return 0;
  game.teamScores[team] -= lost; game.teamUndone[team]++;
  return lost;
}
