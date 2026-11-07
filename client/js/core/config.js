// 画面调试参数（调试面板直接修改这里，各模块每帧读取）
// 颜色均为 sRGB 十六进制字符串
import { normalizeFurShells } from './furSettings.js';

export const DEFAULTS = {
  fur: {
    shells: 8,        // 手动档 / 自动上限；仅 4、8、12，发行默认 8（8 人 × 8 层）。决策依据见 docs/domains/wash/PERFORMANCE.md
    auto: true,       // 持续负载自适应；自动不关闭毛发，也不进入 Extra 16/20
  },
  render: {
    scale: 0.65,       // 分辨率倍率（开启自动时为上限）
    maxPixelRatio: 2,  // 最高像素比；0 = 跟随屏幕原生像素比（最高清）
    autoRes: true,     // 自动分辨率
    targetFps: 60,     // 最低帧数：低于它就自动降分辨率
    minScale: 0.6,     // 自动降低时的最低倍率
    msaa: 'auto',      // 抗锯齿采样：auto（2x 屏关闭，1.5x 屏 2x，普通屏 4x）/ 0 / 2 / 4
    fxaa: 'auto',      // 后期抗锯齿：auto（MSAA 关闭时开启）/ on / off
  },
  world: {
    timeScale: 1,      // 时间流速
    speedMul: 1,       // 车速倍率
    pause: false,
  },
  post: {
    enabled: true,
    // 各效果单独开关
    blurOn: true,
    bloomOn: true,
    gradeOn: true,
    linesOn: true,
    tiltOn: true,
    vignetteOn: true,
    grainOn: true,
    // 色调映射（高光压缩）
    tonemap: 'Neutral',   // None / ACES / AgX / Neutral / Reinhard
    exposure: 1,
    // 泛光 Bloom
    bloom: 2,          // 强度
    bloomThreshold: 1, // 阈值（线性亮度，>1 只有发光体会泛光）
    bloomKnee: 0.5,    // 软膝，阈值附近平滑过渡
    bloomScatter: 0.4, // 扩散（越大光晕越大越柔）
    bloomLevels: 4,    // mip 层数
    bloomTint: '#fff4e0',
    // 动态模糊
    blur: 0.008,       // 快门（模糊长度）
    blurCenter: 0.44,   // 屏幕中心的模糊系数
    blurEdge: 1.11,     // 屏幕边缘额外的模糊系数
    blurSamples: 15,
    maskSharp: true,   // 卡车/玩家保持锐利
    // 移轴景深：沿道路方向保留一条清晰带，路两侧景物逐渐高斯模糊，视线集中到焦点车上
    tilt: 1,           // 强度（最大模糊半径约为画面高度的 1.2%）
    tiltFocus: 3.2,    // 清晰带半宽（米，从焦点车中线横向量起）
    tiltRange: 6,      // 由清晰到最模糊的过渡宽度（米）
    // 调色
    saturation: 1,
    contrast: 1.05,
    liftColor: '#ffb3b3',
    liftAmount: 0.069,
    gainColor: '#fffbf3',
    splitTone: 1.07,
    // 速度线
    lines: 1,          // 强度
    linesDensity: 0.13,
    linesBands: 85,
    linesSpeed: 1,
    linesLength: 0.3,
    linesRadius: 0.42, // 从屏幕中心多远开始出现
    // 暗角
    vignette: 1.1,
    vigInner: 0.61,
    vigOuter: 1.27,
    vigColor: '#c7dee0',
    // 颗粒
    grain: 0.016,
  },
  // 自发光 HDR：颜色 × 强度，强度 > Bloom 阈值的部分才会泛光
  glow: {
    vehicleColor: '#8feaf5', // 车辆推进器、车底光带、示廓灯
    vehicle: 3.6,
    roadColor: '#7fe3f0',    // 路缘光带、护栏柱灯、汇入车道边线
    road: 2,
  },
  wind: {
    enabled: true,
    rate: 20,          // 每秒生成数
    maxCount: 25,
    opacity: 0.85,
    color: '#fffdf6',
    thickness: 0.88,
    lengthMin: 2.5,
    lengthMax: 6.5,
    speed: 1,
    life: 1,
    wobble: 1,
    curlChance: 0,
    curlSize: 1,
  },
  puffs: {
    exhaust: 3.5,
    dust: 7,
  },
  camera: {
    style: 'follow',   // 游玩镜头样式：follow 跟随玩家 / fixed 固定镜头（不跟随玩家，保留视野、距离、俯角与震动）
    fov: 29,           // 主页镜头基准 FOV；随游玩视野（设置里的“镜头视野”）偏移一起变化
    recoilShake: 1,    // 小象喷水后坐力的镜头震动
    fovBoost: 3.5,     // 高速时 FOV 增量
    playFov: 32,       // 游玩时视野（设置里的“镜头视野”滑杆）
    playDistance: 12,  // 游玩时镜头距离（米，跟随玩家时会按需要拉远）；合作与对抗共用。2026-10-20：20 → 15 近景，再随角色缩小（CHARACTER_SCALE 0.8）→ 12，画面中角色大小不变
    playPitch: 60,     // 游玩时俯角（度）
    // Home camera offset from its focus (2026-10-20: 0.68 of the earlier -8.5, 21, 25.5 so the vehicles fill more of the frame).
    offsetX: -5.8,
    offsetY: 14.3,
    offsetZ: 17.3,
    follow: 2.2,
    shake: 1,
    parallax: 0,
    roll: 1,
  },
  light: {
    hemi: 1.89,
    sun: 2,
    sky: '#f5faff',
    ground: '#dbadad',
    sunColor: '#fff1d8',
    shadows: true,
    outline: true,
  },
  grass: {
    sway: 0.87,
    gust: 0.83,
    wake: 0.6,
    base: '#79a884',
    tip: '#a2c79f',
    deep: '#64946f',
    groundTint: '#ffffff', // 地面贴图色调（乘法）
    density: 1,        // 草叶密度（相对默认分布，0~1）
    flowers: 1,        // 小野花密度
    deepRatio: 0.3,    // 深色草叶比例（越高越斑驳）
    patches: 26,       // 地面色斑数量（每块铺贴）
    patchSize: 1,      // 地面色斑大小倍率
    patchContrast: 0.7, // 地面色斑浓度
    groundScale: 80,   // 地面贴图一块铺贴的边长（米，越大色斑越稀疏）
  },
  // 路边布景密度（相对默认布局，0~1）；牌子可单独开关
  scenery: {
    trees: 1,
    bushes: 1,
    hedges: 1,
    hay: 1,
    rocks: 1,
    barrels: 1,
    warningSigns: true,
    highwaySign: true,
  },
  // 红蓝阵营实机测试（仅本机表现，不影响玩法、不同步）：按房间槽位分队，帽子与脚下阵营圈用阵营色
  team: {
    style: 'plate',     // 阵营外观：'plate' HouJianNan（队色昵称框 + 队色脚圈，默认）/ 'hat' Mayulong（阵营圈 + 帽子）
    hats: true,         // 阵营色帽子
    rings: true,        // 脚下圆环改为阵营圈（色环 + 浅色外描边 + 内圈淡色光晕）
    red: '#ec5547',
    blue: '#3d8be6',
    ringRadius: 0.52,   // 阵营圈内半径（米）
    ringWidth: 0.145,   // 色环粗细（米）
    rimWidth: 0.045,    // 外描边粗细（米），0 关闭
    glow: 0.26,         // 内圈光晕强度，0 关闭
    glowSpread: 0.22,   // 光晕向内延伸的宽度（米）
    ringOpacity: 1.6,   // 阵营圈不透明度倍率（乘以落地 0.55 / 空中 0.34）
  },
  // 游玩中的密度（0~1）；主页使用上面 grass / scenery 的值
  play: {
    scenery: 0.1,      // 全部路边布景
    grass: 0.5,        // 草叶
    flowers: 0.5,      // 小野花
  },
};

