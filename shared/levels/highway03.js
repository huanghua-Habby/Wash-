import { HIGHWAY_02 } from './highway02.js';
import { order } from './authoring.js';
const wide = (id, at, side, type, kinds) => order(id, at, side, type, kinds, { behavior: 'wideCruise' });
export const HIGHWAY_03 = {
  ...HIGHWAY_02, id: 'highway-03', number: '03', name: '难以清理！', guide: 'tools-soap',
  description: '两分钟 · 肥皂解锁 · 移动路线', unlockedEquipment: ['towel', 'station', 'water', 'soap'],
  road: { ...HIGHWAY_02.road, scenerySeed: 126 },
  script: { steps: [], events: [], orders: [
    wide('soap-01', 2, -1, 'cargo', ['dust', 'mud', 'grease']), wide('soap-02', 20, 1, 'pod', ['dust', 'mud']),
    wide('soap-03', 40, -1, 'bus', ['dust', 'mud', 'grease']), wide('soap-04', 59, 1, 'sedan', ['dust', 'mud']),
    wide('soap-05', 80, -1, 'hauler', ['dust', 'mud', 'grease']), wide('soap-06', 99, 1, 'pod', ['dust', 'mud']),
  ] },
};
