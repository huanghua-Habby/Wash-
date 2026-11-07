import { HIGHWAY_BASE } from './base.js';
import { order } from './authoring.js';
const first = order('tutorial-car', undefined, -1, 'cargo', ['dust', 'dust', 'dust'], { onComplete: 'hold' });
first.patience = { mode: 'unlimited' }; first.playerCountStains = true;
export const HIGHWAY_01 = {
  ...HIGHWAY_BASE, id: 'highway-01', number: '01', name: 'Tutorial', difficulty: 'tutorial', guide: null,
  description: '无时限 · 移动、擦车、放下与返回', roadSigns: [], unlockedEquipment: [],
  clock: { mode: 'unlimited', duration: 0 }, rating: { mode: 'tutorial', thresholds: [] },
  script: { orders: [first], events: [], steps: [
    { id: 'move', text: 'WSAD进行移动，没病走两步！', condition: { type: 'moved', distance: .35 } },
    { id: 'clean', text: '按J进行拾取/交互，拿起毛巾，把车擦干净！', condition: { type: 'clean', orderId: first.id },
      enter: [{ type: 'equipment', keys: ['towel', 'station'] }, { type: 'spawn', orderId: first.id }] },
    { id: 'release', praise: '干得好！', text: '按K丢掉手中的物品，你也可以长按来扔出去！',
      condition: { type: 'emptyHands' }, hold: 1, minimumSeconds: 2 },
    { id: 'return', text: '按Space进行跳跃，赶紧回到你自己的车，订单完成的车辆是随时会被开走的！',
      condition: { type: 'home' }, minimumSeconds: 1 },
    { id: 'farewell', text: '还好这次的车好像很有耐心！再学两个小招式就出师啦！',
      enter: [{ type: 'leave', orderId: first.id }], condition: { type: 'reclaimed', orderId: first.id }, minimumSeconds: 3 },
    // Slap lesson: a wooden "enemy" appears on the roof; one empty-handed K (or J) on it is enough, the rest is for fun.
    { id: 'slap', text: '空手按K可以拍人！先拿木头人练练手！', dummy: true,
      condition: { type: 'dummy' }, hold: 1.5, minimumSeconds: 2 },
    // Skill lesson: whoever has no L ability borrows the elephant (poof!) until the step ends.
    { id: 'skill', text: '按L放技能！没技能的小伙伴，先借小象鼻子喷喷水！', morph: 'elephant',
      condition: { type: 'skill' }, hold: 1.8, minimumSeconds: 2 },
    { id: 'emote', praise: '变回来啦！', text: '按住U，再按方向键选个表情，打个招呼！',
      condition: { type: 'emote' }, minimumSeconds: 1.5 },
    { id: 'graduate', text: '恭喜你现在明白怎么玩了！', condition: { type: 'elapsed', seconds: 2.5 }, exit: [{ type: 'finish' }] },
  ] },
};
