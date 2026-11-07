/** Exercise original mechanics against a fixed authoring fixture, through the SAME shared authority. */
import { Simulation as RoomSimulation } from '../../shared/sim/RoomSimulation.ts';
import { getLevel } from './levels.js';
export class Simulation extends RoomSimulation {
  constructor(level = getLevel('highway-01'), mode = level?.mode === 'versus' ? 'versus' : 'coop') { super(level, mode); }
}
