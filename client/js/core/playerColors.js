import { AVATAR_COLORS } from '../../../shared/avatar.js';
import { MAX_PLAYER_SLOTS } from '../../../shared/levels.js';
/** One default identity colour per prepared character slot (versus worlds use up to eight). */
export const PLAYER_COLORS = Object.freeze(AVATAR_COLORS.slice(0, MAX_PLAYER_SLOTS.length));
export const playerColor = (slot) => PLAYER_COLORS[slot % PLAYER_COLORS.length];
