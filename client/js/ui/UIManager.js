import { Vector3 } from 'three';
import { i18n, localizedText, localizeMarkup, format } from '../i18n/Localization.js';
import { SFX } from '../audio/sounds.js';
import { AudioSettings } from './AudioSettings.js';
import { VoiceControl } from './VoiceControl.js';
import { LoadingScreen } from './LoadingScreen.js';
import { IrisTransition } from './IrisTransition.js';
import { MainMenu } from './MainMenu.js';
import { CustomizePanel } from './CustomizePanel.js';
import { RoomPanel } from './RoomPanel.js';
import { ReadyNudge } from './ReadyNudge.js';
import { RoomSettingsPanel } from './RoomSettingsPanel.js';
import { versusStartCheck } from '../../../shared/protocol.js';
import { JoinRoomProgress } from './JoinRoomProgress.js';
import { HUD } from './HUD.js';
import { WashGameHud } from './WashGameHud.js';
import { PlayerNames } from './PlayerNames.js';
import { NameVisibility } from './NameVisibility.js';
import { EmoteWheel } from './EmoteWheel.js';
import { EmoteBubbles } from './EmoteBubbles.js';
import { emoteIconsReady } from './emoteIcons.js';
import { SlapText } from './SlapText.js';
import { HackAlert } from './HackAlert.js';
import { KnockoutText } from './KnockoutText.js';
import { CooldownHint } from './CooldownHint.js';
import { SkillBadge } from './SkillBadge.js';
import { SwallowEscapeCue } from './SwallowEscapeCue.js';
import { TeammateIndicators } from './TeammateIndicators.js';
import { WorldHudPositioner } from './WorldHudPositioner.js';
import { WaterAimIndicator } from './WaterAimIndicator.js';
import { RoadSignWarnings } from './RoadSignWarnings.js';
import { RoadSignImpactText } from './RoadSignImpactText.js';
import { SoapSlipText } from './SoapSlipText.js';
import { RoundCues } from './RoundCues.js';
import { HostNotice } from './HostNotice.js';
import { LevelGuidePanel } from './LevelGuidePanel.js';
import { RejoinPanel } from './RejoinPanel.js';
import { LeavePartyConfirm } from './LeavePartyConfirm.js';
import { ChangelogPanel } from './ChangelogPanel.js';
import { TutorialToast } from './TutorialToast.js';
import { ControlsHint } from './ControlsHint.js';
import { ScoreRatingHud } from './ScoreRatingHud.js';
import { Scoreboard } from './Scoreboard.js';
import { StatsChip } from './StatsChip.js';
import { VersusScoreHud } from './VersusScoreHud.js';
import { roundCue, isPreparing } from '../../../shared/sim/roundFlow.js';
import { fitViewport } from '../core/viewport.js';
import { levelMode } from '../../../shared/levels.js';

