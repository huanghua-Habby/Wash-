import { i18n, localizedText, localizedAttr, localizedNode, localizeMarkup, format } from '../i18n/Localization.js';
import { CFG, DEFAULTS, GAMEPLAY_FOV_RANGE, saveConfig } from '../core/config.js';
import { LEVELS, VERSUS_LEVELS, getLevel, SAVE_VERSION, firstLevelFor } from '../../../shared/levels.js';
import { mountLevelResults, resultTitle } from './LevelResults.js';
import { mountVersusResults, versusResultTitle } from './VersusResults.js';
import { createLevelCard, createMapCard } from './LevelCards.js';
import { prepareRatingStars } from './RatingStars.js';

// Menu lifecycle is separate from the practice scene and future order gameplay.
export class MainMenu {
  constructor({ ui, post, rig, onStart, sceneManager, onPause, getResults, onRequestStart, saveStore, canControl, onRequestLoad, onVersusPause, onVoteResume }) {
    this.ui = ui;
    this.post = post;
    this.rig = rig;
    this.onStart = onStart;
    this.sceneManager = sceneManager;
    this.onPause = onPause; this.onVersusPause = onVersusPause; this.onVoteResume = onVoteResume;
    this.getResults = getResults;
    this.onRequestStart = onRequestStart;
    this.saveStore = saveStore; this.canControl = canControl; this.onRequestLoad = onRequestLoad;
    this.dialog = document.getElementById('menu-dialog');
    ui.registerPanel('result-reveal', {
      ready: prepareRatingStars(),
      pages: ['game'], update: dt => this.resultReveal?.update(dt, ui.isPanelForeground('menu'), ui.motionAllowed),
      dispose: () => this.clearResultReveal(),
    });
    ui.listen(this.dialog, 'close', () => { if (!this.dialog.open) this.clearResultReveal(); });
    this.home = document.getElementById('home-menu');
    this.gameControls = document.getElementById('game-controls');
    this.hud = document.getElementById('hud');
    this.newGame = document.getElementById('new-game');
    ui.listen(this.newGame, 'click', () => this.startGame());
    // Versus map: the host's own pick (VERSUS_RULES.md §1.1), chosen from the main menu like co-op level select.
    this.versusMap = firstLevelFor('versus');
    this.modeSwitch = document.getElementById('mode-switch');
    ui.listen(this.modeSwitch, 'click', () => this.toggleGameMode());
    ui.listen(document.getElementById('continue-game'), 'click', () => this.resume());
    ui.listen(document.getElementById('pause-game'), 'click', () => ui.open('pause'));
    ui.listen(document.getElementById('select-level'), 'click', () => ui.open('levels'));
    ui.listen(document.getElementById('settings'), 'click', () => ui.open('settings'));
    // The end-of-round panel stays until a button is clicked: no ×, backdrop or Space (jump) dismissal.
    ui.listen(document.getElementById('dialog-close'), 'click', () => { if (!this.finished) ui.close('menu'); });
    for (const type of ['keydown', 'keyup']) ui.listen(this.dialog, type, (e) => { if (this.finished && e.code === 'Space') e.preventDefault(); });
    ui.listen(this.dialog, 'click', (e) => {
      const rect = this.dialog.getBoundingClientRect();
      if (e.target === this.dialog && !this.finished && (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)) ui.close('menu');
    });
    this.updateFraming();
    this.refreshProgress();
  }

  updateFraming() {
    if (this.mode === 'home') {
      this.rig.screenBias = 0.15;
      this.rig.framingFov = 3;
    }
  }

  /** The mode the menus present (the shown world's; UIManager.gameMode). */
  get gameMode() { return this.ui.gameMode; }

  /** Host only: the registry switches the room; the host world and every page then reload under the black mask. */
  toggleGameMode() {
    const room = this.ui.connection?.room;
    if (this.mode !== 'home' || !room?.ownCode) return;
    this.ui.connection.setGameMode(room.gameMode === 'versus' ? 'coop' : 'versus');
  }

