import GUI from 'lil-gui';
import { localizeMarkup, t } from '../i18n/Localization.js';
import { CFG, DEFAULTS, saveConfig, resetConfig, applyConfig } from '../core/config.js';
import { TONEMAPS } from '../render/PostFX.js';
import { TIME_PREVIEW } from '../render/TimeOfDay.js';
import { FUR_STATUS, normalizeFurShells } from '../core/furSettings.js';

// 画面调试面板：按 ` 键呼出 / 隐藏。改动自动保存到 localStorage。
export class DebugPanel {
  handleShortcuts(input) { if (input.hit('Backquote')) this.toggle(); }
  constructor({ post, resolution, onLightChange, onOutlineChange, onGlowChange = () => {},
    onSceneryChange = () => {}, onSignsChange = () => {}, onGroundChange = () => {}, onGrassDensityChange = () => {} }) {
    this.post = post;
    this.resolution = resolution;
    this.view = { mode: '最终画面' };

    const gui = new GUI({ title: '画面调试  ( ` 键开关 )', width: 300 });
    gui.domElement.classList.add('fx-debug');
    gui.hide();
    this.gui = gui;

    const autosave = () => { clearTimeout(this._t); this._t = setTimeout(saveConfig, 300); };
    gui.onChange(autosave);

    // ---------- 概览 ----------
    const info = resolution.info;
    gui.add(info, 'fps').name('帧率').disable();
    gui.add(info, 'scale').name('当前分辨率倍率').disable();
    gui.add(info, 'size').name('渲染尺寸').disable();
    const VIEWS = { 最终画面: 0, 原始渲染: 1, 速度遮罩: 2, '泛光 Bloom': 3, 移轴景深: 4 };
    gui.add(this.view, 'mode', Object.keys(VIEWS)).name('调试视图')
      .onChange((v) => { post.view = VIEWS[v]; });

    // ---------- 常用：镜头与分辨率（与下方分组联动） ----------
    const CAMERA_STYLES = { 跟随玩家: 'follow', 固定镜头: 'fixed' };
    const fquick = gui.addFolder('镜头与分辨率');
    fquick.add(CFG.camera, 'style', CAMERA_STYLES).name('游玩镜头样式').listen();
    fquick.add(CFG.camera, 'playFov', 10, 70, 0.1).name('游玩视野 FOV').listen();
    fquick.add(CFG.camera, 'playDistance', 8, 60, 0.1).name('游玩镜头距离（米）').listen();
    fquick.add(CFG.camera, 'playPitch', 30, 89, 0.5).name('游玩俯角（度）').listen();
    fquick.add(CFG.camera, 'fov', 10, 70, 0.1).name('主页视野 FOV').listen();
    fquick.add(CFG.render, 'scale', 0.25, 1, 0.05).name('分辨率倍率').listen().onChange(() => resolution.onSettingsChange());

    // ---------- 画质与分辨率 ----------
    const R = CFG.render;
    const onRes = () => resolution.onSettingsChange();
    const fr = gui.addFolder('画质与分辨率');
    fr.add(R, 'scale', 0.25, 1, 0.05).name('分辨率倍率').listen().onChange(onRes);
    fr.add(R, 'maxPixelRatio', { '原生（最高）': 0, '1x': 1, '1.5x': 1.5, '2x': 2, '3x': 3 }).name('最高像素比').onChange(onRes);
    fr.add(R, 'autoRes').name('自动分辨率').onChange(onRes);
    fr.add(R, 'targetFps', 20, 144, 1).name('最低帧数');
    fr.add(R, 'minScale', 0.25, 1, 0.05).name('自动最低倍率').onChange(onRes);
    fr.add(R, 'msaa', { '自动': 'auto', '关闭': 0, '2x': 2, '4x': 4 }).name('抗锯齿 MSAA').onChange(onRes);
    fr.add(R, 'fxaa', { '自动': 'auto', '开': 'on', '关': 'off' }).name('后期抗锯齿 FXAA');

    const ffur = gui.addFolder('动物毛发（本机）');
    ffur.add(CFG.fur, 'auto').name('自动毛发画质');
    ffur.add(CFG.fur, 'shells', { '高（12 层）': 12, '中（8 层）': 8, '低（4 层）': 4 })
      .name('手动档 / 自动上限').listen().onChange(value => { CFG.fur.shells = normalizeFurShells(value); });
    ffur.add(FUR_STATUS, 'shells').name('实际毛发层数').disable();
    ffur.add(FUR_STATUS, 'reason').name('调整原因').disable();

    // 车流、暂停与计时由房间服控制；调试面板只调整本机画面。

    // ---------- 后处理 ----------
    const P = CFG.post;
    const fp = gui.addFolder('后处理');
    fp.add(P, 'enabled').name('启用后处理 (P)');

    const fs = fp.addFolder('效果开关');
    fs.add(P, 'blurOn').name('动态模糊');
    fs.add(P, 'bloomOn').name('泛光 Bloom');
    fs.add(P, 'gradeOn').name('调色');
    fs.add(P, 'linesOn').name('速度线');
    fs.add(P, 'tiltOn').name('移轴景深');
    fs.add(P, 'vignetteOn').name('暗角');
    fs.add(P, 'grainOn').name('颗粒');
    fs.add(P, 'maskSharp').name('卡车/玩家保持锐利');
    fs.add(CFG.light, 'outline').name('描边').onChange(onOutlineChange);

    const ft = fp.addFolder('色调映射');
    ft.add(P, 'tonemap', Object.keys(TONEMAPS)).name('映射曲线');
    ft.add(P, 'exposure', 0.1, 4, 0.01).name('曝光');

    const fbl = fp.addFolder('泛光 Bloom');
    fbl.add(P, 'bloom', 0, 3, 0.01).name('强度');
    fbl.add(P, 'bloomThreshold', 0, 3, 0.01).name('阈值');
    fbl.add(P, 'bloomKnee', 0, 1, 0.01).name('软膝');
    fbl.add(P, 'bloomScatter', 0, 1, 0.01).name('扩散');
    fbl.add(P, 'bloomLevels', 1, 8, 1).name('层数（光晕范围）');
    fbl.addColor(P, 'bloomTint').name('色调');

    // 发光体 HDR：强度越高越超过 Bloom 阈值，光晕越强
    const GL = CFG.glow;
    const fglow = fp.addFolder('自发光 HDR（联动 Bloom）');
    fglow.addColor(GL, 'vehicleColor').name('车辆发光色').onChange(onGlowChange);
    fglow.add(GL, 'vehicle', 0, 20, 0.1).name('车辆发光强度').onChange(onGlowChange);
    fglow.addColor(GL, 'roadColor').name('路边发光色').onChange(onGlowChange);
    fglow.add(GL, 'road', 0, 20, 0.1).name('路边发光强度').onChange(onGlowChange);

    const fb = fp.addFolder('动态模糊').close();
    fb.add(P, 'blur', 0, 0.05, 0.001).name('快门 / 模糊长度');
    fb.add(P, 'blurCenter', 0, 2, 0.01).name('中心强度');
    fb.add(P, 'blurEdge', 0, 4, 0.01).name('边缘强度');
    fb.add(P, 'blurSamples', 1, 32, 1).name('采样数');

    const ftilt = fp.addFolder('移轴景深').close();
    ftilt.add(P, 'tilt', 0, 3, 0.01).name('模糊强度');
    ftilt.add(P, 'tiltFocus', 0, 12, 0.1).name('清晰带半宽（米）');
    ftilt.add(P, 'tiltRange', 0.5, 20, 0.1).name('过渡宽度（米）');

    const fg = fp.addFolder('调色').close();
    fg.add(P, 'saturation', 0, 1.6, 0.01).name('饱和度');
    fg.add(P, 'contrast', 0.5, 1.5, 0.01).name('对比度');
    fg.addColor(P, 'liftColor').name('暗部抬升色');
    fg.add(P, 'liftAmount', 0, 0.2, 0.001).name('暗部抬升量');
    fg.addColor(P, 'gainColor').name('亮部色调');
    fg.add(P, 'splitTone', 0, 4, 0.01).name('分离色调');

    const fl = fp.addFolder('速度线').close();
    fl.add(P, 'lines', 0, 3, 0.01).name('强度');
    fl.add(P, 'linesDensity', 0, 0.6, 0.01).name('密度');
    fl.add(P, 'linesBands', 20, 200, 1).name('细分（越大越细）');
    fl.add(P, 'linesSpeed', 0, 4, 0.01).name('速度');
    fl.add(P, 'linesLength', 0.05, 0.9, 0.01).name('长度');
    fl.add(P, 'linesRadius', 0, 1, 0.01).name('起始半径');

    const fv = fp.addFolder('暗角与颗粒').close();
    fv.add(P, 'vignette', 0, 1.5, 0.01).name('暗角强度');
    fv.add(P, 'vigInner', 0, 1.2, 0.01).name('暗角内径');
    fv.add(P, 'vigOuter', 0.2, 2, 0.01).name('暗角外径');
    fv.addColor(P, 'vigColor').name('暗角颜色');
    fv.add(P, 'grain', 0, 0.12, 0.001).name('颗粒');

    // ---------- 昼夜 ----------
    // 面板中的光照 / Bloom / 发光为白天基准；关卡 35%→50% 转夕阳，50%→75% 转夜晚（预设见 TimeOfDay.js）。
    const fday = gui.addFolder('昼夜（按关卡进度）').close();
    fday.add(TIME_PREVIEW, 'enabled').name('预览指定时段');
    fday.add(TIME_PREVIEW, 'progress', 0, 1, 0.01).name('关卡进度 0.5夕阳 0.75夜');

    // ---------- 风线 ----------
    const W = CFG.wind;
    const fwind = gui.addFolder('风线').close();
    fwind.add(W, 'enabled').name('启用');
    fwind.add(W, 'rate', 0, 120, 1).name('生成频率 /秒');
    fwind.add(W, 'maxCount', 0, 120, 1).name('同屏上限');
    fwind.add(W, 'opacity', 0, 1, 0.01).name('不透明度');
    fwind.addColor(W, 'color').name('颜色');
    fwind.add(W, 'thickness', 0.2, 4, 0.01).name('粗细');
    fwind.add(W, 'lengthMin', 0.5, 12, 0.1).name('最短长度');
    fwind.add(W, 'lengthMax', 0.5, 16, 0.1).name('最长长度');
    fwind.add(W, 'speed', 0.1, 3, 0.01).name('速度');
    fwind.add(W, 'life', 0.2, 4, 0.01).name('寿命');
    fwind.add(W, 'wobble', 0, 4, 0.01).name('波动幅度');
    fwind.add(W, 'curlChance', 0, 1, 0.01).name('卷圈概率');
    fwind.add(W, 'curlSize', 0.2, 3, 0.01).name('卷圈大小');

    // ---------- 烟尘 ----------
    const fpuff = gui.addFolder('烟尘').close();
    fpuff.add(CFG.puffs, 'exhaust', 0, 20, 0.1).name('排气烟 /秒');
    fpuff.add(CFG.puffs, 'dust', 0, 30, 0.1).name('扬尘 /秒');

    // ---------- 相机 ----------
    const C = CFG.camera;
    const fc = gui.addFolder('相机').close();
    fc.add(C, 'style', CAMERA_STYLES).name('游玩镜头样式').listen();
    fc.add(C, 'fov', 10, 70, 0.1).name('主页视野 FOV').listen();
    fc.add(C, 'playFov', 10, 70, 0.1).name('游玩视野 FOV').listen();
    fc.add(C, 'playDistance', 8, 60, 0.1).name('游玩镜头距离（米）').listen();
    fc.add(C, 'playPitch', 30, 89, 0.5).name('游玩俯角（度）').listen();
    fc.add(C, 'recoilShake', 0, 3, 0.05).name('喷水后坐震动');
    fc.add(C, 'fovBoost', 0, 15, 0.1).name('高速 FOV 增量');
    fc.add(C, 'offsetX', -40, 40, 0.1).name('偏移 X（前后）');
    fc.add(C, 'offsetY', 4, 60, 0.1).name('偏移 Y（高度）');
    fc.add(C, 'offsetZ', 0, 60, 0.1).name('偏移 Z（侧向）');
    fc.add(C, 'follow', 0.2, 10, 0.1).name('跟随速度');
    fc.add(C, 'shake', 0, 5, 0.01).name('颠簸');
    fc.add(C, 'parallax', 0, 3, 0.01).name('鼠标视差');
    fc.add(C, 'roll', 0, 5, 0.01).name('轻微侧倾');

    // ---------- 光照与描边 ----------
    const L = CFG.light;
    const flight = gui.addFolder('光照与描边').close();
    flight.add(L, 'hemi', 0, 5, 0.01).name('环境光强度').onChange(onLightChange);
    flight.addColor(L, 'sky').name('天空色').onChange(onLightChange);
    flight.addColor(L, 'ground').name('地面反光色').onChange(onLightChange);
    flight.add(L, 'sun', 0, 4, 0.01).name('主光强度').onChange(onLightChange);
    flight.addColor(L, 'sunColor').name('主光颜色').onChange(onLightChange);
    flight.add(L, 'shadows').name('阴影').onChange(onLightChange);
    flight.add(L, 'outline').name('描边').onChange(onOutlineChange);

    // ---------- 草地 ----------
    const G = CFG.grass;
    const fgr = gui.addFolder('草地').close();
    fgr.add(G, 'sway', 0, 4, 0.01).name('摇摆幅度');
    fgr.add(G, 'gust', 0, 4, 0.01).name('风压');
    fgr.add(G, 'wake', 0, 4, 0.01).name('卡车尾流');
    fgr.addColor(G, 'base').name('草根色').onChange(onLightChange);
    fgr.addColor(G, 'tip').name('草尖色').onChange(onLightChange);
    fgr.addColor(G, 'deep').name('深色草').onChange(onLightChange);
    fgr.addColor(G, 'groundTint').name('地面色调').onChange(onLightChange);
    fgr.add(G, 'density', 0, 1, 0.01).name('草叶密度').onChange(onGrassDensityChange);
    fgr.add(G, 'flowers', 0, 1, 0.01).name('小野花密度').onChange(onGrassDensityChange);
    fgr.add(G, 'deepRatio', 0, 1, 0.01).name('深色草比例').onChange(onGrassDensityChange);
    fgr.add(G, 'patches', 0, 60, 1).name('地面色斑数量').onFinishChange(onGroundChange);
    fgr.add(G, 'patchSize', 0.3, 4, 0.05).name('色斑大小').onFinishChange(onGroundChange);
    fgr.add(G, 'patchContrast', 0, 1, 0.01).name('色斑浓度').onFinishChange(onGroundChange);
    fgr.add(G, 'groundScale', 20, 400, 1).name('地面铺贴尺寸（米）').onChange(onGroundChange);

    // ---------- 路边布景 ----------
    const S = CFG.scenery;
    const fsc = gui.addFolder('路边布景密度').close();
    fsc.add(S, 'trees', 0, 1, 0.01).name('树').onFinishChange(onSceneryChange);
    fsc.add(S, 'bushes', 0, 1, 0.01).name('灌木（含小花）').onFinishChange(onSceneryChange);
    fsc.add(S, 'hedges', 0, 1, 0.01).name('树篱').onFinishChange(onSceneryChange);
    fsc.add(S, 'hay', 0, 1, 0.01).name('草垛').onFinishChange(onSceneryChange);
    fsc.add(S, 'rocks', 0, 1, 0.01).name('石头').onFinishChange(onSceneryChange);
    fsc.add(S, 'barrels', 0, 1, 0.01).name('花桶').onFinishChange(onSceneryChange);
    fsc.add(S, 'warningSigns').name('三角警示牌').onChange(onSignsChange);
    fsc.add(S, 'highwaySign').name('蓝色高速路牌').onChange(onSignsChange);

    // ---------- 游玩中密度（主页使用上面两组） ----------
    const PD = CFG.play;
    const fpd = gui.addFolder('游玩中密度').close();
    fpd.add(PD, 'scenery', 0, 1, 0.01).name('路边布景').onFinishChange(onSceneryChange);
    fpd.add(PD, 'grass', 0, 1, 0.01).name('草叶密度').onChange(onGrassDensityChange);
    fpd.add(PD, 'flowers', 0, 1, 0.01).name('小野花密度').onChange(onGrassDensityChange);

    // ---------- 预设 ----------
    const actions = {
      copy: async () => {
        const json = JSON.stringify(CFG, null, 2);
        try { await navigator.clipboard.writeText(json); alert(t('参数已复制到剪贴板')); }
        catch (e) { prompt(t('复制下面的参数：'), JSON.stringify(CFG)); }
      },
      paste: () => {
        const text = prompt(t('粘贴参数 JSON：'));
        if (!text) return;
        try { applyConfig(JSON.parse(text)); this.refresh(); saveConfig(); }
        catch (e) { alert(t('JSON 格式不正确')); }
      },
      reset: () => {
        if (!confirm(t('恢复全部默认参数？'))) return;
        resetConfig();
        this.refresh();
      },
    };
    // 红蓝阵营实机测试：只改本机表现（帽子、脚下阵营圈），不改玩法和同步；各客户端按槽位得出同样的分队。
    // Teams come from the versus room roster; these only tune the look.
    const fteam = gui.addFolder('阵营表现');
    fteam.add(CFG.team, 'style', { '队色昵称框（HouJianNan）': 'plate', '阵营圈 + 帽子（Mayulong）': 'hat' }).name('阵营外观').listen();
    fteam.add(CFG.team, 'hats').name('帽子').listen();
    fteam.add(CFG.team, 'rings').name('脚下阵营圈').listen();
    fteam.addColor(CFG.team, 'red').name('红队颜色').listen();
    fteam.addColor(CFG.team, 'blue').name('蓝队颜色').listen();
    const fring = fteam.addFolder('阵营圈尺寸');
    fring.add(CFG.team, 'ringRadius', 0.2, 1.0, 0.01).name('半径（米）').listen();
    fring.add(CFG.team, 'ringWidth', 0.02, 0.35, 0.005).name('色环粗细（米）').listen();
    fring.add(CFG.team, 'rimWidth', 0, 0.12, 0.005).name('外描边粗细（米）').listen();
    fring.add(CFG.team, 'glow', 0, 1, 0.01).name('内圈光晕强度').listen();
    fring.add(CFG.team, 'glowSpread', 0, 0.6, 0.01).name('光晕宽度（米）').listen();
    fring.add(CFG.team, 'ringOpacity', 0.5, 2.5, 0.05).name('不透明度倍率').listen();

    const fpre = gui.addFolder('预设');
    fpre.add(actions, 'copy').name('复制参数 JSON');
    fpre.add(actions, 'paste').name('粘贴参数 JSON');
    fpre.add(actions, 'reset').name('恢复默认');

    this.onLightChange = onLightChange;
    this.onOutlineChange = onOutlineChange;
    this.onGlowChange = onGlowChange;
    this.onSceneryChange = onSceneryChange; this.onSignsChange = onSignsChange;
    this.onGroundChange = onGroundChange; this.onGrassDensityChange = onGrassDensityChange;
    this.defaults = DEFAULTS;
  }

