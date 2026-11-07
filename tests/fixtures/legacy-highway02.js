import { HIGHWAY_01 } from './legacy-highway01.js';

/** 02: centre lane service, simultaneous paired traffic and ten seconds per cleaning step. */
export const HIGHWAY_02 = {
  ...HIGHWAY_01,
  id: 'highway-02', number: '02', name: '左右来车', difficulty: 'normal',
  guide: null,
  roadSigns: [],
  description: '三车道 · 左右同时来车 · 每步操作 10 秒耐心',
  road: { ...HIGHWAY_01.road, laneCount: 3, scenerySeed: 84 },
  orders: { ...HIGHWAY_01.orders, sides: [-1, 1], patienceSecondsPerStep: 10, waves: [
    { at: 3, name: '双侧开张', vehicles: ['cargo', 'pod'] }, { at: 53, name: '午间忙碌', vehicles: ['bus', 'sedan'] },
    { at: 93, name: '连续高峰', vehicles: ['hauler', 'cargo'] }, { at: 128, name: '收工冲刺', vehicles: ['pod', 'bus'] },
  ] },
  home: { ...HIGHWAY_01.home, motion: { ...HIGHWAY_01.home.motion, centerHome: true } },
};
