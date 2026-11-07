import test from 'node:test';
import assert from 'node:assert/strict';
import { UIManager } from '../client/js/ui/UIManager.js';
import { HostNotice } from '../client/js/ui/HostNotice.js';
import { NameVisibility } from '../client/js/ui/NameVisibility.js';
import { i18n } from '../client/js/i18n/Localization.js';

i18n.setLocale('zh'); // These UI fixtures assert Chinese copy, independent of Node's navigator language.

class Dialog extends EventTarget {
  open = false;
  showModal() { this.open = true; }
  close() { if (!this.open) return; this.open = false; setImmediate(() => this.dispatchEvent(new Event('close'))); }
}
function fixture() {
  const previous = globalThis.document;
  const nodes = new Map<string, any>();
  const doc: any = { activeElement: null, body: { classList: { toggle() {} } },
    createElement() {
      const parts = new Map();
      const node: any = { hidden: false, dataset: {}, setAttribute() {}, getAnimations() { return []; }, remove() {}, appendChild() {},
        querySelector(key: string) { if (!parts.has(key)) parts.set(key, doc.createElement()); return parts.get(key); } };
      Object.defineProperty(node, 'firstElementChild', { get() { return node.querySelector('card'); } });
      return node;
    },
    getElementById(id: string) {
      if (!nodes.has(id)) nodes.set(id, new class extends EventTarget { hidden = false; inert = false; dataset = {}; classList = { toggle() {}, remove() {} }; appendChild() {} setAttribute() {} focus() { doc.activeElement = this; } });
      return nodes.get(id);
    }, setDialog(id:string, dialog:any) { nodes.set(id, dialog); }, querySelector() { return this.getElementById('sidebar-tabs'); } };
  (globalThis as any).document = doc;
  const ui = new UIManager();
  ui.input = { enabled: true, setEnabled(value: boolean) { this.enabled = value; } };
  ui.ready = true;
  const pauses: boolean[] = [];
  (ui as any).menu = { onPause: (value: boolean) => pauses.push(value), openPause: () => ui.showDialog('menu') };
  return { ui, doc, pauses, restore() { ui.dispose(); (globalThis as any).document = previous; } };
}

test('wheel camera input obeys UI gates and normalizes browser wheel units', () => {
  const { ui, doc, restore } = fixture();
  try {
    const values: number[] = []; let prevented = 0;
    ui.cameraRig = { zoomByWheel: (value: number) => values.push(value) };
    const wheel = (extra = {}) => ui.handleCameraWheel({ deltaY: 2, deltaMode: 0, preventDefault() { prevented++; }, ...extra });
    wheel(); assert.equal(values.length, 0, 'home stays unchanged');
    ui.page = 'game'; ui.roundStage = 'playing';
    wheel(); wheel({ deltaMode: 1 }); wheel({ deltaMode: 2 });
    assert.deepEqual(values, [2, 32, 1600]);
    for (const stage of ['guide', 'ready', 'finish', 'results']) { ui.roundStage = stage; wheel(); }
    ui.roundStage = 'playing';
    for (const extra of [{ ctrlKey: true }, { metaKey: true }, { defaultPrevented: true }, { deltaY: 0 }, { deltaY: NaN }]) wheel(extra);
    ui.iris.active = true; wheel(); ui.iris.active = false;
    ui.levelPresentation = { paused: true }; wheel(); ui.levelPresentation = null;
    const dialog = new Dialog(); ui.registerDialog('test', dialog); dialog.showModal(); wheel(); dialog.close();
    doc.activeElement = { tagName: 'INPUT' }; wheel(); doc.activeElement = null;
    ui.connection = { guest: { rejoinPending: true } }; wheel(); ui.connection = null;
    assert.equal(values.length, 3); assert.equal(prevented, 3, 'blocked wheel events retain their normal UI/browser behavior');
    ui.dispose(); wheel(); assert.equal(values.length, 3);
  } finally { restore(); }
});

