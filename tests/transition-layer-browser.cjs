/** Real Chrome/WebRTC transitions; host fixtures issue results without claiming manual level completion. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
require('./helpers/browser-locale.cjs');
const url = new URL(process.env.WASH_TEST_URL || 'http://127.0.0.1:18081/');
url.searchParams.set('wash-test', '1');
const output = path.resolve('docs/QA/ui-layers');
const checks = [], errors = [];

async function instrument(page) {
  await page.evaluate(() => {
    const iris = __wash.ui.iris, draw = iris.draw.bind(iris);
    window.__maskSamples = [];
    iris.draw = (...args) => {
      draw(...args);
      if (!iris.active) return;
      const rect = iris.surface.getBoundingClientRect();
      const hits = [.01, .5, .99].flatMap(x => [.01, .5, .99].map(y =>
        !!document.elementFromPoint(innerWidth * x, innerHeight * y)?.closest('#wash-iris-layer')));
      __maskSamples.push({ phase: iris.phase, modal: iris.surface.matches(':modal'),
        full: rect.x === 0 && rect.y === 0 && rect.width === innerWidth && rect.height === innerHeight,
        hits: hits.every(Boolean), inputBlocked: __wash.ui.blocksPlayer,
        foreground: [...__wash.ui.dialogs.keys()].some(name => __wash.ui.isPanelForeground(name)) });
    };
  });
}

// Hold only the existing covered transaction, before it mutates the outgoing scene/UI.
async function arm(page) {
  await page.evaluate(() => {
    const scenes = __wash.scenes, apply = scenes.applyCovered.bind(scenes);
    const gate = new Promise(resolve => { window.__releaseMask = resolve; });
    scenes.applyCovered = async commit => { scenes.applyCovered = apply; await gate; return apply(commit); };
  });
}

async function black(page, label) {
  await page.waitForFunction(() => __wash.ui.iris.phase === 'wait');
  assert.equal(await page.evaluate(() => __wash.ui.showDialog('menu')), false, 'late UI cannot overtake mask');
  const before = await page.evaluate(() => __wash.game.guide.ready);
  await page.keyboard.press('Escape'); await page.keyboard.press('j');
  await page.keyboard.press('y'); await page.keyboard.press('n'); await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => __wash.ui.iris.surface.matches(':modal')), true, 'Escape keeps the cover');
  assert.equal(await page.evaluate(() => __wash.game.guide.ready), before, 'covered guide ignores confirmation');
  assert.equal(await page.evaluate(() => document.activeElement === __wash.ui.iris.surface || __wash.ui.iris.surface.contains(document.activeElement)), true);
  const png = await page.screenshot({ path: path.join(output, `${label}.png`) });
  const pixels = await page.evaluate(async base64 => {
    const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
    const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let different = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] !== 16 || data[i + 1] !== 28 || data[i + 2] !== 25 || data[i + 3] !== 255) different++;
    bitmap.close(); return { width: canvas.width, height: canvas.height, different };
  }, png.toString('base64'));
  assert.equal(pixels.different, 0, `${label}: every viewport pixel must be opaque cover`);
  checks.push({ label, ...pixels }); console.log(`PASS ${label}`);
}
async function release(page) { await page.evaluate(() => __releaseMask()); }
async function idle(pages) { await Promise.all(pages.map(p => p.waitForFunction(() => !__wash.ui.iris.active))); }
async function probe(page, label, dialog = null) {
  await arm(page);
  await page.evaluate(name => { if (name) __wash.ui.showDialog(name); window.__coverProbe = __wash.scenes.covered('layer-audit', () => {}); }, dialog);
  await black(page, label); await release(page); await page.evaluate(() => __coverProbe);
}
async function guides(pages) {
  await Promise.all(pages.map(p => p.waitForSelector('#level-guide[open]')));
  await Promise.all(pages.map(p => p.locator('.level-guide-confirm').click()));
  await Promise.all(pages.map(p => p.waitForFunction(() => __wash.game.roundStage === 'playing' && !__wash.ui.iris.active)));
}
async function transaction(pages, label, action, roles = ['host', 'guest']) {
  for (const p of pages) await arm(p);
  await action();
  for (let i = 0; i < pages.length; i++) { await black(pages[i], `${label}-${roles[i]}`); await release(pages[i]); }
  await idle(pages);
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }), pages = [];
  try {
    for (let i = 0; i < 2; i++) {
      const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
      pages.push(p); p.on('pageerror', e => errors.push(e.message));
      await p.goto(url.href); await p.waitForSelector('body.scene-ready', { timeout: 60000 }); await instrument(p);
    }
    const [host, guest] = pages;
    await host.locator('#settings').click(); await probe(host, 'settings'); await host.locator('#dialog-close').click();
    await host.locator('#select-level').click(); await probe(host, 'level-selection'); await host.locator('#dialog-close').click();
    await host.locator('#customize-player').click(); await probe(host, 'customize'); await host.locator('.customize-cancel').click();
    await host.waitForFunction(() => !__wash.ui.customize.dialog.open);
    // Full viewport coverage must also survive letterboxing, narrow windows and resizes while covered.
    for (const [width, height] of [[1920, 720], [800, 1000], [960, 540]]) {
      await host.setViewportSize({ width, height }); await probe(host, `viewport-${width}x${height}`);
    }
    await host.setViewportSize({ width: 1440, height: 900 });
    await guest.locator('#toggle-join-room').click();
    await guest.locator('#join-code').fill(await host.locator('#room-code-value').textContent());
    await guest.locator('#join-room').click(); await guest.waitForFunction(() => __wash.connection.guest?.open && __wash.network.latest);
    await host.locator('#select-level').click();
    await transaction(pages, 'select-level', () => host.locator('[data-level-id="highway-02"]').click());
    await Promise.all(pages.map(p => p.waitForSelector('#level-guide[open]')));
    await host.keyboard.press('Escape'); await host.locator('.pause-settings').click();
    assert.equal(await host.locator('#level-guide').evaluate(n => n.open), true);
    await probe(host, 'guide-with-settings'); await host.locator('#dialog-close').click();
    await guides(pages);
    await host.locator('#pause-game').click();
    await guest.waitForSelector('#host-notice[open]');
    await probe(host, 'pause'); await probe(guest, 'host-notice');
    await host.locator('.pause-continue').click();
    await host.evaluate(() => { const game = __wash.connection.authority.sim.game; game.score = 999; game.finish('time_up'); });
    await Promise.all(pages.map(p => p.waitForSelector('.result-next')));
    // Reproduce the reported case: keep the result dialog open under the entire closing mask.
    await transaction(pages, 'result-next', () => host.locator('.result-next').click());
    await guides(pages);
    await host.evaluate(() => __wash.connection.authority.sim.game.finish('time_up'));
    await Promise.all(pages.map(p => p.waitForSelector('.result-retry')));
    // User preference and OS preference must each retain the black readiness gate.
    await Promise.all(pages.map(p => p.evaluate(() => __wash.ui.setMotionEnabled(false))));
    await probe(host, 'result-retry-quiet-host'); await probe(guest, 'result-retry-quiet-guest');
    // Same-level retry retains the existing entry-camera path; no different-level mask is requested by it.
    await host.locator('.result-retry').click();
    await guides(pages);
    await Promise.all(pages.map(async p => { await p.emulateMedia({ reducedMotion: 'reduce' }); await p.evaluate(() => __wash.ui.setMotionEnabled(true)); }));
    await host.evaluate(() => __wash.connection.authority.sim.game.finish('time_up'));
    await Promise.all(pages.map(p => p.waitForSelector('.result-home')));
    await transaction(pages, 'result-home-reduced', () => host.locator('.result-home').click());
    await Promise.all(pages.map(p => p.waitForFunction(() => __wash.ui.page === 'home' && !__wash.connection.room.homeWaiting.length)));
    await host.locator('#continue-game').click(); await guides(pages);
    await transaction(pages, 'pause-home-reduced', async () => { await host.locator('#pause-game').click(); await host.locator('.pause-home').click(); });
    await Promise.all(pages.map(p => p.waitForFunction(() => __wash.ui.page === 'home' && !__wash.connection.room.homeWaiting.length)));
    await host.locator('#continue-game').click(); await guides(pages);
    await transaction([guest], 'guest-leave', async () => { await guest.locator('#pause-game').click(); await guest.locator('.pause-home').click(); }, ['guest']);
    await guest.waitForFunction(() => __wash.connection.isHost && __wash.ui.page === 'home');
    // Rejoin uses the same prepared dialog/UI path; this is a layer fixture, not a recovery protocol test.
    await probe(guest, 'rejoin-dialog', 'rejoin');
    await guest.evaluate(() => __wash.ui.close('rejoin', true));
    // Permanent teardown while covered releases native modality and cannot reveal a stale completion.
    await arm(guest); await guest.evaluate(() => { __wash.scenes.covered('dispose-audit', () => {}).catch(() => {}); });
    await black(guest, 'dispose-covered'); await guest.evaluate(async () => { await __wash.app.dispose(); __releaseMask(); });
    assert.equal(await guest.locator('#wash-iris-layer').evaluate(n => n.open), false);
    await host.evaluate(() => { __wash.scenes.covered('failure-audit', () => { throw new Error('Expected transition failure fixture'); }).catch(() => {}); });
    await host.waitForFunction(() => __wash.app.state === 'failed');
    assert.equal(await host.locator('#wash-iris-layer').evaluate(n => n.open), false, 'failure releases top layer for the loading failure message');
    assert.equal(await host.locator('#boot-loading').isVisible(), true);
    assert.match(await host.locator('#boot-label').textContent(), /加载未完成/);
    assert.equal(await host.evaluate(() => __wash.ui.input.enabled), false);
    await host.screenshot({ path: path.join(output, 'failure-message.png') });
    for (const p of pages) {
      const samples = await p.evaluate(() => __maskSamples);
      assert.ok(samples.length > 10);
      assert.ok(samples.every(s => s.modal && s.full && s.hits && s.inputBlocked && !s.foreground), 'every close/wait/open sample stays above UI and blocks input');
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ pass: true, scope: 'same-machine Chrome/WebRTC; result and rejoin layer fixtures', checks, errors }, null, 2));
    console.log(`PASS ${checks.length} opaque covers, all animated phase samples, input gates and teardown`);
  } catch (error) {
    for (let i = 0; i < pages.length; i++) await pages[i].screenshot({ path: path.join(output, `failure-${i}.png`) }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