  refresh() {
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    this.onLightChange();
    this.onOutlineChange();
    this.onGlowChange();
    this.onSceneryChange(); this.onSignsChange(); this.onGroundChange(); this.onGrassDensityChange();
    this.resolution.onSettingsChange();
  }

  // 性能统计（最近 600 帧）
  attachPerf(perf) {
    const f = this.gui.addFolder('性能统计');
    const st = perf.stats;
    f.add(st, 'fps').name('平均帧率').disable();
    f.add(st, 'low1').name('1% low 帧率').disable();
    f.add(st, 'maxMs').name('最长一帧 ms').disable();
    f.add(st, 'longFrames').name('卡顿帧数（>25ms）').disable();
    f.add(st, 'cpuMs').name('CPU 耗时 ms/帧').disable();
    f.add(st, 'gpuMs').name('GPU 耗时 ms/帧').disable();
    f.add(st, 'passes').name('Render Pass').disable();
    f.add(st, 'textures').name('贴图数').disable();
    f.add(st, 'geometries').name('几何体数').disable();
    f.add(st, 'programs').name('Shader Program').disable();
    f.add(st, 'calls').name('Draw Call').disable();
    f.add(st, 'tris').name('三角形').disable();
    f.add({ reset: () => perf.reset() }, 'reset').name('重新统计');
    this.gui.children.splice(this.gui.children.indexOf(f), 1);
    this.gui.children.splice(1, 0, f);
    this.gui.$children.insertBefore(f.domElement, this.gui.$children.children[1]);
  }

