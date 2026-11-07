import { LEVELS } from '../shared/levels.js';
import { validateLevelScript } from '../shared/sim/LevelValidation.js';
import { partyStainLayouts, PARTY_FACTORS } from '../shared/sim/PartyBalance.js';
import { STAIN_KINDS } from '../shared/sim/StainDefinitions.js';
import { roadSignDefinitions } from '../shared/sim/RoadSigns.js';

// Importing the registry validates/freeze-checks every preset without creating a scene, renderer or room.
const rows = [];
for (const level of LEVELS) {
  validateLevelScript(level);
  for (const [index, factors] of PARTY_FACTORS.entries()) {
    const layouts = partyStainLayouts(level, factors);
    const stains = level.script.orders.flatMap(order => {
      const result = layouts.get(order.id) || order.stains;
      return order.playerCountStains ? result.slice(0, Math.min(3, index + 1)) : result;
    });
    rows.push({ level: level.id, players: index + 1, seconds: level.clock.duration || 'unlimited', orders: level.script.orders.length,
      stains: stains.length, steps: stains.reduce((sum, stain) => sum + STAIN_KINDS[stain.kind].length, 0),
      maxPerCar: Math.max(0, ...level.script.orders.map(order => order.playerCountStains ? Math.min(3, index + 1) : (layouts.get(order.id) || order.stains).length)),
      signs: roadSignDefinitions(level).length, stars: level.rating.thresholds.join('/') || 'tutorial' });
  }
}
console.table(rows);
console.log(`Validated ${LEVELS.length} levels × 4 party sizes. No browser/GPU or save changes.`);
