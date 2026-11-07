/** Client look of the versus hack console (shared/sim/HackConsole.js): paints both screens from the applied host state
 * and drives the HDR glow parts (underlight, lit keys, antenna tip) so Bloom picks them up. Read-only: it never decides
 * progress, a hacker or an effect. Repaints at most ~12 times a second, and only while the console is shown. */
import * as THREE from 'three';
import { t, i18n } from '../i18n/Localization.js';
import { teamColor, TEAM_LABELS } from '../core/teamColors.js';
import { hackEffect } from '../../../shared/sim/HackEffects.js';
import { HACK } from '../../../shared/sim/HackConsole.js';

const W = 512, H = 304, REPAINT = 1 / 12;
/** Screen brightness: text and bars land above the Bloom threshold, the dark background stays below it. */
const SCREEN_HDR = 2;
const IDLE = '#7fe3f0', REBOOT = '#f0b85a', GRANTED_SECONDS = 3.2;
const HEX = '0123456789ABCDEF';

export class HackConsoleView {
  constructor(game) {
    this.game = game; this.console = game.hackConsole;
    const { screens, glow } = this.console.group.userData.hack;
    this.glow = glow;
    this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = H;
    this.context = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.anisotropy = 4;
    for (const screen of screens) {
      screen.material.map = this.texture; screen.material.color.setScalar(SCREEN_HDR); screen.material.toneMapped = true;
      screen.material.needsUpdate = true;
    }
    this.color = new THREE.Color(); this.time = 0; this.since = REPAINT; this.key = '';
    this.seenSerial = this.console.serial; this.grantedAt = -1e9;
    this.lines = Array.from({ length: 6 }, () => this.codeLine());
    this.paint();
  }
  codeLine() {
    let line = '0x';
    for (let i = 0; i < 4; i++) line += HEX[(Math.random() * 16) | 0];
    line += '  ';
    for (let i = 0; i < 6; i++) line += `${HEX[(Math.random() * 16) | 0]}${HEX[(Math.random() * 16) | 0]} `;
    return line;
  }
  /** What the screen shows now; a change repaints at once instead of waiting for the next tick of the clock. */
  state() {
    const c = this.console;
    if (this.time - this.grantedAt < GRANTED_SECONDS && c.last.effect) return 'granted';
    if (c.cooldown > 0) return 'reboot';
    if (c.slot >= 0) return 'hacking';
    return 'idle';
  }
  update(dt) {
    if (!this.console.group.visible) return;
    this.time += dt; this.since += dt;
    const c = this.console;
    if (c.serial !== this.seenSerial) { if (c.serial > this.seenSerial) this.grantedAt = this.time; this.seenSerial = c.serial; }
    const state = this.state(), hackerTeam = c.slot >= 0 ? this.game.players[c.slot]?.team : -1;
    const key = `${state}:${hackerTeam}:${i18n.locale}`;
    if (key !== this.key || this.since >= REPAINT) { this.key = key; this.since = 0; this.paint(state, hackerTeam); }
    this.light(state, hackerTeam);
  }
  /** Glow parts: calm cyan idle, the hacker's team colour pulsing while typing, amber while rebooting; the tip blinks. */
  light(state, hackerTeam) {
    const c = this.console, pulse = 0.5 + 0.5 * Math.sin(this.time * 9);
    const tint = state === 'hacking' || state === 'granted' ? teamColor(state === 'granted' ? c.last.team : hackerTeam) || IDLE : state === 'reboot' ? REBOOT : IDLE;
    const strip = state === 'hacking' ? 2.2 + 1.6 * pulse : state === 'granted' ? 4.5 : state === 'reboot' ? 1.4 : 2.1 + 0.3 * Math.sin(this.time * 1.6);
    this.glow.strip.color.set(tint).multiplyScalar(strip);
    // Lit keys flicker under the paws while typing.
    const keys = state === 'hacking' ? 1.6 + 2 * Math.abs(Math.sin(this.time * 23)) : 1.8;
    this.glow.keys.color.set(tint).multiplyScalar(keys);
    const blink = state === 'hacking' ? (Math.sin(this.time * 18) > 0 ? 4.5 : 0.6) : (Math.sin(this.time * 3.2) > 0.6 ? 3.6 : 0.7);
    this.glow.tip.color.set(state === 'hacking' ? tint : '#ff6f61').multiplyScalar(blink);
  }
  paint(state = this.state(), hackerTeam = -1) {
    const g = this.context, c = this.console;
    g.fillStyle = '#071417'; g.fillRect(0, 0, W, H);
    // Header strip.
    g.fillStyle = '#0f2a2c'; g.fillRect(0, 0, W, 40);
    g.font = '700 22px "Fredoka", "Noto Sans SC", sans-serif'; g.textBaseline = 'middle';
    g.fillStyle = IDLE; g.textAlign = 'left'; g.fillText('HACK//NET', 16, 21);
    g.textAlign = 'right'; g.fillStyle = Math.sin(this.time * 6) > 0 ? '#ff6f61' : '#7a3a36'; g.fillText('● LIVE', W - 16, 21);
    if (state === 'granted') this.paintGranted(c);
    else if (state === 'reboot') this.paintReboot(c);
    else if (state === 'hacking') this.paintHacking(c, hackerTeam);
    else this.paintIdle(c);
    // CRT scanlines and a soft vignette keep it a screen, not a sticker.
    g.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 2);
    const vignette = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.62);
    vignette.addColorStop(0, 'rgba(0,0,0,0)'); vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vignette; g.fillRect(0, 0, W, H);
    this.texture.needsUpdate = true;
  }
  bar(x, y, w, h, value, color) {
    const g = this.context;
    g.strokeStyle = color; g.lineWidth = 3; g.strokeRect(x, y, w, h);
    g.fillStyle = color; g.fillRect(x + 5, y + 5, Math.max(0, (w - 10) * Math.min(1, value)), h - 10);
    // Chunky segments.
    g.fillStyle = '#071417';
    for (let sx = x + 5 + 22; sx < x + w - 5; sx += 24) g.fillRect(sx, y + 5, 2, h - 10);
  }
  paintIdle(c) {
    const g = this.context;
    g.textAlign = 'center'; g.fillStyle = IDLE; g.font = '700 60px "Fredoka", sans-serif';
    g.fillText(`READY${Math.sin(this.time * 5) > 0 ? '_' : ' '}`, W / 2, 112);
    g.font = '600 28px "Noto Sans SC", "Fredoka", sans-serif'; g.fillStyle = '#d6f6f8';
    g.fillText(t('空手按住 J 骇入对面车辆'), W / 2, 168);
    // Each team's saved bar (it drains while nobody of that team types).
    [0, 1].forEach((team) => {
      const x = 28 + team * 236, color = teamColor(team);
      g.textAlign = 'left'; g.font = '600 18px "Noto Sans SC", sans-serif'; g.fillStyle = color;
      g.fillText(t(TEAM_LABELS[team]), x, 218);
      this.bar(x, 232, 220, 34, c.progress[team], color);
    });
  }
  paintHacking(c, team) {
    const g = this.context, color = teamColor(team) || IDLE, value = c.progress[team] ?? 0;
    // Scrolling hex dump on the left.
    if (Math.random() < 0.6) { this.lines.shift(); this.lines.push(this.codeLine()); }
    g.textAlign = 'left'; g.font = '19px "Menlo", "Consolas", monospace';
    this.lines.forEach((line, i) => { g.fillStyle = i === this.lines.length - 1 ? '#e8fff9' : 'rgba(127,227,240,0.55)'; g.fillText(line, 16, 60 + i * 22); });
    g.textAlign = 'center'; g.fillStyle = color; g.font = '700 34px "Noto Sans SC", "Fredoka", sans-serif';
    g.fillText(t('{0}正在骇入', t(TEAM_LABELS[team] || '')), W / 2, 210);
    this.bar(20, 234, W - 160, 58, value, color);
    g.font = '700 46px "Fredoka", sans-serif'; g.textAlign = 'right'; g.fillText(`${Math.floor(value * 100)}%`, W - 14, 265);
  }
  paintReboot(c) {
    const g = this.context;
    g.save(); g.translate(W / 2, 120); g.rotate(this.time * 4);
    g.strokeStyle = REBOOT; g.lineWidth = 9; g.beginPath(); g.arc(0, 0, 44, 0, Math.PI * 1.4); g.stroke(); g.restore();
    g.textAlign = 'center'; g.fillStyle = REBOOT; g.font = '700 44px "Fredoka", sans-serif';
    g.fillText(`REBOOT ${Math.ceil(c.cooldown)}s`, W / 2, 214);
    g.font = '600 22px "Noto Sans SC", sans-serif'; g.fillStyle = '#f7e3bd';
    g.fillText(t('黑客台重启中'), W / 2, 258);
    this.bar(70, 274, W - 140, 22, 1 - c.cooldown / HACK.cooldownSeconds, REBOOT);
  }
  paintGranted(c) {
    const g = this.context, color = teamColor(c.last.team) || IDLE, flash = Math.sin(this.time * 14) > -0.3;
    if (flash) { g.fillStyle = color; g.globalAlpha = 0.18; g.fillRect(0, 40, W, H - 40); g.globalAlpha = 1; }
    g.textAlign = 'center'; g.fillStyle = color; g.font = '700 50px "Fredoka", sans-serif';
    g.fillText('ACCESS GRANTED', W / 2, 108);
    g.font = '700 30px "Noto Sans SC", "Fredoka", sans-serif'; g.fillStyle = '#ffffff';
    g.fillText(t(hackEffect(c.last.effect)?.label || ''), W / 2, 170);
    g.font = '600 22px "Noto Sans SC", sans-serif'; g.fillStyle = color;
    g.fillText(t('{0}黑进了{1}的车', t(TEAM_LABELS[c.last.team] || ''), t(TEAM_LABELS[1 - c.last.team] || '')), W / 2, 222);
  }
  dispose() { this.texture.dispose(); this.canvas.width = this.canvas.height = 0; }
}
