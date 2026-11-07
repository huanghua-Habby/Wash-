import { normalizeVersusSettings } from '../protocol.js';
/** Versus-only numbers; co-op keeps washConfig/chargingConfig unchanged. Same rules, different values. */
export const VERSUS = {
  // Each order belongs to the team on its arrival side for its whole life: left (-1) red, right (+1) blue.
  sideTeams: { '-1': 0, '1': 1 },
  // Hose and charging cable reach relative to co-op; applied when the versus map is wired in.
  hoseLengthScale: 2,
  cableLengthScale: 2,
};

/** A match's frozen end conditions: the room's settings when valid, otherwise the defaults. */
export function matchSettings(settings) {
  const source = normalizeVersusSettings(settings);
  return { scoreTarget: source.scoreTarget, timeLimit: source.timeLimit };
}

/** Winner by final score; an equal score is a draw (`winner: null`, HouJianNan's rule, replacing the earlier TEMP red win). */
export function versusOutcome(teamScores) {
  const tie = teamScores[0] === teamScores[1];
  return { winner: tie ? null : teamScores[0] > teamScores[1] ? 0 : 1, tie };
}

/** Team that owns an order arriving on `side`, or null when the side has no team. */
export function teamForSide(side) { return VERSUS.sideTeams[String(side)] ?? null; }
