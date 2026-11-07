const { installGuideReader } = require('./helpers/guide-browser.cjs');
/** Real Chrome host/guest audio lifecycle and paired orders; same-machine contexts. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/'); url.searchParams.set('wash-test', '1');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const errors = [], failures = [], pages = [];
  await installGuideReader(browser);

  try {
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 810 } });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' || /音效不可用/.test(m.text())) failures.push(m.text()); });
      pages.push(page);
    }
    const [host, guest] = pages;
    for (const page of pages) {
      await page.goto(url.href); await page.waitForSelector('body.scene-ready', { timeout: 60000 });
      await page.evaluate(() => {
        const audio = __wash.audio;
        window.__audioService = audio; window.__soundLog = [];
        const post = audio.post.bind(audio);
        audio.post = (bank, ...args) => { window.__soundLog.push(bank); return post(bank, ...args); };
        window.__gainNodes = audio.voices.map(v => v.gain);
        window.__stains = [...__wash.game.stainPools.values()].flat();
      });
      assert.equal(await page.evaluate(() => __wash.audio.listeners.length), 1);
    }
    const join = async () => {
      if (await guest.locator('#join-room-form').isHidden()) await guest.locator('#toggle-join-room').click();
      await guest.locator('#join-code').fill(await host.locator('#room-code-value').textContent()); await guest.locator('#join-room').click();
      await guest.waitForFunction(() => __wash.connection.guest?.open);
    };
    await join();
    await host.locator('#select-level').click(); await host.locator('[data-level-id="highway-02"]').click();
    await Promise.all(pages.map(p => p.waitForFunction(() => __wash.network.phase === 'game' && __wash.game.roundStage === 'playing' && !__wash.ui.iris.active, null, { timeout: 30000 })));
    for (const page of pages) {
      assert.equal(await page.evaluate(() => __wash.audio.running), true, 'first interaction unlocks real Web Audio');
      assert.equal(await page.evaluate(() => __wash.audio.buffers.filter(bank => bank.length).length), 30);
    }
    await host.evaluate(() => {
      const sim = __wash.connection.authority.sim, player = sim.players[0];
      if (player.heldTool) player.heldTool.release(player);
      sim.game.waterguns[0].pickup(player);
    });
    await host.keyboard.down('KeyJ');
    await Promise.all(pages.map(p => p.waitForFunction(() => __wash.game.waterguns[0].spraying && __wash.audio.loops[0].current >= 0 && __wash.audio.loops[4].current >= 0)));
    await host.waitForTimeout(300);
    for (const page of pages) assert.equal(await page.evaluate(() => __soundLog.filter(id => id === 10).length), 1, 'one spray start per gun');
    // A guest menu blocks only that guest's inputs; host audio/game continue.
    await guest.locator('#pause-game').click(); await guest.waitForSelector('#menu-dialog[open]');
    assert.equal(await host.evaluate(() => __wash.game.paused), false);
    assert.equal(await guest.evaluate(() => __wash.audio.loops[0].current >= 0), true);
    await guest.locator('.pause-continue').click();
    await host.keyboard.up('KeyJ');
    await Promise.all(pages.map(p => p.waitForFunction(() => __wash.audio.loops[0].current === -1 && __wash.audio.loops[4].current === -1)));
    await host.locator('#pause-game').click();
    await Promise.all(pages.map(p => p.waitForFunction(() => __wash.game.paused && __wash.audio.music.muffled && __wash.audio.loops.every(l => l.current === -1))));
    await host.locator('.pause-continue').click();
    await Promise.all(pages.map(p => p.waitForFunction(() => __wash.game.orders.length === 2 && __wash.game.orders.every(o => o.arrivalProgress === 1), null, { timeout: 30000 })));
    await host.evaluate(() => {
      const sim = __wash.connection.authority.sim;
      for (const p of sim.players.filter(p => p.occupied)) {
        p.pos.set(sim.trucks[0].pos.x + 1, sim.trucks[0].topY, sim.trucks[0].pos.z + 1.1);
        p.ground = { truck: sim.trucks[0], plat: sim.trucks[0].platforms[0] }; p.state = 'ground';
      }
    });
    await Promise.all(pages.map(p => p.waitForFunction(() => Math.abs(__wash.suspension.loads[0].roll) > .002)));
    for (const page of pages) {
      await page.evaluate(() => { __soundLog.length = 0; });
      assert.equal(await page.locator('.stain-badge:visible').count(), 6);
    }
    await host.evaluate(() => {
      const game = __wash.connection.authority.sim.game;
      for (const order of game.orders) {
        for (const stain of order.stains) { stain.stage = stain.steps.length; stain.progress = 0; stain.done = true; stain.cleanedAt = game.elapsed; }
        game.completeOrder(order);
      }
    });
    await Promise.all(pages.map(p => p.waitForFunction(() => __wash.game.completed === 2)));
    await host.waitForTimeout(150);
    for (const page of pages) assert.equal(await page.evaluate(() => __soundLog.filter(id => id === 13).length), 2, 'each authoritative order chimes once');
    // Signaling reconnect preserves the direct gameplay link and never replays payment.
    await guest.evaluate(() => __wash.connection.socket.close());
    await guest.waitForFunction(() => __wash.connection.connected && __wash.connection.guest?.open);
    assert.equal(await guest.evaluate(() => __soundLog.filter(id => id === 13).length), 2);
    await host.evaluate(() => { __wash.connection.authority.sim.game.remaining = .01; });
    await Promise.all(pages.map(p => p.waitForFunction(() => __wash.game.ended && __wash.audio.loops.every(l => l.current === -1))));
    for (const page of pages) assert.equal(await page.evaluate(() => __soundLog.filter(id => id === 14).length), 1);
    await host.locator('.pause-home').click();
    await Promise.all(pages.map(p => p.waitForFunction(() => __wash.ui.page === 'home' && !__wash.ui.iris.active && __wash.audio.music.track === 0)));
    for (const page of pages) assert.equal(await page.evaluate(() => __audioService === __wash.audio && __wash.audio.listeners.length === 1 && __gainNodes.every((g, i) => g === __wash.audio.voices[i].gain) && __stains.every(mesh => [...__wash.game.stainPools.values()].flat().includes(mesh))), true);
    // An actual data-channel failure clears old loops before rejoining a room at home.
    await guest.evaluate(() => __wash.connection.guest.link.close('audio-reconnect-test'));
    await guest.waitForFunction(() => !!__wash.connection.room?.ownCode && __wash.ui.page === 'home' && !__wash.ui.iris.active);
    assert.equal(await guest.evaluate(() => __wash.audio.loops.every(l => l.current === -1)), true);
    await join();
    await host.locator('#new-game').click();
    await Promise.all(pages.map(p => p.waitForFunction(() => __wash.network.phase === 'game' && !__wash.ui.iris.active)));
    for (const page of pages) {
      assert.equal(await page.evaluate(() => __wash.audio.listeners.length), 1);
      assert.equal(await page.evaluate(() => __wash.audio.musicSources.size <= 2), true);
    }
    assert.deepEqual(errors, []); assert.deepEqual(failures, []);
    console.log('PASS real Chrome: decoded/unlocked audio, host/guest spray and menu/pause, paired payments once, signaling reconnect, end/home/re-entry pool reuse and vehicle lean; same-machine only');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
