/** Same-machine real Chrome regression: round bookends, authority timing and guest UI. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/'); url.searchParams.set('wash-test', '1');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }); const errors = [];
  try {
    const pages = [];
    for (let i = 0; i < 2; i++) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 } });
      const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message)); pages.push(page);
      await page.goto(url.href); await page.waitForSelector('body.scene-ready', { timeout: 60000 });
    }
    const [host, guest] = pages;
    const settleCue = p => p.locator('#round-cue').evaluate(async node => { await Promise.allSettled(node.getAnimations({subtree:true}).map(a => a.finished)); });
    await guest.locator('#toggle-join-room').click();
    await guest.locator('#join-code').fill(await host.locator('#room-code-value').textContent());
    await guest.locator('#join-room').click(); await guest.waitForFunction(() => __wash.connection.guest?.open);
    await host.locator('#new-game').click();
    await Promise.all(pages.map(async p => { await p.waitForSelector('#level-guide[open]'); await p.locator('.level-guide-confirm').click(); }));
    await Promise.all(pages.map(p => p.waitForFunction(() => __wash.game.roundStage === 'ready')));
    await settleCue(guest); await guest.screenshot({path:'docs/QA/round-ready.png'});
    await host.locator('#pause-game').click(); await guest.waitForFunction(() => __wash.game.paused);
    const ready = await Promise.all(pages.map(p => p.evaluate(() => ({remaining: __wash.game.remaining, elapsed: __wash.game.elapsed, input: __wash.ui.input.enabled}))));
    assert.deepEqual(ready, ready.map(() => ({ remaining:180, elapsed:0, input:false })));
    const stageTime = await host.evaluate(() => __wash.game.roundStageTime);
    await host.waitForTimeout(400); assert.equal(await host.evaluate(() => __wash.game.roundStageTime), stageTime);
    await host.locator('.pause-continue').click();
    await Promise.all(pages.map(p => p.waitForFunction(() => __wash.game.roundStage === 'playing' && __wash.ui.roundCues.cue === 'go')));
    await settleCue(host); await host.screenshot({path:'docs/QA/round-go.png'});
    assert.ok(await host.evaluate(() => __wash.game.remaining < 180 && __wash.game.elapsed > 0 && __wash.ui.input.enabled));
    await host.evaluate(() => { __wash.connection.authority.sim.game.remaining = 10.1; });
    await guest.waitForFunction(() => document.getElementById('time-panel').classList.contains('final-seconds'));
    assert.match(await guest.locator('#time-value').textContent(), /^00:(?:10|0\d)$/);
    await host.locator('#pause-game').click(); await guest.waitForFunction(() => __wash.game.paused);
    const pausedTime = await guest.locator('#time-value').textContent(); await guest.waitForTimeout(300);
    assert.equal(await guest.locator('#time-value').textContent(), pausedTime);
    await host.locator('.pause-continue').click();
    await host.evaluate(() => { __wash.connection.authority.sim.game.remaining = .001; });
    await Promise.all(pages.map(p => p.waitForFunction(() => __wash.game.roundStage === 'finish')));
    for (const p of pages) {
      assert.equal(await p.locator('#menu-dialog').isVisible(), false);
      assert.equal(await p.locator('#round-cue').isVisible(), true);
      assert.equal(await p.locator('#time-value').textContent(), '00:00');
      assert.equal(await p.evaluate(() => __wash.ui.input.enabled), false);
      assert.equal(await p.locator('#pause-game').isEnabled(), false);
      await p.keyboard.press('Escape'); assert.equal(await p.locator('#menu-dialog').isVisible(), false);
    }
    await settleCue(host); await host.screenshot({path:'docs/QA/round-finish.png'});
    await Promise.all(pages.map(p => p.waitForFunction(() => __wash.game.roundStage === 'results' && document.getElementById('menu-dialog').open)));
    for (const p of pages) {
      assert.equal(await p.locator('#round-cue').isVisible(), false);
      assert.equal(await p.locator('.round-summary strong').textContent(), '0');
      assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('wash-progress')).levels['highway-01'].finishedRuns), 1);
    }
    await host.locator('.pause-home').click();
    await Promise.all(pages.map(p => p.waitForFunction(() => __wash.ui.page === 'home' && !__wash.ui.iris.active)));
    // Reduced motion changes animation only: repeat the full preparation and outro clocks.
    await host.evaluate(() => __wash.ui.setMotionEnabled(false));
    await host.locator('#new-game').click();
    await Promise.all(pages.map(async p => { await p.waitForSelector('#level-guide[open]'); await p.locator('.level-guide-confirm').click(); }));
    await host.waitForFunction(() => __wash.game.roundStage === 'ready');
    assert.equal(await host.locator('#round-cue').isVisible(), true);
    assert.equal(await host.evaluate(() => document.getElementById('round-cue').getAnimations({subtree:true}).length), 0);
    assert.equal(await host.evaluate(() => __wash.game.remaining), 180);
    await host.waitForFunction(() => __wash.game.roundStage === 'playing');
    await host.evaluate(() => { __wash.connection.authority.sim.game.remaining = .001; });
    await host.waitForFunction(() => __wash.game.roundStage === 'finish');
    assert.equal(await host.locator('#menu-dialog').isVisible(), false);
    await host.waitForSelector('#menu-dialog[open]');
    assert.deepEqual(errors, []);
    console.log('PASS: host/guest Ready pause, Go timing, final-ten countdown, Finish before results, input lock, one save, return/restart and reduced motion');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
