/** Real same-machine Chrome/WebRTC: dirt HUD follows drawn moving hulls while walking/scrubbing. */
const assert = require('node:assert/strict'), fs = require('node:fs');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const { installGuideReader } = require('./helpers/guide-browser.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:8080/'); url.searchParams.set('wash-test', '1');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  await installGuideReader(browser);
  const errors = [], pages = [], samples = [];
  const out = 'docs/QA/merge-2026-10-15'; fs.mkdirSync(out, { recursive: true });
  try {
    for (let i = 0; i < 2; i++) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 810 } }); pages.push(page);
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(url.href); await page.waitForSelector('body.scene-ready', { timeout: 90000 });
    }
    const [host, guest] = pages;
    await guest.locator('#toggle-join-room').click(); await guest.locator('#join-code').fill(await host.locator('#room-code-value').textContent());
    await guest.locator('#join-room').click(); await guest.waitForFunction(() => __wash.connection.guest?.open);
    await host.locator('#select-level').click(); await host.locator('[data-level-id="highway-02"]').click();
    await host.waitForFunction(() => __wash.game.roundStage === 'playing' && __wash.game.orders[0]?.arrivalProgress === 1);
    await host.evaluate(() => {
      const sim = __wash.connection.authority.sim, order = sim.game.orders[0], truck = order.truck;
      for (const slot of [0, 1]) {
        const p = sim.players[slot], stain = order.stains[slot];
        const pos = stain.mesh.position;
        p.state = 'ground'; p.ground = { truck, plat: truck.platforms[0] };
        p.pos.set(truck.pos.x + pos.x - .6, truck.topY, truck.pos.z + pos.z);
        p.root.position.copy(p.pos); p.vel.set(0, 0, 0); p.externalVelocity.set(0, 0, 0); p.yaw = 0;
        sim.game.towels[slot].pickup(p); p.skipUse = false;
      }
    });
    await Promise.all(pages.map(p => p.waitForFunction(() => __wash.players[__wash.connection.room.slot].heldTool?.kind === 'towel')));
    for (const page of pages) await page.evaluate(() => {
      const pos = __wash.ui.hudPositioner, place = pos.place.bind(pos);
      window.__anchorSamples = [];
      pos.place = function(node, anchor, options) {
        place(node, anchor, options);
        if (!node.classList.contains('stain-badge') || node.hidden) return;
        const raw = anchor.clone().project(__wash.camera), xy = node.style.transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px/).slice(1).map(Number);
        __anchorSamples.push({ lag: Math.hypot(xy[0] - (raw.x + 1) * 720, xy[1] - (1 - raw.y) * 405), immediate: options.immediate,
          use: __wash.players[__wash.connection.room.slot].useAction, x: xy[0], y: xy[1] });
      };
    });
    await Promise.all(pages.map(p => p.keyboard.down('j')));
    await host.waitForTimeout(800);
    for (const key of ['a', 'd', 'w', 's']) {
      await Promise.all(pages.map(p => p.keyboard.down(key))); await host.waitForTimeout(130);
      await Promise.all(pages.map(p => p.keyboard.up(key)));
    }
    await host.waitForTimeout(500);
    for (const [i, page] of pages.entries()) {
      await page.keyboard.up('j'); const frames = await page.evaluate(() => __anchorSamples);
      const lags = frames.map(f => f.lag).sort((a,b) => a-b);
      assert.ok(frames.length > 60); assert.ok(frames.some(f => f.use === 'wipe'), 'actual authoritative scrubbing occurred');
      assert.ok(frames.every(f => f.immediate)); assert.ok(lags.at(-1) <= .18, 'quarter-pixel rounding only, no 6px damping');
      samples.push({ role: i ? 'guest' : 'host', samples: frames.length, median: lags[Math.floor(lags.length/2)], max: lags.at(-1), scrubbing: frames.filter(f=>f.use==='wipe').length });
      await page.screenshot({ path: `${out}/hud-${i ? 'guest' : 'host'}.png` });
    }
    assert.deepEqual(errors, []); fs.writeFileSync(`${out}/hud-metrics.json`, JSON.stringify({ samples, errors }, null, 2));
    console.log(JSON.stringify(samples));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
