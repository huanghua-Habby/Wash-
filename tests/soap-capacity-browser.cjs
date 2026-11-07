const { installGuideReader } = require('./helpers/guide-browser.cjs');
/** Same-machine Chrome/WebRTC: bounded host-owned soaps, retired-slot reuse and scene reset. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/'); url.searchParams.set('wash-test', '1');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }), pages = [], errors = [];
  await installGuideReader(browser);

  try {
    for (let i = 0; i < 2; i++) {
      const page = await (await browser.newContext({ viewport: { width: 1440, height: 810 } })).newPage(); pages.push(page);
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(url.href); await page.waitForSelector('body.scene-ready', { timeout: 60000 });
      await page.evaluate(() => {
        window.__borrowedDisposals = 0;
        const geometries = new Set();
        for (const tool of __wash.game.towels) tool.mesh.traverse(o => { if (o.geometry) geometries.add(o.geometry); });
        for (const geometry of geometries) geometry.addEventListener('dispose', () => __borrowedDisposals++);
      });
    }
    const [host, guest] = pages;
    if (await guest.locator('#join-room-form').isHidden()) await guest.locator('#toggle-join-room').click();
    await guest.locator('#join-code').fill(await host.locator('#room-code-value').textContent()); await guest.locator('#join-room').click();
    await guest.waitForFunction(() => __wash.connection.guest?.open);
    await host.locator('#select-level').click(); await host.locator('[data-level-id="highway-02"]').click();
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.roundStage === 'playing' && !__wash.ui.iris.active)));
    const programs = await Promise.all(pages.map(page => page.evaluate(() => __wash.renderer.info.programs.length)));
    await host.evaluate(() => {
      const sim = __wash.connection.authority.sim, game = sim.game, home = sim.trucks[0];
      // Fixture starts with nine loose bars away from the box. Both players use actual J input for the final slot.
      for (let i = 0; i < 9; i++) game.takeSoap(sim.players[0]).placeOn(home, sim.players[0].pos.clone().set(-2, 0, .65));
      for (const p of sim.players.slice(0, 2)) {
        p.state = 'ground'; p.ground = { truck: home, plat: home.platforms[0] };
        p.pos.set(home.pos.x + 1.25, home.topY, home.pos.z + .65); p.root.position.copy(p.pos); p.vel.set(0, 0, 0); p.externalVelocity.set(0, 0, 0);
      }
      sim.scene.updateMatrixWorld(true);
    });
    await Promise.all(pages.map(async page => { await page.locator('#game').click(); await page.keyboard.press('KeyJ'); }));
    await host.waitForFunction(() => __wash.connection.authority.sim.game.soaps.length === 10 && __wash.connection.authority.sim.players.filter(p => p.heldTool?.kind === 'soap').length === 1);
    const winner = await host.evaluate(() => __wash.connection.authority.sim.players.findIndex(p => p.heldTool?.kind === 'soap'));
    assert.ok(winner === 0 || winner === 1); const loser = 1 - winner;
    for (const page of pages) {
      await page.waitForFunction(slot => __wash.game.soaps.length === 10 && __wash.players[slot].heldTool?.id === 'soap-9', winner);
      assert.equal(await page.evaluate(() => __wash.game.soaps.filter(s => s.active).length), 10);
      assert.equal(await page.evaluate(slot => __wash.players[slot].heldTool?.id || null, loser), null);
    }
    for (let i = 0; i < 5; i++) await pages[loser].keyboard.press('KeyJ');
    await pages[loser].waitForTimeout(300);
    assert.equal(await host.evaluate(() => __wash.connection.authority.sim.game.soaps.length), 10);
    assert.equal(await pages[loser].evaluate(slot => __wash.players[slot].interactionHint, loser), '拾取现有肥皂');
    await host.evaluate(() => __wash.connection.authority.sim.game.soaps[3].retire());
    await Promise.all(pages.map(page => page.waitForFunction(() => !__wash.game.soaps[3].active)));
    await pages[loser].keyboard.press('KeyJ');
    for (const page of pages) {
      await page.waitForFunction(slot => __wash.players[slot].heldTool?.id === 'soap-3' && __wash.game.soaps[3].generation === 2, loser);
      assert.equal(await page.evaluate(() => __wash.game.soaps.length), 10);
    }
    // Full client pools survive return/rebuild. A fresh authority owns one inactive soap initially.
    await host.locator('#pause-game').click(); await host.locator('.pause-home').click();
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.ui.page === 'home' && !__wash.ui.iris.active && !__wash.connection.room.homeWaiting.length)));
    await host.locator('#select-level').click(); await host.locator('[data-level-id="highway-01"]').click();
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.roundStage === 'playing' && !__wash.ui.iris.active)));
    assert.equal(await host.evaluate(() => __wash.connection.authority.sim.game.soaps.length), 1);
    for (const page of pages) {
      assert.equal(await page.evaluate(() => __wash.game.soaps.filter(s => s.active).length), 0);
      assert.equal(await page.evaluate(() => __borrowedDisposals), 0, 'leaving/rebuilding authority keeps client geometry live');
    }
    await host.evaluate(() => __wash.connection.authority.sim.game.chargers[0].pickup(__wash.connection.authority.sim.players[0]));
    for (const page of pages) await page.waitForFunction(() => __wash.players[0].heldTool === __wash.game.chargers[0]);
    assert.deepEqual(await Promise.all(pages.map(page => page.evaluate(() => __wash.renderer.info.programs.length))), programs, 'recycled soaps and scene changes use prepared programs');
    assert.deepEqual(errors, []);
    console.log('PASS same-machine host/guest J contention at 10 soaps, saturation, generation reuse, smaller authority reset, stable charger IDs and zero borrowed-resource disposal/new shader programs');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
