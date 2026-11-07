/** Same-machine Chrome/WebRTC: confirmed soap slips, bilingual comic text and UI lifecycle. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { installGuideReader } = require('./helpers/guide-browser.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/'); url.searchParams.set('wash-test', '1');
const output = 'docs/QA/soap-slip-text'; fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  await installGuideReader(browser);
  const pages = [], errors = [];
  try {
    for (const language of ['zh', 'en']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); pages.push(page);
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(language => { if (!localStorage.getItem('wash-language')) localStorage.setItem('wash-language', language); }, language);
      await page.goto(url.href); await page.waitForSelector('body.scene-ready', { timeout: 60000 });
      assert.equal(await page.locator('.soap-slip-pop').count(), 4);
      assert.equal(await page.locator('.soap-slip-pop:visible').count(), 0);
    }
    const [host, guest] = pages;
    await guest.locator('#toggle-join-room').click();
    await guest.locator('#join-code').fill(await host.locator('#room-code-value').textContent()); await guest.locator('#join-room').click();
    await guest.waitForFunction(() => __wash.connection.guest?.open);
    await host.locator('#select-level').click(); await host.locator('[data-level-id="highway-03"]').click();
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.roundStage === 'playing' && __wash.game.elapsed > 1.2 && !__wash.ui.iris.active)));
    const trigger = async () => {
      await host.evaluate(() => {
        const sim = __wash.connection.authority.sim, g = sim.game, home = sim.trucks[0];
        for (const soap of g.soaps) soap.retire();
        g.paused = false;
        for (const [slot, x] of [[0, -1], [1, 1]]) {
          const p = sim.players[slot]; p.state = 'ground'; p.ground = { truck: home, plat: home.platformAt(home.pos.x + x, home.pos.z, .3) };
          p.pos.set(home.pos.x + x, home.topY, home.pos.z); p.root.position.copy(p.pos);
          p.vel.set(0, 0, 0); p.externalVelocity.set(0, 0, 0); p.yaw = Math.PI / 2;
          p.slipRemaining = p.slipCooldown = p.dashRemaining = p.stunRemaining = 0;
          g.takeSoap(p).placeOn(home, { x, z: 0 });
        }
        sim.scene.updateMatrixWorld(true);
      });
      await Promise.all(pages.map(page => page.waitForFunction(() => __wash.ui.soapSlipText.pops.slice(0, 2).every(pop => !pop.node.hidden))));
    };
    await trigger();
    // Freeze the confirmed world to inspect the short-lived word and language switching deterministically.
    await host.evaluate(() => { __wash.connection.authority.sim.game.paused = true; });
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.paused)));
    const serials = await Promise.all(pages.map(page => page.evaluate(() => __wash.ui.soapSlipText.pops.map(pop => pop.serial))));
    for (const [index, page] of pages.entries()) {
      const word = page.locator('.soap-slip-pop[data-slot="0"] strong');
      assert.equal(await word.textContent(), index === 0 ? '哧溜~!' : 'WHOOSH!');
      const sizes = await page.evaluate(() => ({ slip: parseFloat(getComputedStyle(document.querySelector('.soap-slip-pop strong')).fontSize), sign: parseFloat(getComputedStyle(document.querySelector('.road-sign-pop strong')).fontSize) }));
      assert.equal(sizes.slip, 40); assert.equal(sizes.sign, 56);
      assert.equal(await word.evaluate(node => getComputedStyle(node).animationPlayState), 'paused');
      await page.evaluate(() => document.querySelectorAll('.soap-slip-pop strong').forEach(node => node.getAnimations().forEach(animation => { animation.currentTime = 200; })));
      const hideModal = await page.addStyleTag({ content: 'dialog[open]{opacity:0!important}dialog::backdrop{background:transparent!important;backdrop-filter:none!important}' });
      await page.screenshot({ path: `${output}/${index ? 'en' : 'zh'}.png` }); await hideModal.evaluate(node => node.remove());
      await page.evaluate(locale => __wash.ui.setLanguage(locale), index ? 'zh' : 'en');
      assert.equal(await word.textContent(), index ? '哧溜~!' : 'WHOOSH!');
      assert.equal(await page.evaluate(() => localStorage.getItem('wash-language')), index ? 'zh' : 'en');
      assert.deepEqual(await page.evaluate(() => __wash.ui.soapSlipText.pops.map(pop => pop.serial)), serials[index]);
    }
    await host.waitForTimeout(250);
    for (const [index, page] of pages.entries()) assert.deepEqual(await page.evaluate(() => __wash.ui.soapSlipText.pops.map(pop => pop.serial)), serials[index], 'unchanged snapshots do not replay');
    await host.evaluate(() => { __wash.connection.authority.sim.game.paused = false; });
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.ui.soapSlipText.pops.every(pop => pop.node.hidden))));
    await host.evaluate(() => __wash.ui.setMotionEnabled(false)); await guest.emulateMedia({ reducedMotion: 'reduce' });
    await trigger();
    for (const page of pages) assert.equal(await page.locator('.soap-slip-pop[data-slot="0"] strong').evaluate(node => getComputedStyle(node).animationName), 'none');
    // Context replacement clears the old text and consumes an in-progress slip as a baseline.
    for (const page of pages) await page.evaluate(() => {
      const text = __wash.ui.soapSlipText;
      text.update(__wash.game, false, 0, 'replacement-room');
      if (text.pops.some(pop => !pop.node.hidden)) throw new Error('old pop survived reset');
      text.update(__wash.game, true, 0, 'replacement-room');
      if (text.pops.some(pop => !pop.node.hidden)) throw new Error('old slip replayed');
    });
    await host.locator('#pause-game').click(); await host.locator('.pause-home').click();
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.ui.page === 'home' && !__wash.ui.iris.active)));
    for (const page of pages) assert.equal(await page.locator('.soap-slip-pop:visible').count(), 0);
    await guest.reload(); await guest.waitForSelector('body.scene-ready', { timeout: 60000 });
    assert.equal(await guest.locator('html').getAttribute('lang'), 'zh-CN');
    assert.deepEqual(errors, []);
    console.log('Soap-slip text: bilingual WebRTC peers, two simultaneous slips, 40/56px size, pause, deduplication, language switching/persistence, reduced motion, reset and return passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
