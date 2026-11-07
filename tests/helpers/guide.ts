import { Simulation } from '../../shared/sim/RoomSimulation.js';

/** Tests without a DOM still acknowledge the real authority barrier before exercising Ready/gameplay. */
export function confirmGuide(sim: Simulation) {
  let ticks = 0;
  while (sim.game.roundStage === 'guide' && ticks++ < 1000) {
    for (let slot = 0; slot < 4; slot++) sim.confirmGuide(slot, sim.game.guide.id, sim.game.guide.pageIndex);
    sim.tick();
  }
  if (sim.game.roundStage === 'guide') throw new Error('Guide did not close');
}
export function enterPlaying(sim: Simulation) {
  while (sim.phase !== 'game') sim.tick();
  confirmGuide(sim);
  while (sim.game.roundStage === 'ready') sim.tick();
}
