/** Local wheel input on two real same-machine WebRTC pages; no shared camera state. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/');
url.searchParams.set('wash-test', '1');
const output = 'docs/QA/wheel-camera';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }), pages = [], errors = [];
  fs.mkdirSync(output, { recursive: true });
  const state = page => page.evaluate(() => ({ scale: __wash.game.rig.zoomScale, fov: __wash.camera.fov, page: __wash.ui.page }));
  const wheel = async (page, amount, count = 1) => {
    await page.mouse.move(720, 400);
    for (let i = 0; i < count; i++) await page.mouse.wheel(0, amount);
    await page.waitForTimeout(150);
  };
  try {
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 810 } });
      const page = await context.newPage(); pages.push(page);
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(url.href); await page.waitForSelector('body.scene-ready', { timeout: 60000 });
    }
    const [host, guest] = pages;
    await wheel(host, -240, 4); assert.equal((await state(host)).scale, 1, 'home does not zoom');
    if (await guest.locator('#join-room-form').isHidden()) await guest.locator('#toggle-join-room').click();
    await guest.locator('#join-code').fill(await host.locator('#room-code-value').textContent());
    await guest.locator('#join-room').click();
    await guest.waitForFunction(() => __wash.connection.guest?.open && __wash.network.latest);
    await host.locator('#new-game').click();
    await host.waitForFunction(() => __wash.ui.page === 'transition');
    await wheel(host, -240); assert.equal((await state(host)).scale, 1, 'entry keeps its original camera');
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.roundStage === 'playing' && !__wash.ui.iris.active)));
    assert.equal((await state(host)).fov, 32);
    await host.screenshot({ path: `${output}/default.png` });
    await wheel(host, -240, 5);
    assert.equal((await state(host)).fov, 16); assert.equal((await state(guest)).fov, 32);
    await host.screenshot({ path: `${output}/near.png` });
    await wheel(guest, 240, 5);
    assert.equal((await state(guest)).fov, 48); assert.equal((await state(host)).fov, 16);
    await guest.screenshot({ path: `${output}/far.png` });
    await host.keyboard.press('Escape'); await host.waitForSelector('#menu-dialog[open]');
    await wheel(host, 240, 2); assert.equal((await state(host)).fov, 16);
    await guest.waitForFunction(() => __wash.game.paused);
    await wheel(guest, -240, 2); assert.equal((await state(guest)).fov, 48);
    await host.locator('.pause-settings').click();
    assert.equal(await host.locator('#setting-camera-fov').inputValue(), '32', 'wheel leaves the saved baseline unchanged');
    await host.locator('#setting-camera-fixed').check();
    await host.locator('#dialog-close').click();
    await host.waitForFunction(() => !__wash.ui.hasModal && !__wash.game.paused);
    await host.locator('#game').click({ position: { x: 720, y: 400 } });
    await wheel(host, 240, 5); assert.equal((await state(host)).fov, 48, 'fixed camera also zooms');
    await host.keyboard.down('Control'); await wheel(host, -240); await host.keyboard.up('Control');
    assert.equal((await state(host)).scale, 1.5, 'browser modifier does not alter game zoom');
    await host.keyboard.press('Escape'); await host.locator('.pause-home').click();
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.ui.page === 'home' && !__wash.ui.iris.active && !__wash.connection.room.homeWaiting.length)));
    assert.equal((await state(host)).scale, 1.5);
    await host.waitForTimeout(2000);
    const homeFov = (await state(host)).fov;
    assert.ok(homeFov > 29 && homeFov < 37, 'home framing does not inherit gameplay zoom');
    await host.locator('#select-level').click(); await host.locator('[data-level-id="highway-02"]').click();
    await Promise.all(pages.map(page => page.waitForSelector('#level-guide[open]')));
    await wheel(host, -240, 4); assert.equal((await state(host)).scale, 1.5, 'reading the guide cannot zoom');
    await Promise.all(pages.map(page => page.locator('.level-guide-confirm').click()));
    await host.waitForFunction(() => __wash.game.roundStage === 'ready');
    await wheel(host, -240); assert.equal((await state(host)).scale, 1.5, 'Ready cannot zoom');
    await host.waitForFunction(() => __wash.game.roundStage === 'playing');
    assert.equal((await state(host)).fov, 48, 'the same page keeps its local zoom across scene changes');
    await host.evaluate(() => __wash.app.dispose());
    const before = (await state(host)).scale;
    await host.locator('#game').dispatchEvent('wheel', { deltaY: -240 });
    assert.equal((await state(host)).scale, before, 'destroyed UI removes wheel listener');
    assert.deepEqual(errors, []);
    const report = { result: 'PASS', defaultFov: 32, minFov: 16, maxFov: 48, hostGuestIndependent: true,
      gates: ['home', 'transition', 'pause', 'settings', 'guide', 'ready', 'dispose'], fixedCamera: true, homeFov };
    fs.writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