  /** Mode button and the versus home actions (no saved levels in versus); visible buttons number in order. */
  refreshGameMode() {
    const room = this.ui.connection?.room, versus = this.gameMode === 'versus', host = !!room?.ownCode;
    this.modeSwitch.hidden = !host; this.modeSwitch.dataset.mode = this.gameMode;
    localizedText(this.modeSwitch.querySelector('.mode-switch-label'), versus ? '还是合作好' : '我不想合作啦！');
    // The title kicker reads as a showdown in versus.
    localizedText(document.querySelector('.brand-kicker'), versus ? '红蓝上车 · 一决胜负' : '全员上车 · 准备开工');
    localizedText(this.modeSwitch.querySelector('small'), versus ? '返回四人合作' : '切换到 4v4 对抗');
    // Versus reuses the level-select slot as the host's map choice (02, before settings); guests do not pick the map.
    const select = document.getElementById('select-level'), selectTitle = select.children[1];
    document.getElementById('continue-game').hidden = versus; select.hidden = versus && !host;
    const selectKey = versus ? `map:${this.versusMap}` : 'levels';
    if (selectTitle.dataset.key !== selectKey) {
      selectTitle.dataset.key = selectKey;
      if (versus) { const small = document.createElement('small'); localizedText(small, getLevel(this.versusMap).name); selectTitle.replaceChildren(localizedNode('选择地图'), small); }
      else selectTitle.replaceChildren(localizedNode('选择关卡'));
    }
    document.getElementById('save-status').hidden = versus; // Versus never saves level progress.
    const title = this.newGame.children[1], small = title.querySelector('small');
    // A versus guest's main button is their ready toggle; the subtitle (waiting states, gate reasons) stays with UIManager.refresh.
    const label = !versus ? '新游戏' : host ? '开始对抗' : this.localMember?.ready ? '取消准备' : '准备';
    if (title.dataset.label !== label) { title.dataset.label = label; title.replaceChildren(localizedNode(label), small); }
    [...this.home.querySelectorAll('.menu-actions .menu-button')].filter(button => !button.hidden)
      .forEach((button, i) => { button.querySelector('.button-index').textContent = String(i + 1).padStart(2, '0'); });
  }

  get localMember() { const room = this.ui.connection?.room; return room?.members?.find(member => member.id === room.playerId) || null; }

  /** The level a menu start uses: the host's map pick in versus (room settings), the first co-op level otherwise. */
  defaultLevel() { return this.gameMode === 'versus' ? this.versusMap : firstLevelFor(this.gameMode); }
  startGame(remote = false, levelId = this.defaultLevel()) {
    if (!remote && this.gameMode === 'versus' && !this.ui.connection?.room?.ownCode) { this.ui.connection.setReady(!this.localMember?.ready); return; }
    if (!remote && this.onRequestStart) { this.onRequestStart(levelId); return; }
    if (this.mode !== 'home' && !(remote && this.mode === 'game')) return;
    this.ui.setPage('transition');
    this.onStart?.();
  }

  finishTransition() {
    this.ui.setPage('game'); this.ui.focusGame();
  }

  returnHome(remote = false) {
    if (this.mode === 'home' || this.mode === 'leaving') return;
    if (!remote && this.ui.inParty) return this.ui.open('leave-confirm');
    if (!remote && !this.ui.connection.isHost) return this.sceneManager.leaveGame();
    if (!remote && !this.canControl()) return;
    return this.sceneManager.returnHome({ remote });
  }

