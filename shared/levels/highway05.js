import { HIGHWAY_03 } from './highway03.js';
import { HIGHWAY_04 } from './highway04.js';
import { order, roadSignEvents } from './authoring.js';
const events = roadSignEvents();
const extra = [[104, -1, 'hauler', ['dust', 'mud', 'grease']], [108, 1, 'pod', ['dust', 'mud']],
  [132, -1, 'bus', ['dust', 'mud', 'dust', 'grease']], [136, 1, 'sedan', ['dust', 'mud', 'dust']],
  [156, -1, 'cargo', ['dust', 'mud', 'grease']], [160, 1, 'pod', ['dust', 'mud']]];
export const HIGHWAY_05 = {
  ...HIGHWAY_03, id: 'highway-05', number: '05', name: '什么叫小心脑袋？', guide: 'hazard-road-sign',
  unlockedEquipment: [...HIGHWAY_04.unlockedEquipment],
  description: '三分钟 · 公告牌 · 耐心 +20%', clock: { mode: 'countdown', duration: 180 },
  rating: { mode: 'score', thresholds: [35, 75, 150] }, road: { ...HIGHWAY_03.road, scenerySeed: 210 },
  script: { ...HIGHWAY_03.script, events, orders: [
    ...[
      [2, -1, 'cargo', ['dust', 'mud', 'grease']], [9, 1, 'pod', ['dust', 'mud']],
      [26, -1, 'bus', ['dust', 'mud', 'dust', 'grease']], [30, 1, 'sedan', ['dust', 'mud', 'dust']],
      [50, -1, 'hauler', ['dust', 'mud', 'grease']], [54, 1, 'pod', ['dust', 'mud']],
      [76, -1, 'cargo', ['dust', 'mud', 'dust', 'grease']], [80, 1, 'sedan', ['dust', 'mud', 'dust']],
    ].map(([at, side, type, kinds], i) => order(`sign-${i + 1}`, at, side, type, kinds, { multiplier: 1.2, behavior: 'wideCruise' })),
    ...extra.map(([at, side, type, kinds], i) => order(`sign-${i + 9}`, at, side, type, kinds, { multiplier: 1.2, behavior: 'wideCruise' })),
  ] },
};
