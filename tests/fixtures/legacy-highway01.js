/** 01: relaxed tutorial. The home menu is a live preview of this level's world. */
import { TUTORIAL_ROAD_SIGNS } from '../../shared/levels/roadSignPresets.js';
export const HIGHWAY_01 = {
  id: 'highway-01', number: '01', name: '新手教程', difficulty: 'tutorial',
  guide: 'basic-controls',
  // Temporary six-sign playtest before authoring the formal tutorial script.
  roadSigns: TUTORIAL_ROAD_SIGNS,
  road: {
    mode: 'treadmill', laneCount: 2, laneWidth: 4.5,
    visibleLength: 360, loopLength: 160, texturePeriod: 12,
    scenerySeed: 42,
  },
  equipment: {
    // Positions are [x, z] on the main vehicle's roof. Keep interaction zones apart.
    washStation: { position: [-4.45, 0], interactionRange: 1.5 },
    towels: { positions: [[-3.4, -0.85], [-3.4, 0.85], [-4.5, 0.85]] },
    waterguns: [{ position: [-0.3, 0.65], supplyPosition: [-0.3, -0.6], supplyHeight: 0.77, recallRange: 1.1 }],
    chargers: [{ position: [4.45, -0.55], supplyPosition: [5.15, -0.65], supplyHeight: 0.25, recallRange: 1.1 }],
    soap: { enabled: true, positions: [[1.25, 0.65]], interactionRange: 1 },
  },
  // Order vehicles cycle through this list; sizes and heights come from shared/sim/vehicles.js.
  orders: {
    vehicles: [
      { type: 'cargo', palette: 'orderCargo', logo: '鲜果速递', sub: 'FRUIT EXPRESS', icon: 'cube' },
      { type: 'pod', palette: 'orderPod' },
      { type: 'bus', palette: 'orderBus' },
      { type: 'sedan', palette: 'orderSedan' },
      { type: 'hauler', palette: 'orderHauler', logo: '云朵搬家', sub: 'CLOUD MOVERS', icon: 'cloud' },
    ],
  },
  home: {
    vehicles: [
      { palette: 'truckA', type: 'washer', name: '洗车飞车', logo: '方方洗车', sub: 'CUBE WASH', icon: 'cube', phase: 0 },
      { palette: 'truckB', type: 'cargo', name: '蓝色飞车', logo: '圆圆物流', sub: 'ROUNDY LOGISTICS', icon: 'cloud', phase: 1.7 },
    ],
    playerSlots: [[-1.8, -0.65], [-3, 0.55], [-0.3, 0.55], [1, -0.65]],
    motion: {
      centerHome: false, speed: 30, speedWaves: [[2.5, 0.11], [1.2, 0.37]],
      initialX: [1.2, -1.2], initialGap: 4.3,
      phaseDelay: 3, phaseInterval: [4, 8],
      leadRange: [1.5, 4.7], followRange: [-2.5, 0],
      parallelChance: 0.25, parallelRange: [-0.75, 0.75],
      longitudinalSpring: 0.55, longitudinalDamping: 1.05,
      gapDelay: 2.5, gapInterval: [2.5, 6],
      closeGapChance: 0.3, closeGapRange: [3.5, 3.65], cruiseGapRange: [3.9, 4.8],
      gapSpring: 0.9, gapDamping: 1.6, driftAmplitude: 0.2, driftFrequency: 0.29,
      roofWobble: 0.12,
    },
  },
};
