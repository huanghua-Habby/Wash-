const { installGuideReader } = require('./helpers/guide-browser.cjs');
/** Same-machine Chrome/WebRTC: authoritative charging, electric stuns with the X-ray strobe, socket short-circuit blasts, GPU prewarm and scene reuse. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/'); url.searchParams.set('wash-test', '1');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }), pages = [], errors = [], signaling = [];
  await installGuideReader(browser);

  try {
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 810 } });
      const page = await context.newPage(); pages.push(page);
      page.on('websocket', socket => socket.on('framesent', frame => { try { signaling.push(JSON.parse(frame.payload).type); } catch {} }));
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', msg => { if (msg.type() === 'error' && /WebGL|Shader Error|VALIDATE_STATUS/.test(msg.text())) errors.push(msg.text()); });
      await page.goto(url.href); await page.waitForSelector('body.scene-ready', { timeout: 60000 });
    }
    const [host, guest] = pages;
    const programs = await Promise.all(pages.map(page => page.evaluate(() => __wash.renderer.info.programs.length)));
    if (await guest.locator('#join-room-form').isHidden()) await guest.locator('#toggle-join-room').click();
    await guest.locator('#join-code').fill(await host.locator('#room-code-value').textContent()); await guest.locator('#join-room').click();
    await guest.waitForFunction(() => __wash.connection.guest?.open);
    await host.locator('#select-level').click(); await host.locator('[data-level-id="highway-04"]').click();
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.roundStage === 'playing' && __wash.game.orders.length === 2)));
    await host.waitForFunction(() => __wash.game.elapsed > 9 && __wash.game.orders.every(order => order.arrivalProgress === 1));
    await host.evaluate(() => {
      const sim = __wash.connection.authority.sim, order = sim.game.orders[0], p = sim.players[0];
      const front = order.truck.platforms.reduce((a, b) => a.x1 > b.x1 ? a : b);
      p.state = 'ground'; p.ground = { truck: order.truck, plat: front }; p.pos.set(order.truck.pos.x + front.x1 - .3, order.truck.topY, order.truck.pos.z);
      p.root.position.copy(p.pos); p.vel.set(0, 0, 0); sim.game.chargers[0].pickup(p); p.skipUse = false;
    });
    await host.keyboard.press('j');
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.chargers[0].connectedSerial === __wash.game.orders[0].serial)));
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.orders[0].chargeProgress > .2)));
    assert.equal(await guest.locator('.charging-badge').filter({ hasText: '充电中' }).count(), 1);
    await host.screenshot({ path: 'docs/QA/charging-placeholder.png' });
    // Water on the plugged socket shorts it: one blast on both pages, connector flies off, the player is thrown.
    await host.evaluate(() => {
      const sim = __wash.connection.authority.sim, order = sim.game.orders[0], p = sim.players[0];
      const front = order.truck.platforms.reduce((a, b) => a.x1 > b.x1 ? a : b);
      p.pos.set(order.truck.pos.x + front.x1 - 1.1, order.truck.topY, order.truck.pos.z); p.root.position.copy(p.pos);
      sim.game.wet.splash(order.truck, front.x1 - .3, 0);
    });
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.charging.blast.id === 1 && __wash.game.chargers[0].connectedSerial === null)));
    for (const page of pages) assert.equal(await page.evaluate(() => __wash.game.effects.entries.get('chargerBlast').system.mesh.geometry.instanceCount), 62);
    await host.waitForTimeout(140);
    await host.screenshot({ path: 'docs/QA/charger-short-circuit.png' });
    await Promise.all(pages.map(page => page.waitForFunction(() => !__wash.game.effects.entries.get('chargerBlast').system.mesh.visible, null, { timeout: 8000 })));
    for (const page of pages) assert.equal(await page.evaluate(() => __wash.game.effects.entries.get('chargerBlast').system.mesh.geometry.instanceCount), 0, 'blast tail ends at zero instances');
    await host.evaluate(() => {
      const sim = __wash.connection.authority.sim, order = sim.game.orders[0], p = sim.players[0];
      const front = order.truck.platforms.reduce((a, b) => a.x1 > b.x1 ? a : b);
      p.state = 'ground'; p.ground = { truck: order.truck, plat: front }; p.pos.set(order.truck.pos.x + front.x1 - .3, order.truck.topY, order.truck.pos.z);
      p.root.position.copy(p.pos); p.vel.set(0, 0, 0); p.externalVelocity.set(0, 0, 0);
      sim.game.wet.clearTruck(order.truck); sim.game.chargers[0].placeOn(order.truck, { x: front.x1 - .3, z: 0 }); sim.game.chargers[0].pickup(p);
      sim.game.charging.plug(sim.game.chargers[0], order);
    });
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.orders[0].charged)));
    for (const page of pages) {
      assert.equal(await page.locator('.charging-badge').filter({ hasText: '充电完成' }).count(), 1);
      assert.equal(await page.evaluate(() => __wash.game.orders[0].rewardMultiplier), 1.5);
    }
    await host.evaluate(() => {
      const sim = __wash.connection.authority.sim, home = sim.trucks[0];
      sim.game.chargers[0].placeOn(home, { x: -1.125, z: .225 }); sim.game.wet.splash(home, -1.125, .225);
      for (const slot of [0, 1]) {
        const p = sim.players[slot]; p.state = 'ground'; p.ground = { truck: home, plat: home.platforms[0] };
        p.pos.set(home.pos.x - 1.125 + slot * .1, home.topY, home.pos.z + .225); p.root.position.copy(p.pos); p.vel.set(0, 0, 0);
      }
    });
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.players.slice(0, 2).every(p => p.stunRemaining > 0 && p.state === 'ground'))));
    // Catch an X-ray strobe frame on the host before pausing.
    await host.waitForFunction(() => __wash.game.effects.entries.get('charging').system.xray.rigs.some(rig => rig.mode === 1));
    await host.locator('#pause-game').click();
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.paused)));
    for (const page of pages) {
      assert.equal(await page.evaluate(() => __wash.game.wet.surfaces[1].marks.some(cell => cell.live)), true);
      assert.equal(await page.evaluate(() => __wash.game.effects.entries.get('charging').system.shocks.some(({ bolts }) => bolts.visible)), true);
      assert.equal(await page.evaluate(() => __wash.game.effects.entries.get('charging').system.ground.pools[1].live.array.some(value => value >= 0)), true);
    }
    // Hide only the paused modal/backdrop for visual evidence; the authoritative pause stays in effect.
    const screenshotStyle = await host.addStyleTag({ content: 'dialog[open]{opacity:0!important}dialog::backdrop{background:transparent!important;backdrop-filter:none!important}' });
    await host.screenshot({ path: 'docs/QA/charging-electric.png' });
    const clip = await host.evaluate(() => {
      const p = __wash.game.players[0].root.position.clone().project(__wash.camera);
      return { x: Math.max(0, Math.min(1000, (p.x * .5 + .5) * 1440 - 220)), y: Math.max(0, Math.min(450, (-p.y * .5 + .5) * 810 - 180)), width: 440, height: 360 };
    });
    await host.screenshot({ path: 'docs/QA/charging-electric-detail.png', clip });
    await screenshotStyle.evaluate(node => node.remove());
    const clocks = await Promise.all(pages.map(page => page.evaluate(() => [__wash.game.wet.tick, __wash.game.players[0].stunRemaining])));
    await host.waitForTimeout(250);
    for (let i = 0; i < pages.length; i++) assert.deepEqual(await pages[i].evaluate(() => [__wash.game.wet.tick, __wash.game.players[0].stunRemaining]), clocks[i]);
    for (let i = 0; i < pages.length; i++) assert.equal(await pages[i].evaluate(() => __wash.renderer.info.programs.length), programs[i], 'charging and shock resources were compiled at boot');
    await host.locator('.pause-continue').click();
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.players[0].stunRemaining === 0 && __wash.game.players[0].state !== 'fallen')));
    for (const page of pages) assert.equal(await page.evaluate(() => __wash.game.effects.entries.get('charging').system.xray.rigs.every(rig => rig.mode === 0)), true, 'X-ray ends with the stun');
    await host.evaluate(() => {
      const sim = __wash.connection.authority.sim; sim.game.chargers[0].pickup(sim.players[0]);
    });
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.game.wet.surfaces.every(surface => surface.marks.every(cell => !cell.live)))));
    await host.locator('#pause-game').click(); await host.locator('.pause-home').click();
    await Promise.all(pages.map(page => page.waitForFunction(() => __wash.ui.page === 'home' && !__wash.ui.iris.active && !__wash.connection.room.homeWaiting.length)));
    for (const page of pages) assert.equal(await page.evaluate(() => __wash.game.chargers[0].connectedSerial === null && __wash.game.wet.surfaces.every(surface => surface.marks.every(mark => !mark.id))), true);
    assert.deepEqual(signaling.filter(type => ['input', 'snapshot', 'blast', 'charge', 'guide_ready'].includes(type)), [], 'charging gameplay never enters the registry WebSocket');
    assert.deepEqual(errors, []);
    console.log('PASS real Chrome/WebRTC: optional charging, host/guest progress/completion, original wet appearance + independent electric effects, stun + X-ray strobe, socket short-circuit blast, pause, boot prewarm and home reset');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
