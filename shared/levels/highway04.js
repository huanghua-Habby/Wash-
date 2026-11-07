import { HIGHWAY_03 } from './highway03.js';
import { order } from './authoring.js';
export const HIGHWAY_04 = {
  ...HIGHWAY_03, id: 'highway-04', number: '04', name: '移动加油站！', guide: 'tools-charging',
  description: '两分钟 · 可选充电 · 耐心 +20%', unlockedEquipment: [...HIGHWAY_03.unlockedEquipment, 'charger'],
  road: { ...HIGHWAY_03.road, scenerySeed: 168 },
  script: { steps: [], events: [], orders: [
    order('charge-01', 2, -1, 'cargo', ['dust', 'mud', 'grease'], { multiplier: 1.2, behavior: 'wideCruise' }),
    order('charge-02', 12, 1, 'pod', ['dust', 'mud'], { multiplier: 1.2, behavior: 'wideCruise' }),
    order('charge-03', 26, -1, 'bus', ['dust', 'mud', 'grease'], { multiplier: 1.2, behavior: 'wideCruise' }),
    order('charge-04', 30, 1, 'sedan', ['dust', 'mud', 'dust'], { multiplier: 1.2, behavior: 'wideCruise' }),
    order('charge-05', 50, -1, 'hauler', ['dust', 'mud', 'grease'], { multiplier: 1.2, behavior: 'wideCruise' }),
    order('charge-06', 54, 1, 'pod', ['dust', 'mud'], { multiplier: 1.2, behavior: 'wideCruise' }),
    order('charge-07', 76, -1, 'cargo', ['dust', 'mud', 'grease'], { multiplier: 1.2, behavior: 'wideCruise' }),
    order('charge-08', 80, 1, 'sedan', ['dust', 'mud'], { multiplier: 1.2, behavior: 'wideCruise' }),
  ] },
};
