/** Isolated DOM contract fixtures. This does not claim five-level gameplay or multiplayer acceptance. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
(async () => {
  const { createServer } = await import('vite');
  const root = path.resolve(__dirname, '..');
  const server = await createServer({ configFile: false, root: path.join(root, 'client'), logLevel: 'error', server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } } });
  await server.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }), errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/__level-ui-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="zh-CN"><link rel="stylesheet" href="/css/style.css"><body><div id="ui-stage"><div id="app-frame"></div><section id="time-panel"><strong id="time-value"></strong><div class="round-time-bar"><i id="time-fill"></i></div></section><input id="probe" aria-label="输入测试"><div id="results"></div><div id="world"></div></div></body></html>' }));
    await page.goto(new URL('__level-ui-fixture', server.resolvedUrls.local[0]).href);
    const report = await page.evaluate(async () => {
      const check = (value, message) => { if (!value) throw new Error(message); };
      const { LevelClock } = await import('/js/ui/LevelClock.js');
      const { TutorialToast } = await import('/js/ui/TutorialToast.js');
      const { mountLevelResults, resultTitle } = await import('/js/ui/LevelResults.js');
      const { LevelGuidePanel } = await import('/js/ui/LevelGuidePanel.js');
      const { VehicleOrderHud } = await import('/js/ui/VehicleOrderHud.js');
      const { ChargingHud } = await import('/js/ui/ChargingHud.js');
      let pops = 0;
      const hud = { root: document.getElementById('world'), ui: Object.fromEntries(['time-panel','time-value','time-fill'].map(id => [id, document.getElementById(id)])),
        text: (node, value) => { node.textContent = String(value); }, hidden: (node, value) => { node.hidden = value; }, width: (node, value) => { node.style.width = `${value}%`; }, pop: () => pops++,
        worldPoint: { set() { return this; } }, position: (node, _point, identity) => { node.hidden = false; node.dataset.identity = identity; },
        at: () => ({}), positionTag: node => { node.hidden = false; } };
      const clock = new LevelClock(hud);
      clock.update({ mode: 'countdown', remaining: 9, duration: 120 });
      check(hud.ui['time-value'].textContent === '00:09', 'countdown text');
      clock.update({ mode: 'unlimited', remaining: 0, duration: 0 });
      check(hud.ui['time-value'].textContent === '--：--', 'explicit unlimited clock');
      check(!hud.ui['time-panel'].classList.contains('urgent') && !hud.ui['time-panel'].classList.contains('final-seconds'), 'unlimited clears danger');
      check(getComputedStyle(document.querySelector('.round-time-bar')).display === 'none', 'unlimited hides progress');
      clock.update({ mode: 'countdown', remaining: 10, duration: 120 }); check(pops === 0, 'no transition from unlimited warning');
      clock.update({ mode: 'countdown', remaining: 9, duration: 120 }); check(pops === 1, 'new second cue only');
      check(!hud.ui['time-fill'].style.width.includes('NaN'), 'finite progress');
      const toast = new TutorialToast({ motionAllowed: false });
      const state = { stepId: 'release', revision: 1, text: '按K丢掉手中的物品，你也可以长按来扔出去！', dots: { kind: 'players', entries: [
        { id: 'p0', slot: 0, active: true, complete: true }, { id: 'p1', slot: 1, active: true, complete: false }, { id: 'p2', slot: 2, active: false, complete: true },
      ] } };
      toast.update(state, true, 'round-a');
      check(toast.dots[0].classList.contains('complete') && !toast.dots[1].classList.contains('complete'), 'applied player completion');
      check(toast.dots[2].classList.contains('inactive') && !toast.dots[2].classList.contains('complete'), 'empty slots cannot look complete');
      state.dots.entries[0].complete = false; toast.update(state, true, 'round-a'); check(!toast.dots[0].classList.contains('complete'), 're-pick extinguishes lamp');
      const input = document.getElementById('probe'); input.focus(); toast.update(state, true, 'round-a');
      check(document.activeElement === input && getComputedStyle(toast.root).pointerEvents === 'none', 'toast never captures focus/input');
      toast.update({ stepId: 'clean', revision: 2, text: '<img src=x onerror=alert(1)>', dots: { kind: 'stains', entries: [{ id: 'dirt-a', slot: null, active: true, complete: false }] } }, true, 'round-b');
      check(!toast.root.querySelector('img') && toast.copy.textContent.startsWith('<img'), 'hint text is not HTML');
      check(toast.dotsRoot.getAttribute('aria-label') === '污渍清洁状态', 'stain lamps not player mask');
      const content = document.getElementById('results'), commands = [];
      const result = { levelId: 'highway-03', reason: 'time_up', outcome: 'success', ratingMode: 'score', score: 999, stars: 1, completedOrders: 2, missed: 3, thresholds: [25,55,130], nextLevelId: 'highway-04' };
      const actions = { canControl: true, onNext: id => commands.push(['next', id]), onRetry: id => commands.push(['retry', id]), onHome: () => commands.push(['home']) };
      mountLevelResults(content, result, actions);
      check(content.querySelectorAll('.result-stars .earned').length === 1, 'host stars must not be recomputed from score');
      content.querySelector('.result-next').click(); check(commands[0][1] === 'highway-04', 'next level command uses authority id');
      content.replaceChildren(); mountLevelResults(content, { ...result, outcome: 'failure', stars: 0 }, actions);
      check(!content.querySelector('.result-next') && content.querySelector('.result-retry').textContent === '重试', 'failure actions');
      content.replaceChildren(); mountLevelResults(content, { ...result, nextLevelId: null }, { ...actions, canControl: false });
      check(!content.querySelector('.result-next') && content.querySelector('.result-retry').disabled && !content.querySelector('.result-home').disabled, 'last level/guest permissions');
      content.replaceChildren(); const tutorial = { ...result, reason: 'tutorial_complete', ratingMode: 'tutorial', stars: null };
      mountLevelResults(content, tutorial, actions); check(!content.querySelector('.result-stars') && !content.querySelector('.result-score') && resultTitle(tutorial) === '教程结束！', 'tutorial has no artificial star rating');
      let guide, foreground = true; const confirms = [];
      const ui = { motionAllowed: false, page: 'game', connection: {}, iris: { active: false },
        listen: (target, type, fn, options) => target.addEventListener(type, fn, options),
        isPanelForeground: () => foreground && !!guide?.dialog.open,
        get hasModal() { return !!guide?.dialog.open; }, close: () => guide.dialog.close(), open: () => guide.dialog.showModal(),
        confirmGuide: (id, keyboard, index) => { confirms.push([id, index, keyboard]); return true; } };
      guide = new LevelGuidePanel(ui); await guide.ready;
      const game = { roundStage: 'guide', guide: { id: 'tools-water', pageIndex: 0, pageCount: 1, participants: 3, ready: 0, closeTime: 0 } };
      const room = { code: 'sample', epoch: 1, roundId: 'round-a', slot: 0, members: [{ slot: 0, name: '<script>bad</script>' }] };
      guide.update(game, room); guide.confirm(); check(confirms.length === 1 && confirms[0][1] === 0, 'page-bound confirmation');
      check(guide.image.complete && guide.image.naturalWidth > 0 && !guide.image.hidden && guide.body.hidden, 'accepted image decoded at startup');
      check(guide.image.alt.includes('长按 J 擦拭') && guide.image.alt.includes('水管'), 'complete image alternative text');
      check(game.guide.pageIndex === 0 && guide.dialog.open && guide.button.disabled, 'confirm never advances locally');
      room.roundId = 'round-b'; game.guide.id = 'tools-soap'; guide.update(game, room);
      check(!guide.button.disabled && guide.pages.hidden, 'new authority guide clears pending; one page has no pagination');
      game.guide.pageIndex = 1;
      let rejected = false; try { guide.update(game, room); } catch { rejected = true; }
      check(rejected, 'retired second page cannot become a blank screen'); game.guide.pageIndex = 0;
      check(!guide.dialog.querySelector('script') && guide.dots[0].title.includes('<script>'), 'safe participant names');
      foreground = false; guide.confirm(); check(confirms.length === 1, 'upper modal blocks confirmation'); foreground = true;
      game.guide.closeTime = .1; guide.update(game, room); check(!guide.dialog.open, 'authority final release');
      const orders = new VehicleOrderHud(hud), charging = new ChargingHud(hud);
      const truck = { pos: {x:0,z:0}, spec:{x1:3}, topY:2 };
      const order = { id:'a', serial:1, generation:1, mode:'working', truck, initialPatience:100, remaining:40, chargeProgress:.5, charged:false, rewardMultiplier:1,
        stains:[{ steps:['water','towel'], stage:1, progress:.5, done:false }] };
      const world = { orders:[order], orderPatience:()=>10, charging:{source:{},ports:new Map([[truck,{}]])},chargers:[{connectedSerial:1}] };
      orders.update(world); charging.update(world);
      check(orders.entries[0].ring.style.strokeDashoffset === '0.6', 'patience uses fixed authority initial budget');
      check(charging.progress[0].style.width === '' && charging.progress[0].firstElementChild.style.width === '50%', 'charging progress read-only');
      order.rewardMultiplier = 1.5; order.chargeProgress = 1; order.charged = true; orders.update(world); charging.update(world);
      check(getComputedStyle(orders.entries[0].fill).backgroundColor === 'rgb(154, 122, 189)' && getComputedStyle(charging.progress[0].firstElementChild).backgroundColor === 'rgb(154, 122, 189)', 'purple boosted and charged bars');
      order.remaining = null; order.rewardMultiplier = 1; order.charged = false; order.generation = 2; orders.update(world); charging.update(world);
      check(orders.entries[0].timer.hidden && !orders.entries[0].badge.classList.contains('reward-boosted') && !charging.ports[0].classList.contains('charged'), 'reuse clears patience and bonus appearance');
      toast.update(state, true, 'sample'); guide.dispose();
      return { pass: true, kind: 'isolated DOM fixtures', tested: ['unlimited clock','non-modal tutorial','authority stars/actions','page-bound guide confirmation','fixed patience','purple bars','reuse cleanup'] };
    });
    assert.deepEqual(errors, []);
    const output = path.join(root, 'docs/QA/level-ui'); fs.mkdirSync(output, { recursive:true });
    await page.screenshot({path:path.join(output,'component-fixtures.png')});
    fs.writeFileSync(path.join(output,'component-fixtures.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally { await browser.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
