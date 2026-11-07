/** Real Chrome/WebRTC: guest leave confirmation at home, pause and results; host return still keeps the party. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const { installGuideReader } = require('./helpers/guide-browser.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/'); url.searchParams.set('wash-test', '1');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  await installGuideReader(browser);
  const pages = [], errors = [];
  try {
    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage(); pages.push(page);
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(url.href); await page.waitForSelector('body.scene-ready', { timeout: 60000 });
    }
    const [host, guest, englishGuest] = pages;
    const code = await host.locator('#room-code-value').textContent();
    for (const [index, page] of [guest, englishGuest].entries()) {
      await page.locator('#toggle-join-room').click();
      await page.locator('#join-code').fill(code);
      await page.locator('#join-room').click();
      await page.waitForFunction(count => __wash.connection.guest?.open && __wash.connection.room?.members.length === count, index + 2);
    }
    await englishGuest.evaluate(() => __wash.ui.setLanguage('en'));
    assert.equal(await guest.locator('#room-action').textContent(), '退出组队');
    assert.equal(await englishGuest.locator('#room-action').textContent(), 'Leave party');
    await guest.locator('#room-action').click();
    assert.equal(await guest.locator('#leave-party-title').textContent(), '你确定要离开当前组队吗？');
    await guest.keyboard.press('n');
    assert.equal(await guest.locator('#leave-party-confirm').isVisible(), false);
    assert.equal(await guest.locator('#room-code-value').textContent(), code, 'N retains room membership');

    const start = async () => {
      await host.locator('#new-game').click();
      await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.roundStage === 'playing' && !__wash.ui.iris.active, null, { timeout: 30000 })));
    };
    await start();
    await host.locator('#pause-game').click();
    assert.equal(await host.locator('.pause-home').textContent(), '回到主菜单');
    await host.locator('.pause-home').click();
    assert.equal(await host.locator('#leave-party-confirm').isVisible(), false, 'host return has no leave gate');
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.ui.page === 'home' && !__wash.ui.iris.active, null, { timeout: 30000 })));
    assert.equal(await host.locator('#room-code-value').textContent(), code);
    assert.equal(await guest.locator('#room-code-value').textContent(), code, 'host brings teammates home together');

    await start();
    await guest.locator('#pause-game').click();
    assert.equal(await guest.locator('.pause-home').textContent(), '退出组队');
    await guest.locator('.pause-home').click();
    await guest.waitForSelector('#leave-party-confirm[open]');
    await guest.keyboard.press('n');
    assert.equal(await guest.locator('#leave-party-confirm').isVisible(), false);
    assert.equal(await guest.locator('.pause-home').isVisible(), true, 'N restores the pause menu');
    assert.equal(await guest.evaluate(() => __wash.connection.room.code), code);
    await guest.locator('.pause-home').click(); await guest.keyboard.press('y');
    await guest.waitForFunction(() => __wash.connection.isHost && __wash.ui.page === 'home' && !__wash.ui.iris.active, null, { timeout: 30000 });
    assert.notEqual(await guest.locator('#room-code-value').textContent(), code);
    assert.equal(await host.evaluate(() => __wash.connection.room.code), code);

    await host.evaluate(() => __wash.connection.authority.sim.game.finish('time_up'));
    await englishGuest.waitForSelector('.result-home', { timeout: 30000 });
    assert.equal(await englishGuest.locator('.result-home').textContent(), 'Leave party');
    await englishGuest.locator('.result-home').click();
    assert.equal(await englishGuest.locator('#leave-party-title').textContent(), 'Are you sure you want to leave this party?');
    await englishGuest.keyboard.press('n');
    assert.equal(await englishGuest.locator('.result-home').isVisible(), true, 'N restores the results');
    await englishGuest.locator('.result-home').click(); await englishGuest.keyboard.press('y');
    await englishGuest.waitForFunction(() => __wash.connection.isHost && __wash.ui.page === 'home' && !__wash.ui.iris.active, null, { timeout: 30000 });
    assert.equal(await host.evaluate(() => __wash.connection.room.code), code, 'guest exit never disbands the host room');
    assert.deepEqual(errors, []);
    console.log('Guest home, pause and results leave confirmation; host whole-party return; Chinese/English Y/N passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