  openPause() {
    if (this.mode !== 'game') return;
    const finished = this.finished;
    const receipt = this.ui.levelPresentation?.result;
    if (finished && receipt) { this.openResults(receipt); return; }
    const content = this.openDialog('', finished ? '时间到！' : '暂停');
    if (finished) {
      const result = this.getResults?.() || { score: 0, completed: 0 };
      (content.innerHTML = `<div class="round-summary"><strong>${result.score}</strong><span>完成 ${result.completed} 辆车</span></div>`, localizeMarkup(content));
    }
    const actions = document.createElement('div');
    actions.className = 'pause-actions';
    const guest = !this.ui.connection.isHost, party = this.ui.inParty;
    (actions.innerHTML = `<button class="menu-button primary pause-continue" ${finished ? 'disabled' : ''}>继续游戏</button>${guest ? '' : `<button class="menu-button pause-load" ${this.saveStore.resumeLevelId && this.canControl() ? '' : 'disabled'}>读取游戏<small>读取上次关卡，从头开始这一局</small></button>`}<button class="menu-button pause-settings">设置</button><button class="menu-button pause-home" ${party || this.canControl() ? '' : 'disabled'}>${party ? '退出组队' : '回到主菜单'}</button>`, localizeMarkup(actions));
    // Versus: this menu froze nobody; "申请暂停" freezes the whole match until a majority votes to continue.
    const game = this.ui.levelPresentation;
    if (game?.mode === 'versus' && !finished) {
      const request = document.createElement('button'); request.className = 'menu-button pause-request';
      const cooling = (game.pauseCooldowns?.[this.ui.connection?.room?.slot] || 0) > 0;
      localizedText(request, cooling ? '刚恢复，稍后可再次申请暂停' : '申请暂停'); request.disabled = !!game.pauseVote || cooling;
      request.addEventListener('click', () => { if (this.onVersusPause?.()) this.ui.close('menu'); });
      actions.prepend(request);
    }
    content.appendChild(actions);
    const saveNote = document.createElement('p'); saveNote.className = 'dialog-note save-result-note'; localizedText(saveNote, this.progressMessage()); content.appendChild(saveNote);
    actions.querySelector('.pause-load')?.addEventListener('click', () => this.resume(true));
    actions.querySelector('.pause-continue').addEventListener('click', () => this.ui.close('menu'));
    actions.querySelector('.pause-settings').addEventListener('click', () => this.ui.open('settings'));
    actions.querySelector('.pause-home').addEventListener('click', () => this.returnHome());
    this.ui.showDialog('menu');
  }

  openResults(result) {
    const level = this.ui.levelPresentation.level;
    if (result.mode === 'versus') {
      // Kicker is just the map name; the outcome heading stays as the dialog's accessible name but is not drawn (the banner says it).
      const room = this.ui.connection?.room, content = this.openDialog(level.name, versusResultTitle(result));
      this.dialog.dataset.view = 'results';
      this.resultReveal = mountVersusResults(content, { ...result, levelId: level.id }, {
        localTeam: room?.members?.find(member => member.id === room.playerId)?.team, canControl: this.canControl(),
        localSlot: room?.slot ?? null, players: this.ui.worldPlayers || [], animated: this.ui.motionAllowed,
        homeLabel: this.ui.inParty ? '退出组队' : '回到主页',
        onRetry: id => this.canControl() && this.onRequestLoad(id), onHome: () => this.returnHome(),
        onError: () => this.ui.notify('操作未完成，请重试'),
      });
      this.ui.showDialog('menu'); return;
    }
    const content = this.openDialog(format('{0} / {1}', level.number, level.name), resultTitle(result));
    this.dialog.dataset.view = 'results';
    this.resultReveal = mountLevelResults(content, { ...result, levelId: level.id }, {
      canControl: this.canControl(),
      homeLabel: this.ui.inParty ? '退出组队' : '回到主页',
      animated: this.ui.motionAllowed, onStar: index => this.ui.playResultStar(index),
      onNext: id => this.canControl() && this.onRequestLoad(id), onRetry: id => this.canControl() && this.onRequestLoad(id), onHome: () => this.returnHome(),
      onError: () => this.ui.notify('操作未完成，请重试'),
    });
    this.ui.showDialog('menu');
  }

