import { HIGHWAY_BASE } from './base.js';
import { order } from './authoring.js';
export const HIGHWAY_02 = {
  ...HIGHWAY_BASE, id: 'highway-02', number: '02', name: '认识你的工具', difficulty: 'normal', guide: 'tools-water',
  partyScaling: true,
  description: '两分钟 · 毛巾与水枪 · 耐心 +40%', unlockedEquipment: ['towel', 'station', 'water'], roadSigns: [],
  road: { ...HIGHWAY_BASE.road, laneCount: 3, scenerySeed: 84 },
  home: { ...HIGHWAY_BASE.home, motion: { ...HIGHWAY_BASE.home.motion, centerHome: true } },
  orders: { ...HIGHWAY_BASE.orders, sides: [-1, 1] }, clock: { mode: 'countdown', duration: 120 },
  rating: { mode: 'score', thresholds: [25, 55, 130] },
  script: { steps: [], events: [], orders: [
    order('water-01', 3, -1, 'pod', ['dust', 'dust']), order('water-02', 19, 1, 'cargo', ['dust', 'mud', 'dust']),
    order('water-03', 37, -1, 'sedan', ['dust', 'mud']), order('water-04', 55, 1, 'bus', ['dust', 'mud', 'dust']),
    order('water-05', 76, -1, 'pod', ['dust', 'mud']), order('water-06', 96, 1, 'hauler', ['dust', 'mud', 'dust']),
  ] },
};
