/** Real Chrome keys through host/guest input sampling and WebRTC; same machine, not a cross-device LAN test. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/'); url.searchParams.set('wash-test', '1');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }), pages = [], errors = [];
  try {
    for (let i = 0; i < 2; i++) {
      const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
      pages.push(page); page.on('pageerror', e => errors.push(e.message));
      await page.goto(url.href); await page.waitForSelector('body.scene-ready', { timeout: 60000 });
      assert.deepEqual(await page.locator('.keys kbd').allTextContents(), ['W', 'A', 'S', 'D', '空格', 'J', 'K', 'L']);
    }
    const [host, guest] = pages;
    if (await guest.locator('#join-room-form').isHidden()) await guest.locator('#toggle-join-room').click();
    await guest.locator('#join-code').fill(await host.locator('#room-code-value').textContent()); await guest.locator('#join-room').click();
    await guest.waitForFunction(() => __wash.connection.guest?.open && __wash.network.latest);
    await host.waitForFunction(() => __wash.connection.authority.sim.players.slice(0, 2).every(p => p.state === 'ground'));
    for (const page of pages) await page.evaluate(() => {
      window.__controlInputs = [];
      const connection = __wash.connection, send = connection.send.bind(connection);
      connection.send = (type, input) => {
        if (type === 'input') __controlInputs.push(structuredClone(input));
        return send(type, input);
      };
    });
    const fixture = async (slot, held = false) => {
      await host.evaluate(({ slot, held }) => {
        const sim = __wash.connection.authority.sim, truck = sim.trucks[0], towel = sim.game.towels[0], p = sim.players[slot];
        towel.placeOn(truck, { x: -1.5, z: 0 });
        p.state = 'ground'; p.ground = { truck, plat: truck.platformAt(truck.pos.x - 2, truck.pos.z, 0) };
        p.pos.set(truck.pos.x - 2, truck.topY, truck.pos.z); p.root.position.copy(p.pos);
        p.vel.set(0, 0, 0); p.externalVelocity.set(0, 0, 0); p.yaw = 0;
        p.throwCancelled = p.throwWasDown = p.skipUse = false;
        if (held) towel.pickup(p);
        sim.scene.updateMatrixWorld(true);
      }, { slot, held });
      await Promise.all(pages.map(p => p.waitForFunction(({ slot, held }) =>
        __wash.network.latest.game.towels[0].holder === (held ? slot : -1), { slot, held })));
    };
    for (const slot of [0, 1]) {
      const page = pages[slot]; await page.bringToFront(); await page.locator('#game').click();
      await fixture(slot);
      for (const key of ['KeyE', 'KeyG', 'KeyQ']) await page.keyboard.press(key);
      await page.waitForTimeout(120);
      assert.equal(await host.evaluate(slot => !!__wash.connection.authority.sim.players[slot].heldTool, slot), false, 'old keys do nothing');
      await page.keyboard.down('KeyJ');
      await Promise.all(pages.map(p => p.waitForFunction(slot => __wash.network.latest.game.towels[0].holder === slot, slot)));
      await page.keyboard.up('KeyJ');
      await host.waitForFunction(slot => !__wash.connection.authority.sim.players[slot].skipUse, slot);
      await page.keyboard.down('KeyD'); await page.keyboard.down('KeyJ');
      await page.waitForFunction(() => __controlInputs.some(p => p.down.includes('KeyJ') && p.axis[0] === 1));
      await host.waitForFunction(slot => __wash.connection.authority.sim.players[slot].useAction === 'wipe', slot);
      await page.keyboard.up('KeyD'); await page.keyboard.up('KeyJ');
      await page.keyboard.down('KeyK'); await page.waitForTimeout(70); await page.keyboard.up('KeyK');
      await Promise.all(pages.map(p => p.waitForFunction(() => __wash.network.latest.game.towels[0].holder === -1 && !__wash.network.latest.game.towels[0].flight)));
      await fixture(slot, true);
      await page.keyboard.down('KeyK');
      await host.waitForFunction(() => __wash.connection.authority.sim.game.towels[0].charge > .25);
      await page.keyboard.press('ShiftLeft'); await page.keyboard.press('ShiftRight');
      assert.ok(await host.evaluate(() => __wash.connection.authority.sim.game.towels[0].charge) > .25, 'Shift does not cancel charge');
      assert.equal(await host.evaluate(slot => __wash.connection.authority.sim.players[slot].dashRemaining, slot), 0);
      await page.keyboard.up('KeyK');
      await Promise.all(pages.map(p => p.waitForFunction(() => __wash.network.latest.game.towels[0].flight && __wash.network.latest.game.towels[0].holder === -1)));
      await fixture(slot, true);
      await page.keyboard.down('KeyK');
      await host.waitForFunction(() => __wash.connection.authority.sim.game.towels[0].charge > .25);
      // Jumping keeps the charge; releasing K in the air throws.
      const charged = await host.evaluate(() => __wash.connection.authority.sim.game.towels[0].charge);
      await page.keyboard.press('Space');
      await host.waitForFunction(({ slot, charged }) => {
        const sim = __wash.connection.authority.sim;
        return sim.players[slot].state === 'air' && sim.game.towels[0].charge > charged && sim.game.towels[0].holder === sim.players[slot];
      }, { slot, charged });
      await page.keyboard.up('KeyK');
      await Promise.all(pages.map(p => p.waitForFunction(() => __wash.network.latest.game.towels[0].flight && __wash.network.latest.game.towels[0].holder === -1)));
      const packets = await page.evaluate(() => __controlInputs);
      assert.ok(packets.some(p => p.hits.includes('Space')));
      assert.ok(packets.some(p => p.hits.includes('KeyK')));
      assert.ok(packets.every(p => [...p.down, ...p.hits].every(key => ['Space', 'KeyJ', 'KeyK', 'KeyL'].includes(key))));
    }
    await guest.screenshot({ path: '/tmp/wash-controls-jkl.png' });
    assert.deepEqual(errors, []);
    console.log('PASS real host + WebRTC guest: J pickup/use with D movement; K place/throw; Space jumps without cancelling, jump-throws; both Shifts dormant; old keys absent from packets; consistent ownership on both pages');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