/** Owns player-facing views and interaction policy; the debug console stays independent. */
export class UIManager {
  constructor() {
    this.loading = new LoadingScreen(); this.iris = new IrisTransition({ motionEnabled: () => this.motionAllowed });
    this.hud = new HUD({ onAllComplete: () => this.setTodoFolded(true) });
    this.page = 'home'; this.ready = false; this.finished = false; this.resultShown = false; this.disposed = false;
    this.listeners = new AbortController(); this.dialogs = new Map(); this.panels = new Map(); this.pauseRequested = false;
    this.localization = i18n; localizeMarkup(document);
    this.listen(i18n, 'change', () => { this.menu?.syncLanguageButtons(); this.levelGuide?.syncLanguage(); });
    this.disclosures = new Map(); this.motionEnabled = true;
    try { this.motionEnabled = localStorage.getItem('wash-quiet-ui') !== 'true'; } catch { /* Optional persistence. */ }
    this.reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (this.reducedMotion) this.listen(this.reducedMotion, 'change', () => this.syncMotion());
    this.syncMotion();
    this.homeRoot = document.getElementById('hud');
    this.gameControls = document.getElementById('game-controls');
    this.canvas = document.getElementById('game');
    this.roundCues = new RoundCues(() => this.motionAllowed);
    this.roundStage = 'idle';
    this.registerPanel('round-cues', { pages: ['game'], dispose: () => this.roundCues.dispose() });
    this.tutorialToast = new TutorialToast(this);
    this.registerPanel('tutorial-toast', { pages: ['game'], dispose: () => this.tutorialToast.dispose() });
    this.controlsHint = new ControlsHint(this);
    this.registerPanel('controls-hint', { pages: ['home'], dispose: () => this.controlsHint.dispose() });
    const version = document.querySelector('meta[name="application-version"]')?.content;
    this.versionWatermark = document.createElement('span'); this.versionWatermark.className = 'version-watermark';
    localizedText(this.versionWatermark, version ? format("版本 {0}", version) : ''); this.versionWatermark.hidden = !version;
    document.getElementById('ui-stage').appendChild(this.versionWatermark);
    this.registerPanel('version-watermark', {
      pages: ['home', 'transition', 'game'], dispose: () => this.versionWatermark.remove(),
    });
    this.applicationVersion = version || '';
    this.homeRoot.inert = true;
    this.setTodoFolded(true);
    this.listen(document.getElementById('sidebar-role'), 'click', () => this.setTodoFolded(true));
    this.listen(document.getElementById('sidebar-checklist'), 'click', () => this.setTodoFolded(false));
    this.listen(document.querySelector('.sidebar-tabs'), 'keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const role = event.key === 'Home' || (event.key !== 'End' && !this.todoFolded);
      this.setTodoFolded(role);
      document.getElementById(role ? 'sidebar-role' : 'sidebar-checklist').focus({ preventScroll: true });
    });
  }

  listen(target, type, callback, options = {}) { target.addEventListener(type, callback, { ...options, signal: this.listeners.signal }); }
  setLanguage(locale) { return !this.disposed && i18n.setLocale(locale); }
  roomSnapshotApplied(room, data) { this.joinProgress?.snapshotApplied(room, data); }
  get motionAllowed() { return this.motionEnabled && !this.reducedMotion?.matches; }
  setMotionEnabled(enabled) {
    this.motionEnabled = !!enabled;
    try { localStorage.setItem('wash-quiet-ui', String(!this.motionEnabled)); } catch { /* Optional persistence. */ }
    this.syncMotion();
  }
  syncMotion() {
    document.body.classList.toggle('quiet-ui', !this.motionAllowed);
    if (!this.motionAllowed) document.getAnimations?.().forEach(animation => animation.cancel());
  }
  /** Inline views share the global motion policy and survive rapid open/close changes. */
  setDisclosure(node, open) {
    const revision = (this.disclosures.get(node) || 0) + 1;
    this.disclosures.set(node, revision);
    node.inert = !open;
    node.setAttribute('aria-hidden', String(!open));
    node.classList.remove('closing');
    if (open) { node.hidden = false; return; }
    if (node.hidden || !this.motionAllowed || !this.ready) { node.hidden = true; return; }
    node.classList.add('closing');
    Promise.allSettled(node.getAnimations().map(animation => animation.finished)).then(() => {
      if (this.disclosures.get(node) !== revision) return;
      node.hidden = true; node.classList.remove('closing');
    });
  }
  progress(label, value) { this.loading.step(label, value); }
  prepareLayout() { fitViewport(); }
  setSceneStage(stage) { document.getElementById('app-frame').dataset.scene = stage; }
  notify(message, show = true, showAtHome = false) {
    if (!this.ready) { this.pendingToast = show ? {message, showAtHome} : null; return; }
    this.room.showToast(message, show, showAtHome);
  }
  fail(error) { this.ready = false; this.iris.reset(); this.closeAll(); this.loading.root.hidden = false; this.loading.fail(error); this.syncInteraction(); }

  createWorldHud(players, homeTruck) {
    if (this.worldHud) throw new Error('World HUD already registered');
    this.hudPositioner = new WorldHudPositioner();
    this.tagVisibility = new NameVisibility();
    this.worldHud = new WashGameHud(players, () => this.motionAllowed, this.hudPositioner);
    this.scoreRating = new ScoreRatingHud(document.getElementById('score-panel'));
    this.registerPanel('score-rating', { pages: ['game'], dispose: () => this.scoreRating.dispose() });
    // Match record: the hold-Tab board and the local "+N" chip above the score.
    this.scoreboard = new Scoreboard(() => this.motionAllowed);
    this.registerPanel('scoreboard', { pages: ['game'], dispose: () => this.scoreboard.dispose() });
    this.statsChip = new StatsChip(() => this.motionAllowed);
    this.registerPanel('stats-chip', { pages: ['game'], dispose: () => this.statsChip.dispose() });
    this.versusScore = new VersusScoreHud(() => this.motionAllowed);
    this.registerPanel('versus-score', { pages: ['game'], dispose: () => this.versusScore.dispose() });
    this.waterAim = new WaterAimIndicator(players, this.hudPositioner);
    this.roadSignWarnings = new RoadSignWarnings(this.hudPositioner);
    this.registerPanel('road-sign-warnings', { pages: ['game'], dispose: () => this.roadSignWarnings.dispose() });
    this.roadSignImpacts = new RoadSignImpactText(players, this.hudPositioner, () => this.motionAllowed);
    this.registerPanel('road-sign-impacts', { pages: ['game'], dispose: () => this.roadSignImpacts.dispose() });
    this.soapSlipText = new SoapSlipText(players, this.hudPositioner, () => this.motionAllowed);
    this.registerPanel('soap-slip-text', { pages: ['home', 'game'], dispose: () => this.soapSlipText.dispose() });
    this.slapText = new SlapText(players, this.hudPositioner, () => this.motionAllowed);
    this.registerPanel('slap-text', { pages: ['game'], dispose: () => this.slapText.dispose() });
    // Versus hack console: badge over the console and the team warning / result banner.
    this.hackAlert = new HackAlert(this.hudPositioner, () => this.motionAllowed);
    this.registerPanel('hack-alert', { pages: ['home', 'game'], dispose: () => this.hackAlert.dispose() });
    // Knock-off feedback "砰～!" in the upper middle of the screen (the camera thump and post punch live in SceneCamera).
    this.knockoutText = new KnockoutText(() => this.motionAllowed);
    this.registerPanel('knockout-text', { pages: ['game'], dispose: () => this.knockoutText.dispose() });
    this.registerPanel('water-aim', { pages: ['home', 'game'], dispose: () => this.waterAim.dispose() });
    this.names = new PlayerNames(players, homeTruck, this.hudPositioner, this.tagVisibility);
    this.teammateIndicators = new TeammateIndicators(players, homeTruck);
    this.worldPlayers = players;
    this.emoteBubbles = new EmoteBubbles(players, this.hudPositioner, () => this.motionAllowed, (player, state, target) => this.names.counterAnchor(player, state, target));
    this.registerPanel('emote-bubbles', { pages: ['home', 'game'], ready: emoteIconsReady(), dispose: () => this.emoteBubbles.dispose() });
    this.emoteWheel = new EmoteWheel(this.hudPositioner, id => this.connection?.send('emote', { id }));
    this.registerPanel('emote-wheel', { pages: ['home', 'game'], dispose: () => this.emoteWheel.dispose() });
    // A refused press while recharging: a dull, low "not yet" thud through AudioManager.
    this.cooldownHint = new CooldownHint(this.hudPositioner, () => this.motionAllowed, () => this.audio?.post(SFX.drop, 0, .6, -1, 0, .72));
    this.registerPanel('cooldown-hint', { pages: ['home', 'game'], dispose: () => this.cooldownHint.dispose() });
    // Versus: the local animal's skill, always shown at the bottom left (SkillBadge).
    this.skillBadge = new SkillBadge(() => this.motionAllowed);
    this.registerPanel('skill-badge', { pages: ['game'], dispose: () => this.skillBadge.dispose() });
    // Inside a pelican: a big "mash any key to break free" cue with the escape bar, instead of the bottom toast.
    this.swallowEscape = new SwallowEscapeCue(() => this.motionAllowed);
    this.registerPanel('swallow-escape', { pages: ['home', 'game'], dispose: () => this.swallowEscape.dispose() });
    this.ghostAnchor = new Vector3();
    this.registerPanel('teammate-indicators', { pages: ['game'], dispose: () => this.teammateIndicators.dispose() });
    const view = this.worldHud;
    // Shared simulation can notify the adapter, but frame presentation has one manager-owned entry.
    this.simulationHud = {
      root: view.root,
      get lastScore() { return view.lastScore; }, set lastScore(value) { view.lastScore = value; },
      get lastCombo() { return view.lastCombo; }, set lastCombo(value) { view.lastCombo = value; },
      setStains: stains => view.setStains(stains), reward: amount => view.reward(amount), update() {},
    };
    return this.simulationHud;
  }

  mount({ input, connection, ...menuOptions }) {
    if (this.menu || this.disposed) throw new Error('UIManager can only be mounted once');
    this.input = input; this.connection = connection;
    // A versus guest who has not readied for a while gets their ready button lit up and shaken.
    this.readyNudge = new ReadyNudge(document.getElementById('new-game'));
    this.registerPanel('ready-nudge', { pages: ['home'], dispose: () => this.readyNudge.dispose(),
      update: dt => this.readyNudge.update(dt, this.awaitingReady, this.motionAllowed) });
    this.cameraRig = menuOptions.rig;
    this.rejoin = new RejoinPanel(this);
    this.registerPanel('rejoin', {
      dialog:this.rejoin.dialog, pages:['home', 'transition', 'game'],
      canOpen:() => !!connection.guest?.rejoinPending, canClose:() => !connection.guest?.rejoinPending,
      open:() => { this.showDialog('rejoin'); this.rejoin.yes.focus({preventScroll:true}); },
      update:() => this.rejoin.update(), dispose:() => this.rejoin.dispose(),
    });
    this.levelGuide = new LevelGuidePanel(this);
    this.registerPanel('level-guide', {
      dialog: this.levelGuide.dialog, pages: ['game'], ready: this.levelGuide.ready,
      canOpen: () => this.roundStage === 'guide' && !this.levelGuide.releasing,
      canClose: () => !!this.levelGuide.releasing,
      open: () => { this.showDialog('level-guide'); this.levelGuide.button.focus({ preventScroll: true }); },
      close: () => this.levelGuide.close(), onClosed: () => this.levelGuide.reset(), dispose: () => this.levelGuide.dispose(),
    });
    this.menu = new MainMenu({ ...menuOptions, ui: this });
    // Update notes beside the version watermark (main menu only); a new version's notes open once by themselves.
    this.changelog = new ChangelogPanel(this, this.applicationVersion);
    this.registerPanel('changelog', {
      dialog: this.changelog.dialog, pages: ['home'], open: () => this.changelog.open(),
      update: () => this.changelog.update(), dispose: () => this.changelog.dispose(),
    });
    this.leaveConfirm = new LeavePartyConfirm(this);
    this.registerPanel('leave-confirm', {
      dialog: this.leaveConfirm.dialog, pages: ['home', 'game'],
      canOpen: () => this.inParty, canClose: () => !this.leaveConfirm.pending,
      open: () => this.leaveConfirm.open(), update: () => this.leaveConfirm.update(),
      dispose: () => this.leaveConfirm.dispose(),
    });
    this.joinProgress = new JoinRoomProgress(this);
    this.registerPanel('join-progress', {
      dialog: this.joinProgress.dialog, pages: ['home'], canOpen: () => this.joinProgress.active, canClose: () => false,
      open: () => this.joinProgress.open(), update: () => this.joinProgress.update(), dispose: () => this.joinProgress.dispose(),
    });
    this.room = new RoomPanel(connection, this);
    this.roomSettings = new RoomSettingsPanel(connection, this);
    this.registerPanel('room-arrivals', { pages: ['home'], update: dt => this.room.update(dt) });
    this.customize = new CustomizePanel({ connection, ui: this });
    this.registerDialog('menu', this.menu.dialog);
    this.hostNotice = new HostNotice(this);
    this.registerPanel('host-notice', {
      dialog: this.hostNotice.dialog, pages: ['home', 'game', 'transition'],
      canClose: () => false, open: () => this.showDialog('host-notice'),
      onClosed: () => this.hostNotice.reset(), update: () => this.hostNotice.update(), dispose: () => this.hostNotice.dispose(),
    });
    this.registerPanel('customize', {
      dialog: this.customize.dialog, ready: this.customize.ready,
      canOpen: () => connection.connected && connection.room?.phase === 'home' && !this.customize.pending && !this.customize.closing,
      canClose: () => !this.customize.pending,
      open: () => this.customize.open(), close: () => { if (!this.customize.pending) this.customize.close(); },
      onClosed: () => this.customize.onClosed(),
      update: dt => { if (this.customize.dialog.open) this.customize.render(dt); },
      dispose: () => this.customize.dispose(),
    });
    this.listen(window, 'keydown', event => this.handlePauseShortcut(event));
    this.listen(this.canvas, 'pointerdown', () => this.focusGame());
    this.listen(this.canvas, 'wheel', event => this.handleCameraWheel(event), { passive: false });
    this.listen(document, 'focusin', () => this.syncInteraction());
    this.listen(document, 'focusout', () => queueMicrotask(() => this.syncInteraction()));
    this.listen(window, 'resize', () => this.menu.updateFraming());
    this.listen(window, 'resize', fitViewport);
    this.listen(connection, 'room', () => {
      if (this.customize.dialog.open && connection.room?.phase !== 'home') this.close('customize', true);
      this.refresh();
    });
    this.listen(connection, 'status', () => this.refresh());
    this.listen(this.menu.saveStore, 'change', () => this.refresh());
    this.refresh(); this.syncInteraction();
  }

  /** UI events share the manager-owned input and listener lifetime. */
  bindAudio(audio) {
    if (this.audio) throw new Error('UI audio already bound');
    this.audio = audio;
    this.audioSettings = new AudioSettings(this, audio);
    this.registerPanel('audio-settings', { pages: ['home', 'game'], dispose: () => this.audioSettings.dispose() });
    this.listen(document, 'click', event => {
      if (this.ready && event.target.closest?.('button:not(:disabled)')) audio.post(SFX.ui_click);
    });
    this.listen(window, 'keydown', event => {
      if (event.code === 'KeyM' && !event.repeat && !this.editing && this.ready) {
        audio.toggleMute(); this.audioSettings.sync();
      }
    });
  }

  /** Party voice controls on the room card and game HUD; VoiceChat owns capture and the mute preference. */
  bindVoice(voice) {
    if (this.voiceControl) throw new Error('UI voice already bound');
    this.voiceControl = new VoiceControl(this, voice, this.audio);
    this.audioSettings?.bindVoice(voice);
    this.registerPanel('voice-chat', { pages: ['home', 'game'], dispose: () => this.voiceControl.dispose() });
  }

  mountAudioSettings(parent) { this.audioSettings?.mount(parent); }

  registerDialog(name, dialog) {
    if (this.dialogs.has(name)) throw new Error(`Duplicate UI dialog: ${name}`);
    this.dialogs.set(name, dialog);
    // Native close events are queued: derive state from all currently open dialogs, never the closed view alone.
    this.listen(dialog, 'close', () => {
      if (!dialog.open) this.panels.get(name)?.onClosed?.();
      if (this.page === 'game' && (!this.hasModal || this.isPanelForeground('level-guide')) && !this.finished) this.requestPause(false);
      this.syncInteraction(); this.focusGame();
    });
  }

  /** Register a view's lifecycle before startup preparation.
   * @param {string} name
   * @param {{dialog?: any, open?: (() => void) | null, close?: (() => void) | null,
   * onClosed?: (() => void) | null, update?: ((dt: number) => void) | null,
   * ready?: Promise<unknown> | null, dispose?: (() => void) | null,
   * canOpen?: () => boolean, canClose?: () => boolean, pages?: string[]}} options
   */
  registerPanel(name, { dialog = null, open = null, close = null, onClosed = null, update = null, ready = null, dispose = null, canOpen = () => true, canClose = () => true, pages = ['home'] }) {
    if (this.disposed || this.readiness) throw new Error('Register UI panels before scene preparation');
    if (this.panels.has(name)) throw new Error(`Duplicate UI panel: ${name}`);
    this.panels.set(name, { open, close, onClosed, update, ready, dispose, canOpen, canClose, pages });
    if (dialog) this.registerDialog(name, dialog);
  }

  /** This page's versus team (0 red, 1 blue) from its character; null in co-op. */
  get localTeam() {
    const team = this.worldPlayers?.[this.connection?.room?.slot ?? 0]?.team;
    return team === 0 || team === 1 ? team : null;
  }
  get hasModal() { return [...this.dialogs.values()].some(dialog => dialog.open); }
  get inParty() { return !!this.connection?.room && !this.connection.room.ownCode; }
  isPanelForeground(name) { return !this.iris.active && !!this.dialogs.get(name)?.open && [...this.dialogs].every(([key, dialog]) => key === name || !dialog.open || (name === 'leave-confirm' && key === 'level-guide')); }
  handlePauseShortcut(event) {
    if (event.repeat || !['Escape', 'KeyP'].includes(event.code) || this.iris.active || !this.ready || this.editing || this.hostNotice?.dialog.open) return;
    if (this.page === 'game') {
      const menu = this.dialogs.get('menu');
      if (menu?.open) { event.preventDefault(); if (!this.finished) this.close('menu', true); return; }
      if (this.hasModal && !this.isPanelForeground('level-guide')) return;
      event.preventDefault(); this.open('pause');
    } else if (this.page === 'transition' && event.code === 'Escape' && !this.hasModal) { event.preventDefault(); this.menu.returnHome(); }
  }
  get editing() {
    const node = document.activeElement;
    return !!node && (/^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName) || node.isContentEditable);
  }
  /** The mode the UI presents: the shown world's, which changes under the black mask of the covered level change, so a
   * mode switch keeps the old menus until the zoom-in has closed. Before the first world frame, the room's mode. */
  get gameMode() { return this.shownMode || (this.connection?.room?.gameMode === 'versus' ? 'versus' : 'coop'); }
  /** A connected versus guest on the main menu who has not readied up yet. */
  get awaitingReady() {
    const room = this.connection?.room;
    if (!this.ready || this.page !== 'home' || this.hasModal || !this.connection?.connected || this.gameMode !== 'versus' || room?.phase !== 'home') return false;
    const me = room.members?.find(member => member.id === room.playerId);
    return !!me && me.id !== room.hostId && !me.ready;
  }

  get blocksPlayer() {
    return !this.ready || this.iris.active || !['home', 'game'].includes(this.page) || this.connection?.guest?.homePending || this.connection?.guest?.rejoinPending || this.connection?.guest?.rejoinLeaving || isPreparing(this) || this.hasModal || this.finished || this.editing;
  }

  syncInteraction() {
    if (!this.input || this.disposed) return;
    const enabled = !this.blocksPlayer;
    if (this.input.enabled !== enabled) this.input.setEnabled(enabled);
    this.homeRoot.inert = this.page !== 'home' || !this.ready || this.iris.active || this.hasModal || this.finished;
  }
  focusGame() { if (!this.blocksPlayer && !this.disposed) this.canvas.focus({ preventScroll: true }); }

  handleCameraWheel(event) {
    if (this.disposed || this.page !== 'game' || this.roundStage !== 'playing' || this.blocksPlayer ||
        this.levelPresentation?.paused || event.defaultPrevented || event.ctrlKey || event.metaKey ||
        !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.canvas.clientHeight || 800 : 1;
    event.preventDefault();
    this.cameraRig.zoomByWheel(event.deltaY * unit);
  }

  open(name, options = {}) {
    if (this.disposed || !this.ready || this.iris.active || (!['home', 'game'].includes(this.page) && !(['host-notice', 'rejoin'].includes(name) && this.page === 'transition'))) return false;
    if (this.roundStage === 'finish' && !['host-notice', 'rejoin', 'leave-confirm'].includes(name)) return false;
    if (this.roundStage === 'guide' && !['level-guide', 'host-notice', 'rejoin', 'pause', 'settings', 'leave-confirm'].includes(name)) return false;
    if (this.hostNotice?.dialog.open && name !== 'host-notice') return false;
    if (name === 'host-notice') { this.close('level-guide', true); this.close('rejoin', true); }
    if (name === 'rejoin') this.close('level-guide', true);
    const panel = this.panels.get(name);
    if (panel && (!panel.pages.includes(this.page) || !panel.canOpen())) return false;
    if (name === 'pause' && this.page !== 'game') return false;
    if (name === 'levels' && this.page !== 'home') return false;
    if (!panel && !['pause', 'settings', 'levels'].includes(name)) throw new Error(`Unknown UI view: ${name}`);
    // Close other modals synchronously before opening the replacement. Their queued close events see the replacement.
    const target = panel ? name : 'menu';
    const keepGuide = this.roundStage === 'guide' && ['pause', 'settings', 'leave-confirm'].includes(name) && this.dialogs.get('level-guide')?.open;
    if (name === 'level-guide' && this.dialogs.get('menu')?.open) return false;
    for (const [key, dialog] of this.dialogs) {
      if (keepGuide && key === 'level-guide') continue;
      if (key !== target && dialog.open && this.panels.get(key)?.canClose() === false) return false;
    }
    for (const key of this.dialogs.keys()) if (key !== target && !(keepGuide && key === 'level-guide')) this.close(key, true);
    if (panel) panel.open?.();
    else if (name === 'pause') { this.finished = options.finished ?? this.finished; this.requestPause(true); this.menu.openPause(); }
    else if (name === 'settings') { if (this.page === 'game') this.requestPause(true); this.menu.openSettings(); }
    else this.menu.openLevels();
    this.syncInteraction();
    return true;
  }

  showDialog(name) {
    if (this.disposed || this.iris.active) return false;
    const dialog = this.dialogs.get(name); if (!dialog.open) dialog.showModal(); this.syncInteraction();
    return true;
  }
  close(name, force = false) {
    const dialog = this.dialogs.get(name);
    if (!dialog?.open) return;
    const panel = this.panels.get(name);
    if (panel && !force) { if (panel.canClose()) panel.close?.(); return; }
    dialog.close(); this.syncInteraction();
  }
  closeAll() { for (const name of this.dialogs.keys()) this.close(name, true); }
  requestPause(paused) {
    if (this.pauseRequested === paused) return;
    this.pauseRequested = paused; this.menu.onPause?.(paused);
  }
  confirmGuide(id, keyboard = false, pageIndex = 0) {
    const sent = this.connection.confirmGuide(id, pageIndex);
    if (sent && keyboard) this.audio?.post(SFX.ui_click);
    return sent;
  }
  playConfirmSound() { this.audio?.post(SFX.ui_click); }
  playResultStar(index) { this.audio?.post(SFX.pop, 0, .55, -1, 0, .95 + index * .13); }

  setPage(page) {
    this.page = page;
    if (page === 'home' || page === 'transition') { this.finished = false; this.resultShown = false; this.pauseRequested = false; }
    if (page !== 'game') { this.roundStage = 'idle'; this.lastRoundCue = ''; this.roundCues.reset(); }
    if (page !== 'game' && page !== 'leaving') { this.levelGuide?.reset(); this.tutorialToast?.reset(); this.scoreRating?.reset(); this.scoreboard?.reset(); this.statsChip?.reset(); this.versusScore?.reset(); this.levelPresentation = null; }
    if (page === 'transition' || page === 'leaving') this.closeAll();
    else for (const [name, panel] of this.panels) if (!panel.pages.includes(page)) this.close(name, true);
    // Keep the outgoing page/HUD until IrisTransition covers it and commits the home snapshot.
    if (page === 'leaving') { this.syncInteraction(); return; }
    this.homeRoot.hidden = page === 'game';
    this.gameControls.hidden = page !== 'game';
    document.body.classList.toggle('starting-game', page === 'transition');
    document.body.classList.toggle('in-game', page === 'game' || page === 'leaving');
    if (page === 'transition') document.getElementById('interaction-prompt').hidden = true;
    this.syncInteraction();
  }

  refresh() {
    this.menu.refreshProgress(); this.room.refresh(); this.roomSettings.refresh();
    // The second sidebar tab follows the shown mode: checklist in co-op, room settings in versus.
    const versus = this.gameMode === 'versus';
    if (versus !== this.versusTabs) { this.versusTabs = versus; this.setTodoFolded(this.todoFolded); }
    const host = this.connection.connected && !!this.connection.room?.ownCode;
    const waiting = this.connection.room?.homeWaiting?.length > 0;
    // Versus: guests use the main button to ready up; the host's start waits for both teams and every guest.
    const room = this.connection.room, gate = versus && room ? versusStartCheck(room) : null, ready = !!this.menu.localMember?.ready;
    document.getElementById('new-game').disabled = versus && !host ? !this.connection.connected || room?.phase !== 'home' : !host || waiting || (gate && !gate.ok);
    document.getElementById('select-level').disabled = !host || waiting;
    localizedText(document.getElementById('new-game').querySelector('small'), host && waiting ? '等队友返回主菜单'
      : versus && !host ? (ready ? '已准备 · 等房主开始' : '准备好了就点一下')
      : this.connection.connected && !host ? '等房主带大家出发'
      : gate && !gate.teams ? '两队都需要至少一名玩家'
      : gate && !gate.ok ? format("等待全员准备（{0}/{1}）", gate.ready, gate.total)
      : versus ? '红队在左 · 蓝队在右' : '出发，把麻烦洗干净');
    document.getElementById('customize-player').disabled = !this.connection.connected || this.connection.room?.phase !== 'home';
    if (this.customize.dialog.open) this.customize.refresh();
    this.syncInteraction();
  }

  registerReadiness(readiness) {
    if (this.readiness === readiness) return;
    if (this.readiness) throw new Error('UI already registered with another SceneReadiness');
    this.readiness = readiness;
    readiness.addAsset('UI 文字转场', this.iris.prepare());
    for (const [name, panel] of this.panels) if (panel.ready) readiness.addAsset(`UI 资源：${name}`, panel.ready);
    readiness.addAsset('品牌水枪图标', document.getElementById('wash-watergun').decode());
    readiness.addAsset('菜单图标', Promise.all(['new-game', 'continue-game', 'select-level', 'settings'].map(async name => {
      const image = new Image(); image.src = new URL(`../../assets/icons/${name}.svg`, import.meta.url).href; await image.decode();
    })));
  }
  update(dt) {
    if (this.disposed) return;
    this.iris.update(dt);
    if (this.ready && !this.iris.active && this.pendingToast) { this.room.showToast(this.pendingToast.message, true, this.pendingToast.showAtHome); this.pendingToast = null; }
    for (const panel of this.panels.values()) panel.update?.(dt);
    this.syncInteraction();
  }
  updateWorld(camera, game, phase, dt) {
    if (this.disposed) return;
    this.updateHostStatus(game);
    this.updateRoundState(game);
    const room = this.connection?.room;
    this.hudPositioner.begin(camera, dt, { motionEnabled: this.motionAllowed,
      context: `${phase}:${game.level?.id || ''}:${room?.code || ''}:${room?.epoch || ''}` });
    const tagState = { phase, active: game.active, ended: game.ended, elapsed: game.elapsed || 0, dt, motionEnabled: this.motionAllowed };
    const tagOpacity = this.tagVisibility.update(tagState);
    this.worldGame = game; this.worldHud.tick?.(dt);
    // The shown level's mode drives the menus; it flips only when the covered level change commits the new world.
    const shown = levelMode(game.level);
    if (shown !== this.shownMode) { this.shownMode = shown; if (this.room) this.refresh(); }
    this.worldHud.update(game, tagOpacity, this.levelPresentation?.clock);
    // Keep the outgoing level HUD until the covered SceneManager commit.
    if (this.page !== 'leaving' && this.iris.phase !== 'close') this.scoreRating?.update(this.levelPresentation?.ratingProgress,
      this.page === 'game' && phase === 'game' && game.active && !this.iris.active && !this.hasModal && ['playing', 'finish'].includes(game.roundStage));
    if (this.page !== 'leaving' && this.iris.phase !== 'close') {
      const slot = room?.slot ?? game.localSlot ?? 0, live = this.page === 'game' && phase === 'game' && game.active && !this.iris.active && !this.hasModal;
      this.statsChip?.update(dt, live && ['playing', 'finish'].includes(game.roundStage), game, slot, `${game.level?.id}:${room?.code}:${room?.epoch}:${room?.roundId}`);
      this.versusScore?.update(game, this.levelPresentation?.clock, this.page === 'game' && phase === 'game' && game.active && !this.iris.active);
      this.scoreboard?.update(dt, live && !!this.input?.down('Tab') && ['ready', 'playing', 'finish'].includes(game.roundStage), game, this.worldPlayers, slot);
    }
    if (this.page !== 'leaving' && this.iris.phase !== 'close') this.tutorialToast.update(this.levelPresentation?.tutorial,
      phase === 'game' && game.roundStage === 'playing' && !game.ended && !this.iris.active && !this.hasModal,
      `${room?.epoch}:${room?.roundId || ''}`);
    this.waterAim.update(game, room?.slot ?? game.localSlot ?? 0, !this.blocksPlayer, dt, this.motionAllowed);
    this.roadSignWarnings.update(game, phase === 'game' && !this.iris.active);
    this.roadSignImpacts.update(game, phase === 'game' && !this.iris.active, dt);
    this.soapSlipText.update(game, ['home', 'game'].includes(phase) && !game.ended && !this.iris.active, dt,
      `${phase}:${game.level?.id}:${room?.code}:${room?.epoch}:${room?.roundId}`);
    this.slapText?.update(phase === 'game' && !game.ended && !this.iris.active, dt, `${game.level?.id}:${room?.code}:${room?.epoch}:${room?.roundId}`);
    this.knockoutText?.update(this.worldPlayers?.[room?.slot ?? game.localSlot ?? 0], phase === 'game' && game.active && !game.ended && !this.iris.active, dt, `${game.level?.id}:${room?.code}:${room?.epoch}:${room?.roundId}`);
    const hackShown = (this.page === 'game' && phase === 'game' && game.active && !game.ended) || (this.page === 'home' && game.practice);
    this.hackAlert?.update(game, hackShown && !this.iris.active && !this.hasModal, this.localTeam, dt);
    this.names.update(tagState, tagOpacity);
    this.tagState = tagState;
    this.emoteBubbles?.update(tagState, ['home', 'game'].includes(phase) && !this.iris.active, tagOpacity);
    const localPlayer = this.worldPlayers?.[room?.slot ?? game.localSlot ?? 0];
    // Out of play the wheel opens over the local countdown circle instead of the body.
    this.emoteWheel?.update(localPlayer, this.names.counterAnchor(localPlayer, tagState, this.ghostAnchor));
    this.cooldownHint?.update(dt, ['home', 'game'].includes(phase) && !this.iris.active && !this.blocksPlayer, localPlayer);
    this.swallowEscape?.update(['home', 'game'].includes(phase) && !this.iris.active, localPlayer);
    this.skillBadge?.update(dt, game.mode === 'versus' && this.page === 'game' && phase === 'game' && game.active && !game.ended && !this.iris.active, localPlayer);
    const localSlot = room?.slot ?? game.localSlot ?? 0, localTeam = game.mode === 'versus' ? this.teammateIndicators.players?.[localSlot]?.team : null;
    this.teammateIndicators.update(camera, localSlot,
      phase === 'game' && game.active && !game.ended && !this.iris.active && !this.hasModal, tagOpacity,
      Number.isInteger(localTeam) ? localTeam : null);
  }
  updateHostStatus(game) {
    if (!this.hostNotice || this.hostNotice.mode === 'home') return;
    // Versus: a requested pause shows the vote to every player, host included; never the co-op "host paused" notice.
    const voting = this.page === 'game' && !this.iris.active && game.active && !game.ended && !!game.pauseVote;
    if (voting) {
      const room = this.connection?.room, names = Object.fromEntries((room?.members || []).map(member => [member.slot, member.name]));
      this.hostNotice.votePaused(game.pauseVote, names, room?.slot, () => this.menu.onVoteResume?.());
      return;
    }
    if (this.hostNotice.mode === 'vote') { this.hostNotice.reset(); this.close('host-notice', true); }
    const paused = this.page === 'game' && game.roundStage !== 'guide' && !this.iris.active && !!this.connection?.guest && !this.connection.guest.homePending && !this.connection.guest.rejoinPending && !this.connection.guest.rejoinLeaving && game.active && game.paused && !game.ended;
    if (paused) this.hostNotice.paused();
    else if (this.hostNotice.mode === 'paused') { this.hostNotice.reset(); this.close('host-notice', true); }
  }
  showHostReturn(confirm) { this.hostNotice.returning(confirm); this.syncInteraction(); this.hostNotice.button.focus?.({ preventScroll:true }); }
  updateRoundState(game) {
    if (this.page !== 'game') return;
    // Frozen contract: shared/levelContracts.ts. Keep a read-only reference to the applied view.
    this.levelPresentation = game;
    const stage = game.roundStage || (game.ended ? 'results' : 'playing');
    this.roundStage = stage;
    this.levelGuide?.update(game, this.connection?.room);
    if (game.ended && !this.finished) { this.finished = true; if (!this.connection?.guest?.rejoinPending) this.closeAll(); }
    this.roundCues.update(game, !this.iris.active && !this.hasModal, this.localTeam);
    const cue = roundCue(game);
    if (cue !== this.lastRoundCue) {
      if (!game.paused && !this.iris.active) {
        if (cue.startsWith('ready')) this.audio?.post(SFX.pop, 0, .65);
        else if (cue === 'go') this.audio?.post(SFX.clean, 0, .85);
      }
      this.lastRoundCue = cue;
    }
    document.getElementById('pause-game').disabled = stage === 'finish';
    this.syncInteraction();
    if (stage === 'results' && game.ended && !this.resultShown && !this.hasModal && !this.connection?.guest?.rejoinLeaving) {
      this.resultShown = this.open('pause', { finished: true });
    }
  }
  setTodoFolded(folded) {
    this.todoFolded = !!folded;
    const settings = document.getElementById('room-settings'), versus = !!this.versusTabs;
    const second = versus ? settings : this.hud.el.todo, unused = versus ? this.hud.el.todo : settings;
    unused.hidden = true;
    this.setDisclosure(second, !this.todoFolded);
    this.setDisclosure(document.getElementById('room-panel'), this.todoFolded);
    const tab = document.getElementById('sidebar-checklist');
    localizedText(tab, versus ? '房间设置' : '出发清单'); tab.setAttribute('aria-controls', second.id);
    for (const [id, selected] of [['sidebar-role', this.todoFolded], ['sidebar-checklist', !this.todoFolded]]) {
      const tab = document.getElementById(id);
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    }
    this.syncInteraction();
  }
  handleShortcuts(input, phase, active, localInput) {
    if (input.hit('Tab')) this.toggleInfo(phase, active);
    // Wrong tool on a stain: the press itself (J) asks for the hint; the HUD shows the right tool's bubble.
    if (localInput?.hit('KeyJ') && phase === 'game' && active && !this.blocksPlayer && this.worldHud?.noteUse)
      this.worldHud.noteUse(this.worldGame, this.worldPlayers?.[this.connection?.room?.slot ?? 0]);
    const playable = ['home', 'game'].includes(phase) && !this.blocksPlayer;
    if (localInput && this.emoteWheel) this.emoteWheel.handle(localInput, playable && this.localCanEmote());
    if (localInput && this.cooldownHint && !this.emoteWheel?.open) this.cooldownHint.handle(localInput, this.worldPlayers?.[this.connection?.room?.slot ?? 0], playable);
    if (localInput && !this.emoteWheel?.open) this.skillBadge?.handle(localInput, this.worldPlayers?.[this.connection?.room?.slot ?? 0], playable);
  }
  /** The local slot's actor is on the field, or out of play with its countdown showing: either way an emote has
   * somewhere to show (over the body, or over the countdown circle). */
  localCanEmote() {
    const player = this.worldPlayers?.[this.connection?.room?.slot ?? 0];
    if (!player || player.occupied === false || player.sceneReady === false) return false;
    if (!['fallen', 'swallowed'].includes(player.state)) return true;
    return !!this.tagState && !!this.names?.counterAnchor(player, this.tagState, this.ghostAnchor);
  }
  toggleInfo(phase, active) {
    if (phase === 'game' && active && !this.blocksPlayer) this.tagVisibility.showTemporarily();
    else if (this.page === 'home') this.setTodoFolded(!this.todoFolded);
  }
  reveal() {
    this.iris.reveal(() => { this.ready = true; document.body.classList.add('scene-ready'); this.menu?.sceneManager?.homeVisible(); this.syncInteraction(); this.focusGame(); });
    this.loading.hide();
  }
  dispose() {
    if (this.disposed) return;
    this.ready = false; this.syncInteraction(); this.listeners.abort(); this.closeAll();
    this.iris.dispose();
    for (const panel of this.panels.values()) panel.dispose?.();
    this.room?.dispose();
    this.worldHud?.dispose(); this.names?.dispose(); this.hudPositioner?.reset();
    this.panels.clear(); this.dialogs.clear(); this.disclosures.clear();
    this.disposed = true;
  }
}
