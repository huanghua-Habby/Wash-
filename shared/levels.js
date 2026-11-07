/** Shared lightweight level list. Save version changes whenever the persisted progress contract changes. */
export const SAVE_VERSION = '0.5';
import { HIGHWAY_01 } from './levels/highway01.js';
import { HIGHWAY_02 } from './levels/highway02.js';
import { HIGHWAY_03 } from './levels/highway03.js';
import { HIGHWAY_04 } from './levels/highway04.js';
import { HIGHWAY_05 } from './levels/highway05.js';
import { VERSUS_01 } from './levels/versus01.js';
import { validateLevelSet } from './sim/LevelValidation.js';
/** @template T @param {T} value @returns {T} */
function freezeConfig(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeConfig); Object.freeze(value); }
  return value;
}
const presets = [HIGHWAY_01, HIGHWAY_02, HIGHWAY_03, HIGHWAY_04, HIGHWAY_05];
const versusPresets = [VERSUS_01];
// Each mode prepares one shared asset manifest; ids are unique across both.
validateLevelSet(presets); validateLevelSet(versusPresets); validateLevelSet([...presets, ...versusPresets], { sameSlots: false });
/** Co-op levels: level cards, next level and the wash-progress save use only this list. */
export const LEVELS = Object.freeze(presets.map(freezeConfig));
/** Versus maps (0.5, GameLogic). Never saved. */
export const VERSUS_LEVELS = Object.freeze(versusPresets.map(freezeConfig));
export const FIRST_LEVEL_ID = LEVELS[0].id;
/** Every level a client prepares at startup, across modes. */
export const ALL_LEVELS = Object.freeze([...LEVELS, ...VERSUS_LEVELS]);
/** Home slots of the level with the most characters; clients build this many actors at startup. */
export const MAX_PLAYER_SLOTS = /** @type {readonly (readonly number[])[]} */ (ALL_LEVELS.reduce((best, level) => level.home.playerSlots.length > best.length ? level.home.playerSlots : best, /** @type {readonly (readonly number[])[]} */ ([])));
/** Resolve a stable level id in either mode; display names and room codes are not save identifiers. */
export function getLevel(id) { return ALL_LEVELS.find((level) => level.id === id) || null; }
/** A level's mode; co-op levels carry no mode field. */
export const levelMode = (level) => level?.mode === 'versus' ? 'versus' : 'coop';
/** The level a room of this mode loads on its main menu. */
export function firstLevelFor(mode) { return (mode === 'versus' ? VERSUS_LEVELS : LEVELS)[0].id; }
/** Co-op lookup for the wash-progress save: versus maps are never entered, resumed or recorded. */
export function getCoopLevel(id) { return LEVELS.find((level) => level.id === id) || null; }
export function nextLevelId(id) { const index = LEVELS.findIndex(level => level.id === id); return index < 0 ? null : LEVELS[index + 1]?.id || null; }
/** Accept only completed round results emitted by the authority, never a client-authored score command. */
export function validRoundResult(result) {
  return result?.saveVersion === SAVE_VERSION && typeof result.roundId === 'string' && result.roundId.length > 0 && result.roundId.length <= 64 &&
    !!getCoopLevel(result.levelId) && Number.isSafeInteger(result.score) && result.score >= 0 &&
    Number.isSafeInteger(result.completedOrders) && result.completedOrders >= 0 &&
    Number.isSafeInteger(result.missed) && result.missed >= 0 &&
    Number.isInteger(result.partyBalance?.playerCount) && result.partyBalance.playerCount >= 1 && result.partyBalance.playerCount <= 4 &&
    ['time_up', 'tutorial_complete'].includes(result.reason) && ['success', 'failure'].includes(result.outcome) &&
    (getLevel(result.levelId).rating.mode === 'tutorial' ? result.stars === null && result.reason === 'tutorial_complete' && result.outcome === 'success'
      : Number.isInteger(result.stars) && result.stars >= 0 && result.stars <= 3 && result.reason === 'time_up' &&
        result.stars === getLevel(result.levelId).rating.thresholds.filter(n => result.score >= n).length && result.outcome === (result.stars > 0 ? 'success' : 'failure'));
}
