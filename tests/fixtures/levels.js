/** Stable legacy scenarios for mechanics regression. Production levels are tested in level-framework.test.ts. */
import { HIGHWAY_01 } from './legacy-highway01.js';
import { HIGHWAY_02 } from './legacy-highway02.js';
export { SAVE_VERSION, FIRST_LEVEL_ID, validRoundResult } from '../../shared/levels.js';
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
export const LEVELS = [freeze(HIGHWAY_01), freeze(HIGHWAY_02)];
export function getLevel(id) { return LEVELS.find(level => level.id === id) || null; }
