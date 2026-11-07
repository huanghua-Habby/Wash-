const { installGuideReader } = require('./helpers/guide-browser.cjs');
/** Same-machine Chrome/WebRTC: local Tab reveals shared-clock labels without hiding essential HUD. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/'); url.searchParams.set('wash-test', '1');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }), pages = [], errors = [];
  const output = process.env.WASH_QA_DIR || 'docs/QA'; await fs.mkdir(output, { recursive: true });
  await installGuideReader(browser);

  try {
    for (let i = 0; i < 2; i++) {
      const page = await (await browser.newContext({ viewport: { width: 1440, height: 810 } })).newPage(); pages.push(page);
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(url.href); await page.waitForSelector('body.scene-ready', { timeout: 60000 });
      assert.equal(await page.locator('.station-badge[data-tool="soap"]').isVisible(), true);
      assert.equal(await page.locator('.player-names').isVisible(), true);
    }
    const [host, guest] = pages;
    if (await guest.locator('#join-room-form').isHidden()) await guest.locator('#toggle-join-room').click();
    await guest.locator('#join-code').fill(await host.locator('#room-code-value').textContent()); await guest.locator('#join-room').click();
    await guest.waitForFunction(() => __wash.connection.guest?.open);
    await host.locator('#select-level').click(); await host.locator('[data-level-id="highway-02"]').click();
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.roundStage === 'playing' && __wash.game.elapsed > 8)));
    for (const page of pages) {
      assert.equal(await page.locator('.player-names').isHidden(), true);
      assert.equal(await page.locator('.station-badge:visible').count(), 0);
      assert.equal(await page.locator('.stain-steps:visible').count(), 6, 'cleaning instructions remain essential information without Tab');
      assert.equal(await page.locator('.stain-step.current .stain-action:visible').count(), 6);
      assert.equal(await page.locator('.wipe-bar:visible').count(), 6);
      assert.equal(await page.locator('.car-badge:visible').count(), 2);
      assert.equal(await page.locator('.order-timer:visible').count(), 2);
    }
    await host.locator('#game').click(); await host.keyboard.press('Tab');
    await host.waitForSelector('.player-names:visible');
    assert.equal(await host.locator('.player-names').isVisible(), true);
    assert.equal(await host.locator('.station-badge[data-tool="soap"]').isVisible(), true);
    assert.equal(await guest.locator('.station-badge:visible').count(), 0, 'Tab stays local');
    await host.screenshot({ path: path.join(output, 'tags-revealed.png') });
    await host.waitForTimeout(1700); await host.keyboard.press('Tab');
    await host.waitForTimeout(1700);
    assert.equal(await host.locator('.player-names').isVisible(), true, 'repeat Tab refreshes the display');
    await host.waitForSelector('.player-names', { state: 'hidden' });
    assert.equal(await host.locator('.station-badge:visible').count(), 0);
    assert.equal(await host.locator('.stain-steps:visible').count(), 6, 'cleaning routes survive Tab expiry');
    // Exercise real authority snapshots while labels are hidden; no local-only gauge fixtures.
    await host.locator('#pause-game').click();
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.paused)));
    await host.evaluate(() => {
      const sim = __wash.connection.authority.sim, [order] = sim.game.orders, player = sim.players[0];
      sim.game.towels[0].pickup(player);
      player.throwWasDown = true; player.heldTool.charge = .65;
      order.stains[0].progress = .47;
      order.chargeProgress = .25;
      sim.players[1].state = 'fallen'; sim.players[1].fallTimer = 2;
    });
    for (const page of pages) {
      await page.waitForFunction(() => __wash.ui.worldHud.stainBadges[0].cue.fill.style.width === '47%');
      await page.waitForSelector('.player-badge .durability-bar:visible');
      assert.equal(await page.locator('.held-tool:visible').count(), 1, 'held tools keep the full validated status card while names hide');
      assert.match(await page.locator('.held-tool:visible').textContent(), /毛巾/);
      assert.equal(await page.locator('.player-badge.bars-only').count(), 0);
      assert.equal(await page.locator('.throw-charge-bar:visible').count(), 1);
      assert.equal(await page.locator('.charging-badge:visible').count(), 1, 'started charging status stays visible');
      assert.match(await page.locator('.charging-badge:visible').textContent(), /25%/);
      assert.equal(await page.locator('.respawn-counter:visible').count(), 1);
      assert.ok(await page.locator('.car-badge:visible').count() > 0, 'orders in the camera remain visible after death moves the guest camera');
    }
    const modalStyle = await host.addStyleTag({ content: 'dialog[open]{opacity:0!important}dialog::backdrop{background:transparent!important;backdrop-filter:none!important}' });
    await host.screenshot({ path: path.join(output, 'tags-hidden.png') });
    await modalStyle.evaluate(node => node.remove());
    await host.keyboard.press('Tab');
    assert.equal(await host.locator('.player-names').isHidden(), true, 'modal focus navigation cannot reveal labels');
    await host.locator('.pause-continue').click();
    await host.locator('#game').click(); await host.keyboard.press('Tab');
    await host.waitForSelector('.player-names:visible');
    await host.locator('#pause-game').click();
    await host.waitForSelector('.player-names', { state: 'hidden' });
    assert.equal(await host.locator('.station-badge[data-tool="soap"]:visible').count(), 0, 'manual display expires while paused');
    assert.equal(await host.locator('.stain-steps:visible').count(), 6, 'pause expiry preserves cleaning instructions');
    await host.locator('.pause-home').click();
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.ui.page === 'home' && !__wash.ui.iris.active && !__wash.connection.room.homeWaiting.length)));
    for (const page of pages) assert.equal(await page.locator('.station-badge[data-tool="soap"]').isVisible(), true);
    await host.evaluate(() => __wash.ui.setMotionEnabled(false));
    await host.locator('#new-game').click();
    await host.waitForFunction(() => __wash.ui.page === 'game' && !__wash.ui.iris.active && __wash.game.roundStage === 'playing' && __wash.game.elapsed > 8 && __wash.ui.worldHud.stainBadges.some(badge => !badge.hidden));
    assert.equal(await host.evaluate(() => __wash.ui.blocksPlayer), false);
    await host.locator('#game').click(); await host.keyboard.press('Tab');
    await host.waitForSelector('.player-names:visible');
    await host.waitForSelector('.stain-steps:visible');
    assert.equal(await host.locator('.player-names').evaluate(node => getComputedStyle(node).opacity), '1');
    await host.waitForSelector('.player-names', { state: 'hidden' });
    assert.ok(await host.locator('.stain-step.current .stain-action:visible').count() > 0, 'quiet UI also keeps cleaning instructions after names hide');
    for (const page of pages) await page.evaluate(() => __wash.ui.dispose());
    assert.equal(await host.locator('.world-hud').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS shared name/tag clock, local repeated Tab, essential order/stain/tool/charging/respawn HUD, pause expiry, modal gating, home reset, quiet UI and managed disposal');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
