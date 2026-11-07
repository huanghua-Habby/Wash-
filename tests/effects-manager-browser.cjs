const { installGuideReader } = require('./helpers/guide-browser.cjs');
/** Real host/guest views: managed spray, shared clean timestamp, pause and pool reuse after return. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/');
url.searchParams.set('wash-test', '1');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const errors = [];
  await installGuideReader(browser);

  try {
    const pages = [];
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 810 } });
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); pages.push(page);
    }
    const [host, guest] = pages;
    await Promise.all(pages.map(async page => {
      await page.goto(url.href); await page.waitForSelector('body.scene-ready', { timeout: 60000 });
      assert.equal(await page.evaluate(() => __wash.game.effects.entries.size), 12);
      await page.evaluate(() => { window.__originalEffects = __wash.game.effects; });
    }));
    const code = await host.locator('#room-code-value').textContent();
    if (await guest.locator('#join-room-form').isHidden()) await guest.locator('#toggle-join-room').click(); await guest.locator('#join-code').fill(code); await guest.locator('#join-room').click();
    await guest.waitForFunction(() => __wash.connection.guest?.open);
    await host.locator('#new-game').click();
    await Promise.all(pages.map(page => page.waitForSelector('body.in-game')));
    await host.waitForFunction(() => __wash.connection.authority.sim.phase === 'game');
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.roundStage === 'playing')));
    // Put the authority's gun in the player's hand; use still travels through ordinary input.
    await host.evaluate(() => {
      const sim = __wash.connection.authority.sim, p = sim.players[0];
      if (p.heldTool) p.heldTool.release(p);
      sim.game.waterguns[0].pickup(p);
    });
    await host.keyboard.down('KeyJ');
    await Promise.all(pages.map(page => page.waitForFunction(() => {
      const water = __wash.game.effects.entries.get('water').system;
      return __wash.game.waterguns[0].spraying && water.views[0].spray.serial > 10;
    })));
    await host.screenshot({ path: 'docs/QA/effects-managed-spray-host.png' });
    await guest.screenshot({ path: 'docs/QA/effects-managed-spray-guest.png' });
    await host.keyboard.up('KeyJ');
    await host.waitForFunction(() => !!__wash.connection.authority.sim.game.order);
    const cleanTime = await host.evaluate(() => {
      const game = __wash.connection.authority.sim.game;
      Object.assign(game.order.stains[0], { done: true, cleanedAt: game.elapsed });
      return game.elapsed;
    });
    await Promise.all(pages.map(page => page.waitForFunction(time => {
      const state = __wash.game.effects.entries.get('cleaning').system.states.value[0];
      // Transport quantizes numeric snapshot fields to four decimal places.
      return Math.abs(state.y - time) < 0.0001 && state.y === __wash.network.latest.game.order?.stains[0].cleanedAt;
    }, cleanTime)));
    await host.locator('#pause-game').click();
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.paused)));
    const clocks = await Promise.all(pages.map(page => page.evaluate(() => ({
      water: __wash.game.effects.entries.get('water').system.views[0].spray.time.value,
      wind: __wash.game.effects.entries.get('wind').system.pool.time.value,
    }))));
    await host.waitForTimeout(300);
    for (let i = 0; i < pages.length; i++) {
      const clock = await pages[i].evaluate(() => ({
        water: __wash.game.effects.entries.get('water').system.views[0].spray.time.value,
        wind: __wash.game.effects.entries.get('wind').system.pool.time.value,
      }));
      assert.equal(clock.water, clocks[i].water, 'shared pause freezes water particles on each peer');
      assert.ok(clock.wind > clocks[i].wind, 'world decoration retains its pause policy');
    }
    await host.locator('.pause-home').click();
    await Promise.all(pages.map(page => page.waitForFunction(() =>
      !document.body.classList.contains('in-game') && document.querySelector('#wash-iris').hasAttribute('hidden'))));
    for (const page of pages) {
      assert.equal(await page.evaluate(() => window.__originalEffects === __wash.game.effects), true);
      assert.equal(await page.evaluate(() => __wash.game.effects.entries.get('cleaning').system.root.visible), false);
    }
    assert.deepEqual(errors, []);
    console.log('PASS managed host/guest spray, shared clean timestamp, paused water/continuing world effects, masked return and reuse of warmed pools');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
