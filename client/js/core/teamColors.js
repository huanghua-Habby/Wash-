/** Versus team presentation (HouJianNan's team plate, ring and cab colors). The team itself is authority state:
 * world team indices 0 red and 1 blue (player.team from the roster, order.team from its side). Colors come from
 * CFG.team so both team looks (TEAM_PRESENTATION.md) share one palette. */
import { CFG } from './config.js';

export const TEAM_LABELS = Object.freeze(['红队', '蓝队']);
const isTeam = team => team === 0 || team === 1;
/** The team color, or null outside a team. */
export const teamColor = team => isTeam(team) ? CFG.team[team === 0 ? 'red' : 'blue'] : null;
/** Whether the HouJianNan team plate look is active (the default); 'hat' is Mayulong's ring + hat look. */
export const plateStyle = () => CFG.team.style !== 'hat';
/** A player's on-screen color: the team color under the plate look, otherwise their own identity color. */
export const displayColor = (player, fallback) => (plateStyle() && teamColor(player.team)) || player.identityColor || fallback;
