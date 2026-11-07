const { installGuideReader } = require('./helpers/guide-browser.cjs');
/** Real Chrome: delayed asset at boot, delayed authority at return, and failure stays covered. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const path = require('node:path');
const testUrl = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/mp/wash-cn/');
testUrl.searchParams.set('wash-test', '1');
const url = testUrl.href;
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const errors = [];
  await installGuideReader(browser);

  try {
    const hostContext = await browser.newContext({ viewport: { width: 1440, height: 810 } });
    const host = await hostContext.newPage(); host.on('pageerror', (e) => errors.push(e.message));
    let releaseAsset;
    const assetGate = new Promise((resolve) => { releaseAsset = resolve; });
    await host.route('**/*.glb', async (route) => { await assetGate; await route.continue(); });
    await host.goto(url);
    await host.waitForFunction(() => document.querySelector('#boot-label').textContent.includes('shader') || document.querySelector('#boot-percent').textContent !== '0%');
    assert.equal(await host.locator('#boot-loading').isVisible(), true);
    assert.equal(await host.locator('body').evaluate((node) => node.classList.contains('scene-ready')), false);
    assert.notEqual(await host.locator('#boot-percent').textContent(), '100%');
    await host.screenshot({ path: path.resolve('docs/QA/boot-loading.png') });
    releaseAsset(); await host.waitForSelector('body.scene-ready');
    assert.equal(await host.locator('#boot-percent').textContent(), '100%');
    const guest = await browser.newPage({ viewport: { width: 1440, height: 810 } }); guest.on('pageerror', (e) => errors.push(e.message));
    await guest.goto(url); await guest.waitForSelector('body.scene-ready');
    const code = await host.locator('#room-code-value').textContent();
    if (await guest.locator('#join-room-form').isHidden()) await guest.locator('#toggle-join-room').click(); await guest.locator('#join-code').fill(code); await guest.locator('#join-room').click();
    await guest.waitForFunction(() => document.querySelector('#room-code-label').textContent === '当前房间' && __wash.connection.guest?.open);
    await host.locator('#select-level').click(); await host.locator('[data-level-id="highway-02"]').click();
    await Promise.all([host, guest].map((page) => page.waitForFunction(() => __wash.game.roundStage === 'playing' && !__wash.ui.iris.active)));
    await host.waitForFunction(() => document.querySelectorAll('.stain-badge').length > 0);
    await host.locator('#pause-game').click();
    // The host's own browser authority produces the home world; hold its presentation snapshots to simulate a slow return.
    await host.evaluate(() => {
      const connection = __wash.connection, emit = connection.emit.bind(connection);
      connection.emit = (type, detail) => (type === 'snapshot' && detail.phase === 'home' ? setTimeout(() => emit(type, detail), 1800) : emit(type, detail));
    });
    await host.locator('.pause-home').click();
    await host.waitForFunction(() => document.querySelector('#wash-iris').dataset.phase === 'close');
    assert.equal(await host.locator('.world-hud').isVisible(), true, 'outgoing tools and world HUD survive mask closure');
    await host.waitForFunction(() => document.querySelector('#wash-iris').dataset.phase === 'wait');
    assert.equal(await host.locator('#wash-iris').isVisible(), true, 'SVG hidden attribute must actually be removed');
    assert.equal(await host.locator('#wash-iris').evaluate((node) => getComputedStyle(node).opacity), '1');
    assert.equal(await host.locator('.world-hud').isVisible(), true, 'authority delay keeps old scene behind black');
    await host.screenshot({ path: path.resolve('docs/QA/home-return-black.png') });
    await Promise.all([host, guest].map((page) => page.waitForFunction(() => !document.body.classList.contains('in-game') && document.querySelector('#wash-iris').hasAttribute('hidden'))));
    assert.equal(await host.locator('#home-menu').isVisible(), true);
    assert.equal(await host.locator('.world-hud').isVisible(), true, 'home retains level equipment for practice');
    assert.equal(await host.locator('.stain-badge').count(), 0, 'home has equipment but no orders');
    assert.deepEqual(errors, []);
    // A stalled optional font stylesheet must never block the application
    // module before FontPreparation can enforce its three-second fallback.
    const fontPage = await browser.newPage();
    let releaseFonts;
    const fontGate = new Promise(resolve => { releaseFonts = resolve; });
    await fontPage.route('https://fonts.googleapis.com/**', async route => { await fontGate; await route.abort().catch(() => {}); });
    try {
      await fontPage.goto(url, { waitUntil: 'domcontentloaded' });
      await fontPage.waitForSelector('body.scene-ready', { timeout: 60000 });
      assert.equal(await fontPage.locator('#game-fonts').count(), 0, 'timed-out fonts detach without a late page-wide font swap');
      assert.equal(await fontPage.locator('#boot-percent').textContent(), '100%');
    } finally { releaseFonts(); await fontPage.close(); }
    // Failure must never show 100% or reveal a partially loaded game.
    const failed = await browser.newPage(); await failed.route('**/*.glb', (route) => route.abort());
    await failed.goto(url); await failed.waitForFunction(() => document.querySelector('#boot-label').textContent.includes('未完成'));
    assert.equal(await failed.locator('#boot-loading').isVisible(), true);
    assert.notEqual(await failed.locator('#boot-percent').textContent(), '100%');
    console.log('PASS boot resource gate, 100% reveal, optional font stylesheet fallback, delayed authoritative return for host/guest, failure remains covered');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
