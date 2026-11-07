// 全局色板：低饱和、偏暖的粉彩色。所有颜色都在后处理调色之前，
// 设计原则：明度接近、色相分散，后处理压一层后任何组合都柔和。
export const PAL = {
  bg: '#79A884',

  grass: '#79A884',
  grassTip: '#A2C79F',
  grassDeep: '#64946F',
  blotchA: '#82B08B',
  blotchB: '#70A07C',

  road: '#7F8798',
  roadSpeck: '#767E8F',
  roadTrack: '#8A92A3',
  roadLine: '#D9F4F7',
  curb: '#C9D0DA',
  laneGlow: '#7FE3F0',
  lane: '#6B7AA6',

  rail: '#CDD3DC',
  railPost: '#A3ABB8',
  wood: '#B58866',
  picket: '#EAE0CC',

  leaf: ['#5F9669', '#6FA474', '#568B61', '#7DAF7B'],
  trunk: '#8E6B53',
  hay: '#E2C380',
  rock: '#BDBBB2',
  barrel: '#6C8CC8',

  flower: ['#F7F2E6', '#F7F2E6', '#F3D46E', '#BBA3DB', '#F2A9A2'],

  // Home vehicle: head, body band and the CUBE WASH logo in the READY card's deep green (2026-10-20 user).
  // Home wash truck (HouJianNan): the same green as the versus neutral cab (orderCargo #5FA79A) everywhere — cab, stripes, logo.
  truckA: { cab: '#5FA79A', trailer: '#F1E7D5', stripe: '#5FA79A', accent: '#E9B44E', door: '#E6DAC5' },
  truckB: { cab: '#6087C0', trailer: '#EFCD7B', stripe: '#6087C0', accent: '#F1E7D5', door: '#E5C16C' },
  orderCargo: { cab: '#5FA79A', trailer: '#F2E4CF', stripe: '#5FA79A', accent: '#E9B44E', door: '#E4D6BE' },
  orderPod: { cab: '#E7A1B4', trailer: '#FBF1E4', stripe: '#C9748C', accent: '#F3D46E', door: '#F3E4D3' },
  orderBus: { cab: '#E9B44E', trailer: '#F4D27C', stripe: '#C96F5E', accent: '#FBF1E4', door: '#E2C06A' },
  orderSedan: { cab: '#8E83C9', trailer: '#B5ABE3', stripe: '#6A5FA8', accent: '#F1E7D5', door: '#A79CD9' },
  orderHauler: { cab: '#7FA4CF', trailer: '#D7DEE6', stripe: '#567FB0', accent: '#F2A9A2', door: '#C6CFDA' },
  chassis: '#5C6170',
  thruster: '#8A93A6',
  thrusterGlow: '#8FEAF5',
  glass: '#A9C6D3',
  chrome: '#D6D5CE',
  headlight: '#FFF2C2',
  tail: '#E2665A',

  player: '#FBF8F1',
  cheek: '#F2A39B',
  eye: '#2D3138',
  mouth: '#C9625A',

  puff: '#F4EFE6',
  dust: '#D9CBAE',
  wind: '#FFFDF6',

  light: { sky: '#FFF5E6', ground: '#A9C4AE', sun: '#FFF1D8' },
};