test('one UIManager clock drives names, world tags and edge names without advancing the reveal twice', () => {
  const { ui, restore } = fixture();
  try {
    const shown: number[] = [];
    ui.tagVisibility = new NameVisibility();
    ui.hudPositioner = { begin() {}, reset() {} } as any;
    ui.worldHud = { update(_: unknown, opacity: number) { shown.push(opacity); }, dispose() {} } as any;
    ui.names = { update(_: unknown, opacity: number) { shown.push(opacity); }, dispose() {} } as any;
    ui.waterAim = { update() {} } as any;
    ui.roadSignWarnings = { update() {} } as any;
    ui.roadSignImpacts = { update() {} } as any;
    ui.soapSlipText = { update() {} } as any;
    ui.teammateIndicators = { update(_: unknown, __: unknown, ___: unknown, opacity: number) { shown.push(opacity); } } as any;
    ui.setPage('game');
    const game = { active: true, ended: false, elapsed: 40, roundStage: 'playing' };
    ui.toggleInfo('game', true);
    ui.updateWorld({} as any, game, 'game', 2.65);
    assert.ok(shown[0] > 0 && shown[0] < 1);
    assert.deepEqual(shown, [shown[0], shown[0], shown[0]]);
    assert.ok(Math.abs(ui.tagVisibility.manualRemaining - .2) < 1e-9);
    shown.length = 0;
    ui.updateWorld({} as any, game, 'game', .25);
    assert.deepEqual(shown, [0, 0, 0]);
    ui.ready = false;
    ui.toggleInfo('game', true);
    assert.equal(ui.tagVisibility.manualRemaining, 0, 'blocked input cannot reveal tags');
  } finally { restore(); }
});

test('queued close of the previous modal cannot unlock a replacement; editing blocks movement without making the field inert', async () => {
  const { ui, doc, restore } = fixture();
  try {
    for (const name of ['first', 'second']) {
      const dialog = new Dialog();
      ui.registerPanel(name, { dialog, open: () => ui.showDialog(name), close: () => ui.close(name, true) });
    }
    ui.open('first'); ui.open('second');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ui.dialogs.get('first').open, false);
    assert.equal(ui.dialogs.get('second').open, true);
    assert.equal(ui.input.enabled, false, 'old native close event must not restore game input');
    ui.close('second'); await new Promise(resolve => setImmediate(resolve));
    assert.equal(ui.input.enabled, true);
    const field = { tagName: 'INPUT' }; doc.activeElement = field; ui.syncInteraction();
    assert.equal(ui.input.enabled, false); assert.equal(ui.homeRoot!.inert, false);
    ui.focusGame(); assert.equal(doc.activeElement, field, 'room-code/nickname editing retains focus');
    ui.ready = false; doc.activeElement = null; ui.syncInteraction(); assert.equal(ui.input.enabled, false);
  } finally { restore(); }
});

test('guide keeps a lower modal under pause; shortcuts and queued closes cannot unlock reading or Ready', async () => {
  const { ui, pauses, restore } = fixture();
  try {
    const dialog = new Dialog(); let complete = false;
    ui.registerPanel('level-guide', { dialog, pages:['game'], canClose:()=>complete,
      open:()=>ui.showDialog('level-guide'), close:()=>ui.close('level-guide',true) });
    ui.registerDialog('menu',new Dialog()); ui.setPage('game'); ui.roundStage='guide'; ui.syncInteraction();
    assert.equal(ui.input.enabled,false);
    assert.equal(ui.open('level-guide'),true); ui.close('level-guide'); assert.equal(dialog.open,true);
    ui.handlePauseShortcut({code:'Escape',repeat:false,preventDefault(){}});
    assert.equal(ui.dialogs.get('menu').open,true); assert.equal(dialog.open,true);
    assert.equal(ui.isPanelForeground('level-guide'),false); assert.equal(ui.open('level-guide'),false);
    ui.handlePauseShortcut({code:'KeyP',repeat:false,preventDefault(){}});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(ui.dialogs.get('menu').open,false); assert.equal(dialog.open,true); assert.equal(ui.input.enabled,false);
    assert.deepEqual(pauses,[true,false],'closing the upper menu resumes authority while the guide still locks gameplay');
    complete=true; ui.roundStage='ready'; ui.close('level-guide');
    await new Promise(resolve=>setImmediate(resolve)); assert.equal(ui.input.enabled,false);
    ui.roundStage='playing'; ui.syncInteraction(); assert.equal(ui.input.enabled,true);
  } finally { restore(); }
});

