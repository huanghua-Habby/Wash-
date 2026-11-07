const { installGuideReader } = require('./helpers/guide-browser.cjs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/'); url.searchParams.set('wash-test', '1');

async function monitor(page, frames = 90) {
  return page.evaluate(frames => new Promise(resolve => {
    const { ui, camera } = __wash, original = ui.updateWorld.bind(ui);
    const originalPlace = ui.hudPositioner.place.bind(ui.hudPositioner), kinds = new Set();
    let frame = 0, maxLag = 0, maxMatrixError = 0, visibleNames = 0, checked = 0;
    ui.hudPositioner.place = function(node, anchor, options) {
      originalPlace(node, anchor, options);
      if (node.hidden) return;
      const point = anchor.clone().project(camera);
      const rendered = node.style.transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px/).slice(1).map(Number);
      maxLag = Math.max(maxLag, Math.hypot(rendered[0] - (point.x + 1) * 720, rendered[1] - (1 - point.y) * 405));
      kinds.add(node.classList[0]); checked++;
    };
    ui.updateWorld = function(...args) {
      const previous = camera.matrixWorldInverse.clone(); camera.updateMatrixWorld(true);
      maxMatrixError = Math.max(maxMatrixError, ...previous.elements.map((v, i) => Math.abs(v - camera.matrixWorldInverse.elements[i])));
      original(...args);
      __wash.players.forEach((player, i) => {
        const label = ui.names.labels[i]; if (label.hidden) return;
        visibleNames++; checked++;
        const point = player.root.getWorldPosition(player.pos.clone()); point.y += args[1].active || player.heldTool ? 2.5 : 1.6;
        point.project(camera);
        const rendered = label.style.transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px/).slice(1).map(Number);
        maxLag = Math.max(maxLag, Math.hypot(rendered[0] - (point.x + 1) * 720, rendered[1] - (1 - point.y) * 405));
      });
      if (++frame === frames) {
        ui.updateWorld = original; ui.hudPositioner.place = originalPlace;
        resolve({ maxLag, maxMatrixError, visibleNames, checked, kinds: [...kinds] });
      }
    };
  }), frames);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }), pages = [], errors = [];
  await installGuideReader(browser);

  try {
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 810 } }), page = await context.newPage();
      pages.push(page); page.on('pageerror', error => errors.push(error.message));
      await page.goto(url.href); await page.waitForSelector('body.scene-ready');
    }
    const [host, guest] = pages;
    if (await guest.locator('#join-room-form').isHidden()) await guest.locator('#toggle-join-room').click();
    await guest.locator('#join-code').fill(await host.locator('#room-code-value').textContent()); await guest.locator('#join-room').click();
    await guest.waitForFunction(() => __wash.connection.guest?.open && __wash.network.latest);
    await host.waitForFunction(() => __wash.connection.room.members.length === 2);
    const home = await Promise.all(pages.map(page => monitor(page)));
    for (const result of home) { assert.ok(result.visibleNames > 0); assert.ok(result.maxLag <= 6.2); assert.equal(result.maxMatrixError, 0); }
    await host.keyboard.down('KeyW');
    const moving = await monitor(host, 20); await host.keyboard.up('KeyW'); assert.ok(moving.maxLag <= 6.2);
    await host.keyboard.press('Space'); await host.waitForTimeout(250);
    await host.screenshot({ path: 'docs/QA/world-hud-damped-home.png' });
    await host.locator('#new-game').click();
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.network.phase === 'game' && __wash.game.roundStage === 'playing')));
    await Promise.all(pages.map(page => page.evaluate(() => __wash.ui.names.showTemporarily())));
    const gameplay = await Promise.all(pages.map(page => monitor(page, 60)));
    for (const result of gameplay) { assert.ok(result.visibleNames > 0); assert.ok(result.maxLag <= 6.2); assert.equal(result.maxMatrixError, 0); }
    await host.waitForFunction(() => [...document.querySelectorAll('.stain-badge')].some(node => !node.hidden), null, { timeout: 30000 });
    const orders = await Promise.all(pages.map(page => monitor(page, 60)));
    for (const result of orders) {
      assert.ok(result.kinds.includes('stain-badge') && result.kinds.includes('car-badge'));
      assert.ok(result.maxLag <= 6.2); assert.equal(result.maxMatrixError, 0);
    }
    await host.screenshot({ path: 'docs/QA/world-hud-damped-game.png' });
    await host.evaluate(() => { __wash.ui.setMotionEnabled(false); __wash.ui.names.showTemporarily(); });
    const quiet = await monitor(host, 30); assert.ok(quiet.maxLag < .18, 'quiet UI places tags immediately');
    assert.deepEqual(errors, []);
    console.log('PASS same-machine WebRTC HUD: home, moving/jumping, transition/game, visible labels, <=6px damping lag, current camera matrices, quiet UI');
    console.log(JSON.stringify({ home, moving, gameplay, orders, quiet }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
