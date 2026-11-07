const { installGuideReader } = require('./helpers/guide-browser.cjs');
/** Same-machine Chrome: color/icon routes follow host stages, including peers and pooled reuse. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/'); url.searchParams.set('wash-test', '1');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }), pages = [], errors = [];
  await installGuideReader(browser);

  try {
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 810 } });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); pages.push(page);
      if (i === 0) {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        await page.route('**/watergun-cleaning-*.png', async route => { await gate; await route.continue(); });
        const requested = page.waitForRequest(request => /watergun-cleaning-.*\.png/.test(request.url()));
        await page.goto(url.href, { waitUntil: 'domcontentloaded' }); await requested;
        assert.notEqual(await page.locator('#boot-percent').textContent(), '100%');
        assert.equal(await page.locator('body.scene-ready').count(), 0, 'the new tool texture participates in boot readiness');
        release();
      } else await page.goto(url.href);
      await page.waitForSelector('body.scene-ready', { timeout: 60000 });
    }
    const [host, guest] = pages;
    if (await guest.locator('#join-room-form').isHidden()) await guest.locator('#toggle-join-room').click();
    await guest.locator('#join-code').fill(await host.locator('#room-code-value').textContent()); await guest.locator('#join-room').click();
    await guest.waitForFunction(() => __wash.connection.guest?.open);
    await host.locator('#select-level').click(); await host.locator('[data-level-id="highway-02"]').click();
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.roundStage === 'playing' && document.querySelectorAll('.stain-badge:not([hidden])').length === 6)));
    await host.waitForFunction(() => __wash.game.elapsed > 8 && __wash.game.orders.every(order => order.arrivalProgress === 1));
    for (const page of pages) {
      assert.equal(await page.locator('.player-names').isHidden(), true);
      assert.equal(await page.locator('.station-badge:visible').count(), 0);
      assert.equal(await page.locator('.stain-badge.bars-only').count(), 0, 'cleaning cards retain their full icon/action route without Tab');
      assert.deepEqual(await page.locator('.stain-badge').evaluateAll(nodes => nodes.map(node => node.dataset.tool)), ['towel', 'water', 'soap', 'towel', 'water', 'soap']);
      assert.equal(await page.locator('.stain-step.current .stain-action:visible').count(), 6);
      assert.equal(await page.locator('.stain-step:not(.current) .stain-action:visible').count(), 0);
      assert.equal(await page.locator('.stain-step.current .cleaning-icon:visible').count(), 6);
      assert.equal(await page.evaluate(() => __wash.game.towels.length > 0 && __wash.game.towels.every(towel => towel.material.color.getHexString() === 'e8c468')), true);
      assert.equal(await page.evaluate(() => __wash.game.effects.entries.get('water').system.gunTexture.colorSpace), 'srgb');
    }
    await host.screenshot({ path: 'docs/QA/cleaning-hud-game.png' });
    const boxes = await host.locator('.stain-badge').evaluateAll(nodes => nodes.slice(0, 3).map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; }));
    const x = Math.max(0, Math.floor(Math.min(...boxes.map(b => b.x)) - 65)), y = Math.max(0, Math.floor(Math.min(...boxes.map(b => b.y)) - 40));
    await host.screenshot({ path: 'docs/QA/cleaning-hud-detail.png', clip: { x, y, width: Math.min(1440 - x, Math.ceil(Math.max(...boxes.map(b => b.right)) - x + 65)), height: Math.min(810 - y, Math.ceil(Math.max(...boxes.map(b => b.bottom)) - y + 50)) } });
    for (const [stage, kind] of [[1, 'water'], [2, 'towel']]) {
      await host.evaluate(stage => { const stain = __wash.connection.authority.sim.game.orders[0].stains[2]; stain.stage = stage; stain.progress = .47; }, stage);
      await Promise.all(pages.map(page => page.waitForFunction(({ stage, kind }) => {
        const node = __wash.ui.worldHud.stainBadges[2];
        return node.dataset.tool === kind && node.querySelectorAll('.stain-step.done').length === stage && node.querySelector('.wipe-bar i').style.width === '47%';
      }, { stage, kind })));
    }
    await host.screenshot({ path: 'docs/QA/cleaning-hud-progress.png' });
    await host.evaluate(() => { const stain = __wash.connection.authority.sim.game.orders[0].stains[2]; stain.done = true; stain.stage = stain.steps.length; });
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.ui.worldHud.stainBadges[2].hidden)));
    await host.locator('#pause-game').click(); await host.locator('.pause-home').click();
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.ui.page === 'home' && !__wash.ui.iris.active && !__wash.connection.room.homeWaiting.length)));
    assert.equal(await host.locator('.stain-badge').count(), 0);
    assert.equal(await host.locator('.station-badge[data-tool="soap"] .cleaning-icon:visible').count(), 1);
    await host.locator('#new-game').click();
    await host.waitForFunction(() => document.querySelectorAll('.stain-badge:not([hidden])').length === 3);
    assert.deepEqual(await host.locator('.stain-badge').evaluateAll(nodes => nodes.map(node => node.dataset.tool)), ['towel', 'water', 'soap']);
    assert.deepEqual(errors, []);
    console.log('PASS cleaning HUD: three colors + distinct icons/actions, host/guest stage and progress agreement, completion hide, home/re-entry reset and matching tool palette');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