test('host pause replaces guest menu and prevents dismiss; return updates the same panel and confirms once by wall time', async () => {
  const { ui, doc, restore } = fixture(); let now = 0, confirmed = 0;
  try {
    ui.setMotionEnabled(false); ui.registerDialog('menu', new Dialog());
    doc.setDialog('host-notice', new Dialog());
    const notice: any = new HostNotice(ui, () => now); ui.hostNotice = notice;
    ui.registerPanel('host-notice', { dialog:notice.dialog, pages:['game','transition'], canClose:()=>false,
      open:()=>ui.showDialog('host-notice'), onClosed:()=>notice.reset(), dispose:()=>notice.dispose() });
    (ui as any).connection = {guest:{homePending:false}};
    ui.setPage('game'); ui.open('pause'); const g = {active:true,paused:true,ended:false};
    ui.updateHostStatus(g); await new Promise(resolve=>setImmediate(resolve));
    assert.equal(ui.dialogs.get('menu').open, false); assert.equal(notice.dialog.open, true); assert.equal(ui.input.enabled,false);
    ui.close('host-notice'); assert.equal(notice.dialog.open,true);
    g.paused=false; ui.updateHostStatus(g); await new Promise(resolve=>setImmediate(resolve)); assert.equal(ui.input.enabled,true);
    g.paused=true; ui.updateHostStatus(g);
    ui.showHostReturn(()=>{confirmed++;ui.setPage('leaving');});
    assert.equal(notice.title.textContent,'房主退出了游戏');
    now=2900;notice.update();assert.equal(confirmed,0);assert.match(notice.count.textContent,/1 秒/);
    now=3100;notice.update();notice.confirm();assert.equal(confirmed,1);assert.equal(ui.input.enabled,false);
    await new Promise(resolve=>setImmediate(resolve));assert.equal(notice.mode,null);
  } finally { restore(); }
});

test('rejoin blocks gameplay, takes precedence over guide and remains until authority response; host return can replace it', async () => {
  const {ui,restore}=fixture();
  try {
    const guest={rejoinPending:true,rejoinLeaving:false,homePending:false}; (ui as any).connection={guest};
    ui.registerPanel('level-guide',{dialog:new Dialog(),pages:['game'],canClose:()=>false,open:()=>ui.showDialog('level-guide')});
    ui.registerPanel('rejoin',{dialog:new Dialog(),pages:['game','transition'],canClose:()=>!guest.rejoinPending,open:()=>ui.showDialog('rejoin')});
    ui.registerPanel('host-notice',{dialog:new Dialog(),pages:['game','transition'],canClose:()=>false,open:()=>ui.showDialog('host-notice')});
    ui.registerDialog('menu',new Dialog()); ui.setPage('game'); ui.roundStage='guide'; ui.open('level-guide');
    assert.equal(ui.open('rejoin'),true); await new Promise(resolve=>setImmediate(resolve));
    assert.equal(ui.dialogs.get('level-guide').open,false); assert.equal(ui.input.enabled,false);
    ui.close('rejoin'); assert.equal(ui.dialogs.get('rejoin').open,true); assert.equal(ui.open('pause'),false);
    assert.equal(ui.open('host-notice'),true); assert.equal(ui.dialogs.get('rejoin').open,false);
    ui.closeAll(); guest.rejoinPending=false; guest.rejoinLeaving=true; ui.roundStage='playing'; ui.syncInteraction();
    assert.equal(ui.input.enabled,false,'release acknowledgement cannot briefly restore gameplay before the own-room transaction');
  } finally {restore();}
});

