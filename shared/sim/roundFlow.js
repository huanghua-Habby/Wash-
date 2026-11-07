/** Authority-owned round cues. Viewers only render the captured stage and time. */
export const ROUND_FLOW = Object.freeze({ readySeconds: 3, goSeconds: 0.8, finishSeconds: 2.4 });
export const isPreparing = game => game.roundStage === 'guide' || game.roundStage === 'ready';
/** Reading freezes the world clock; guide acknowledgements/close and Ready use their own authority stage clock. */
export const isWorldFrozen = game => !!game.paused || game.roundStage === 'guide';

export function roundCue(game) {
  if (!game.active) return '';
  if (game.roundStage === 'ready') return `ready-${Math.max(1, Math.ceil(ROUND_FLOW.readySeconds - game.roundStageTime))}`;
  if (game.roundStage === 'finish') return 'finish';
  if (game.roundStage === 'playing' && game.elapsed < ROUND_FLOW.goSeconds) return 'go';
  return '';
}