  clearResultReveal() { this.resultReveal?.dispose(); this.resultReveal = null; }
  openDialog(kicker, title) {
    this.clearResultReveal(); this.dialog.dataset.view = 'default';
    document.getElementById('dialog-close').hidden = this.finished;
    localizedText(document.getElementById('dialog-kicker'), kicker);
    localizedText(document.getElementById('dialog-title'), title);
    const content = document.getElementById('dialog-content');
    content.replaceChildren();
    return content;
  }

  /** Continue means entering the last saved level from its beginning. */
  resume(restart = false) {
    const levelId = this.saveStore.resumeLevelId;
    if (!levelId || !this.canControl()) return;
    if (restart) this.onRequestLoad(levelId);
    else this.startGame(false, levelId);
  }

  progressMessage() {
    if (this.saveStore.error) return this.saveStore.error;
    if (this.saveStore.status === 'incompatible') return `旧存档版本不兼容，开始游戏后将创建 ${SAVE_VERSION} 存档`;
    if (this.saveStore.status === 'corrupt') return '存档无法读取，开始游戏后将创建新档';
    return this.saveStore.status === 'ready' ? '关卡进度已自动保存到本浏览器' : '关卡进度会自动保存到本浏览器';
  }

  /** Re-render resume availability after storage writes, role changes or cross-tab updates. */
  refreshProgress() {
    this.refreshGameMode();
    const level = getLevel(this.saveStore.resumeLevelId);
    const button = document.getElementById('continue-game');
    button.disabled = !level || !this.canControl();
    localizedText(button.querySelector('small'), !this.canControl() && level ? '等房主读取关卡' : level ? format("上次：{0} · 从关卡开始继续", level.name) : this.saveStore.status === 'incompatible' ? '旧存档不可用' : '还没有保存的关卡');
    localizedText(document.getElementById('save-status'), this.progressMessage());
    this.dialog?.querySelectorAll('.save-result-note').forEach((node) => { localizedText(node, this.progressMessage()); });
    if (this.dialog?.querySelector('.result-actions')?.getAttribute('aria-busy') !== 'true') {
      this.dialog?.querySelectorAll('.result-next, .result-retry').forEach(node => { node.disabled = !this.canControl(); });
    }
    const home = this.dialog?.querySelector('.pause-home, .result-home');
    if (home) localizedText(home, this.ui.inParty ? '退出组队' : home.classList.contains('result-home') ? '回到主页' : '回到主菜单');
  }

  openLevels() {
    if (this.gameMode === 'versus') { this.openMaps(); return; }
    const content = this.openDialog('准备出发', '选择关卡');
    this.dialog.dataset.view = 'levels';
    const grid = document.createElement('div'); grid.className = 'level-grid'; content.appendChild(grid);
    for (const level of LEVELS) {
      const stats = this.saveStore.data?.levels[level.id];
      grid.appendChild(createLevelCard(level, stats, { playable: this.canControl(), onSelect: id => this.startGame(false, id) }));
    }
    this.ui.showDialog('menu');
  }

  /** Versus map choice: picking a card only sets the host's map; "开始对抗" starts it. */
  openMaps() {
    const content = this.openDialog('准备开战', '选择地图');
    this.dialog.dataset.view = 'levels';
    const grid = document.createElement('div'); grid.className = 'level-grid'; content.appendChild(grid);
    for (const level of VERSUS_LEVELS) grid.appendChild(createMapCard(level, { selected: level.id === this.versusMap, playable: this.canControl(),
      onSelect: id => { this.versusMap = id; this.ui.close('menu'); this.refreshGameMode(); } }));
    this.ui.showDialog('menu');
  }