test('returning keeps the outgoing HUD and pause request until the covered home commit; revealing controls input', async () => {
  const { ui, pauses, restore } = fixture();
  try {
    ui.registerDialog('menu', new Dialog());
    ui.setPage('game'); ui.open('pause');
    assert.deepEqual(pauses, [true]);
    let ratingResets = 0, toastResets = 0;
    ui.scoreRating = { reset() { ratingResets++; } } as any;
    ui.tutorialToast.reset = () => { toastResets++; };
    ui.levelPresentation = { ratingProgress: { stars: 2 } };
    ui.setPage('leaving'); ui.requestPause(true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ui.homeRoot!.hidden, true); assert.equal(ui.gameControls!.hidden, false, 'outgoing HUD survives mask closure');
    assert.equal(ui.input.enabled, false); assert.deepEqual(pauses, [true], 'queued close must not unpause a leaving room');
    assert.equal(ratingResets, 0); assert.equal(toastResets, 0); assert.ok(ui.levelPresentation, 'new level HUD preserves the outgoing scene too');
    ui.iris.active = true; ui.setPage('home');
    assert.equal(ratingResets, 1); assert.equal(toastResets, 1); assert.equal(ui.levelPresentation, null);
    assert.equal(ui.homeRoot!.hidden, false); assert.equal(ui.gameControls!.hidden, true); assert.equal(ui.input.enabled, false);
    assert.equal(ui.showDialog('menu'), false, 'late dialogs cannot enter the top layer over a scene mask');
    assert.equal(ui.isPanelForeground('menu'), false, 'covered panels cannot consume shortcuts');
    ui.iris.active = false; ui.syncInteraction(); assert.equal(ui.input.enabled, true);
    assert.deepEqual(pauses, [true], 'the home authority reset handles pause, without a stale resume call');
  } finally { restore(); }
});

test('round cues block Ready input and defer results until Finish completes, including an open pause dialog', async () => {
  const { ui, restore } = fixture();
  try {
    ui.setMotionEnabled(false); ui.registerDialog('menu', new Dialog()); ui.setPage('game');
    const g = { active: true, ended: false, roundStage: 'ready', roundStageTime: 0, elapsed: 0 };
    ui.updateRoundState(g); assert.equal(ui.input.enabled, false); assert.equal(ui.roundCues.cue, 'ready-3');
    g.roundStage = 'playing'; g.elapsed = .01; ui.updateRoundState(g); assert.equal(ui.input.enabled, true); assert.equal(ui.roundCues.cue, 'go');
    ui.open('pause'); g.ended = true; g.roundStage = 'finish'; ui.updateRoundState(g);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ui.dialogs.get('menu').open, false); assert.equal(ui.input.enabled, false); assert.equal(ui.roundCues.cue, 'finish');
    assert.equal(ui.open('pause'), false);
    g.roundStage = 'results'; ui.updateRoundState(g); assert.equal(ui.dialogs.get('menu').open, true); assert.equal(ui.roundCues.cue, '');
    ui.close('menu'); await new Promise(resolve => setImmediate(resolve)); ui.updateRoundState(g);
    assert.equal(ui.dialogs.get('menu').open, false, 'results open once and can be dismissed without resuming');
    assert.equal(ui.input.enabled, false); ui.open('pause'); assert.equal(ui.dialogs.get('menu').open, true);
    ui.setPage('home'); assert.equal(ui.roundCues.root.hidden, true); assert.equal(ui.finished, false);
  } finally { restore(); }
});
