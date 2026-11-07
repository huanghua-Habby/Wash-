/** Level-progress day cycle: day → sunset → night. Blends over the debug-panel day values into LOOK. */
import * as THREE from 'three';
import { CFG, LOOK } from '../core/config.js';
import { smoothstep } from '../../../shared/sim/util.js';

// 关卡进度（0–1）：35% 起转向夕阳，50% 为完整夕阳，随后过渡，75% 进入夜晚并保持。
export const TIMELINE = { sunsetFrom: 0.35, sunset: 0.5, night: 0.75 };
export const DAY_SUN = [10, 30, 7];

// 夕阳：低角度暖色侧光，影子拉长。
export const SUNSET = {
  light: { hemi: 1.45, sun: 2.2, sky: '#ffd2b0', ground: '#c99a8a', sunColor: '#ffa36b' },
  post: { bloom: 2, bloomThreshold: 1, bloomKnee: 0.55, bloomScatter: 0.55, bloomLevels: 5 },
  glow: { vehicle: 4.2, road: 3.2 },
  sun: [26, 9, 14],
};

// 夜晚：调试面板调好的夜间数值；冷色月光从另一侧较高处照下。
export const NIGHT = {
  light: { hemi: 1, sun: 1.5, sky: '#85c4ff', ground: '#dbadad', sunColor: '#adbbff' },
  post: { bloom: 1.84, bloomThreshold: 1, bloomKnee: 0.58, bloomScatter: 0.65, bloomLevels: 6 },
  glow: { vehicle: 5, road: 5 },
  sun: [-8, 26, -14],
};

/** Debug-only override; not saved with CFG. */
export const TIME_PREVIEW = { enabled: false, progress: 0 };

const ca = new THREE.Color(), cb = new THREE.Color(), cc = new THREE.Color();
const mix = (day, sunset, night, a, b) => {
  if (typeof day === 'number') { const s = day + (sunset - day) * a; return s + (night - s) * b; }
  // Colours blend in linear space, written back as the same sRGB hex strings consumers already read.
  return `#${ca.set(day).lerp(cb.set(sunset), a).lerp(cc.set(night), b).getHexString()}`;
};

/** Sunset and night blend weights for a level progress value. */
export function timeWeights(progress) {
  return { sunset: smoothstep(TIMELINE.sunsetFrom, TIMELINE.sunset, progress), night: smoothstep(TIMELINE.sunset, TIMELINE.night, progress) };
}

/** Write the effective look for this progress. Returns the weights actually used. */
export function applyTimeOfDay(levelProgress) {
  const progress = TIME_PREVIEW.enabled ? TIME_PREVIEW.progress : levelProgress;
  const { sunset: a, night: b } = timeWeights(progress);
  for (const group of ['light', 'post', 'glow']) {
    for (const key of new Set([...Object.keys(SUNSET[group]), ...Object.keys(NIGHT[group])])) {
      const day = CFG[group][key];
      LOOK[group][key] = mix(day, SUNSET[group][key] ?? day, NIGHT[group][key] ?? day, a, b);
    }
  }
  LOOK.sunOffset = DAY_SUN.map((day, i) => mix(day, SUNSET.sun[i], NIGHT.sun[i], a, b));
  return { progress, sunset: a, night: b };
}