  openSettings() {
    const content = this.openDialog('按你的节奏来', '设置');
    this.dialog.dataset.view = 'settings';
    (content.innerHTML = '<label class="setting-row"><span>画面后处理<small>调色、速度线与动态模糊</small></span><input type="checkbox" id="setting-post"></label><label class="setting-row"><span>UI 动效<small>统一开启菜单、面板与 HUD 的动效</small></span><input type="checkbox" id="setting-motion"></label>', localizeMarkup(content));
    content.prepend(this.languageSetting());
    const post = content.querySelector('#setting-post');
    post.checked = this.post.enabled;
    post.addEventListener('change', () => {
      this.post.enabled = post.checked;
      try { saveConfig(); } catch { /* Still usable without persistence. */ }
    });
    const motion = content.querySelector('#setting-motion');
    motion.checked = this.ui.motionEnabled;
    motion.addEventListener('change', () => this.ui.setMotionEnabled(motion.checked));
    content.appendChild(this.cameraSettings());
    this.ui.mountAudioSettings(content);
    if (this.mode === 'game') {
      const back = document.createElement('button');
      back.className = 'settings-back'; localizedText(back, '返回暂停菜单');
      back.addEventListener('click', () => this.ui.open('pause'));
      content.appendChild(back);
    }
    this.ui.showDialog('menu');
  }

  languageSetting() {
    const row = document.createElement('div'); row.className = 'setting-row language-setting';
    const label = document.createElement('span'); localizedText(label, '语言');
    const choices = document.createElement('div'); choices.className = 'language-choices'; choices.setAttribute('role', 'group');
    localizedAttr(choices, 'aria-label', '语言');
    this.languageButtons = ['zh', 'en'].map(locale => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.language = locale;
      button.dataset.l10nLiteral = ''; button.textContent = locale === 'zh' ? '中文' : 'English';
      this.ui.listen(button, 'click', () => this.ui.setLanguage(locale)); choices.appendChild(button); return button;
    });
    row.append(label, choices); this.syncLanguageButtons(); return row;
  }
  syncLanguageButtons() { this.languageButtons?.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.language === i18n.locale))); }

  /** 镜头视野 and 固定镜头 (gameplay camera style), saved with the other display settings. */
  cameraSettings() {
    const section = document.createElement('fieldset'); section.className = 'audio-settings camera-settings';
    const legend = document.createElement('legend'); localizedText(legend, '镜头'); section.appendChild(legend);
    const row = document.createElement('label'); row.className = 'audio-setting';
    const name = document.createElement('span'); localizedText(name, '视野 FOV');
    const input = document.createElement('input'); input.type = 'range'; input.id = 'setting-camera-fov';
    [input.min, input.max] = GAMEPLAY_FOV_RANGE.map(String); input.step = '1'; localizedAttr(input, 'aria-label', '镜头视野 FOV');
    const output = document.createElement('output'); output.setAttribute('for', input.id);
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'camera-fov-reset'; localizedText(reset, '恢复默认');
    const sync = () => { input.value = String(Math.round(CFG.camera.playFov)); localizedText(output, format("{0}°", input.value)); };
    const apply = (value) => { CFG.camera.playFov = value; sync(); try { saveConfig(); } catch { /* Still usable without persistence. */ } };
    input.addEventListener('input', () => apply(Number(input.value)));
    reset.addEventListener('click', () => apply(DEFAULTS.camera.playFov));
    const hint = document.createElement('small'); hint.className = 'camera-fov-hint'; localizedText(hint, '数值越大看到的范围越广，越小镜头越近');
    row.append(name, input, output); section.append(row, hint, reset); sync();
    const style = document.createElement('label'); style.className = 'setting-row camera-style';
    (style.innerHTML = '<span>固定镜头<small>不跟随玩家，保留视野、距离与震动</small></span><input type="checkbox" id="setting-camera-fixed">', localizeMarkup(style));
    const fixed = style.querySelector('input'); fixed.checked = CFG.camera.style === 'fixed';
    fixed.addEventListener('change', () => {
      CFG.camera.style = fixed.checked ? 'fixed' : 'follow';
      try { saveConfig(); } catch { /* Still usable without persistence. */ }
    });
    section.appendChild(style);
    return section;
  }

  get mode() { return this.ui.page; }
  get finished() { return this.ui.finished; }
  get blocksPlayer() { return this.ui.blocksPlayer; }
}