  /** Read-only room sync window, refreshed once per second by NetworkGame. */
  attachNetwork(stats) {
    const f = this.gui.addFolder('联机同步');
    f.add(stats, 'snapshotHz').name('快照频率 /s').disable();
    f.add(stats, 'gapMaxMs').name('最长快照间隔 ms').disable();
    f.add(stats, 'bytes').name('快照大小（字符）').disable();
    f.add(stats, 'ackMs').name('输入确认中位 ms').disable();
    f.add(stats, 'correctionCm').name('本机最大纠偏 cm').disable();
    f.add(stats, 'clockErrorMs').name('画面时钟误差 ms').disable();
    f.add(stats, 'delayMs').name('远端插值延迟 ms').disable();
    f.add(stats, 'rttMs').name('直连往返 RTT ms').disable();
  }

  update(dt) {
    if (this.gui._hidden) return;
    this.displayTime = (this.displayTime || 0) + dt;
    if (this.displayTime < 0.25) return;
    this.displayTime = 0;
    // One shared clock, no per-controller requestAnimationFrame loops.
    this.refreshLabels();
  }

  refreshLabels() {
    this.gui.controllersRecursive().forEach(controller => {
      controller.updateDisplay();
      // Localize read-only status values without changing the underlying graphics configuration.
      if (controller._disabled && controller.$input?.type === 'text') controller.$input.value = t(controller.getValue());
    });
    localizeMarkup(this.gui.domElement);
  }

  dispose() { this.gui.destroy(); }

  toggle() {
    this.gui._hidden ? this.gui.show() : this.gui.hide();
    if (!this.gui._hidden) {
      this.displayTime = 0;
      this.refreshLabels();
    }
  }
}
