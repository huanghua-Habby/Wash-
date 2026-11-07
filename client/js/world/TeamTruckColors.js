import { PAL } from '../../../shared/sim/palette.js';
import { teamColor } from '../core/teamColors.js';

/** Versus presentation (HouJianNan): the neutral home truck's cab turns green, each team truck's cab takes its team
 * color. Reads only applied authority state (world mode, order.team); recolors prepared meshes in place. */
/** The green the side cargo trucks' cabs had before versus recolored them. */
export const NEUTRAL_CAB = PAL.orderCargo.cab;
export class TeamTruckColors {
  constructor(homeTruck, orderTrucks) { this.homeTruck = homeTruck; this.orderTrucks = orderTrucks; }
  update(game) {
    const versus = game.active && game.mode === 'versus';
    // The home truck's own palette is already this green (PAL.truckA), so co-op, versus, home and in-round all match.
    this.homeTruck.setCabColor(versus ? NEUTRAL_CAB : this.homeTruck.colors.cab);
    for (const truck of this.orderTrucks) {
      const team = versus ? game.orders.find(order => order.truck === truck)?.team : null;
      truck.setCabColor(teamColor(team) || truck.colors.cab);
    }
  }
}
