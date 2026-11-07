const { installGuideReader } = require('./helpers/guide-browser.cjs');
/** Actual Chrome verifies public lifecycle state, preparation reuse and permanent teardown. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/'); url.searchParams.set('wash-test', '1');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }); const errors = [];
  await installGuideReader(browser);

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 810 } }); page.on('pageerror', e => errors.push(e.message));
    await page.goto(url.href); await page.waitForSelector('body.scene-ready', { timeout: 60000 });
    assert.deepEqual(await page.evaluate(() => [__wash.app.state, __wash.resources.state, __wash.scenes.state]), ['running', 'ready', 'running']);
    await page.evaluate(() => {
      window.__prepared = __wash.resources.ready; window.__audio = __wash.audio; window.__effects = __wash.game.effects;
      window.__assets = __wash.resources.status.assets.map(entry => entry.name);
      window.__warmRuns = 0;
      window.__borrowedDisposals = 0;
      const geometries = new Set();
      for (const tool of __wash.game.towels) tool.mesh.traverse(o => { if (o.geometry) geometries.add(o.geometry); });
      for (const geometry of geometries) geometry.addEventListener('dispose', () => __borrowedDisposals++);
      const run = __wash.resources.readiness.run.bind(__wash.resources.readiness);
      __wash.resources.readiness.run = (...args) => { __warmRuns++; return run(...args); };
    });
    await page.locator('#select-level').click(); await page.locator('[data-level-id="highway-02"]').click();
    await page.waitForFunction(() => __wash.network.phase === 'game' && !__wash.ui.iris.active);
    assert.equal(await page.evaluate(() => __borrowedDisposals), 0, 'authority rebuild cannot invalidate client tool templates');
    await page.locator('#pause-game').click(); await page.locator('.pause-home').click();
    await page.waitForFunction(() => __wash.ui.page === 'home' && !__wash.ui.iris.active && __wash.scenes.state === 'running');
    assert.equal(await page.evaluate(() => __prepared === __wash.resources.ready && __audio === __wash.audio && __effects === __wash.game.effects && __warmRuns === 0), true);
    assert.deepEqual(await page.evaluate(() => __wash.resources.status.assets.map(entry => entry.name)), await page.evaluate(() => __assets));
    const released = await page.evaluate(async () => {
      const clock = __wash.network.backgroundClock;
      await __wash.app.dispose(); await __wash.app.dispose();
      const rig = __wash.game.rig, before = rig.mouse.toArray();
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 50 }));
      const pointerStopped = before.every((value, i) => value === rig.mouse.toArray()[i]);
      return { app: __wash.app.state, resources: __wash.resources.state, scene: __wash.scenes.state,
        ui: __wash.ui.disposed, audio: __wash.audio.disposed, effects: __wash.game.effects.disposed,
        clock: clock.disposed, connection: __wash.connection.disposed, frameStopped: __wash.app.disposed,
        banks: __wash.audio.buffers.every(bank => bank.length === 0), providerCount: __wash.resources.providers.size,
        materialCount: __wash.game.stainPools.size, pointerStopped };
    });
    assert.deepEqual(released, { app: 'disposed', resources: 'disposed', scene: 'disposed', ui: true, audio: true, effects: true,
      clock: true, connection: true, frameStopped: true, banks: true, providerCount: 0, materialCount: 0, pointerStopped: true });
    await page.waitForTimeout(200); assert.deepEqual(errors, []);
    console.log('PASS app/resource/scene startup, level and home reuse without warmup, and complete idempotent teardown in real Chrome');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
