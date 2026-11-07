/** Actual guest L input, real ballistic hits and host/guest HUD agreement at low pressure. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { installGuideReader } = require('./helpers/guide-browser.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://192.168.1.10:8080/');
url.searchParams.set('wash-test', '1');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  await installGuideReader(browser);
  const pages = [], errors = [];
  try {
    for (const language of ['zh', 'en']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
      await page.addInitScript(language => localStorage.setItem('wash-language', language), language);
      page.on('pageerror', error => errors.push(error.message)); pages.push(page);
      await page.goto(url.href);
      await page.waitForSelector('body.scene-ready', { timeout: 60000 });
      await page.waitForFunction(() => __wash.connection.connected);
    }
    const [host, guest] = pages;
    await guest.evaluate(() => __wash.connection.customize({ animal: 'elephant', breed: 'grey', color: 1 }));
    if (await guest.locator('#join-room-form').isHidden()) await guest.locator('#toggle-join-room').click();
    await guest.locator('#join-code').fill(await host.locator('#room-code-value').textContent());
    await guest.locator('#join-room').click();
    await guest.waitForFunction(() => __wash.connection.guest?.open && !__wash.ui.iris.active && !__wash.ui.hasModal);
    await host.locator('#select-level').click(); await host.locator('[data-level-id="highway-02"]').click();
    await host.waitForFunction(() => __wash.game.orders.some(order => order.id === 'water-02' && order.arrivalProgress === 1), null, { timeout: 60000 });
    const state = page => page.evaluate(() => {
      const order = __wash.game.orders.find(order => order.id === 'water-02');
      const stain = order.stains.find(stain => stain.steps[0] === 'water');
      const index = __wash.game.orders.flatMap(order => order.stains).indexOf(stain);
      const badge = __wash.ui.worldHud.stainBadges[index];
      return { stage: stain.stage, progress: stain.progress, width: parseFloat(badge.querySelector('.wipe-bar i').style.width), tool: badge.dataset.tool };
    });
    // Reposition between short bursts so this regression isolates weak-jet contact from recoil/aiming.
    // Never assign stain progress/stage, mock trace, or inject a successful hit.
    for (let burst = 0; burst < 8 && (await state(host)).stage === 0; burst++) {
      await host.evaluate(() => {
        const sim = __wash.connection.authority.sim, order = sim.game.orders.find(order => order.id === 'water-02');
        const stain = order.stains.find(stain => stain.steps[0] === 'water'), p = sim.players[1], truck = order.truck;
        const at = stain.mesh.getWorldPosition(p.pos.clone());
        p.state = 'ground'; p.pos.set(at.x + 1, truck.topY, at.z); p.yaw = Math.PI;
        p.ground = { truck, plat: truck.platformAt(p.pos.x, p.pos.z, 0.3) };
        p.externalVelocity.set(0, 0, 0); p.vel.set(0, 0, 0);
      });
      await guest.waitForTimeout(150); await guest.bringToFront(); await guest.keyboard.down('KeyL');
      await host.waitForFunction(() => __wash.connection.authority.sim.players[1].trunk.sprayTime > 0.12);
      if (burst === 0) {
        const initial = await host.evaluate(() => {
          const sim = __wash.connection.authority.sim, stain = sim.game.orders.find(order => order.id === 'water-02').stains.find(stain => stain.steps[0] === 'water');
          return { progress: stain.progress, pressure: sim.players[1].trunk.pressure };
        });
        assert.ok(initial.progress > 0, 'the weak opening jet must already clean, before full pressure');
        console.log('Opening L jet:', initial);
      }
      await guest.waitForTimeout(160); await guest.keyboard.up('KeyL'); await guest.waitForTimeout(500);
      await Promise.all(pages.map(page => page.waitForFunction(() => {
        const order = __wash.game.orders.find(order => order.id === 'water-02'), stain = order.stains.find(stain => stain.steps[0] === 'water');
        const index = __wash.game.orders.flatMap(order => order.stains).indexOf(stain);
        const width = parseFloat(__wash.ui.worldHud.stainBadges[index].querySelector('.wipe-bar i').style.width);
        return Math.abs(width - stain.progress * 100) < 0.11;
      })));
      console.log('Rinse burst', burst + 1, await state(host), await state(guest));
      if (burst === 0) await guest.screenshot({ path: '/tmp/wash-elephant-rinse-progress.png' });
    }
    for (const page of pages) {
      // Another arriving order may rebuild all cues between frames. Observe the applied HUD frame atomically.
      await page.waitForFunction(() => {
        const order = __wash.game.orders.find(order => order.id === 'water-02');
        const stain = order.stains.find(stain => stain.steps[0] === 'water');
        const index = __wash.game.orders.flatMap(order => order.stains).indexOf(stain);
        const badge = __wash.ui.worldHud.stainBadges[index];
        return stain.stage === 1 && stain.progress === 0 && badge.dataset.tool === 'towel';
      }, null, { timeout: 10000 });
    }
    assert.deepEqual(errors, []);
    console.log('PASS real guest L: weak jet advances rinse, repeated bursts finish water step, both HUDs agree; towel remains required');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
