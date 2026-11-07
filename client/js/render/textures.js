import * as THREE from 'three';
import { PAL } from '../../../shared/sim/palette.js';
import { FIRST_LEVEL_ID, getLevel } from '../../../shared/levels.js';
import { mulberry32 } from '../../../shared/sim/util.js';

const FONT_ZH = '"ZCOOL KuaiLe", "Fredoka", "PingFang SC", sans-serif';
const FONT_EN = '"Fredoka", "ZCOOL KuaiLe", sans-serif';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, { repeat = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// 原创图标：小方块（主角形象）
export function drawCubeIcon(g, cx, cy, s, body = '#2F3438', accent = null) {
  g.save();
  g.translate(cx, cy);
  g.scale(s, s);
  g.rotate(-0.12);
  g.fillStyle = body;
  roundRect(g, -34, -34, 68, 68, 12); g.fill();
  g.fillRect(-22, 30, 10, 18); g.fillRect(12, 30, 10, 18);      // 小短腿
  g.fillStyle = accent || 'rgba(255,255,255,0)';
  if (accent) {                                                   // 眼睛
    g.beginPath(); g.arc(-12, -6, 6, 0, Math.PI * 2); g.arc(14, -6, 6, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

// 原创图标：圆滚滚的云朵
export function drawCloudIcon(g, cx, cy, s, body = '#2F3438', accent = null) {
  g.save();
  g.translate(cx, cy);
  g.scale(s, s);
  g.fillStyle = body;
  g.beginPath();
  g.arc(-22, 8, 22, 0, Math.PI * 2);
  g.arc(4, -6, 28, 0, Math.PI * 2);
  g.arc(28, 10, 20, 0, Math.PI * 2);
  g.fill();
  roundRect(g, -44, 4, 92, 28, 14); g.fill();
  if (accent) {
    g.fillStyle = accent;
    g.beginPath(); g.arc(-8, 6, 5, 0, Math.PI * 2); g.arc(16, 6, 5, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

// 路面：12 x 9 世界单位一块，沿 x 平铺
export function roadTexture(road = getLevel(FIRST_LEVEL_ID).road) {
  const W = 1024, H = 768, ppu = W / road.texturePeriod;
  const width = road.laneCount * road.laneWidth;
  const yAt = (z) => (z / width + 0.5) * H;
  const [c, g] = canvas(W, H);
  const rng = mulberry32(3);
  g.fillStyle = PAL.road; g.fillRect(0, 0, W, H);
  // 车辙
  g.fillStyle = PAL.roadTrack; g.globalAlpha = 0.35;
  for (let lane = 0; lane < road.laneCount; lane++) {
    const center = -width / 2 + (lane + 0.5) * road.laneWidth;
    for (const offset of [-0.9, 0.9]) g.fillRect(0, yAt(center + offset) - 22, W, 44);
  }
  g.globalAlpha = 1;
  // 斑点
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = rng() < 0.5 ? PAL.roadSpeck : '#A7A9B0';
    const r = 1 + rng() * 3;
    g.beginPath(); g.arc(rng() * W, rng() * H, r, 0, Math.PI * 2); g.fill();
  }
  // 裂缝补丁
  g.strokeStyle = '#8C8E96'; g.lineWidth = 3; g.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    let x = rng() * W, y = rng() * H;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += (rng() - 0.3) * 50; y += (rng() - 0.5) * 30; g.lineTo(x, y); }
    g.stroke();
  }
  // 边线 + 中间虚线
  g.fillStyle = PAL.roadLine;
  const lw = 0.16 * ppu;
  for (const z of [-width / 2 + 0.55, width / 2 - 0.55]) roundRect(g, -10, yAt(z) - lw / 2, W + 20, lw, lw / 2), g.fill();
  for (let lane = 1; lane < road.laneCount; lane++) {
    const y = yAt(-width / 2 + lane * road.laneWidth);
    for (const x0 of [0.5, 6.5]) roundRect(g, x0 * ppu, y - lw / 2, 3.2 * ppu, lw, lw / 2), g.fill();
  }
  return toTexture(c, { repeat: true, aniso: 16 });
}

// 草地底色斑块（无缝）
// 地面草地：底色 + 柔和色斑 + 小草笔触。色斑数量、大小、对比度可调（调试面板“草地”）
export function groundTexture(options) {
  const [c] = canvas(512, 512);
  const t = toTexture(c, { repeat: true });
  drawGround(t, options);
  return t;
}

export function drawGround(texture, { patches = 26, patchSize = 1, patchContrast = 0.7 } = {}) {
  const c = texture.image, g = c.getContext('2d'), S = c.width;
  const rng = mulberry32(11);
  g.globalAlpha = 1; g.fillStyle = PAL.grass; g.fillRect(0, 0, S, S);
  const blob = (x, y, r, col, a) => {
    for (let ox = -S; ox <= S; ox += S) for (let oy = -S; oy <= S; oy += S) {
      const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      grd.addColorStop(0, col); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = a; g.fillStyle = grd;
      g.beginPath(); g.arc(x + ox, y + oy, r, 0, Math.PI * 2); g.fill();
    }
  };
  // 固定种子按顺序取值，减少数量时保留前面的色斑，不会整体跳变
  for (let i = 0; i < Math.round(patches); i++) {
    const x = rng() * S, y = rng() * S, r = (30 + rng() * 70) * patchSize, col = rng() < 0.5 ? PAL.blotchA : PAL.blotchB;
    blob(x, y, r, col, patchContrast);
  }
  // 小草笔触
  const strokes = mulberry32(12);
  g.globalAlpha = 0.5; g.strokeStyle = PAL.grassDeep; g.lineWidth = 2; g.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const x = strokes() * S, y = strokes() * S;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (strokes() - 0.5) * 6, y - 5 - strokes() * 6); g.stroke();
  }
  g.globalAlpha = 1;
  texture.needsUpdate = true;
}

// 货柜侧面的 logo
export function logoTexture(title, sub, color, icon = 'cube') {
  const [c, g] = canvas(1024, 256);
  g.fillStyle = color;
  g.beginPath(); g.arc(122, 128, 104, 0, Math.PI * 2); g.fill();
  (icon === 'cloud' ? drawCloudIcon : drawCubeIcon)(g, 122, 126, 1.15, '#FFFDF6', color);
  g.textBaseline = 'middle';
  g.font = `150px ${FONT_ZH}`;
  g.fillText(title, 256, 104);
  g.font = `600 50px ${FONT_EN}`;
  g.globalAlpha = 0.85;
  g.fillText(sub.split('').join(String.fromCharCode(8202)), 262, 210);
  return toTexture(c);
}

// 三角警示牌：小心方块
export function warningSignTexture() {
  const S = 512;
  const [c, g] = canvas(S, S);
  const tri = (inset) => {
    g.beginPath();
    g.moveTo(256, 40 + inset * 1.6);
    g.lineTo(476 - inset * 1.4, 460 - inset * 0.8);
    g.lineTo(36 + inset * 1.4, 460 - inset * 0.8);
    g.closePath();
  };
  g.lineJoin = 'round';
  g.fillStyle = '#7E3A35'; g.strokeStyle = '#7E3A35'; g.lineWidth = 40; tri(0); g.stroke(); g.fill();
  g.fillStyle = '#E0574E'; g.strokeStyle = '#E0574E'; g.lineWidth = 30; tri(0); g.stroke(); g.fill();
  g.fillStyle = '#FFFDF6'; g.strokeStyle = '#FFFDF6'; g.lineWidth = 20; tri(46); g.stroke(); g.fill();
  drawCubeIcon(g, 256, 318, 1.7);
  return toTexture(c);
}

// 蓝色高速路牌
export function highwaySignTexture() {
  const [c, g] = canvas(1024, 400);
  g.fillStyle = '#4F75B3'; roundRect(g, 0, 0, 1024, 400, 40); g.fill();
  g.strokeStyle = '#FFFDF6'; g.lineWidth = 14; roundRect(g, 22, 22, 980, 356, 28); g.stroke();
  g.fillStyle = '#FFFDF6'; g.textBaseline = 'middle';
  g.font = `150px ${FONT_ZH}`; g.fillText('方块镇', 70, 150);
  g.font = `600 58px ${FONT_EN}`; g.fillText('Cube Town', 76, 280);
  g.font = `700 110px ${FONT_EN}`; g.textAlign = 'right'; g.fillText('2 km', 950, 280);
  // 箭头
  g.lineWidth = 26; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(700, 140); g.lineTo(930, 140); g.moveTo(860, 80); g.lineTo(930, 140); g.lineTo(860, 200); g.stroke();
  return toTexture(c);
}
