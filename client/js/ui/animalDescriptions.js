// Presentation copy follows animal selection. Breed choices only affect appearance.
import { WASH_CONFIG } from '../../../shared/sim/washConfig.js';
import { ANIMAL_SLAP, SLAP_DEFAULT } from '../../../shared/sim/Slap.js';
export const ANIMAL_DESCRIPTIONS = {
  cat: { type: '被动', tag: '快速复活', description: `猫猫有九条命，等待复活的时间降低${Math.round(WASH_CONFIG.catRespawnReduction * 100)}%` },
  dog: { type: '被动', tag: '尽职尽责', description: `狗狗很勤奋，用肥皂和毛巾的速度提升${Math.round(WASH_CONFIG.dogWorkSpeedBonus * 100)}%` },
  pelican: {
    type: '主动', tag: '大嘴吞吞',
    description: '按L可以吞掉任何道具，或队友！没吃东西的话可以在天上滑翔！',
    actions: [{ key: 'L', description: '吞下 / 吐出' }, { key: '空格（长按）', description: '滑翔' }],
  },
  elephant: {
    type: '主动', tag: '象鼻水炮',
    description: '按住L可以发射水柱！但是你也会被推开！',
    actions: [{ key: 'L', description: '按住喷水' }],
  },
  squirrel: {
    type: '被动', tag: '飞檐走壁',
    description: `松鼠很灵活，移动速度提升${Math.round(WASH_CONFIG.squirrelSpeedBonus * 100)}%！碰到墙会扒住，扒得越久滑得越快。`,
    action: { key: '空格', description: '扒墙时蹬墙跳' },
  },
  goose: {
    type: '主动', tag: '鹅霸一方',
    description: `加拿大鹅脾气火爆，出拳速度提升${Math.round((SLAP_DEFAULT.cooldown / ANIMAL_SLAP.goose.cooldown - 1) * 100)}%！可以在天上滑翔的更久！`,
    actions: [{ key: '空格（长按）', description: '滑翔' }],
  },
  kangaroo: {
    type: '被动', tag: '拳王袋鼠',
    // Jump height grows with the square of the take-off speed.
    description: `袋鼠是运动健将，跳的比别人高${Math.round((WASH_CONFIG.kangarooJumpScale ** 2 - 1) * 100)}%！而且出拳能把人打飞更远！`,
  },
};