export const CFG = structuredClone(DEFAULTS);
/** Public settings limits; UI does not depend on the camera renderer. */
export const GAMEPLAY_FOV_RANGE = Object.freeze([24, 50]);

// 实际生效的画面参数。CFG 是白天基准（调试面板编辑、保存的就是它）；
// 昼夜系统只在这里覆盖混合后的值，未覆盖的键经原型链实时读取 CFG。
export const LOOK = {
  post: Object.create(CFG.post),
  light: Object.create(CFG.light),
  glow: Object.create(CFG.glow),
  sunOffset: [10, 30, 7],
};

// v2: since the day/night cycle the saved values are the *day* baseline. Older saves
// (possibly holding night values pasted before the cycle existed) are ignored.
const KEY = 'cube-highway-fx-v2';
/** Gameplay camera distance default before the shared close camera (2026-10-20). */
const LEGACY_PLAY_DISTANCE = [20, 15];
/** Home camera offset defaults before 2026-10-20; a save holding exactly these follows the new default. */
const LEGACY_HOME_OFFSET = [-8.5, 21, 25.5];

export function saveConfig() {
  localStorage.setItem(KEY, JSON.stringify(CFG));
}

export function loadSavedConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) applyConfig(saved);
  } catch (e) { /* 忽略损坏的存档 */ }
}

export function applyConfig(src) {
  for (const group of Object.keys(DEFAULTS)) {
    if (!src[group]) continue;
    for (const k of Object.keys(DEFAULTS[group])) {
      if (src[group][k] !== undefined) CFG[group][k] = src[group][k];
    }
  }
  CFG.fur.shells = normalizeFurShells(CFG.fur.shells);
  // Saved settings store the whole config, so the old 20 m default came along with any FOV or toggle change; treat it as unset.
  if (LEGACY_PLAY_DISTANCE.includes(src.camera?.playDistance)) CFG.camera.playDistance = DEFAULTS.camera.playDistance;
  if (src.camera && LEGACY_HOME_OFFSET.every((value, i) => src.camera[['offsetX', 'offsetY', 'offsetZ'][i]] === value)) {
    Object.assign(CFG.camera, { offsetX: DEFAULTS.camera.offsetX, offsetY: DEFAULTS.camera.offsetY, offsetZ: DEFAULTS.camera.offsetZ });
  }
  if (typeof CFG.fur.auto !== 'boolean') CFG.fur.auto = true;
}

export function resetConfig() {
  applyConfig(structuredClone(DEFAULTS));
  localStorage.removeItem(KEY);
}
